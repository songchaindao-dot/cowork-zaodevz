// Slash command handlers per doc 662 B.6. Nine commands:
// /start /mine /list /add /wip /blocked /done /assign /daily
// Each mutation goes through mutateActions() with SHA-dance retry.

import { Context } from 'grammy';
import { fetchActions, makeActionItem, mutateActions } from './actions-store';
import { notifyAssigned, notifyStatusChange } from './notifications';
import type { ActionItem, ActionStatus, Owner } from './types';
import { OWNERS } from './types';

interface UserNameMap {
  [tgUserId: string]: Owner;
}

function parseUserNames(env: string | undefined): UserNameMap {
  const map: UserNameMap = {};
  if (!env) return map;
  for (const pair of env.split(',')) {
    const [id, name] = pair.split(':').map((s) => s.trim());
    if (id && name && (OWNERS as readonly string[]).includes(name)) {
      map[id] = name as Owner;
    }
  }
  return map;
}

const USER_NAMES = parseUserNames(process.env.USER_NAMES);
const ADMIN_IDS = new Set((process.env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean));

function ownerForCtx(ctx: Context): Owner {
  const id = String(ctx.from?.id ?? '');
  return USER_NAMES[id] ?? 'Open';
}

function callerDisplayName(ctx: Context): string {
  return ctx.from?.first_name ?? ctx.from?.username ?? `user:${ctx.from?.id ?? '?'}`;
}

function isAdmin(ctx: Context): boolean {
  return ADMIN_IDS.has(String(ctx.from?.id ?? ''));
}

function formatItem(item: ActionItem): string {
  const flags = [item.important && '!', item.urgent && '*'].filter(Boolean).join('');
  return `[${item.status}] (${item.owner}) #${item.id} ${item.title}${item.due ? ` - due ${item.due}` : ''}${flags ? ` ${flags}` : ''}`;
}

function listGrouped(items: ActionItem[]): string {
  const open = items.filter((i) => i.status !== 'DONE');
  if (open.length === 0) return 'no open items';
  const byOwner = new Map<Owner, ActionItem[]>();
  for (const item of open) {
    const arr = byOwner.get(item.owner) ?? [];
    arr.push(item);
    byOwner.set(item.owner, arr);
  }
  const sections: string[] = [];
  for (const owner of OWNERS) {
    const arr = byOwner.get(owner);
    if (!arr || arr.length === 0) continue;
    sections.push(`${owner}:\n${arr.map((i) => `  ${formatItem(i)}`).join('\n')}`);
  }
  return sections.join('\n\n');
}

function findItemById(items: ActionItem[], id: string): ActionItem | undefined {
  return items.find((i) => i.id === id);
}

function updateStatus(items: ActionItem[], id: string, status: ActionStatus, by: string, notes?: string): ActionItem | null {
  const item = findItemById(items, id);
  if (!item) return null;
  item.status = status;
  item.updatedAt = new Date().toISOString();
  if (status === 'DONE') {
    item.completedAt = item.updatedAt;
    item.completedBy = by;
  }
  if (notes && status === 'BLOCKED') {
    item.notes = notes + (item.notes ? `\n\n${item.notes}` : '');
  }
  return item;
}

export async function cmdStart(ctx: Context): Promise<void> {
  await ctx.reply(
    'ZAOcoworkingBot online. Commands:\n\n' +
      'tracker:\n' +
      '  /mine - my open items\n' +
      '  /list [category] - all open items by owner\n' +
      '  /find <keyword> - search items\n' +
      '  /add <title> - create item assigned to me\n' +
      '  /wip <id> - move to in-progress\n' +
      '  /blocked <id> <reason> - mark blocked\n' +
      '  /done <id> - mark done\n' +
      '  /assign <id> <Owner> - reassign\n' +
      '  /daily - admin: post digest of open items\n\n' +
      'team (admin):\n' +
      '  /team - show roster\n' +
      '  /adduser <tg_id> <Name> [admin] - add member, no restart\n' +
      '  /addchat - allow CURRENT group chat\n' +
      '  /reload - force-refresh roster from github\n\n' +
      'notifications:\n' +
      '  /notify - manage my proactive DM channels\n\n' +
      'model / keys:\n' +
      '  /providers - list available LLM providers\n' +
      '  /mymodel - show my current provider/model\n' +
      '  /setmodel <provider> <model> - switch\n' +
      '  /setkey <provider> <key> - DM only, BYOK\n' +
      '  /clearkey <provider> - drop BYOK',
  );
}

export async function cmdMine(ctx: Context): Promise<void> {
  const { data } = await fetchActions();
  const me = ownerForCtx(ctx);
  const mine = data.items.filter((i) => (i.owner === me || i.owner === 'Both') && i.status !== 'DONE');
  if (mine.length === 0) {
    await ctx.reply(`no open items for ${me}`);
    return;
  }
  await ctx.reply(`${me} open (${mine.length}):\n${mine.map(formatItem).join('\n')}`);
}

export async function cmdList(ctx: Context, args: string): Promise<void> {
  const { data } = await fetchActions();
  const cat = args.trim();
  const items = cat ? data.items.filter((i) => i.category.toLowerCase().includes(cat.toLowerCase())) : data.items;
  await ctx.reply(cat ? `Open in "${cat}":\n${listGrouped(items)}` : `All open items:\n${listGrouped(items)}`);
}

// v2.9 - keyword search across title + notes + category. case-insensitive.
// Default 15 results, includes DONE items so people can find shipped things too.
export async function cmdFind(ctx: Context, args: string): Promise<void> {
  const q = args.trim().toLowerCase();
  if (!q) {
    await ctx.reply('usage: /find <keyword>\nsearches title, notes, and category. case-insensitive.');
    return;
  }
  const { data } = await fetchActions();
  const matches = data.items.filter((i) => {
    return (
      (i.title || '').toLowerCase().includes(q) ||
      (i.notes || '').toLowerCase().includes(q) ||
      (i.category || '').toLowerCase().includes(q)
    );
  });
  if (matches.length === 0) {
    await ctx.reply(`no matches for "${q}"`);
    return;
  }
  const open = matches.filter((i) => i.status !== 'DONE');
  const done = matches.filter((i) => i.status === 'DONE');
  const lines: string[] = [`"${q}" - ${matches.length} match${matches.length === 1 ? '' : 'es'} (${open.length} open, ${done.length} done):`, ''];
  for (const i of [...open, ...done].slice(0, 15)) {
    lines.push(`  ${formatItem(i)}`);
  }
  if (matches.length > 15) lines.push(`  ... and ${matches.length - 15} more`);
  await ctx.reply(lines.join('\n'));
}

export async function cmdAdd(ctx: Context, args: string): Promise<void> {
  const title = args.trim();
  if (!title) {
    await ctx.reply('usage: /add <title>');
    return;
  }
  const me = ownerForCtx(ctx);
  const by = callerDisplayName(ctx);
  const result = await mutateActions(async (data) => {
    const item = makeActionItem({ title, owner: me, createdBy: by }, data.items);
    data.items.push(item);
    return {
      data,
      commitMessage: `bot: add #${item.id} (${me}) ${item.title}`,
      result: item,
    };
  });
  if (result) {
    await ctx.reply(`added #${result.id} (${result.owner}): ${result.title}`);
  }
}

async function applyStatusCommand(ctx: Context, args: string, status: ActionStatus, label: string): Promise<void> {
  const trimmed = args.trim();
  const idMatch = trimmed.match(/^(\d+)\s*(.*)$/);
  if (!idMatch) {
    await ctx.reply(`usage: /${label} <id>${status === 'BLOCKED' ? ' <reason>' : ''}`);
    return;
  }
  const [, id, rest] = idMatch;
  const reason = rest.trim() || undefined;
  if (status === 'BLOCKED' && !reason) {
    await ctx.reply('usage: /blocked <id> <reason>');
    return;
  }
  const by = callerDisplayName(ctx);
  const result = await mutateActions(async (data) => {
    const item = updateStatus(data.items, id, status, by, reason);
    if (!item) return null;
    return {
      data,
      commitMessage: `bot: ${label} #${id} by ${by}`,
      result: item,
    };
  });
  if (result) {
    await ctx.reply(`${label} #${result.id}: ${result.title}`);
    // v2.8 - notify the owner if someone else updated their item
    if (status === 'DONE' || status === 'BLOCKED' || status === 'WIP') {
      notifyStatusChange(ctx.api, result, status, by, reason).catch(() => { /* best-effort */ });
    }
  } else {
    await ctx.reply(`no item #${id}`);
  }
}

export async function cmdWip(ctx: Context, args: string): Promise<void> {
  await applyStatusCommand(ctx, args, 'WIP', 'wip');
}

export async function cmdBlocked(ctx: Context, args: string): Promise<void> {
  await applyStatusCommand(ctx, args, 'BLOCKED', 'blocked');
}

export async function cmdDone(ctx: Context, args: string): Promise<void> {
  await applyStatusCommand(ctx, args, 'DONE', 'done');
}

export async function cmdAssign(ctx: Context, args: string): Promise<void> {
  const m = args.trim().match(/^(\d+)\s+(\w+)$/);
  if (!m) {
    await ctx.reply(`usage: /assign <id> <${OWNERS.join('|')}>`);
    return;
  }
  const [, id, ownerRaw] = m;
  if (!(OWNERS as readonly string[]).includes(ownerRaw)) {
    await ctx.reply(`unknown owner ${ownerRaw}. valid: ${OWNERS.join(', ')}`);
    return;
  }
  const owner = ownerRaw as Owner;
  const by = callerDisplayName(ctx);
  const result = await mutateActions(async (data) => {
    const item = data.items.find((i) => i.id === id);
    if (!item) return null;
    item.owner = owner;
    item.updatedAt = new Date().toISOString();
    return {
      data,
      commitMessage: `bot: assign #${id} -> ${owner} by ${by}`,
      result: item,
    };
  });
  if (result) {
    await ctx.reply(`#${result.id} -> ${result.owner}: ${result.title}`);
    // v2.8 - notify the new owner instantly
    notifyAssigned(ctx.api, result, by).catch(() => { /* best-effort */ });
  } else {
    await ctx.reply(`no item #${id}`);
  }
}

export async function cmdDaily(ctx: Context): Promise<void> {
  if (!isAdmin(ctx)) {
    await ctx.reply('admin only');
    return;
  }
  const { data } = await fetchActions();
  await ctx.reply(`Daily digest:\n${listGrouped(data.items)}`);
}
