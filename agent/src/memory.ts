// 5-block Letta-style memory per doc 662 B.2.
// Blocks: persona, human, working, tasks, actions.
// Used in the appendSystemPrompt to every claude CLI call.

import { promises as fs } from 'node:fs';
import { COWORK_PATHS } from './paths';
import { readRecent } from './transcripts';
import { readActionsCache } from './actions-store';
import type { MemoryBlocks } from './types';

const DEFAULT_PERSONA = `You are ZAOcoworkingBot - the Telegram concierge for the cowork-zaodevz action tracker.

VOICE: spartan, lowercase casual when it fits, no emojis, no em dashes, no marketing speak. Match Zaal's Year-of-the-ZABAL tone. Brand spellings exact: WaveWarZ, COC Concertz, The ZAO, BetterCallZaal, ZABAL, ZOE, ZOLs, FISHBOWLZ.

JOB: help the 4 team members track action items across all ZAO brands. Answer questions about open items, suggest action mutations when conversation implies them (always confirm before writing), surface relevant context from recent conversation history.

WHEN UNSURE: ask a single sharp question rather than guess. Do not invent action item IDs, owners, or deadlines.

OUTPUT JSON SUGGESTION (when the user clearly implies an action mutation, append a fenced json block at the END of your reply):
\`\`\`json-suggest
{"op":"done","id":"12","reason":"fixed the UI bug"}
\`\`\`
Valid ops: add, wip, blocked, done, assign. Fields: id (string), title (for add), owner (for add/assign), reason (for blocked/done notes), category (for add). The bot will surface the suggestion and ask the user to confirm before writing.`;

const DEFAULT_HUMAN = `Team (4 members, 1 bot):

- **Zaal** (@bettercallzaal, founder of The ZAO, BCZ Strategies LLC). Telegram ID 1447437687. Owns: ZAOOS, ZABAL, WaveWarZ cofounder, ZAOstock org.
- **Iman** (songchaindao GH org owner, ZAO Devz lead, built cowork-zaodevz tracker). Owns: this VPS, cowork-zaodevz repo, ZAO Devz coordination.
- **ThyRev** (Thy Revolution, COC Concertz brand owner).
- **Samantha** (candytoybox, WaveWarZ cofounder with Hurric4n3ike).

Brands they coordinate across: The ZAO, WaveWarZ, COC Concertz, BCZ Strategies, Magnetiq, Attabotty, ZAOstock, BetterCallZaal.`;

export async function ensureCoworkHome(): Promise<void> {
  await fs.mkdir(COWORK_PATHS.home, { recursive: true });
  await fs.mkdir(COWORK_PATHS.recent, { recursive: true });
  await fs.mkdir(COWORK_PATHS.archive, { recursive: true });
  await fs.mkdir(COWORK_PATHS.sentinels, { recursive: true });
  await seedIfMissing(COWORK_PATHS.persona, DEFAULT_PERSONA);
  await seedIfMissing(COWORK_PATHS.human, DEFAULT_HUMAN);
  await seedIfMissing(COWORK_PATHS.tasks, '[]');
}

async function seedIfMissing(path: string, content: string): Promise<void> {
  try {
    await fs.access(path);
  } catch {
    await fs.writeFile(path, content, 'utf8');
  }
}

async function readOr(path: string, fallback: string): Promise<string> {
  try {
    return (await fs.readFile(path, 'utf8')).trim();
  } catch {
    return fallback;
  }
}

function formatRecent(turns: Array<{ from_user_name: string; direction: 'in' | 'out'; message_text: string }>): string {
  if (turns.length === 0) return '(no recent turns in this chat)';
  return turns
    .map((t) => (t.direction === 'in' ? `${t.from_user_name}: ${t.message_text}` : `bot: ${t.message_text}`))
    .join('\n');
}

function formatActions(actions: Array<{ id: string; status: string; owner: string; title: string; due: string }>): string {
  const open = actions.filter((a) => a.status !== 'DONE').slice(0, 25);
  if (open.length === 0) return '(no open action items)';
  return open
    .map((a) => `[${a.status}] (${a.owner}) #${a.id} ${a.title}${a.due ? ` - due ${a.due}` : ''}`)
    .join('\n');
}

export async function buildMemoryBlocks(scope: string): Promise<MemoryBlocks> {
  const [persona, human, tasks, recent, actionsCache] = await Promise.all([
    readOr(COWORK_PATHS.persona, DEFAULT_PERSONA),
    readOr(COWORK_PATHS.human, DEFAULT_HUMAN),
    readOr(COWORK_PATHS.tasks, '[]'),
    readRecent(scope),
    readActionsCache(),
  ]);
  return {
    persona,
    human,
    working: formatRecent(recent),
    tasks,
    actions: formatActions(actionsCache?.items ?? []),
  };
}

export function memoryBlocksToSystemPrompt(b: MemoryBlocks, chatScope: string): string {
  return `<persona>
${b.persona}
</persona>

<human>
${b.human}
</human>

<chat_scope>${chatScope}</chat_scope>

<working_memory>
${b.working}
</working_memory>

<tasks>
${b.tasks}
</tasks>

<actions>
${b.actions}
</actions>`;
}
