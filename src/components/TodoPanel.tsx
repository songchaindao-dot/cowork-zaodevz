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

// ─── Types ───────────────────────────────────────────────────────────────────

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: ParsedAction[];
};

type Chat = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

// ─── Storage helpers ─────────────────────────────────────────────────────────

function chatsKey(user: string) { return `zao-ai-chats:${user}`; }
function activeKey(user: string) { return `zao-ai-active:${user}`; }

function loadChats(user: string): Chat[] {
  try {
    const raw = localStorage.getItem(chatsKey(user));
    return raw ? (JSON.parse(raw) as Chat[]) : [];
  } catch { return []; }
}

function persistChats(user: string, chats: Chat[]) {
  try { localStorage.setItem(chatsKey(user), JSON.stringify(chats)); } catch {}
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

const WELCOME = "Hi! Tell me what you need — I can create tasks, update statuses, add notes, or answer questions about the board.";

function makeWelcome(): ChatMessage {
  return { id: "welcome", role: "assistant", content: WELCOME };
}

function makeNewChat(): Chat {
  const now = new Date().toISOString();
  return { id: genId(), title: "New chat", createdAt: now, updatedAt: now, messages: [makeWelcome()] };
}

function relativeDate(iso: string): string {
  const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function groupChats(chats: Chat[]): { label: string; items: Chat[] }[] {
  const sorted = [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const today: Chat[] = [], yesterday: Chat[] = [], week: Chat[] = [], older: Chat[] = [];
  sorted.forEach(c => {
    const d = Math.floor((Date.now() - new Date(c.updatedAt).getTime()) / 86400000);
    if (d === 0) today.push(c);
    else if (d === 1) yesterday.push(c);
    else if (d < 7) week.push(c);
    else older.push(c);
  });
  return [
    { label: "Today", items: today },
    { label: "Yesterday", items: yesterday },
    { label: "Last 7 days", items: week },
    { label: "Older", items: older },
  ].filter(g => g.items.length > 0);
}

// ─── Main component ───────────────────────────────────────────────────────────

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
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileView, setMobileView] = useState<"sidebar" | "chat">("chat");
  const [input, setInput] = useState("");
  const [pendingActions, setPendingActions] = useState<ParsedAction[]>([]);
  const [chatPending, startChat] = useTransition();
  const [applyPending, startApply] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load chats from localStorage on open
  useEffect(() => {
    if (!open) return;
    const loaded = loadChats(currentUser);
    const savedActiveId = localStorage.getItem(activeKey(currentUser));
    if (loaded.length === 0) {
      const first = makeNewChat();
      setChats([first]);
      setActiveChatId(first.id);
      persistChats(currentUser, [first]);
      localStorage.setItem(activeKey(currentUser), first.id);
    } else {
      setChats(loaded);
      const valid = loaded.find(c => c.id === savedActiveId);
      const id = valid ? savedActiveId! : loaded[0].id;
      setActiveChatId(id);
    }
  }, [open, currentUser]);

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [input]);

  // Focus input when chat pane is active
  useEffect(() => {
    if (open && mobileView === "chat") setTimeout(() => inputRef.current?.focus(), 80);
  }, [open, mobileView, activeChatId]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  // Scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats, chatPending, activeChatId]);

  const activeChat = chats.find(c => c.id === activeChatId) ?? null;
  const messages = activeChat?.messages ?? [];

  // ── Chat actions ────────────────────────────────────────────────────────────

  function switchChat(id: string) {
    setActiveChatId(id);
    localStorage.setItem(activeKey(currentUser), id);
    setPendingActions([]);
    setInput("");
    setMobileView("chat");
  }

  function createNewChat() {
    const chat = makeNewChat();
    setChats(prev => {
      const next = [chat, ...prev];
      persistChats(currentUser, next);
      return next;
    });
    setActiveChatId(chat.id);
    localStorage.setItem(activeKey(currentUser), chat.id);
    setPendingActions([]);
    setInput("");
    setMobileView("chat");
    setTimeout(() => inputRef.current?.focus(), 80);
  }

  function deleteChat(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const remaining = chats.filter(c => c.id !== id);
    let nextChats: Chat[];
    let nextId: string;
    if (remaining.length === 0) {
      const fresh = makeNewChat();
      nextChats = [fresh];
      nextId = fresh.id;
    } else {
      nextChats = remaining;
      nextId = activeChatId === id ? remaining[0].id : activeChatId!;
    }
    persistChats(currentUser, nextChats);
    localStorage.setItem(activeKey(currentUser), nextId);
    setChats(nextChats);
    setActiveChatId(nextId);
    if (activeChatId === id) setPendingActions([]);
  }

  function sendMessage() {
    const msg = input.trim();
    if (!msg || chatPending || !activeChatId) return;
    const chatId = activeChatId;
    setInput("");
    setPendingActions([]);

    const userMsg: ChatMessage = { id: genId(), role: "user", content: msg };
    const isFirst = !messages.some(m => m.role === "user");
    const autoTitle = isFirst ? msg.slice(0, 40) + (msg.length > 40 ? "…" : "") : undefined;

    // history for AI (strip welcome)
    const history = [...messages, userMsg]
      .filter(m => m.id !== "welcome")
      .map(m => ({ role: m.role, content: m.content }));

    setChats(prev => {
      const next = prev.map(c => c.id === chatId ? {
        ...c,
        title: autoTitle ?? c.title,
        updatedAt: new Date().toISOString(),
        messages: [...c.messages, userMsg],
      } : c);
      persistChats(currentUser, next);
      return next;
    });

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
      setChats(prev => {
        const next = prev.map(c => c.id === chatId ? {
          ...c,
          updatedAt: new Date().toISOString(),
          messages: [...c.messages, assistantMsg],
        } : c);
        persistChats(currentUser, next);
        return next;
      });
      if (res.actions.length > 0) setPendingActions(res.actions);
    });
  }

  function removeAction(msgId: string, idx: number) {
    if (!activeChatId) return;
    const chatId = activeChatId;
    setChats(prev => {
      const next = prev.map(c => {
        if (c.id !== chatId) return c;
        return {
          ...c,
          messages: c.messages.map(m => {
            if (m.id !== msgId) return m;
            const updated = (m.actions || []).filter((_, i) => i !== idx);
            return { ...m, actions: updated.length ? updated : undefined };
          }),
        };
      });
      persistChats(currentUser, next);
      return next;
    });
    setPendingActions(prev => prev.filter((_, i) => i !== idx));
  }

  function applyChanges() {
    if (!activeChatId) return;
    const chatId = activeChatId;
    const toApply = pendingActions;
    startApply(async () => {
      const fd = new FormData();
      fd.set("actions", JSON.stringify(toApply));
      const res = await todoProcess(fd);
      setPendingActions([]);
      const parts: string[] = [];
      if (res.created > 0) parts.push(`${res.created} task${res.created !== 1 ? "s" : ""} created`);
      if (res.updated > 0) parts.push(`${res.updated} updated`);
      const summary = parts.join(" · ") || "No changes applied";
      setChats(prev => {
        const next = prev.map(c => c.id === chatId ? {
          ...c,
          updatedAt: new Date().toISOString(),
          messages: [...c.messages, { id: genId(), role: "assistant" as const, content: `Done! ${summary}.` }],
        } : c);
        persistChats(currentUser, next);
        return next;
      });
    });
  }

  if (!open) return null;

  const activeCount = items.filter(i => i.status !== "DONE").length;
  const groups = groupChats(chats);

  // ── Sidebar content (shared between mobile/desktop) ─────────────────────────
  const sidebar = (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2.5 flex-shrink-0">
        <button
          onClick={createNewChat}
          className="w-full flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.07] px-3 py-2.5 text-sm text-white/60 hover:text-white/90 transition text-left"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3v10M3 8h10" />
          </svg>
          New chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-2">
        {groups.map(group => (
          <div key={group.label}>
            <div className="px-2 py-1.5 text-[10px] text-white/25 uppercase tracking-wider font-semibold">
              {group.label}
            </div>
            {group.items.map(chat => (
              <button
                key={chat.id}
                onClick={() => switchChat(chat.id)}
                className={`group w-full flex items-start gap-2 px-2.5 py-2 text-left rounded-xl transition mb-0.5 ${
                  chat.id === activeChatId
                    ? "bg-white/[0.09] text-white/90"
                    : "hover:bg-white/[0.05] text-white/60"
                }`}
              >
                <svg className="flex-shrink-0 mt-0.5 text-white/20" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 10a2 2 0 01-2 2H5l-3 3V4a2 2 0 012-2h8a2 2 0 012 2v6z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] leading-snug truncate">{chat.title}</div>
                  <div className="text-[10px] text-white/25 mt-0.5">{relativeDate(chat.updatedAt)}</div>
                </div>
                <button
                  onClick={e => deleteChat(chat.id, e)}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 transition text-sm leading-none px-1 pt-0.5"
                  title="Delete chat"
                >
                  ×
                </button>
              </button>
            ))}
          </div>
        ))}
        {chats.length === 0 && (
          <p className="text-[11px] text-white/25 text-center py-6">No chats yet</p>
        )}
      </div>
    </div>
  );

  // ── Chat content ────────────────────────────────────────────────────────────
  const chat = (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} onRemoveAction={i => removeAction(msg.id, i)} />
        ))}
        {chatPending && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {pendingActions.length > 0 && !chatPending && (
        <div className="px-4 py-2.5 border-t border-white/[0.06] flex-shrink-0">
          <button
            onClick={applyChanges}
            disabled={applyPending}
            className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-4 py-2 text-sm font-semibold transition"
          >
            {applyPending ? "Applying…" : `Apply ${pendingActions.length} change${pendingActions.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}

      <div className="px-3 pb-safe-or-3 pb-3 pt-2 border-t border-white/[0.08] flex-shrink-0 flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
          }}
          placeholder="Ask anything about your tasks…"
          disabled={chatPending}
          rows={1}
          className="flex-1 bg-[#0b1220] rounded-xl px-4 py-2.5 text-sm text-white/85 placeholder-white/25 focus:outline-none focus:ring-1 focus:ring-blue-500/40 disabled:opacity-50 transition resize-none overflow-hidden"
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || chatPending}
          className="flex-shrink-0 self-end rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-default px-4 py-2.5 text-sm font-semibold transition"
        >
          →
        </button>
      </div>
    </>
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Mobile-only backdrop */}
      <div
        className="fixed inset-0 z-40 md:hidden"
        style={{ background: "rgba(2,8,20,0.75)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />

      {/* Panel: full-screen on mobile, bottom-right panel on desktop */}
      <div
        className="fixed z-50 flex flex-col overflow-hidden border border-white/[0.12] shadow-2xl
          inset-0
          md:inset-auto md:bottom-20 md:right-6 md:w-[740px] md:h-[580px] md:rounded-2xl"
        style={{ background: "#07111e" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] flex-shrink-0">
          <div className="flex items-center gap-2">
            {/* Toggle sidebar (desktop) / switch to sidebar view (mobile) */}
            <button
              onClick={() => {
                if (typeof window !== "undefined" && window.innerWidth < 768) {
                  setMobileView(v => v === "sidebar" ? "chat" : "sidebar");
                } else {
                  setSidebarOpen(v => !v);
                }
              }}
              className="text-white/35 hover:text-white/80 transition p-1.5 rounded-lg hover:bg-white/[0.06]"
              title="Chat history"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
                <line x1="5.5" y1="1.5" x2="5.5" y2="14.5" />
              </svg>
            </button>
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500/20 border border-blue-500/30">
              <span className="text-blue-300 text-[11px] leading-none">✦</span>
            </div>
            <span className="text-sm font-semibold text-white truncate max-w-[160px] sm:max-w-[300px]">
              {mobileView === "sidebar" ? "Chat history" : (activeChat && activeChat.title !== "New chat" ? activeChat.title : "Task AI")}
            </span>
            <span className="hidden sm:inline text-[11px] text-white/30 ml-1">{activeCount} active</span>
          </div>

          <div className="flex items-center gap-1">
            {/* Mobile: chip to switch between chat and sidebar */}
            <button
              onClick={() => setMobileView(v => v === "sidebar" ? "chat" : "sidebar")}
              className="md:hidden flex items-center gap-1.5 text-[12px] text-white/60 hover:text-white transition px-2.5 py-1.5 rounded-lg border border-white/[0.08] hover:bg-white/[0.07] active:scale-95"
            >
              {mobileView === "sidebar" ? (
                <>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 1L3 6l5 5"/></svg>
                  Back
                </>
              ) : (
                <>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="1" width="10" height="10" rx="1.5"/><line x1="4" y1="1" x2="4" y2="11"/></svg>
                  Chats
                </>
              )}
            </button>
            <button
              onClick={createNewChat}
              className="text-white/35 hover:text-white/80 transition p-1.5 rounded-lg hover:bg-white/[0.06]"
              title="New chat"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v10M3 8h10" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="text-white/35 hover:text-white/80 transition p-1.5 rounded-lg hover:bg-white/[0.06] text-xl leading-none"
              title="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Desktop sidebar */}
          {sidebarOpen && (
            <div className="hidden md:flex flex-col w-52 flex-shrink-0 border-r border-white/[0.07] bg-black/20">
              {sidebar}
            </div>
          )}

          {/* Mobile: sidebar view */}
          {mobileView === "sidebar" && (
            <div className="flex md:hidden flex-col flex-1 bg-black/20">
              {sidebar}
            </div>
          )}

          {/* Chat view */}
          <div className={`flex flex-col flex-1 min-w-0 ${mobileView === "sidebar" ? "hidden md:flex" : "flex"}`}>
            {chat}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

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
          <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap">{msg.content}</p>
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

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-2.5 items-start">
      <div className="flex-shrink-0 h-6 w-6 mt-0.5 rounded-md bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
        <span className="text-blue-300 text-[11px] leading-none">✦</span>
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-white/[0.05] border border-white/[0.08] px-4 py-3">
        <div className="flex gap-1 items-center">
          {[0, 150, 300].map(delay => (
            <span
              key={delay}
              className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Action card ──────────────────────────────────────────────────────────────

function ActionCard({ action, onRemove }: { action: ParsedAction; onRemove: () => void }) {
  const removeBtn = (
    <button onClick={onRemove} className="flex-shrink-0 text-white/20 hover:text-white/60 transition text-base leading-none ml-1">×</button>
  );

  if (action.type === "create") {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5 flex items-start gap-2">
        <span className="mt-0.5 flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-semibold uppercase tracking-wide">New</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white/85 font-medium leading-snug">{action.title}</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {action.owner ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-white/15 text-white/55">{action.owner}</span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">Claimable</span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 text-white/45">{STATUS_LABEL[action.status] ?? action.status}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-white/10 text-white/45">{action.priority}</span>
          </div>
        </div>
        {removeBtn}
      </div>
    );
  }

  if (action.type === "update_status") {
    return (
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.05] px-3 py-2.5 flex items-center gap-2">
        <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-blue-500/40 bg-blue-500/10 text-blue-300 font-semibold uppercase tracking-wide">Status</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white/75 leading-snug truncate">{action.matchedTitle}</p>
          <p className="text-[11px] text-blue-300/70 mt-0.5">→ {STATUS_LABEL[action.newStatus] ?? action.newStatus}</p>
        </div>
        {removeBtn}
      </div>
    );
  }

  if (action.type === "add_note") {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 flex items-start gap-2">
        <span className="mt-0.5 flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-amber-500/35 bg-amber-500/[0.08] text-amber-300 font-semibold uppercase tracking-wide">Note</span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-white/40 truncate mb-0.5">{action.matchedTitle}</p>
          <p className="text-sm text-white/70 leading-snug line-clamp-2">{action.note}</p>
        </div>
        {removeBtn}
      </div>
    );
  }

  return null;
}

// ─── Trigger button ───────────────────────────────────────────────────────────

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
