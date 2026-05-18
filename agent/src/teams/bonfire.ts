// ZAOcoworkingBot -> ZABAL Bonfire integration (Phase 1 per Doc 669).
//
// Each action-tracker mutation calls bonfireHook(event). The hook:
//   1. converts the TeamEvent to a kEngram changeset (nodes + edges)
//   2. enqueues to a local jsonl spool (~/.zaocoworking/bonfire-spool.jsonl)
//   3. attempts an HTTP POST to the Bonfires API
//   4. on success, marks the spool line sent
//   5. on failure, leaves the line pending for retry on next drain
//
// Hook is a no-op if env vars are not configured. Code is safe to ship
// before credentials land - the moment BONFIRE_API_KEY + BONFIRE_ID are
// set + the bot restarts, the integration goes live.
//
// HTTP path (not subprocess) because the VPS has python3 but no pip; the
// Bonfires SDK is Python. Native Node HTTP is cleaner for our stack.
//
// Env contract:
//   BONFIRE_API_KEY    - revealed via signed message at app.bonfires.ai/dashboard
//   BONFIRE_ID         - UUID of the ZABAL bonfire
//   BONFIRE_API_URL    - defaults to https://tnt-v2.api.bonfires.ai
//   BONFIRE_ENABLED    - any truthy value enables; missing or "false" = skip
//   BONFIRE_DEFAULT_BRAND - tag for events whose brand isn't explicit (default "ZAO")

import type { BonfireChangeset, BonfireEdge, BonfireNode, TeamEvent } from './types';
import { enqueue, readPending, rewrite } from './spool';

const API_KEY = process.env.BONFIRE_API_KEY ?? '';
const BONFIRE_ID = process.env.BONFIRE_ID ?? '';
const API_URL = process.env.BONFIRE_API_URL ?? 'https://tnt-v2.api.bonfires.ai';
const ENABLED = !!process.env.BONFIRE_ENABLED && process.env.BONFIRE_ENABLED !== 'false' && !!API_KEY && !!BONFIRE_ID;
const DEFAULT_BRAND = process.env.BONFIRE_DEFAULT_BRAND ?? 'ZAO';
const FETCH_TIMEOUT_MS = 8_000;

export function isBonfireEnabled(): boolean {
  return ENABLED;
}

export function bonfireStatusLine(): string {
  if (ENABLED) return `bonfire: enabled (id=${BONFIRE_ID.slice(0, 8)}..., url=${API_URL})`;
  const missing: string[] = [];
  if (!API_KEY) missing.push('BONFIRE_API_KEY');
  if (!BONFIRE_ID) missing.push('BONFIRE_ID');
  if (!process.env.BONFIRE_ENABLED) missing.push('BONFIRE_ENABLED');
  return `bonfire: disabled (missing ${missing.join(', ') || 'config'})`;
}

/**
 * Convert a TeamEvent to the kEngram changeset shape per Doc 668d spec.
 * Each op produces 1-2 nodes + a small set of edges. Auto-UUIDs.
 */
export function eventToChangeset(event: TeamEvent): BonfireChangeset {
  const brand = event.brand ?? DEFAULT_BRAND;
  const id = event.item.id;
  const ts = event.timestamp;
  const actor = event.actor;
  const nodes: BonfireNode[] = [];
  const edges: BonfireEdge[] = [];

  switch (event.op) {
    case 'add':
      nodes.push({
        uuid: 'auto',
        name: `todo:${id}`,
        summary: event.item.title,
        labels: ['Todo', 'Open', brand, event.item.category, event.item.priority].filter(Boolean) as string[],
      });
      edges.push({ source: `todo:${id}`, target: actor, name: 'CREATED_BY', fact: ts });
      edges.push({ source: `todo:${id}`, target: brand, name: 'BELONGS_TO' });
      if (event.item.owner && event.item.owner !== 'Open') {
        edges.push({ source: `todo:${id}`, target: event.item.owner, name: 'ASSIGNED_TO' });
      }
      break;

    case 'wip':
      nodes.push({
        uuid: 'auto',
        name: `todo:${id}:wip:${ts}`,
        summary: `Marked in-progress at ${ts}`,
        labels: ['TodoEvent', 'InProgress', brand],
      });
      edges.push({ source: `todo:${id}:wip:${ts}`, target: `todo:${id}`, name: 'UPDATES' });
      edges.push({ source: `todo:${id}:wip:${ts}`, target: actor, name: 'DONE_BY', fact: ts });
      break;

    case 'blocked':
      nodes.push({
        uuid: 'auto',
        name: `todo:${id}:blocked:${ts}`,
        summary: `Marked BLOCKED at ${ts}${event.reason ? ': ' + event.reason : ''}`,
        labels: ['TodoEvent', 'Blocked', brand],
      });
      edges.push({ source: `todo:${id}:blocked:${ts}`, target: `todo:${id}`, name: 'UPDATES' });
      edges.push({ source: `todo:${id}:blocked:${ts}`, target: actor, name: 'DONE_BY', fact: ts });
      break;

    case 'done':
      nodes.push({
        uuid: 'auto',
        name: `todo:${id}:done:${ts}`,
        summary: `Completed at ${ts}${event.reason ? ': ' + event.reason : ''}`,
        labels: ['TodoEvent', 'Done', brand],
      });
      edges.push({ source: `todo:${id}:done:${ts}`, target: `todo:${id}`, name: 'COMPLETES' });
      edges.push({ source: `todo:${id}:done:${ts}`, target: actor, name: 'COMPLETED_BY', fact: ts });
      break;

    case 'assign':
      nodes.push({
        uuid: 'auto',
        name: `todo:${id}:assigned:${ts}`,
        summary: `Assigned to ${event.item.owner} at ${ts}`,
        labels: ['TodoEvent', 'Assignment', brand],
      });
      edges.push({ source: `todo:${id}:assigned:${ts}`, target: `todo:${id}`, name: 'UPDATES' });
      edges.push({ source: `todo:${id}:assigned:${ts}`, target: event.item.owner, name: 'ASSIGNED_TO' });
      if (event.previousOwner && event.previousOwner !== event.item.owner) {
        edges.push({ source: `todo:${id}:assigned:${ts}`, target: event.previousOwner, name: 'REASSIGNED_FROM' });
      }
      edges.push({ source: `todo:${id}:assigned:${ts}`, target: actor, name: 'DONE_BY', fact: ts });
      break;

    case 'setdue':
      nodes.push({
        uuid: 'auto',
        name: `todo:${id}:due:${ts}`,
        summary: `Due date set to ${event.item.due || '(cleared)'} at ${ts}`,
        labels: ['TodoEvent', 'DueDateChange', brand],
      });
      edges.push({ source: `todo:${id}:due:${ts}`, target: `todo:${id}`, name: 'UPDATES' });
      edges.push({ source: `todo:${id}:due:${ts}`, target: actor, name: 'DONE_BY', fact: ts });
      break;

    case 'setnote':
      nodes.push({
        uuid: 'auto',
        name: `todo:${id}:note:${ts}`,
        summary: `Notes updated at ${ts}`,
        labels: ['TodoEvent', 'NotesChange', brand],
      });
      edges.push({ source: `todo:${id}:note:${ts}`, target: `todo:${id}`, name: 'UPDATES' });
      edges.push({ source: `todo:${id}:note:${ts}`, target: actor, name: 'DONE_BY', fact: ts });
      break;

    case 'setprio':
      nodes.push({
        uuid: 'auto',
        name: `todo:${id}:prio:${ts}`,
        summary: `Priority changed ${event.previousPriority ?? '?'} -> ${event.item.priority} at ${ts}`,
        labels: ['TodoEvent', 'PriorityChange', brand, event.item.priority],
      });
      edges.push({ source: `todo:${id}:prio:${ts}`, target: `todo:${id}`, name: 'UPDATES' });
      edges.push({ source: `todo:${id}:prio:${ts}`, target: actor, name: 'DONE_BY', fact: ts });
      break;
  }

  return { nodes, edges };
}

/**
 * Post a changeset to the Bonfires API. Returns true on 2xx, false otherwise.
 * Never throws - caller decides whether to keep the spool line pending.
 *
 * The exact endpoint path is per the Bonfires SDK convention:
 *   POST {API_URL}/v1/bonfires/{BONFIRE_ID}/kengram/batch
 * If that turns out wrong once we test against the real API, this is the
 * single function to update.
 */
async function postToBonfire(changeset: BonfireChangeset): Promise<{ ok: boolean; status?: number; error?: string }> {
  const url = `${API_URL.replace(/\/$/, '')}/v1/bonfires/${BONFIRE_ID}/kengram/batch`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(changeset),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: body.slice(0, 200) };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Main entry point. Called from commands.ts after each successful mutation.
 * Returns immediately if Bonfires is disabled; never throws.
 *
 * On a failed POST, the spool retains the event for retry. drain() can be
 * called periodically (or on next event) to replay pending events.
 */
export async function bonfireHook(event: TeamEvent): Promise<void> {
  if (!ENABLED) return;
  let spoolId: string;
  try {
    spoolId = await enqueue(event);
  } catch (err) {
    console.error('[bonfire] enqueue failed:', err);
    return;
  }
  const changeset = eventToChangeset(event);
  const result = await postToBonfire(changeset);
  const now = new Date().toISOString();
  const updates = new Map<string, ReturnType<typeof makeLine>>();
  function makeLine(status: 'sent' | 'failed', attempts: number, lastError?: string) {
    return {
      id: spoolId,
      event,
      status,
      attempts,
      lastError,
      enqueuedAt: now,
      sentAt: status === 'sent' ? now : undefined,
    } as const;
  }
  if (result.ok) {
    updates.set(spoolId, makeLine('sent', 1));
    console.log(`[bonfire] sent ${event.op} #${event.item.id} (${changeset.nodes.length} nodes, ${changeset.edges.length} edges)`);
  } else {
    updates.set(spoolId, makeLine('failed', 1, `status=${result.status ?? '-'} ${result.error ?? ''}`.trim()));
    console.error(`[bonfire] post failed for ${event.op} #${event.item.id}: ${result.error}`);
  }
  await rewrite(updates as never).catch((e) => console.error('[bonfire] spool rewrite failed:', e));
}

/**
 * Drain pending spool lines. Called on bot startup + opportunistically.
 * Returns count {sent, failed, kept}.
 */
export async function drainSpool(): Promise<{ sent: number; failed: number; kept: number }> {
  if (!ENABLED) return { sent: 0, failed: 0, kept: 0 };
  const pending = await readPending();
  if (pending.length === 0) return { sent: 0, failed: 0, kept: 0 };
  const updates = new Map<string, typeof pending[number]>();
  let sent = 0;
  let failed = 0;
  for (const line of pending) {
    const changeset = eventToChangeset(line.event);
    const result = await postToBonfire(changeset);
    if (result.ok) {
      sent++;
      updates.set(line.id, {
        ...line,
        status: 'sent',
        attempts: line.attempts + 1,
        sentAt: new Date().toISOString(),
      });
    } else {
      failed++;
      updates.set(line.id, {
        ...line,
        status: 'failed',
        attempts: line.attempts + 1,
        lastError: `status=${result.status ?? '-'} ${result.error ?? ''}`.trim(),
      });
    }
  }
  await rewrite(updates).catch((e) => console.error('[bonfire] drain rewrite failed:', e));
  const kept = pending.length - sent - failed;
  console.log(`[bonfire] drain: sent=${sent} failed=${failed} kept=${kept}`);
  return { sent, failed, kept };
}
