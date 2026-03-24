# Thinking

`Thinking...` renders only when both of these are true:

- the chat is busy
- the current UI phase is `thinking`

In code, that is:

```ts
const showThinkingCard = isBusy && runUiPhase === "thinking";
```

Typical flow:

1. User clicks `Send`
2. App sets `isBusy = true`
3. App sets `runUiPhase = "thinking"`
4. `Thinking...` appears

It stops rendering when:

- assistant text starts streaming
- a tool call starts running
- the run finishes or fails

So `Thinking...` means:

- the model is currently working
- but no visible assistant output or tool activity has started yet

Why that can happen:

- there is a gap between `prompt accepted` and `first visible event`
- during that gap, the model may be queued by the provider
- it may be doing internal reasoning
- it may be preparing the first token
- it may be deciding whether to call a tool
- it may be waiting for the first streamed text or tool part to be emitted

So `Thinking...` covers:

- active run
- no visible output yet
