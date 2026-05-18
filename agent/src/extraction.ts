// Suggest-then-confirm pattern per doc 662 B.7.
// The bot's claude reply may include a fenced ```json-suggest block proposing
// an action mutation. We parse it, surface it to the user, and only execute
// if the next reply from the same user in the same chat (within 5 min) is
// affirmative.

import { promises as fs } from 'node:fs';
import { Context } from 'grammy';
import { COWORK_PATHS } from './paths';
import { cmdAdd, cmdAssign, cmdBlocked, cmdDone, cmdSetDue, cmdSetNote, cmdSetPrio, cmdWip } from './commands';
import type { SuggestActionOp } from './types';
import { isAutoConfirm } from './users';

interface PendingSuggestion {
  chat_id: number;
  from_user_id: number;
  suggestion: SuggestActionOp;
  createdAt: string;
}

const PENDING_TTL_MS = 5 * 60_000;

const SUGGEST_RE = /```json-suggest\s*([\s\S]*?)\s*```/i;
const YES_RE = /^(y|yes|yep|yeah|sure|do it|confirm|ok)\b/i;

export function stripSuggestionBlock(text: string): string {
  return text.replace(SUGGEST_RE, '').trim();
}

export function extractSuggestion(text: string): SuggestActionOp | null {
  const m = text.match(SUGGEST_RE);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]) as SuggestActionOp;
    if (!parsed.op) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function describeSuggestion(s: SuggestActionOp): string {
  switch (s.op) {
    case 'add':
      return `add new item "${s.title ?? '(?)'}"${s.owner ? ` for ${s.owner}` : ''}${s.category ? ` in ${s.category}` : ''}`;
    case 'wip':
      return `move #${s.id} to WIP`;
    case 'blocked':
      return `mark #${s.id} BLOCKED${s.reason ? ` (${s.reason})` : ''}`;
    case 'done':
      return `mark #${s.id} DONE${s.reason ? ` (${s.reason})` : ''}`;
    case 'assign':
      return `reassign #${s.id} -> ${s.owner}`;
    case 'setdue':
      return `set due on #${s.id} -> ${s.due || '(clear)'}`;
    case 'setnote':
      return s.appendNotes
        ? `append note on #${s.id}`
        : `replace notes on #${s.id}`;
    case 'setprio':
      return `set priority on #${s.id} -> ${s.priority}`;
  }
}

export async function savePending(p: PendingSuggestion): Promise<void> {
  await fs.mkdir(COWORK_PATHS.home, { recursive: true });
  await fs.writeFile(COWORK_PATHS.pending, JSON.stringify(p, null, 2), 'utf8');
}

export async function loadPending(): Promise<PendingSuggestion | null> {
  try {
    const raw = await fs.readFile(COWORK_PATHS.pending, 'utf8');
    const p = JSON.parse(raw) as PendingSuggestion;
    if (Date.now() - new Date(p.createdAt).getTime() > PENDING_TTL_MS) {
      await fs.unlink(COWORK_PATHS.pending).catch(() => {});
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export async function clearPending(): Promise<void> {
  await fs.unlink(COWORK_PATHS.pending).catch(() => {});
}

export async function maybeStartSuggestionFlow(
  ctx: Context,
  botReply: string,
): Promise<string> {
  const suggestion = extractSuggestion(botReply);
  if (!suggestion) return botReply;
  const stripped = stripSuggestionBlock(botReply);
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId) return stripped;

  // v2.11 - if user has auto_confirm on, skip the suggest-then-confirm step
  // and execute directly. Trade safety for speed; default off.
  if (await isAutoConfirm(userId)) {
    await executeSuggestion(ctx, suggestion);
    const note = `\n\n(auto-confirmed: ${describeSuggestion(suggestion)})`;
    return stripped + note;
  }

  await savePending({
    chat_id: chatId,
    from_user_id: userId,
    suggestion,
    createdAt: new Date().toISOString(),
  });
  const tail = `\n\nsuggested: ${describeSuggestion(suggestion)}\nreply "yes" to confirm or anything else to cancel\n(tip: /autoconfirm on to skip this step for future natural-language edits)`;
  return stripped + tail;
}

/**
 * Returns true if this message was a confirmation of a pending suggestion
 * (and we handled the execution). False otherwise - caller should proceed with
 * normal concierge flow.
 */
export async function maybeHandleConfirmation(ctx: Context, text: string): Promise<boolean> {
  const pending = await loadPending();
  if (!pending) return false;
  if (pending.chat_id !== ctx.chat?.id || pending.from_user_id !== ctx.from?.id) return false;
  await clearPending();
  if (!YES_RE.test(text.trim())) {
    await ctx.reply('cancelled');
    return true;
  }
  await executeSuggestion(ctx, pending.suggestion);
  return true;
}

async function executeSuggestion(ctx: Context, s: SuggestActionOp): Promise<void> {
  switch (s.op) {
    case 'add':
      await cmdAdd(ctx, s.title ?? '');
      return;
    case 'wip':
      await cmdWip(ctx, s.id ?? '');
      return;
    case 'blocked':
      await cmdBlocked(ctx, `${s.id ?? ''} ${s.reason ?? ''}`);
      return;
    case 'done':
      await cmdDone(ctx, s.id ?? '');
      return;
    case 'assign':
      await cmdAssign(ctx, `${s.id ?? ''} ${s.owner ?? ''}`);
      return;
    case 'setdue':
      await cmdSetDue(ctx, `${s.id ?? ''} ${s.due ?? 'clear'}`);
      return;
    case 'setnote': {
      const prefix = s.appendNotes ? 'append: ' : '';
      const text = s.appendNotes ?? s.notes ?? '';
      await cmdSetNote(ctx, `${s.id ?? ''} ${prefix}${text}`);
      return;
    }
    case 'setprio':
      await cmdSetPrio(ctx, `${s.id ?? ''} ${s.priority ?? ''}`);
      return;
  }
}
