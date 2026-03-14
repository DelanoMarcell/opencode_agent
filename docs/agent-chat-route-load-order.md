# Agent Chat Route Load Order

This document describes what happens, in order, when a route like:

- `/agent/chats/:trackedSessionId`

loads in the app.

## End-to-End Order

1. **Next.js server route runs**
- [page.tsx](/mnt/c/Users/Delan/desktop/lnp_agent/app/agent/chats/[trackedSessionId]/page.tsx)
- reads `trackedSessionId` from the URL

2. **Auth is checked**
- calls `requireAuthenticatedAgentUser()` from [bootstrap.ts](/mnt/c/Users/Delan/desktop/lnp_agent/lib/agent/bootstrap.ts)

3. **Tracked session is resolved**
- calls `resolveTrackedSession(trackedSessionId)` in [route-resolvers.ts](/mnt/c/Users/Delan/desktop/lnp_agent/lib/agent/route-resolvers.ts)
- this looks up the Mongo `opencode_sessions` row
- if it finds a matter assignment, the route redirects to:
  - `/agent/matters/:matterId/chats/:trackedSessionId`

4. **Bootstrap data is built**
- calls `buildAgentBootstrap(...)` in [bootstrap.ts](/mnt/c/Users/Delan/desktop/lnp_agent/lib/agent/bootstrap.ts)
- this loads:
  - accessible matters
  - tracked sessions
  - matter-session mappings
- and includes:
  - `initialTrackedSessionId`
  - `initialRawSessionId`

5. **Server renders the client runtime**
- renders [agent-client-runtime.tsx](/mnt/c/Users/Delan/desktop/lnp_agent/components/agent-shell/agent-client-runtime.tsx)
- with the bootstrap payload

6. **Client runtime mounts**
- initial state is seeded from bootstrap:
  - `selectedTrackedSessionID`
  - `selectedSessionID`
  - `selectedMatterID`
- this happens near the top of [agent-client-runtime.tsx](/mnt/c/Users/Delan/desktop/lnp_agent/components/agent-shell/agent-client-runtime.tsx)

7. **Client starts background setup**
- `loadSessionOptions()` runs
- `refreshModelContextLimits()` runs
- this fetches the OpenCode session list and provider/model metadata

8. **Auto-resume effect runs**
- the effect checks `bootstrap.initialRawSessionId`
- if present, it calls `resumeSession()`
- see [agent-client-runtime.tsx](/mnt/c/Users/Delan/desktop/lnp_agent/components/agent-shell/agent-client-runtime.tsx)

9. **`resumeSession()` rebuilds chat state**
- clears old local runtime state
- ensures OpenCode clients exist
- ensures event stream is connected
- fetches stored messages with `client.session.messages(...)`
- rebuilds the timeline from those messages

10. **Session status is checked**
- `resumeSession()` then calls `client.session.status()`
- if status is `busy` or `retry`:
  - rebuilds `activeRunRef`
  - sets `isBusy = true`
  - derives `runUiPhase`
- if status is `idle`:
  - leaves the session as non-busy

11. **Polling / streaming continue**
- if the resumed session is busy:
  - the polling effect starts
  - incoming stream events continue updating the UI
- if idle:
  - the restored finished chat is shown with no active run state

## Summary

In short:

- **server side**: auth -> resolve tracked session -> build bootstrap
- **client side**: mount runtime -> fetch OpenCode session list -> auto-resume selected chat -> fetch messages -> check status -> continue live updates
