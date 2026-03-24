# New Chat Flow

When a user clicks `New Chat`, no MongoDB record is created yet.

## What Happens First

Clicking `New Chat` only resets client-side state in the app:

- clears the selected session
- clears the timeline
- clears the composer input
- clears attached Microsoft 365 files
- routes the user back to either:
  - `/agent`
  - or the currently selected matter page

This happens in [components/agent-shell/agent-client-runtime.tsx](/mnt/c/users/delan/desktop/lnp_agent/components/agent-shell/agent-client-runtime.tsx).

At this stage, there is no database write.

## When A Record Is Actually Created

The first real creation happens only when the user sends the first prompt.

The runtime calls `ensureSession()`, which does two things:

1. Creates the real OpenCode session with `client.session.create()`
2. Registers that session in this app by POSTing to `/api/opencode-sessions`

## Records Created

### 1. `OpencodeSession`

The API route creates an `OpencodeSession` record if one does not already exist.

Model:
- [lib/models/opencode-session.ts](/mnt/c/users/delan/desktop/lnp_agent/lib/models/opencode-session.ts)

Fields written:
- `organisationId`
- `sessionId`
- `createdByUserId`
- `createdAt`

Meaning:
- this is the app-side metadata record for the raw OpenCode session
- the actual conversation content still lives in OpenCode

### 2. `MatterSession` (only if the chat is created inside a matter)

If the chat is started from inside a matter, the runtime then POSTs to `/api/matters/[id]/sessions`.

That creates a `MatterSession` record.

Model:
- [lib/models/matter-session.ts](/mnt/c/users/delan/desktop/lnp_agent/lib/models/matter-session.ts)

Fields written:
- `matterId`
- `opencodeSessionId`
- `addedByUserId`
- `createdAt`

Meaning:
- this links the app-side session record to a matter
- a session can belong to at most one matter

## Two Cases

### New chat from the general Chats workspace

Records created:
- `OpencodeSession`

### New chat from inside a matter

Records created:
- `OpencodeSession`
- `MatterSession`

## What Is Not Created

Creating a new chat does not create:

- a new `Matter`
- a new `MatterMember`
- a new `User`
- a new `Organisation`

Those records must already exist.

## Summary

`New Chat` in the UI is only a reset action.

The first database write happens only after the first prompt is sent, because that is when the app gets a real OpenCode session id and can persist it.
