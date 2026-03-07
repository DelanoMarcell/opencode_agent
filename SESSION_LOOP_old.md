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


## Reliability hardening update (2026-03-07)

The run loop now includes a lightweight stream supervisor to reduce stuck states and missed UI updates.

### 1) Event stream supervisor

- `event.subscribe` now runs inside a reconnect loop.
- Backoff is capped and deterministic:
  1. 250ms
  2. 1000ms
  3. 2000ms
  4. 5000ms (max, repeats until reconnected)
- Backoff resets after first event is received on a new connection.

### 2) Heartbeat/staleness watchdog

- While a run is busy, the app tracks last event timestamp.
- If no events arrive for 15s during busy state, current stream attempt is aborted and reconnected.
- This covers cases where the server is still alive but the client stream became stale.

### 3) Non-blocking event handling

- `processEvent` is now synchronous for state updates.
- No awaited network calls are performed inline in event processing.
- This avoids head-of-line blocking where one slow side call delays later events.

### 4) Interactive request refresh behavior

- Direct inline refresh calls were replaced with `scheduleInteractiveRefresh()` (debounced, trailing).
- Refresh uses dirty-while-running semantics:
  - If refresh is already in flight, mark refresh as dirty.
  - Run exactly one follow-up refresh after in-flight call completes.
- Result: permission/question cards are less likely to lag or require manual page refresh.

### 5) Reconnect resync

On reconnect, app performs canonical resync for active session:

1. Reload `session.messages` and rebuild timeline from server truth.
2. Reload `question.list` and `permission.list`.
3. Rebuild local event caches used for incremental rendering.

This prevents drift after temporary disconnects.

### 6) Completion signals (primary + fallbacks)

Completion is now finalized by multiple signals, in this order:

1. Primary: `session.idle`
2. Fallback: `session.status` transitions to `idle`
3. Final fallback: periodic `session.status()` polling every 2.5s while busy

Only one finalization is allowed per run (guarded), preventing duplicate completion paths.

### 7) What still remains true

- `session.idle` remains the authoritative primary completion event.
- Tool and text events can still interleave in any order.
- Final UI stabilization now does not depend on a single event path.
