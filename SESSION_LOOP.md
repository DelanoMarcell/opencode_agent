# OpenCode Session Loop Notes

This document explains how the chat run loop works in this app and what `session.idle` means.

## High-level loop

1. User sends a prompt.
2. App ensures a session exists (`session.create` if needed).
3. App submits prompt with `session.promptAsync`.
4. App listens to streamed events from `event.subscribe`.
5. UI updates continuously from events (text/tool/status).
6. Run is considered finished only when `session.idle` is received for the active session.

## Event flow in practice

- `session.status: busy`
  - Server is actively processing.
  - This can happen multiple times in one run.

- `message.part.updated` with `part.type === "text"`
  - Incremental assistant text chunks.
  - These are draft/streaming updates, not guaranteed final.

- `message.part.updated` with `part.type === "tool"`
  - Tool state transitions: pending/running/completed/error.
  - Tools and assistant text can interleave in the same run.

- `step-start` / `step-finish`
  - Internal step boundaries.
  - Useful for trace, but not final completion.

- `session.error`
  - Terminal failure path for a run.

- `session.idle`
  - Authoritative completion signal for the active run.
  - This is when the app should mark the response as final.

## What `session.idle` means

`session.idle` means the session is no longer actively generating or executing steps for that turn.

In this app, when `session.idle` is received:

1. The current assistant message is marked as no longer running.
2. If streamed text was empty, the app can fetch fallback text from `session.messages`.
3. The run is finalized in UI and trace (`turn finished ...`).

## Important clarification

Seeing assistant text appear does **not** mean the run is done.

The model can:

1. Emit partial text,
2. Call tools,
3. Emit more text,
4. Then finally idle.

So the only reliable “final answer now” signal is `session.idle` (or `session.error` for failure).

## Recommended UI behavior

1. Treat streamed text as draft while busy.
2. Show tool updates separately (pending/running/completed/error).
3. Mark message final only on `session.idle`.
4. Optionally replace draft with canonical final text from `session.messages` on idle.
