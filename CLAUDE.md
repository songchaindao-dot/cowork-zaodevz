# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start dev server at http://localhost:3000
npm run build    # production build (TypeScript + Next.js compile)
npm run lint     # ESLint via next lint
npm run start    # run production build locally
```

There is no test suite. Validate changes by running `npm run build` (catches type errors) and manually testing in the browser.

## Environment variables

Copy `.env.example` to `.env.local` and set:
- `ZAAL_PASSWORD`, `IMAN_PASSWORD` — login passwords
- `AUTH_SECRET` — 32+ hex chars for HMAC cookie signing
- `GITHUB_TOKEN` — fine-grained PAT with `contents:write` (optional in dev; required on Vercel for saves to persist)
- `GITHUB_REPO` — `bettercallzaal/imanprojects`
- `GITHUB_BRANCH` — `main`
- `MINIMAX_API_KEY` — MiniMax key for the `/chat` Assistant (optional; route returns 503 without it)
- `MINIMAX_API_URL` / `MINIMAX_MODEL` — optional overrides (default `https://api.minimax.io/v1/chat/completions`, `MiniMax-M2.7`)

Without `GITHUB_TOKEN`, saves write to `data/actions.json` on local disk instead.

## Architecture

**Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind v3. No database — data lives in `data/actions.json`.

### Data flow

```
Browser form submit
  → Next.js Server Action (src/app/actions.ts)
  → requireSession() checks HMAC-signed cookie
  → getActions() reads from GitHub Contents API (or local FS fallback)
  → mutate doc
  → saveActions() writes back via GitHub Contents API (commits to repo)
  → revalidatePath("/") triggers page re-render
```

Every save creates a git commit — the commit history is the audit log.

### AI chat flow

```
/chat page (server) — auth gate, renders <Chat>
  → <Chat> (client) POSTs { messages } to /api/chat
  → route handler: requireSession() verifies HMAC
  → getActions() loads the live board
  → builds a board-aware system prompt (status/owner/priority/age snapshot)
  → fetches MiniMax with stream:true
  → transforms OpenAI-style SSE into a plain UTF-8 token stream, strips <think> tags
  → <Chat> reads the stream and appends tokens to the assistant bubble
```

The system prompt is built server-side only; any client-supplied `system` role is dropped. The MiniMax key never reaches the browser. The assistant is read-only — it suggests board changes, it does not call mutations.

### Auth model

`src/lib/auth.ts` — no NextAuth, no database. Login checks password against env vars, then sets an HMAC-signed `iman-session` cookie (`user.expiry.sig`). `src/middleware.ts` checks cookie presence (redirects to `/login` if missing); server-side `requireSession()` verifies the HMAC signature before any mutation.

### Key files

| File | Role |
|------|------|
| `src/lib/types.ts` | All domain types (`ActionItem`, `ActionDoc`) + pure utility functions (`ageDays`, `cycleDays`, `isAging`) — **no Node/browser imports**, safe to import from client components |
| `src/lib/data.ts` | Re-exports everything from `types.ts` + all server-side I/O: `getActions`, `saveActions`, `normalizeItem`, `newId` — **server-only** (uses `node:fs`, `process.env`) |
| `src/app/actions.ts` | All `"use server"` mutations: `createItem`, `quickCreate`, `updateItem`, `patchField`, `deleteItem`, `logout` |
| `src/components/Board.tsx` | Entire client-side UI: Kanban columns, filter bar, card components, inline edit modal — one large `"use client"` component |
| `src/app/page.tsx` | Server component: auth gate, loads data, computes stats bar values, renders `<Board>` |
| `src/app/api/chat/route.ts` | `POST` MiniMax proxy — auth-gated, builds the board-aware system prompt, streams tokens back. **Server-only.** |
| `src/app/chat/page.tsx` | Server component: auth gate, renders `<Chat>` |
| `src/components/Chat.tsx` | `"use client"` streaming chat UI for the Assistant tab |

### Client/server boundary

`Board.tsx` imports types from `src/lib/types` (safe — no server APIs). It must **never** import from `src/lib/data` (Node.js only). Server actions in `src/app/actions.ts` are imported directly by `Board.tsx` via `"use server"` — Next.js handles the serialization boundary.

### Data model

`ActionItem` fields: `id`, `title`, `owner` (Zaal/Iman/Both), `status` (TODO/WIP/BLOCKED/DONE), `category`, `priority` (P1/P2/P3), `phase` (DMAIC), `due`, `notes`, `important`, `urgent`, `createdBy`, `completedAt`, `completedBy`, `createdAt`, `updatedAt`.

## Phase 2 context

Read `BACKLOG.md` before adding features. The planned Phase 2 swap is `src/lib/data.ts` → Supabase, keeping the same exported function signatures so `actions.ts` is untouched. Don't add infrastructure that conflicts with this migration path.
