"use client";

import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";
type Message = { role: Role; content: string };

type Provider = "minimax" | "openai" | "claude";
const PROVIDERS: Provider[] = ["minimax", "openai", "claude"];

// Per-user provider + key + model persistence via localStorage.
// Keys never leave the browser except in the x-byok-key header per request.
const LS_PROVIDER = "cowork-chat-provider";
const LS_MODEL_PREFIX = "cowork-chat-model-";
const LS_KEY_PREFIX = "cowork-chat-key-";

const SUGGESTIONS = [
  "What should I work on next?",
  "What's blocked right now?",
  "Any aging items I'm ignoring?",
  "Summarize the board in 3 lines",
];

const GREETING =
  "Ask me anything about the board. I can see every item, its status, owner, priority, and age. Try one of the prompts below.";

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProviderState] = useState<Provider>("minimax");
  const [model, setModelState] = useState<string>("");
  const [byokKey, setByokKeyState] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Load persisted provider + per-provider model + key on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = (localStorage.getItem(LS_PROVIDER) as Provider) || "minimax";
    setProviderState(p);
    setModelState(localStorage.getItem(LS_MODEL_PREFIX + p) ?? "");
    setByokKeyState(localStorage.getItem(LS_KEY_PREFIX + p) ?? "");
  }, []);

  function setProvider(p: Provider) {
    setProviderState(p);
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_PROVIDER, p);
      setModelState(localStorage.getItem(LS_MODEL_PREFIX + p) ?? "");
      setByokKeyState(localStorage.getItem(LS_KEY_PREFIX + p) ?? "");
    }
  }
  function setModel(m: string) {
    setModelState(m);
    if (typeof window !== "undefined") localStorage.setItem(LS_MODEL_PREFIX + provider, m);
  }
  function setByokKey(k: string) {
    setByokKeyState(k);
    if (typeof window !== "undefined") {
      if (k) localStorage.setItem(LS_KEY_PREFIX + provider, k);
      else localStorage.removeItem(LS_KEY_PREFIX + provider);
    }
  }

  // Stick to the bottom as tokens stream in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Cancel any in-flight stream if the component unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(text: string) {
    const content = text.trim();
    if (!content || streaming) return;
    setError(null);
    setInput("");

    const next: Message[] = [...messages, { role: "user", content }];
    // Optimistically add an empty assistant message we stream into.
    setMessages([...next, { role: "assistant", content: "" }]);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (byokKey.trim()) headers["x-byok-key"] = byokKey.trim();
      const reqBody: Record<string, unknown> = { messages: next, provider };
      if (model.trim()) reqBody.model = model.trim();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify(reqBody),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let detail = `Request failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) detail = j.error;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(detail);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }

      if (!acc.trim()) {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: "assistant",
            content: "(no response — try rephrasing)",
          };
          return copy;
        });
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      // Drop the empty assistant placeholder on failure.
      setMessages((prev) => {
        const copy = [...prev];
        if (
          copy.length &&
          copy[copy.length - 1].role === "assistant" &&
          !copy[copy.length - 1].content
        ) {
          copy.pop();
        }
        return copy;
      });
      if (!aborted) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      taRef.current?.focus();
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="flex flex-col h-[min(70vh,640px)]">
      {/* Provider bar */}
      <div className="mb-2 flex items-center gap-2 text-xs text-white/60">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as Provider)}
          className="bg-black/30 border border-white/10 rounded px-2 py-1 text-white/80"
          aria-label="LLM provider"
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="text-white/50 hover:text-white/80"
          aria-label="provider settings"
        >
          {showSettings ? "hide settings" : "settings"}
        </button>
        {byokKey ? <span className="text-teal-400/80">BYOK</span> : <span className="text-white/30">env key</span>}
      </div>
      {showSettings && (
        <div className="mb-3 rounded-xl bg-black/40 border border-white/10 p-3 space-y-2 text-xs">
          <div>
            <label className="block text-white/50 mb-1">model override (blank = server default)</label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={
                provider === "minimax" ? "MiniMax-M2.7" : provider === "openai" ? "gpt-4o-mini" : "claude-haiku-4-5-20251001"
              }
              className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-white"
            />
          </div>
          <div>
            <label className="block text-white/50 mb-1">your {provider} api key (BYOK, stored in this browser only)</label>
            <input
              type="password"
              value={byokKey}
              onChange={(e) => setByokKey(e.target.value)}
              placeholder="leave blank to use server env key"
              className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-white"
            />
            <p className="text-white/40 mt-1">key sent in x-byok-key header per request. never stored server-side. clear by emptying this field.</p>
          </div>
        </div>
      )}
      {/* Transcript */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-3 pr-1"
      >
        {empty && (
          <div className="rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-white/60">
            {GREETING}
          </div>
        )}

        {messages.map((m, i) => (
          <Bubble
            key={i}
            role={m.role}
            content={m.content}
            streaming={
              streaming && i === messages.length - 1 && m.role === "assistant"
            }
          />
        ))}

        {error && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Suggestions — only before the first turn */}
      {empty && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="text-xs rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] px-3 py-1.5 text-white/70 transition"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="mt-3 flex items-end gap-2">
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Ask about the board…"
          className="flex-1 resize-none rounded-xl bg-black/30 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-white/30 focus:outline-none focus:border-teal-400/60 focus:ring-1 focus:ring-teal-400/30 max-h-32"
        />
        {streaming ? (
          <button
            onClick={stop}
            className="rounded-xl border border-white/15 bg-white/[0.06] hover:bg-white/[0.1] px-4 py-2.5 text-sm font-medium text-white/80"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={() => send(input)}
            disabled={!input.trim()}
            className="rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:hover:bg-teal-500 px-4 py-2.5 text-sm font-medium text-black transition shadow-lg shadow-teal-500/20"
          >
            Send
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-white/30">
        Enter to send · Shift+Enter for a new line · the assistant reads the live board but cannot edit it
      </p>
    </div>
  );
}

function Bubble({
  role,
  content,
  streaming,
}: {
  role: Role;
  content: string;
  streaming: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
          isUser
            ? "bg-blue-500/20 border border-blue-500/30 text-blue-50"
            : "bg-white/[0.06] border border-white/10 text-white/85"
        }`}
      >
        {content || (streaming ? "" : "")}
        {streaming && (
          <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle bg-teal-400/80 animate-pulse" />
        )}
      </div>
    </div>
  );
}
