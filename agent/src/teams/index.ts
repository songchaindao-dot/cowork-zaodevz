// Public surface for the bonfire integration.
// Keep this small - commands.ts only needs bonfireHook + isBonfireEnabled.

export { bonfireHook, isBonfireEnabled, bonfireStatusLine, drainSpool, eventToChangeset } from './bonfire';
export type { TeamEvent, TeamEventOp, BonfireChangeset, BonfireNode, BonfireEdge } from './types';
