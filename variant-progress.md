# Progress

- [done] Confirm the current problem in the app:
  - the app was not loading available model variants from OpenCode provider metadata
  - the app was not sending `variant` on `session.promptAsync(...)`
  - the app was not showing the current variant anywhere in the UI
  - selecting a reasoning variant in the OpenCode CLI did not reliably affect prompts sent from this app
- [done] Confirm the OpenCode behavior and source of truth:
  - `provider.list()` exposes `model.variants`
  - `session.promptAsync(...)` accepts both `model` and `variant`
  - OpenCode stores the used `variant` on user messages
  - the latest stored user message can therefore be used to recover the last used model and variant for a chat
- [done] Add a shared model-catalog builder for the app:
  - one helper now normalizes context limits, costs, and available variants from OpenCode provider metadata
  - the same logic is used by bootstrap and client-side refresh so the app does not drift between server and client model metadata
- [done] Extend the app bootstrap model catalog to include available variants per model key
- [done] Load variant availability into client runtime state:
  - the runtime now keeps `availableModelVariantsByKey`
  - provider metadata refresh now updates variants as well as context limits and costs
- [done] Restore the last used model and variant from stored session history:
  - the runtime now reads the latest stored user message
  - it falls back to the latest assistant model when there is no usable stored user model selection yet
  - the selected variant is restored only when a real stored variant exists
- [done] Make model and variant first-class send-time state in the app:
  - the runtime now computes the current effective model key for the session
  - the runtime now computes the current selected variant for that model
  - prompts now send both `model` and `variant` explicitly when available
- [done] Surface current variant state in the composer UI:
  - the composer now shows the current model and current variant
  - the composer now exposes a variant dropdown for the current model when variants are available
  - the dropdown includes a `Default` option plus the available model-specific variants returned by OpenCode
- [done] Make variant changes sticky within the current chat:
  - selecting a variant updates runtime state immediately
  - subsequent sends in that chat continue with the chosen variant until changed again
  - resetting or changing chat context clears or rehydrates that state from the new session

- [next] Verify end-to-end behavior across the main chat flows:
  - existing session with prior stored model/variant
  - existing session with prior model but no explicit variant
  - new session with no prior stored messages
  - route reload / hard refresh
  - resumed busy session
- [next] Decide whether the session header should also show the active variant:
  - the composer now exposes it, which is enough for functionality
  - but the header may still be the better long-term place for always-visible session model state
- [next] Decide whether the timeline should show the actual model variant used per sent turn:
  - current scope restores and reuses the last used variant for the chat
  - later we may want per-message visibility for auditability
- [next] Decide whether brand-new chats should allow choosing a variant before the first message:
  - current implementation can only expose variants once a concrete model is known to the app
  - if we want pre-send variant selection for brand-new chats, we will need explicit app-side model selection too

## Notes

- The intended source of truth for continuing a chat is the latest stored user message in that session:
  - it captures the model and variant the app actually sent
  - it is more reliable than assuming the OpenCode CLI or another client last touched the same session in the same way
- The app now explicitly sends `model` and `variant` on prompt when it has them, so chat behavior no longer depends on implicit CLI-side variant state.
