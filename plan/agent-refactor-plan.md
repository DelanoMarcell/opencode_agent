# Agent Refactor Plan

## Goal

Refactor the current `/agent` page so that:

- canonical chat navigation follows the route model in `matter-plan.md`
- Mongo-backed matter/session metadata is loaded server-side
- live OpenCode runtime behavior stays client-side
- the client filters incoming OpenCode sessions using server-provided matter data

## Route Model

Canonical app routes:

- `/agent`
- `/agent/chats/:trackedSessionId`
- `/agent/matters/:matterId`
- `/agent/matters/:matterId/chats/:trackedSessionId`

Meaning:

- `/agent` can be a default landing page or redirect target
- `/agent/chats/:trackedSessionId` is an unassigned tracked session
- `/agent/matters/:matterId` is a matter overview
- `/agent/matters/:matterId/chats/:trackedSessionId` is a tracked session assigned to a matter

## Proposed Split

### Server Component

Server wrappers should exist at the route entry points above.

Responsibilities:

- check authenticated user
- load app-owned data from MongoDB
- prepare a small bootstrap payload
- render the client runtime component with that payload

### Client Component

Suggested new file:

- `components/agent-shell/agent-runtime.tsx`

Responsibilities:

- keep current OpenCode client setup
- load and stream live OpenCode session/message data
- create and resume OpenCode sessions
- merge raw OpenCode sessions with server bootstrap data
- derive:
  - matter-linked sessions
  - normal unassigned sessions

## Bootstrap Data

The server should send resolved data, not raw collections.

Suggested shape:

```ts
type AgentBootstrap = {
  matters: Array<{
    id: string;
    code: string;
    title: string;
    description?: string;
    ownerUserId: string;
    status: "active" | "archived";
  }>;
  matterSessionIdsByMatterId: Record<string, string[]>;
  trackedSessionsBySessionId: Record<
    string,
    {
      dbId: string;
      createdByUserId: string;
      createdAt: string;
      matterId?: string;
      addedByUserId?: string;
    }
  >;
  initialMatterId?: string;
  initialTrackedSessionId?: string;
  initialRawSessionId?: string;
};
```

## Data Loading Strategy

Initial reads should happen server-side.

That means:

- server wrappers read Mongo directly
- they do not need to call internal `GET /api/...` routes for initial render
- the client receives `AgentBootstrap` as props

After hydration:

- client fetches raw OpenCode sessions from OpenCode
- client merges those with bootstrap data
- client derives matter-linked and unassigned session views

## Filtering Rules

- Matter view:
  - show OpenCode sessions whose `sessionId` belongs to the selected matter
- Normal session view:
  - show OpenCode sessions with no `matter_sessions` mapping
- If OpenCode returns a session not found in `opencode_sessions`:
  - treat it as unassigned
  - creator is unknown until backfilled

## Route Handlers

These can still exist even with SSR-based initial reads.

- `GET /api/matters`
- `POST /api/matters`
- `GET /api/matters/:id/sessions`
- `POST /api/matters/:id/sessions`
- `GET /api/opencode-sessions/:sessionId`
- `POST /api/opencode-sessions`

Purpose:

- `GET` routes support optional client refreshes and non-page consumers
- `POST` routes handle client-triggered writes
- matter creation seeds `matter_members` for all existing users
- tracked session creation stores creator metadata
- matter session creation assigns tracked sessions to matters

## Session Creation Flow

### Current OpenCode Behavior

In the current implementation, OpenCode does not create a session on page load.

Instead:

1. the user sends the first message
2. the client calls `ensureSession()`
3. `ensureSession()` calls `client.session.create()`
4. OpenCode returns the real raw `sessionId`
5. the client then sends the first prompt with `client.session.promptAsync(...)`

So the OpenCode session is created immediately before the first prompt is sent, and that creation is triggered by the first prompt flow.

### Unassigned Session

1. Client creates OpenCode session
2. Client calls `POST /api/opencode-sessions`
3. No `matter_sessions` row is created

### Matter Session

1. Client creates OpenCode session
2. Client calls `POST /api/opencode-sessions`
3. Client calls `POST /api/matters/:id/sessions`

### Tracking Rule

When `client.session.create()` succeeds and returns the raw OpenCode `sessionId`:

- create the `opencode_sessions` row immediately
- do this before or immediately alongside the first prompt flow

Reason:

- every created session should be tracked in MongoDB
- creator attribution should exist even if the first prompt later fails

## Server Load By Page

### `/agent`

- load all accessible matters
- load tracked sessions and matter mappings
- render default workspace state

### `/agent/chats/:trackedSessionId`

- resolve `trackedSessionId` through `opencode_sessions`
- load all accessible matters
- confirm whether the tracked session is assigned or unassigned
- pass the resolved raw OpenCode `sessionId` into the bootstrap

### `/agent/matters/:matterId`

- verify access through `matter_members`
- load that matter
- load tracked sessions assigned to that matter
- pass `initialMatterId`

### `/agent/matters/:matterId/chats/:trackedSessionId`

- verify access through `matter_members`
- verify tracked session belongs to that matter through `matter_sessions`
- resolve raw OpenCode `sessionId`
- pass both `initialMatterId` and `initialTrackedSessionId`

## Refactor Steps

1. Move the current client-heavy runtime from `app/agent/page.tsx` into a shared client component
2. Turn `app/agent/page.tsx` into a server wrapper or landing page
3. Add server page wrappers for the canonical `/agent/...` routes
4. Add shared server loaders that read Mongo directly and return `AgentBootstrap`
5. Add route handlers for matter creation, tracked session creation, and matter assignment
6. Update client state to merge bootstrap data with live OpenCode sessions
7. Use route params, not only local state, to determine selected matter/chat

## Result

This keeps:

- OpenCode runtime behavior in the client
- app metadata and access logic on the server

And gives:

- canonical URL-based navigation
- matter-aware filtering
- creator attribution for sessions
- support for unassigned normal sessions
