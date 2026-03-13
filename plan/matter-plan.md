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
3. `matter_sessions`

This split is intentional. Each collection models a different kind of data and relationship:

- `matters` stores matter-level metadata
- `matter_members` stores who can access each matter
- `matter_sessions` stores which OpenCode sessions belong to which matter

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

### `matter_sessions`

One document represents one OpenCode session assigned to one matter.

```ts
{
  _id: ObjectId,
  matterId: ObjectId,
  sessionId: string,         // OpenCode session id
  addedByUserId: ObjectId,
  createdAt: Date
}
```

Notes:

- OpenCode owns sessions.
- MongoDB stores the mapping from session ID to matter.
- This collection is the app-side source of truth for matter assignment.

Example:

```json
{
  "_id": "67d1a300c8e4b2a91f003333",
  "matterId": "67d1a1f0c8e4b2a91f001111",
  "sessionId": "ses_abc123xyz789",
  "addedByUserId": "67d19f80c8e4b2a91f000101",
  "createdAt": "2026-03-13T09:05:00.000Z"
}
```

Another linked session:

```json
{
  "_id": "67d1a301c8e4b2a91f003334",
  "matterId": "67d1a1f0c8e4b2a91f001111",
  "sessionId": "ses_def456uvw000",
  "addedByUserId": "67d19fb0c8e4b2a91f000102",
  "createdAt": "2026-03-13T09:10:00.000Z"
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

### 2. `matters` to `matter_sessions`

Relationship:

- one matter to many session assignment records

This is a one-to-many relationship from matter to assigned sessions.

Why it should be modeled separately:

- one matter can contain many sessions
- OpenCode sessions are not stored in MongoDB, so the app needs a separate mapping layer
- this keeps matter metadata separate from operational session assignment data

### 3. `sessionId` to `matter_sessions`

Planned rule:

- one OpenCode session belongs to zero or one matter

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

### Matter Sessions

```json
[
  {
    "matterId": "67d1a1f0c8e4b2a91f001111",
    "sessionId": "ses_abc123xyz789"
  },
  {
    "matterId": "67d1a1f0c8e4b2a91f001111",
    "sessionId": "ses_def456uvw000"
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

- the UI loads the assigned `sessionId` values for that matter
- the UI filters the incoming OpenCode session list against those IDs
- only matching sessions are shown under that matter

### Unassigned Sessions

Sessions with no row in `matter_sessions`:

- remain visible as regular sessions
- are not hidden by the existence of matters

### All Sessions View

If the application supports a combined sessions view, it can show:

- matter-assigned sessions grouped under their matter
- unassigned sessions as regular standalone sessions

## Recommended Constraints

### `matters`

- unique index on `code`

Reason:

- the matter code is user-facing and should not collide

### `matter_members`

- unique compound index on `(matterId, userId)`

Reason:

- a user should not have duplicate memberships in the same matter

### `matter_sessions`

- unique compound index on `(matterId, sessionId)`
- unique index on `sessionId`

Reason:

- no duplicate assignment row inside the same matter
- a session should belong to at most one matter

## Why This Design Fits The Current Application

- OpenCode already owns session creation and session listing.
- The application already owns user authentication through MongoDB and NextAuth.
- Matters are application concepts, not OpenCode concepts.
- The correct approach is therefore to keep matter metadata and permissions in MongoDB and treat OpenCode session IDs as external references.

## Implementation Direction For V1

This document is planning only, but the intended V1 behavior is:

- create matters in MongoDB
- store the creator in `ownerUserId`
- create matter memberships in MongoDB
- add all existing users to `matter_members` when a matter is created
- assign OpenCode session IDs to matters in MongoDB
- keep unassigned sessions visible as normal sessions
- filter matter views by intersecting OpenCode sessions with `matter_sessions`
- allow any matter member to resume sessions assigned to that matter

## Summary

This design is based on clear relationship boundaries:

- one matter stores metadata
- many users can belong to many matters
- one matter can contain many sessions
- one session can belong to zero or one matter

That gives the application:

- a clean access-control layer
- deterministic matter filtering
- support for unassigned sessions
- a structure that can scale into future sharing and matter management features
