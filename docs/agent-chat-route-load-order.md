# Agent Chat Route Load Order

This document describes what happens, in order, when a route like:

- `/agent/chats/:trackedSessionId`

loads in the app after the server-side OpenCode bootstrap change.

## End-to-End Order

1. **Next.js server route runs**
- [page.tsx](/mnt/c/users/delan/desktop/lnp_agent/app/agent/chats/[trackedSessionId]/page.tsx)
- reads `trackedSessionId` from the URL

2. **Auth is checked**
- calls `requireAuthenticatedAgentUser()` from [bootstrap.ts](/mnt/c/users/delan/desktop/lnp_agent/lib/agent/bootstrap.ts)

3. **Tracked session is resolved**
- calls `resolveTrackedSession(trackedSessionId)` in [route-resolvers.ts](/mnt/c/users/delan/desktop/lnp_agent/lib/agent/route-resolvers.ts)
- this looks up the Mongo `opencode_sessions` row
- if it finds a matter assignment, the route redirects to:
  - `/agent/matters/:matterId/chats/:trackedSessionId`

4. **Server bootstrap is built**
- [buildAgentBootstrap(...)](/mnt/c/users/delan/desktop/lnp_agent/lib/agent/bootstrap.ts) loads:
  - accessible matters
  - tracked session metadata from Mongo
  - matter-session mappings from Mongo
- it then calls [fetchOpenCodeBootstrap(...)](/mnt/c/users/delan/desktop/lnp_agent/lib/agent/opencode-server.ts) to fetch from OpenCode:
  - `session.list()`
  - `provider.list()`
  - and, for selected chat routes, `session.messages()` + `session.status()`

5. **Server filters OpenCode data before sending it down**
- the raw OpenCode session list is filtered against tracked Mongo sessions
- only tracked sessions become `bootstrap.availableSessions`
- the selected chat route includes:
  - `bootstrap.initialSessionSnapshot.storedMessages`
  - `bootstrap.initialSessionSnapshot.status`

6. **Server renders the client runtime with hydrated data**
- [agent-client-runtime.tsx](/mnt/c/users/delan/desktop/lnp_agent/components/agent-shell/agent-client-runtime.tsx)
- receives a bootstrap payload that already contains:
  - filtered sidebar chats
  - provider/model catalog
  - selected chat messages and status, when applicable

7. **Client runtime mounts from server snapshot**
- initial client state is seeded directly from bootstrap:
  - sidebar sessions
  - selected matter/chat ids
  - timeline items for the selected chat
  - model/context/spend metadata
  - busy/idle state for the selected chat

8. **Client route sync consumes bootstrap first**
- on route change, the runtime now prefers the server snapshot
- if `bootstrap.initialSessionSnapshot` exists, it hydrates the chat from that snapshot instead of immediately calling `session.messages()` and `session.status()` again
- if the server could not provide OpenCode data, the runtime falls back to the older client-side fetch path

9. **Client reconnects for live behavior**
- after the server snapshot is applied, the client still:
  - creates/reuses the OpenCode SDK client
  - ensures the event stream is connected
  - refreshes interactive requests
- this is what keeps:
  - streaming output
  - permission prompts
  - questions
  - status updates
  working live after the initial render

10. **Ongoing chat behavior remains client-side**
- prompting
- event processing
- run-state updates
- optimistic UI
- interactive request replies

## Why This Change Exists

Before this change, the route did two visible loading phases:

1. server route/loading boundary
2. client-side OpenCode hydration for:
   - sidebar sessions
   - selected chat history
   - session status
   - provider metadata

After this change:

- the server provides the initial OpenCode snapshot
- the client continues from that snapshot
- the client no longer needs to rediscover the selected chat immediately after the page has already loaded

## Summary

In short:

- **server side**: auth -> resolve tracked session -> load Mongo metadata -> fetch OpenCode snapshot -> filter -> send hydrated bootstrap
- **client side**: mount from hydrated snapshot -> connect live OpenCode event stream -> continue chatting
