# Understanding The Agent Runtime

This note is a quick file map for the main agent UI and runtime.
## Main Entry

- [app/agent/page.tsx](../app/agent/page.tsx) is the top-level agent page. It composes the sidebar, main conversation panel, composer, and trace panel, and still owns the core session/stream orchestration.

## Agent Shell Components

- [components/agent-shell/matter-chat-sidebar.tsx](../components/agent-shell/matter-chat-sidebar.tsx) renders the left sidebar that groups sessions under matter-style folders.
- [components/agent-shell/agent-session-header.tsx](../components/agent-shell/agent-session-header.tsx) renders the active-session header, status badge, resume action, and overflow menu.
- [components/agent-shell/agent-timeline.tsx](../components/agent-shell/agent-timeline.tsx) renders the main conversation timeline, including user messages, assistant messages, tool cards, and the transient thinking card.
- [components/agent-shell/agent-interactive-panel.tsx](../components/agent-shell/agent-interactive-panel.tsx) renders pending interactive work from the runtime, mainly question flows and permission prompts.
- [components/agent-shell/agent-composer.tsx](../components/agent-shell/agent-composer.tsx) renders the message composer, send button, context usage display, and cost/session usage popover.
- [components/agent-shell/agent-trace-panel.tsx](../components/agent-shell/agent-trace-panel.tsx) renders the right-hand trace/debug panel, including base URL controls and live trace output.

## Hooks

- [hooks/agent/use-agent-usage.ts](../hooks/agent/use-agent-usage.ts) manages model/context usage, token totals, session spend, and provider pricing metadata for the active session.
- [hooks/use-mobile.ts](../hooks/use-mobile.ts) provides a simple mobile breakpoint check for responsive UI decisions.

## Runtime Modules

- [lib/agent-runtime/types.ts](../lib/agent-runtime/types.ts) defines the shared runtime types used by the agent page, hooks, and extracted components.
- [lib/agent-runtime/helpers.ts](../lib/agent-runtime/helpers.ts) contains shared helper functions for formatting, event normalization, usage parsing, question handling, tool-call shaping, message ordering, and timeline reconstruction.

## Runtime Helper Functions

### Event and general helpers

- `normalizeEvent`: unwraps event payloads into a consistent event object.
- `summarizeText`: trims long text for logs and compact trace output.
- `toErrorMessage`: converts unknown errors into readable strings.
- `waitFor`: waits for a delay and respects abort signals.
- `toCompactJSON`: serializes values into short JSON snippets.

### Number and token helpers

- `toTokenNumber`: normalizes token-like values into safe integers.
- `areTokenTotalsEqual`: compares two token-usage totals.
- `getTokenUsageTotal`: calculates the combined token total.
- `sumTokenUsageTotals`: adds token-usage totals together.
- `formatTokenCount`: formats token counts for display.
- `formatUsdAmount`: formats USD values for display.
- `formatUsdRate`: formats per-million token pricing labels.
- `toCostNumber`: normalizes pricing/cost values into safe numbers.

### Record and metadata helpers

- `toRecord`: safely narrows unknown values into object records.
- `getCreatedAt`: reads `info.time.created` from runtime metadata.
- `toModelCostInfo`: normalizes model pricing metadata from provider responses.
- `getModelKey`: builds a stable `provider/model` key.
- `parseAssistantUsageFromInfo`: extracts assistant usage snapshots from message metadata.
- `formatSessionOptionLabel`: formats a session title, short ID, and timestamp for UI display.

### Cost and usage helpers

- `buildCostFormulaRow`: creates a single cost-row breakdown entry.
- `resolveSessionCostGroup`: chooses the pricing tier that applies to a usage snapshot.
- `buildSessionCostFormulaGroups`: groups session usage into display-ready cost breakdowns.

### Question helpers

- `createEmptyQuestionDraft`: creates a blank answer draft.
- `renderQuestionHints`: returns short guidance text for a question.
- `buildQuestionAnswer`: converts a draft into the final answer payload sent back to the runtime.

### Tool helpers

- `extractCommandFromInput`: finds a shell/command string inside tool input data.
- `getToolSignature`: creates a compact signature used to detect tool state changes.
- `formatToolUpdate`: formats tool events for the live trace panel.
- `getAssistantError`: extracts readable error text from assistant/runtime error objects.
- `normalizeToolArgs`: normalizes tool arguments into a plain object.
- `parseToolOutput`: parses JSON tool output when possible and falls back to raw text.
- `toRuntimeToolCall`: converts a tool part into the app's tool-card shape.
- `formatToolResult`: converts tool results into display-ready text.
- `getToolCallCacheSignature`: creates a cache key for comparing tool-call states.
- `preferMoreCompleteToolCall`: chooses the more complete version of a tool call when reconciling state.

### Message ordering and timeline helpers

- `compareAscending`: performs stable ascending string comparison.
- `sortStoredParts`: returns stored message parts in a shallow-copied array.
- `sortMessageEntries`: orders messages by turn and ID.
- `sortMessagePartEntries`: orders assistant parts within a message.
- `buildTimelineFromMessageState`: converts normalized message state into the rendered timeline.
- `upsertMessageEntry`: inserts or updates a message entry.
- `findMessageEntry`: finds a message entry by ID.
- `updateUserMessageText`: replaces or appends user-message text.
- `upsertMessagePart`: inserts or updates an assistant part.
- `getAssistantTextFromMessageParts`: joins assistant text parts into a single string.
- `isTextPartRunning`: determines whether a text part is still streaming.
- `getLatestAssistantSnapshot`: reads the latest assistant text from stored messages.
- `mergeAssistantText`: prefers canonical assistant text when available.
- `didSnapshotCaptureActiveRun`: checks whether a session snapshot already contains the latest local run.
- `buildMessageStateFromStoredMessages`: rebuilds normalized message state from persisted session messages.

## Main Page Callback Groups

The main page still contains several large callback groups that are important to know about:

- Message-state callbacks in [app/agent/page.tsx](../app/agent/page.tsx) manage local timeline state, optimistic user messages, assistant text parts, and tool cards.
- Session callbacks in [app/agent/page.tsx](../app/agent/page.tsx) load sessions, resume sessions, ensure a session exists, send prompts, and reset the current session.
- Stream callbacks in [app/agent/page.tsx](../app/agent/page.tsx) process runtime events, supervise the event stream, and poll for run completion.
- Interactive callbacks in [app/agent/page.tsx](../app/agent/page.tsx) manage question drafts, permission replies, and question submission.

## Practical Reading Order

If you are new to this part of the codebase, the fastest path is:

1. Read [app/agent/page.tsx](../app/agent/page.tsx) for the top-level composition.
2. Read the files in `components/agent-shell/` to understand the UI surfaces.
3. Read [hooks/agent/use-agent-usage.ts](../hooks/agent/use-agent-usage.ts) for usage/state aggregation.
4. Read [lib/agent-runtime/types.ts](../lib/agent-runtime/types.ts) and [lib/agent-runtime/helpers.ts](../lib/agent-runtime/helpers.ts) for the shared runtime vocabulary and helper behavior.
