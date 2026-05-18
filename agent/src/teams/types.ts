// Bonfires integration types (Phase 1 per Doc 669).
// Each action-tracker mutation emits a TeamEvent which the bonfire hook
// converts to a kEngram changeset.

import type { ActionItem, Owner, Priority, Phase } from '../types';

export type TeamEventOp =
  | 'add'
  | 'wip'
  | 'blocked'
  | 'done'
  | 'assign'
  | 'setdue'
  | 'setnote'
  | 'setprio';

export interface TeamEvent {
  op: TeamEventOp;
  item: ActionItem;
  actor: string; // human-readable username of the person triggering
  actorTgId: number; // telegram id for graph identity
  brand?: string; // optional brand tag, defaults to "ZAO" if not provided
  // op-specific extras
  reason?: string; // for blocked / done
  previousOwner?: Owner; // for assign
  previousDue?: string; // for setdue
  previousPriority?: Priority; // for setprio
  previousPhase?: Phase; // reserved for future setphase
  timestamp: string; // ISO UTC
}

// kEngram changeset shape per Doc 668d / Bonfires SDK contract.
export interface BonfireNode {
  uuid: 'auto' | string;
  name: string;
  summary?: string;
  labels?: string[];
}

export interface BonfireEdge {
  source: string;
  target: string;
  name: string;
  fact?: string;
}

export interface BonfireChangeset {
  nodes: BonfireNode[];
  edges: BonfireEdge[];
}
