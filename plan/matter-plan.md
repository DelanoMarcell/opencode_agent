# Matter Plan

## Purpose

This document defines the planned matter architecture for the agent experience before any implementation work begins. The goal is to add app-managed matters on top of OpenCode sessions without changing how OpenCode itself creates or stores sessions.

## Core Requirements

- Users must be able to create matters.
- A matter must have:
  - a user-provided matter code, for example `MATTER12868`
  - a matter name, for example `Dispute Between X and Y`
  - an optional matter description
- A matter stores session IDs from OpenCode.
- When a user clicks a specific matter, the UI should only show sessions assigned to that matter.
- Sessions that are not assigned to a matter must remain available as normal sessions.
- Users who can access a matter can see and resume its sessions.
- MongoDB `_id` remains the internal identifier for all documents.

## High-Level Model

The design uses three collections:

1. `matters`
2. `matter_members`
3. `opencode_sessions`
4. `matter_sessions`

This split is intentional. Each collection models a different kind of data and relationship:

- `matters` stores matter-level metadata
- `matter_members` stores who can access each matter
- `opencode_sessions` stores app-side metadata for every known OpenCode session, including who created it
- `matter_sessions` stores which tracked OpenCode sessions belong to which matter

## Collection Schemas

### `matters`

One document represents one matter.

```ts
{
  _id: ObjectId,
  code: string,              // user-entered matter code, e.g. MATTER12868
  title: string,             // human-readable matter name, e.g. Dispute Between X and Y
  description?: string,      // optional
  ownerUserId: ObjectId,     // creator / primary owner
  status: "active" | "archived",
  createdAt: Date,
  updatedAt: Date
}
```

Notes:

- `_id` is the internal MongoDB identifier.
- `code` is the user-facing matter code.
- `title` is the matter name.
- `description` is optional.
- `ownerUserId` points to the user who created the matter.
- matter access is controlled through `matter_members`.
- when a matter is created, all existing users are added to `matter_members`.
- `ownerUserId` is still kept so the system knows who created the matter.

Example:

```json
{
  "_id": "67d1a1f0c8e4b2a91f001111",
  "code": "MATTER12868",
  "title": "Dispute Between X and Y",
  "description": "Contract dispute covering correspondence, advice, and litigation prep.",
  "ownerUserId": "67d19f80c8e4b2a91f000101",
  "status": "active",
  "createdAt": "2026-03-13T09:00:00.000Z",
  "updatedAt": "2026-03-13T09:00:00.000Z"
}
```

### Matter Creation Membership Behavior

When creating a matter folder:

- the app creates the matter document
- the app stores the creator in `ownerUserId`
- the app inserts all existing user accounts into `matter_members`

Meaning:

- all current users can access the matter
- all current users can access sessions assigned to that matter
- the application can still show who created the matter by reading `ownerUserId`

### `matter_members`

One document represents one user's membership in one matter.

```ts
{
  _id: ObjectId,
  matterId: ObjectId,
  userId: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```

Notes:

- This collection determines access to matters.
- A user can belong to many matters.
- A matter can have many users.
- Membership grants full access to the matter.
- For V1, every newly created matter gets membership rows for all existing users.

Example:

```json
{
  "_id": "67d1a250c8e4b2a91f002222",
  "matterId": "67d1a1f0c8e4b2a91f001111",
  "userId": "67d19f80c8e4b2a91f000101",
  "createdAt": "2026-03-13T09:01:00.000Z",
  "updatedAt": "2026-03-13T09:01:00.000Z"
}
```

Another member:

```json
{
  "_id": "67d1a260c8e4b2a91f002223",
  "matterId": "67d1a1f0c8e4b2a91f001111",
  "userId": "67d19fb0c8e4b2a91f000102",
  "createdAt": "2026-03-13T09:02:00.000Z",
  "updatedAt": "2026-03-13T09:02:00.000Z"
}
```

### `opencode_sessions`

One document represents one tracked OpenCode session known to the application.

```ts
{
  _id: ObjectId,
  sessionId: string,         // OpenCode session id
  createdByUserId: ObjectId,
  createdAt: Date
}
```

Notes:

- OpenCode still owns the actual session content and runtime history.
- MongoDB stores app-side metadata for each session.
- This collection lets the app track who created a session, including sessions not tied to any matter.

Example:

```json
{
  "_id": "67d1a300c8e4b2a91f003333",
  "sessionId": "ses_abc123xyz789",
  "createdByUserId": "67d19f80c8e4b2a91f000101",
  "createdAt": "2026-03-13T09:05:00.000Z"
}
```

Another tracked session:

```json
{
  "_id": "67d1a301c8e4b2a91f003334",
  "sessionId": "ses_def456uvw000",
  "createdByUserId": "67d19fb0c8e4b2a91f000102",
  "createdAt": "2026-03-13T09:10:00.000Z"
}
```

### `matter_sessions`

One document represents one tracked OpenCode session assigned to one matter.

```ts
{
  _id: ObjectId,
  matterId: ObjectId,
  opencodeSessionId: ObjectId,
  addedByUserId: ObjectId,
  createdAt: Date
}
```

Notes:

- This collection maps tracked sessions to matters.
- `opencodeSessionId` points to a row in `opencode_sessions`.
- This preserves creator tracking separately from matter assignment.

Example:

```json
{
  "_id": "67d1a350c8e4b2a91f003444",
  "matterId": "67d1a1f0c8e4b2a91f001111",
  "opencodeSessionId": "67d1a300c8e4b2a91f003333",
  "addedByUserId": "67d19f80c8e4b2a91f000101",
  "createdAt": "2026-03-13T09:06:00.000Z"
}
```

Another linked session:

```json
{
  "_id": "67d1a351c8e4b2a91f003445",
  "matterId": "67d1a1f0c8e4b2a91f001111",
  "opencodeSessionId": "67d1a301c8e4b2a91f003334",
  "addedByUserId": "67d19fb0c8e4b2a91f000102",
  "createdAt": "2026-03-13T09:11:00.000Z"
}
```

## Relationship Justification

### 1. `matters` to `matter_members`

Relationship:

- one matter to many membership records
- one user to many membership records

This is a many-to-many relationship between users and matters.

Why it should be modeled separately:

- a matter can have multiple users
- a user can access multiple matters
- this is easier to query than embedding large member arrays forever
- this supports future sharing cleanly
- it gives the app an explicit list of users who can access each matter

### 2. `opencode_sessions` to `matter_sessions`

Relationship:

- one tracked session to zero or one matter assignment record

This is a one-to-zero-or-one relationship from a tracked session to a matter link.

Why it should be modeled separately:

- a session may exist without belonging to a matter
- the app needs creator tracking even for unassigned sessions
- creator tracking and matter assignment are different concerns

### 3. `matters` to `matter_sessions`

Relationship:

- one matter to many session assignment records

This is a one-to-many relationship from matter to assigned sessions.

Why it should be modeled separately:

- one matter can contain many sessions
- session assignment changes independently of session creation
- this keeps matter metadata separate from operational session assignment data

### 4. Tracked Session Assignment Rule

Planned rule:

- one tracked OpenCode session belongs to zero or one matter

This means:

- a session may be unassigned
- if assigned, it should point to exactly one matter

Why this rule is useful:

- avoids ambiguous filtering
- avoids conflicting access rules
- keeps UI behavior simple
- makes matter selection deterministic

## How The Collections Work Together

Given the agreed decisions, the flow becomes:

- OpenCode returns all sessions available.
- The app checks `matter_sessions` to see which sessions are assigned to a matter.
- If a session is assigned to a matter:
  - the user must have a membership row in `matter_members`
  - then they can see and resume it
- If a session is not assigned to any matter:
  - it appears as a normal unassigned session
  - no matter filter applies to it unless the user explicitly views `all sessions` or `unassigned sessions`

This is a critical design rule because the application does not control how OpenCode stores sessions. The application only controls:

- matter metadata
- matter access
- tracked session metadata
- matter-to-session assignment

## Example End-to-End Data

### Users

```json
[
  {
    "_id": "67d19f80c8e4b2a91f000101",
    "email": "owner@firm.com",
    "name": "Owner User"
  },
  {
    "_id": "67d19fb0c8e4b2a91f000102",
    "email": "viewer@firm.com",
    "name": "Viewer User"
  }
]
```

### Matter

```json
{
  "_id": "67d1a1f0c8e4b2a91f001111",
  "code": "MATTER12868",
  "title": "Dispute Between X and Y",
  "description": "Contract dispute covering correspondence and litigation preparation.",
  "ownerUserId": "67d19f80c8e4b2a91f000101",
  "status": "active"
}
```

### Matter Members

```json
[
  {
    "matterId": "67d1a1f0c8e4b2a91f001111",
    "userId": "67d19f80c8e4b2a91f000101"
  },
  {
    "matterId": "67d1a1f0c8e4b2a91f001111",
    "userId": "67d19fb0c8e4b2a91f000102"
  }
]
```

### Tracked OpenCode Sessions

```json
[
  {
    "_id": "67d1a300c8e4b2a91f003333",
    "sessionId": "ses_abc123xyz789",
    "createdByUserId": "67d19f80c8e4b2a91f000101"
  },
  {
    "_id": "67d1a301c8e4b2a91f003334",
    "sessionId": "ses_def456uvw000",
    "createdByUserId": "67d19fb0c8e4b2a91f000102"
  },
  {
    "_id": "67d1a302c8e4b2a91f003335",
    "sessionId": "ses_unfiled001",
    "createdByUserId": "67d19f80c8e4b2a91f000101"
  }
]
```

### Matter Sessions

```json
[
  {
    "matterId": "67d1a1f0c8e4b2a91f001111",
    "opencodeSessionId": "67d1a300c8e4b2a91f003333"
  },
  {
    "matterId": "67d1a1f0c8e4b2a91f001111",
    "opencodeSessionId": "67d1a301c8e4b2a91f003334"
  }
]
```

### Raw OpenCode Sessions

```json
[
  {
    "id": "ses_abc123xyz789",
    "title": "Initial contract review"
  },
  {
    "id": "ses_def456uvw000",
    "title": "Witness prep notes"
  },
  {
    "id": "ses_unfiled001",
    "title": "General drafting scratchpad"
  }
]
```

### What The User Sees

Inside matter `MATTER12868 / Dispute Between X and Y`:

- `ses_abc123xyz789`
- `ses_def456uvw000`

Outside matters as normal sessions:

- `ses_unfiled001`

The app can also show creator attribution for all three sessions because each one has a row in `opencode_sessions`.

## Access Rules

When a matter is created:

- the creator is stored in `ownerUserId`
- all existing users are added to `matter_members`

For V1, this means all current users can access every created matter.

### What Full Access Means

Any user who has access to a matter can:

- access the matter
- view matter details
- assign and unassign sessions
- see matter-linked sessions
- resume matter-linked sessions
- manage membership if that capability is later exposed in the UI

### Session Access

If a session is assigned to a matter:

- the user must be included in `matter_members`
- if they are a member, they can see and resume the session

If a session is unassigned:

- it remains visible as a normal session
- it is not filtered under a matter unless it is assigned later

## Filtering Behavior

### Matter View

When a matter is selected:

- the UI loads the `opencodeSessionId` values assigned to that matter
- the UI resolves those rows to `sessionId` values from `opencode_sessions`
- the UI filters the incoming OpenCode session list against those session IDs
- only matching sessions are shown under that matter

### Unassigned Sessions

Tracked sessions with no row in `matter_sessions`:

- remain visible as regular sessions
- are not hidden by the existence of matters
- still retain creator attribution through `opencode_sessions`

### All Sessions View

If the application supports a combined sessions view, it can show:

- matter-assigned sessions grouped under their matter
- unassigned sessions as regular standalone sessions

## Routing And URL Model

The application should treat chat navigation as URL-addressable app state, not only local client state.

This is important because users need to:

- switch reliably between chats
- deep-link directly into a chat
- refresh the page without losing context
- open a matter or chat in a new tab

### Canonical Routes

Recommended route structure:

- `/agent/chats/:trackedSessionId`
- `/agent/matters/:matterId`
- `/agent/matters/:matterId/chats/:trackedSessionId`

Meaning:

- unassigned normal chats live under `/agent/chats/:trackedSessionId`
- a matter overview lives under `/agent/matters/:matterId`
- a chat assigned to a matter lives under `/agent/matters/:matterId/chats/:trackedSessionId`

### Route Identifier Choice

The route parameter should use the MongoDB `_id` from `opencode_sessions`, not the raw OpenCode `sessionId`.

Reason:

- `matter_sessions` already points to `opencodeSessionId`
- the app should own canonical routing
- OpenCode session ids remain external references
- the app can still resolve the route to the raw OpenCode `sessionId` before resuming a session

### Canonical Resolution Rule

One tracked session belongs to zero or one matter.

Therefore:

- if a tracked session has no `matter_sessions` row, its canonical route is `/agent/chats/:trackedSessionId`
- if a tracked session is assigned to a matter, its canonical route is `/agent/matters/:matterId/chats/:trackedSessionId`

This should be treated as a canonical routing rule, not only a display rule.

### Route Loading Behavior

When loading `/agent/chats/:trackedSessionId`:

- the app resolves `trackedSessionId` through `opencode_sessions`
- the app finds the raw OpenCode `sessionId`
- the app resumes that OpenCode session
- the app confirms the tracked session is still unassigned

When loading `/agent/matters/:matterId/chats/:trackedSessionId`:

- the app verifies the user has access through `matter_members`
- the app verifies the tracked session is linked through `matter_sessions`
- the app resolves the tracked session to the raw OpenCode `sessionId`
- the app resumes that OpenCode session

When loading `/agent/matters/:matterId`:

- the app loads matter metadata
- the app resolves the tracked sessions assigned to that matter
- the app shows that matter context even before a specific chat is selected

### Redirect Behavior

The app should redirect to the canonical route when needed.

Examples:

- if a tracked session is assigned to a matter later, its canonical route should move from `/agent/chats/:trackedSessionId` to `/agent/matters/:matterId/chats/:trackedSessionId`
- if a tracked session is unassigned from a matter later, its canonical route should move back to `/agent/chats/:trackedSessionId`

This prevents one chat from having multiple equally valid URLs.

### Why Not Query-Only Routing

A query-only shape such as `/agent?session=...` is weaker for this design because:

- matter context becomes less explicit
- canonical route rules become less clear
- nested matter navigation becomes harder to express
- the route shape stops reflecting the data model cleanly

Path-based routing fits the planned collections more directly.

## Recommended Constraints

### `matters`

- unique index on `code`

Reason:

- the matter code is user-facing and should not collide

### `matter_members`

- unique compound index on `(matterId, userId)`

Reason:

- a user should not have duplicate memberships in the same matter

### `opencode_sessions`

- unique index on `sessionId`

Reason:

- each OpenCode session should have one metadata row in MongoDB

### `matter_sessions`

- unique compound index on `(matterId, opencodeSessionId)`
- unique index on `opencodeSessionId`

Reason:

- no duplicate assignment row inside the same matter
- a tracked session should belong to at most one matter

## Why This Design Fits The Current Application

- OpenCode already owns session creation and session listing.
- The application already owns user authentication through MongoDB and NextAuth.
- Matters are application concepts, not OpenCode concepts.
- The application also needs creator attribution for sessions, including unassigned sessions.
- The correct approach is therefore to keep matter metadata, permissions, and app-side session metadata in MongoDB while treating OpenCode session IDs as external references.

## Implementation Direction For V1

This document is planning only, but the intended V1 behavior is:

- create matters in MongoDB
- store the creator in `ownerUserId`
- create matter memberships in MongoDB
- add all existing users to `matter_members` when a matter is created
- create an `opencode_sessions` row whenever the app creates an OpenCode session
- assign tracked sessions to matters through `matter_sessions`
- keep unassigned tracked sessions visible as normal sessions
- filter matter views by resolving `matter_sessions` to `opencode_sessions` and then intersecting with OpenCode sessions
- allow any matter member to resume sessions assigned to that matter
- retain creator attribution for all tracked sessions, including unassigned sessions

## Summary

This design is based on clear relationship boundaries:

- one matter stores metadata
- many users can belong to many matters
- one tracked session stores creator metadata
- one matter can contain many tracked sessions
- one tracked session can belong to zero or one matter

That gives the application:

- a clean access-control layer
- deterministic matter filtering
- support for unassigned sessions
- a structure that can scale into future sharing and matter management features
