# Model Variant Selection

## Current behavior

For existing chats, the app continues using the last model and variant from the latest user message in that session.

This means:

- if a session already has messages, the app reads the latest user message
- it uses that message's `model`
- it uses that message's `variant`
- the next send continues with that same model/variant unless the user changes it

## New route behavior

For brand-new routes with no session messages yet, the app should still allow model selection before the first send.

This applies to routes like:

- `/agent`
- `/agent/matters/<matterId>`

For these routes:

- use `provider.list()` to get available providers and models before any session exists
- only expose selectable models from `openrouter`
- use the same provider metadata to get available variants for the selected model
- allow the user to choose the model before the first send
- allow the user to choose the variant before the first send
- if no variant is selected, treat it as the default variant

## Backend allowlist behavior

The app now also supports an organisation-level backend model policy.

This policy is managed from:

- `/models/allowlist`

When a backend policy exists:

- the policy is loaded server-side during bootstrap
- brand-new routes use the backend default model if one is configured
- brand-new routes use the backend default variant if one is configured
- the model selector only shows backend-allowed OpenRouter models

When no backend policy exists:

- brand-new routes fall back to the current OpenCode default model
- the client model selector continues showing the full current OpenRouter model list

## Source of truth

The intended selection flow is:

1. If the session already has messages, use the latest user message's model/variant.
2. If there is no session history yet and a backend model policy exists, use that backend policy as the source of truth.
3. Otherwise, use provider metadata from `provider.list()` so the user can choose before the first send.

## Send behavior

When sending a prompt:

- always send the selected `model`
- send the selected `variant` when one is chosen
- if no variant is chosen, use the default variant behavior

## Continuation behavior

Once the chat has started:

- keep using the existing mechanism of reading the latest user message's model/variant
- do not replace that mechanism for active or existing chats
- if an existing chat is already on a model that is no longer in the backend allowlist, let it continue using that model
- the backend allowlist only constrains newly selected models, especially on brand-new routes

So the intended split is:

- brand-new chat: backend policy drives selection when present, otherwise provider metadata does
- existing chat: latest user message drives continuation
