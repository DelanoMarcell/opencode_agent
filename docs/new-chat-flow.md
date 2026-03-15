# New Chat Flow

This document explains, simply, what happens when the user clicks `New chat`.

## What `New chat` means

`New chat` does **not** create an OpenCode session immediately.

It means:

1. clear the current chat
2. go to an empty compose screen
3. wait for the user to type the first message
4. only then create the real OpenCode session

## Step By Step

1. **User clicks `New chat`**
- this calls the client runtime `resetSession()` flow

2. **Current chat state is cleared**
- active session id is removed
- timeline/messages are cleared
- busy state is cleared
- interactive requests are cleared
- token/spend/context tracking is cleared

3. **The app routes to the empty chat screen**
- `/agent` for normal chats
- `/agent/matters/:matterId` if the user is already inside a matter

4. **The page loads with no selected session**
- there is no selected chat snapshot
- the user just sees the empty compose state

5. **No OpenCode session exists yet**
- the app does not create a chat just because `New chat` was clicked

6. **The first real session is created only when the user sends a message**
- `sendPrompt()` runs
- `ensureSession()` creates the OpenCode session
- the app registers that session in Mongo
- then the first prompt is sent

## Why it works this way

This avoids creating empty unused chat sessions.

So the rule is:

- `New chat` = clear and prepare
- first message = actually create the real session
