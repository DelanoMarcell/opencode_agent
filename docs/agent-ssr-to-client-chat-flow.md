# Agent SSR To Client Chat Flow

This document explains, in simple terms, how the agent chat page works now that the initial OpenCode data is loaded on the server and the live chat continues on the client.

## Simple Model

There are now **two phases**:

1. **Server gives the page an initial snapshot**
2. **Client takes over and continues the live chat**

That is why SSR and client-side chatting can coexist.

## How It Works

1. **Server route loads**
- A page like [app/agent/chats/[trackedSessionId]/page.tsx](/mnt/c/users/delan/desktop/lnp_agent/app/agent/chats/[trackedSessionId]/page.tsx) runs on the server.
- It resolves the tracked session from Mongo.

2. **Server builds bootstrap data**
- [buildAgentBootstrap](/mnt/c/users/delan/desktop/lnp_agent/lib/agent/bootstrap.ts) loads:
  - Mongo data: matters, tracked sessions, matter mappings
  - OpenCode data: recent sessions, provider/model catalog, and for a selected chat, messages + status
- The OpenCode server-side fetch lives in [opencode-server.ts](/mnt/c/users/delan/desktop/lnp_agent/lib/agent/opencode-server.ts)

3. **Server renders the page already populated**
- [agent-client-runtime.tsx](/mnt/c/users/delan/desktop/lnp_agent/components/agent-shell/agent-client-runtime.tsx) receives that bootstrap.
- So the browser gets HTML that already contains:
  - sidebar chats
  - selected chat history
  - model/context/spend metadata
  - busy/idle state

That removes the old “page loads, then client has to rediscover everything” behavior.

## Then The Client Takes Over

4. **React hydrates in the browser**
- The same [agent-client-runtime.tsx](/mnt/c/users/delan/desktop/lnp_agent/components/agent-shell/agent-client-runtime.tsx) mounts in the browser.
- It starts from the server snapshot instead of from empty state.

5. **Client opens its own OpenCode connection**
- The browser creates the OpenCode SDK client in `ensureClients()`
- It opens the live event stream in `ensureEventStream()`

This is the important part:
- **SSR gave the initial snapshot**
- **the browser owns the ongoing live connection**

6. **Client continues live chat**
- When you send a message, `sendPrompt()` runs in the browser
- It uses the browser SDK client to call OpenCode
- Incoming stream events update the timeline live

So chatting is still client-side because:
- prompts come from the browser
- streaming updates come to the browser
- interactive actions happen in the browser

## Why This Is Valid After SSR

Because SSR is only the **starting state**.

It does not mean the server keeps controlling the page afterward.

The flow is:

- server: “here is the current snapshot”
- client: “I will now continue from that snapshot live”

That is standard App Router behavior.

## What Is Server-Side Now

- initial recent chat list
- initial selected chat messages
- initial selected chat status
- initial provider/model metadata

## What Is Still Client-Side

- sending prompts
- live event subscription
- tool/assistant streaming
- question/permission replies
- optimistic updates
- ongoing session state changes

## Why This Is Better

Before:
- server route loaded
- then client loaded sessions/messages/status again

Now:
- server already sends those initial values
- client only needs to continue live behavior

So the client is no longer doing a second full hydration pass just to know what chat it is on.

## Exact Flow For `/agent/chats/:trackedSessionId`

### 1. Load `/agent/chats/:trackedSessionId`

1. [page.tsx](/mnt/c/users/delan/desktop/lnp_agent/app/agent/chats/[trackedSessionId]/page.tsx) runs on the server
- reads `trackedSessionId` from the URL
- checks auth
- resolves the tracked session from Mongo

2. The server builds bootstrap data in [bootstrap.ts](/mnt/c/users/delan/desktop/lnp_agent/lib/agent/bootstrap.ts)
- loads Mongo data:
  - matters
  - tracked sessions
  - matter mappings
- loads OpenCode data in [opencode-server.ts](/mnt/c/users/delan/desktop/lnp_agent/lib/agent/opencode-server.ts):
  - recent sessions
  - provider/model catalog
  - selected chat messages
  - selected chat status

3. Server renders [agent-client-runtime.tsx](/mnt/c/users/delan/desktop/lnp_agent/components/agent-shell/agent-client-runtime.tsx)
- with a bootstrap payload that already contains:
  - sidebar chat list
  - selected chat history
  - busy/idle status
  - model/context/spend metadata

So when the page arrives in the browser, it is already populated.

### 2. Browser Hydrates

4. React hydrates [agent-client-runtime.tsx](/mnt/c/users/delan/desktop/lnp_agent/components/agent-shell/agent-client-runtime.tsx)
- it seeds local state from the server bootstrap
- no need to immediately call `session.messages()` just to find the chat history again

5. Then the browser connects live
- `ensureClients()` creates the browser OpenCode client
- `ensureEventStream()` opens the event stream

So now the browser is ready for live updates.

### 3. You Send A New Message

6. You type and hit send
- `sendPrompt()` runs in the browser

7. `sendPrompt()` makes sure there is a live session
- if the selected chat was already resumed, it uses that session id
- if it is a brand new chat, it creates one

8. The browser sends the prompt to OpenCode
- this happens client-side through the SDK

9. OpenCode starts streaming events back
- assistant text deltas
- tool updates
- status changes

10. The browser updates the UI live
- timeline grows
- thinking/tool-running states update
- spend/context updates continue

## Final Summary

The split is:

- **server**
  - gives you the chat as it exists at page load time

- **client**
  - continues the chat from that point onward

That is why SSR does not block client-side chatting.
SSR only gives the initial snapshot.
The browser still owns the live conversation after hydration.
