# Progress

- [done] Define the matter/session data model and document it in `plan/matter-plan.md`
- [done] Define the `/agent` refactor plan in `plan/agent-refactor-plan.md`
- [done] Add Mongoose models for `matters`, `matter_members`, `opencode_sessions`, and `matter_sessions`
- [done] Add shared server-side helpers for auth, bootstrap loading, and route resolution
- [done] Move the current client runtime out of `app/agent/page.tsx` into a renamed shared client component
- [done] Create server route pages for:
  - `/agent`
  - `/agent/chats/[trackedSessionId]`
  - `/agent/matters/[matterId]`
  - `/agent/matters/[matterId]/chats/[trackedSessionId]`
- [done] Add `loading.tsx` files for the `/agent` route tree
- [done] Add API route handlers for:
  - `GET /api/matters`
  - `POST /api/matters`
  - `GET /api/matters/[id]/sessions`
  - `POST /api/matters/[id]/sessions`
  - `GET /api/opencode-sessions/[sessionId]`
  - `POST /api/opencode-sessions`
- [done] Update the client runtime to consume server bootstrap data
- [done] Filter the left-hand session list to tracked sessions only
- [done] Split the left-hand session list into unassigned chats and matter-linked chats
- [done] Make sidebar navigation URL-driven instead of only local state
- [done] Keep `/agent` as the default view with no selected session on the right-hand side
- [done] Ensure matter and chat routes preselect the correct context from route params
- [done] Ensure new session creation writes to `opencode_sessions` as soon as OpenCode returns a raw `sessionId`
- [done] Ensure matter session assignment writes to `matter_sessions`
- [done] Focus the composer textbox after clicking `New chat`
- [done] Add a client-side loader under `Recent chats` while tracked OpenCode sessions hydrate
- [done] Add a client-side loader in the RHS chat panel while selected session history loads from OpenCode
- [done] Consolidate shared loaders under `components/loaders`
- [ ] Run a verification pass and update this file with final status

## Notes

- The canonical route model lives in `plan/matter-plan.md`
- The server/client split lives in `plan/agent-refactor-plan.md`
- The existing `app/agent/page.tsx` is the client runtime that will be moved and renamed, not rewritten from scratch
- Full-project `tsc --noEmit` is currently blocked by pre-existing missing UI dependencies such as `react-day-picker`, `recharts`, and `cmdk`
