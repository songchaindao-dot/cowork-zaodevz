import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getActions, ageDays, cycleDays, type ActionItem } from "@/lib/data";
import {
  callProvider,
  deltaExtractorFor,
  isProvider,
  PROVIDER_CONFIG,
  resolveApiKey,
  type ChatTurn,
  type Provider,
} from "@/lib/llm-providers";

// getActions() touches node:fs / fetch and auth touches node:crypto — keep on the
// Node.js runtime. force-dynamic so the board snapshot is never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// v2.9 - default provider unless client overrides. Configurable via env.
const DEFAULT_PROVIDER: Provider = (process.env.CHAT_DEFAULT_PROVIDER as Provider) || "minimax";

// Cap conversation history sent upstream so token cost stays bounded.
const MAX_HISTORY = 14;

type ChatRole = "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };

function isChatMessage(v: unknown): v is ChatMessage {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string"
  );
}

/** One compact line per item: `#12 [P1] Title — Owner · Category · 9d` */
function itemLine(it: ActionItem): string {
  const age = ageDays(it.createdAt);
  const cycle = cycleDays(it.createdAt, it.updatedAt, it.status);
  const tail =
    it.status === "DONE"
      ? cycle != null
        ? `${cycle}d cycle`
        : "done"
      : `${age}d old`;
  const flags = [it.important ? "important" : "", it.urgent ? "urgent" : ""]
    .filter(Boolean)
    .join("+");
  return `#${it.id} [${it.priority}] ${it.title} — ${it.owner} · ${it.category}${
    flags ? ` · ${flags}` : ""
  } · ${tail}`;
}

/** Snapshot of the live board, grouped by status, for the model's context. */
function boardSnapshot(items: ActionItem[]): string {
  const groups: Record<string, ActionItem[]> = {
    TODO: [],
    WIP: [],
    BLOCKED: [],
    DONE: [],
  };
  for (const it of items) (groups[it.status] ??= []).push(it);

  const sections: string[] = [];
  for (const status of ["BLOCKED", "WIP", "TODO", "DONE"] as const) {
    const g = groups[status] ?? [];
    if (!g.length) continue;
    // DONE can get long — only surface the most recent dozen.
    const list =
      status === "DONE"
        ? [...g]
            .sort(
              (a, b) =>
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime(),
            )
            .slice(0, 12)
        : g;
    sections.push(
      `## ${status} (${g.length})\n${list.map(itemLine).join("\n")}`,
    );
  }
  return sections.join("\n\n") || "The board is empty.";
}

function systemPrompt(user: string, items: ActionItem[]): string {
  const who = user === "zaal" ? "Zaal" : "Iman";
  const open = items.filter((x) => x.status !== "DONE").length;
  const blocked = items.filter((x) => x.status === "BLOCKED").length;
  const aging = items.filter(
    (x) => x.status !== "DONE" && ageDays(x.createdAt) > 14,
  ).length;

  return [
    `You are the Co-Works Assistant for "The Zao Co-Works" — a shared action tracker run by Zaal and Iman.`,
    `You are talking to ${who} right now.`,
    ``,
    `The tracker is Kanban + Six Sigma flavored. Items move TODO -> WIP -> BLOCKED -> DONE.`,
    `Each item has a DMAIC phase (Define/Measure/Analyze/Improve/Control), a priority (P1/P2/P3),`,
    `an owner (Zaal/Iman/Both), a category, and age/cycle-time signals. Items open > 14 days are "aging".`,
    `Soft WIP limit is 5 active items per person.`,
    ``,
    `Current totals: ${open} open, ${blocked} blocked, ${aging} aging.`,
    ``,
    `--- LIVE BOARD SNAPSHOT ---`,
    boardSnapshot(items),
    `--- END SNAPSHOT ---`,
    ``,
    `Rules:`,
    `- Answer using the board snapshot above. Reference items by their #id.`,
    `- Be concise and direct. Plain text, short paragraphs or hyphen bullets. No emojis, no em dashes.`,
    `- When asked what to work on, prioritize: blocked items needing a nudge, then P1, then aging items, then WIP over the limit.`,
    `- You cannot edit the board yourself — tell the user the exact change to make (e.g. "move #12 to BLOCKED", "set #7 to P1").`,
    `- If the answer is not in the snapshot, say so plainly.`,
  ].join("\n");
}

/**
 * Stateful filter that strips <think>...</think> reasoning blocks from a token
 * stream. M2.7 emits these inline; tags can span chunk boundaries, so we carry
 * a small tail buffer that might be the start of a tag.
 */
function makeThinkStripper() {
  let inside = false;
  let carry = "";
  const OPEN = "<think>";
  const CLOSE = "</think>";

  // Longest suffix of `s` that is a strict prefix of `tag`.
  function partialPrefix(s: string, tag: string): number {
    const max = Math.min(s.length, tag.length - 1);
    for (let n = max; n > 0; n--) {
      if (tag.startsWith(s.slice(s.length - n))) return n;
    }
    return 0;
  }

  return {
    push(chunk: string): string {
      let buf = carry + chunk;
      let out = "";
      while (buf.length) {
        if (!inside) {
          const open = buf.indexOf(OPEN);
          if (open === -1) {
            // Hold back a possible partial "<think>" at the tail.
            const keep = partialPrefix(buf, OPEN);
            out += buf.slice(0, buf.length - keep);
            carry = buf.slice(buf.length - keep);
            return out;
          }
          out += buf.slice(0, open);
          buf = buf.slice(open + OPEN.length);
          inside = true;
        } else {
          const close = buf.indexOf(CLOSE);
          if (close === -1) {
            const keep = partialPrefix(buf, CLOSE);
            carry = buf.slice(buf.length - keep);
            return out;
          }
          buf = buf.slice(close + CLOSE.length);
          inside = false;
        }
      }
      carry = "";
      return out;
    },
    flush(): string {
      // Anything still carried was not a real tag — emit it unless mid-think.
      const rest = inside ? "" : carry;
      carry = "";
      return rest;
    },
  };
}

export async function POST(req: NextRequest) {
  // Middleware checks cookie presence; this verifies the HMAC signature.
  let user: string;
  try {
    user = await requireSession();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // v2.9 - provider + model + BYOK can be overridden per-request
  const requestedProvider = (body as { provider?: unknown })?.provider;
  const provider: Provider = isProvider(requestedProvider) ? requestedProvider : DEFAULT_PROVIDER;
  const requestedModel = (body as { model?: unknown })?.model;
  const model = typeof requestedModel === "string" && requestedModel.trim()
    ? requestedModel.trim()
    : PROVIDER_CONFIG[provider].defaultModel;
  // BYOK header takes priority over env. Browser stores keys in localStorage,
  // sends per-request. Never logged, never persisted server-side.
  const byok = req.headers.get("x-byok-key");
  const apiKey = resolveApiKey(provider, byok);
  if (!apiKey) {
    return Response.json(
      {
        error: `AI chat needs an API key for ${provider}. Set ${PROVIDER_CONFIG[provider].envKey} on the server, or paste your key in chat settings.`,
      },
      { status: 503 },
    );
  }

  const raw = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(raw) || !raw.every(isChatMessage)) {
    return Response.json(
      { error: "Body must be { messages: {role,content}[], provider?, model? }" },
      { status: 400 },
    );
  }
  // Drop any client-supplied system role; the system prompt is built here only.
  const history: ChatTurn[] = (raw as ChatMessage[])
    .filter((m) => m.content.trim())
    .slice(-MAX_HISTORY);
  if (!history.length) {
    return Response.json({ error: "No messages" }, { status: 400 });
  }

  const doc = await getActions();
  const sys = systemPrompt(user, doc.items);

  let upstream: Response;
  try {
    upstream = await callProvider({ provider, model, apiKey, systemPrompt: sys, history });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "upstream fetch failed";
    return Response.json({ error: `${provider} unreachable: ${msg}` }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text()).slice(0, 300);
    return Response.json(
      { error: `${provider} error ${upstream.status}`, detail },
      { status: 502 },
    );
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  // <think>...</think> stripping is only needed for MiniMax M2.7. Other
  // providers emit clean text without reasoning tags.
  const useThinkStripper = provider === "minimax";
  const strip = useThinkStripper ? makeThinkStripper() : null;
  const extractDelta = deltaExtractorFor(provider);
  let sseBuffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = sseBuffer.indexOf("\n")) !== -1) {
            const line = sseBuffer.slice(0, nl).trim();
            sseBuffer = sseBuffer.slice(nl + 1);
            const delta = extractDelta(line);
            if (!delta) continue;
            const visible = strip ? strip.push(delta) : delta;
            if (visible) controller.enqueue(encoder.encode(visible));
          }
        }
        if (strip) {
          const tail = strip.flush();
          if (tail) controller.enqueue(encoder.encode(tail));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      "X-Provider": provider,
      "X-Model": model,
    },
  });
}
