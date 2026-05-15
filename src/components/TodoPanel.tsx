"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ActionItem } from "@/lib/types";
import type { ParsedAction } from "@/lib/todo-parser";
import { chatWithTodoBot, todoProcess } from "@/app/actions";

const STATUS_LABEL: Record<string, string> = {
  TODO: "To Do",
  WIP: "In Progress",
  BLOCKED: "Blocked",
  DONE: "Done",
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: ParsedAction[];
};

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi! Tell me what you need — I can create tasks, update statuses, add notes, or answer questions about what's happening.",
};

export function TodoPanel({
  items,
  open,
  onClose,
  currentUser,
}: {
  items: ActionItem[];
  open: boolean;
  onClose: () => void;
  currentUser: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [pendingActions, setPendingActions] = useState<ParsedAction[]>([]);
  const [chatPending, startChat] = useTransition();
  const [applyPending, startApply] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatPending]);

  function handleClose() {
    onClose();
    setTimeout(() => {
      setMessages([WELCOME]);
      setInput("");
      setPendingActions([]);
    }, 300);
  }

  function sendMessage() {
    const msg = input.trim();
    if (!msg || chatPending) return;
    setInput("");
    setPendingActions([]);

    const userMsg: ChatMessage = { id: genId(), role: "user", content: msg };
    setMessages((prev) => [...prev, userMsg]);

    // Build history (strip welcome, use clean text only)
    const history = [...messages, userMsg]
      .filter((m) => m.id !== "welcome")
      .map((m) => ({ role: m.role, content: m.content }));

    startChat(async () => {
      const fd = new FormData();
      fd.set("messages", JSON.stringify(history));
      const res = await chatWithTodoBot(fd);

      const assistantMsg: ChatMessage = {
        id: genId(),
        role: "assistant",
        content: res.reply,
        actions: res.actions.length > 0 ? res.actions : undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (res.actions.length > 0) setPendingActions(res.actions);
    });
  }

  function removeAction(msgId: string, actionIdx: number) {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const updated = (m.actions || []).filter((_, i) => i !== actionIdx);
        return { ...m, actions: updated.length ? updated : undefined };
      }),
    );
    setPendingActions((prev) => prev.filter((_, i) => i !== actionIdx));
  }

  function applyChanges() {
    startApply(async () => {
      const fd = new FormData();
      fd.set("actions", JSON.stringify(pendingActions));
      const res = await todoProcess(fd);
      setPendingActions([]);

      const parts: string[] = [];
      if (res.created > 0) parts.push(`${res.created} task${res.created !== 1 ? "s" : ""} created`);
      if (res.updated > 0) parts.push(`${res.updated} updated`);
      const summary = parts.length ? parts.join(" · ") : "No changes applied";

      setMessages((prev) => [
        ...prev,
        { id: genId(), role: "assistant", content: `Done! ${summary}.` },
      ]);
    });
  }

  if (!open) return null;

  const activeCount = items.filter((i) => i.status !== "DONE").length;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <button
        className="absolute inset-0 w-full h-full"
        style={{ background: "rgba(2,8,20,0.85)", backdropFilter: "blur(6px)" }}
        onClick={handleClose}
        tabIndex={-1}
        aria-label="Close"
      />

      <div
        className="relative w-full sm:max-w-xl flex flex-col rounded-t-2xl sm:rounded-2xl border border-white/[0.12] shadow-2xl overflow-hidden"
        style={{ background: "#07111e", height: "min(90vh, 680px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/20 border border-blue-500/30">
              <span className="text-blue-300 text-sm leading-none">✦</span>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white leading-none">Task Assistant</h2>
              <p className="text-[11px] text-white/40 mt-0.5 leading-none">
                AI · {activeCount} active task{activeCount !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-white/35 hover:text-white/80 text-xl leading-none transition"
          >
            ×
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onRemoveAction={(i) => removeAction(msg.id, i)}
            />
          ))}
          {chatPending && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* Apply bar */}
        {pendingActions.length > 0 && !chatPending && (
          <div className="px-4 py-3 border-t border-white/[0.06] flex-shrink-0">
            <button
              onClick={applyChanges}
              disabled={applyPending}
              className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-default px-4 py-2.5 text-sm font-semibold transition"
            >
              {applyPending
                ? "Applying…"
                : `Apply ${pendingActions.length} change${pendingActions.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        )}

        {/* Input */}
        <div className="px-4 pb-4 pt-2 border-t border-white/[0.08] flex-shrink-0 flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Ask anything about your tasks…"
            disabled={chatPending}
            className="flex-1 bg-[#0b1220] rounded-xl px-4 py-2.5 text-sm text-white/85 placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-blue-500/40 disabled:opacity-50 transition"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || chatPending}
            className="flex-shrink-0 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-default px-4 py-2.5 text-sm font-semibold transition"
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  onRemoveAction,
}: {
  msg: ChatMessage;
  onRemoveAction: (i: number) => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-blue-600/25 border border-blue-500/20 px-4 py-2.5">
          <p className="text-sm text-white/90 leading-relaxed">{msg.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 items-start">
      <div className="flex-shrink-0 h-6 w-6 mt-0.5 rounded-md bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
        <span className="text-blue-300 text-[11px] leading-none">✦</span>
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <div className="rounded-2xl rounded-tl-sm bg-white/[0.05] border border-white/[0.08] px-4 py-2.5 inline-block max-w-full">
          <p className="text-sm text-white/85 leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        </div>
        {msg.actions && msg.actions.length > 0 && (
          <div className="space-y-1.5">
            {msg.actions.map((action, i) => (
              <ActionCard key={i} action={action} onRemove={() => onRemoveAction(i)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-2.5 items-start">
      <div className="flex-shrink-0 h-6 w-6 mt-0.5 rounded-md bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
        <span className="text-blue-300 text-[11px] leading-none">✦</span>
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-white/[0.05] border border-white/[0.08] px-4 py-3">
        <div className="flex gap-1 items-center">
          <span
            className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce"
            style={{ animationDelay: "300ms" }}
          />
        </div>
      </div>
    </div>
  );
}

function ActionCard({
  action,
  onRemove,
}: {
  action: ParsedAction;
  onRemove: () => void;
}) {
  if (action.type === "create") {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5 flex items-start gap-2">
        <span className="mt-0.5 flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-semibold uppercase tracking-wide">
          New
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white/85 font-medium leading-snug">{action.title}</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {action.owner ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-white/15 text-white/55">
                {action.owner}
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">
                Claimable
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 text-white/45">
              {STATUS_LABEL[action.status] ?? action.status}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 text-white/45">
              {action.priority}
            </span>
          </div>
        </div>
        <button
          onClick={onRemove}
          className="flex-shrink-0 text-white/20 hover:text-white/60 transition text-base leading-none ml-1"
        >
          ×
        </button>
      </div>
    );
  }

  if (action.type === "update_status") {
    return (
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.05] px-3 py-2.5 flex items-center gap-2">
        <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-blue-500/40 bg-blue-500/10 text-blue-300 font-semibold uppercase tracking-wide">
          Status
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white/75 leading-snug truncate">{action.matchedTitle}</p>
          <p className="text-[11px] text-blue-300/70 mt-0.5">
            → {STATUS_LABEL[action.newStatus] ?? action.newStatus}
          </p>
        </div>
        <button
          onClick={onRemove}
          className="flex-shrink-0 text-white/20 hover:text-white/60 transition text-base leading-none ml-1"
        >
          ×
        </button>
      </div>
    );
  }

  if (action.type === "add_note") {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 flex items-start gap-2">
        <span className="mt-0.5 flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-amber-500/35 bg-amber-500/[0.08] text-amber-300 font-semibold uppercase tracking-wide">
          Note
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-white/40 truncate mb-0.5">{action.matchedTitle}</p>
          <p className="text-sm text-white/70 leading-snug line-clamp-2">{action.note}</p>
        </div>
        <button
          onClick={onRemove}
          className="flex-shrink-0 text-white/20 hover:text-white/60 transition text-base leading-none ml-1"
        >
          ×
        </button>
      </div>
    );
  }

  return null;
}

export function TodoTrigger({
  onClick,
  claimableCount,
}: {
  onClick: () => void;
  claimableCount: number;
}) {
  return (
    <button
      onClick={onClick}
      className="group fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full border border-blue-500/30 bg-[#07111e] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-900/30 transition-all hover:border-blue-400/50 hover:bg-[#0a1828] hover:shadow-blue-700/40 hover:shadow-xl active:scale-95"
      style={{ backdropFilter: "blur(12px)" }}
      aria-label="Open Task Assistant"
    >
      <span className="text-blue-400 text-base leading-none transition group-hover:rotate-12">✦</span>
      <span className="text-white/90">Ask AI</span>
      {claimableCount > 0 && (
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-black text-[10px] font-bold leading-none">
          {claimableCount}
        </span>
      )}
    </button>
  );
}
