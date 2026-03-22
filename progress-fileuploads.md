# Progress

- [done] Define the first file-library slice as storage and management only, with no model prompting yet
- [done] Decide that file metadata lives in Mongo and is managed independently of any assistant-prompting behavior
- [done] Add the `SessionFile` Mongoose model, the `MatterFile` Mongoose model, and shared server-side storage helpers
- [done] Add API route handlers for session files:
  - `GET /api/opencode-sessions/[sessionId]/files`
  - `POST /api/opencode-sessions/[sessionId]/files`
  - `DELETE /api/opencode-sessions/[sessionId]/files/[fileId]`
- [done] Add API route handlers for matter files:
  - `GET /api/matters/[id]/files`
  - `POST /api/matters/[id]/files`
  - `DELETE /api/matters/[id]/files/[fileId]`
- [done] Add session-file and matter-file summary data to the agent bootstrap payload
- [done] Add a shared files dialog that works for the active session or the active matter
- [done] Add an `Attach` dropdown action for `Upload from your device`
- [done] Wire general chats to upload into the active session library
- [done] Wire matter chats and matter-overview uploads into the active matter library
- [done] Verify the end-to-end storage/list/delete flow and update this file with final status

## Notes

- This slice is intentionally limited to file storage, listing, and delete
- The filesystem contract is:
  - `.agent/<organisationName>/session-files/<rawSessionId>/`
  - `.agent/<organisationName>/matter-files/<matterCode>/`
- General chats use the session library
- Matter chats and matter-overview uploads use the matter library so the files are shared across chats in that matter
- Prompt injection, hidden runtime context, file search, extraction, and assistant-facing attach behavior are explicitly out of scope for this pass
- Verification completed with `git diff --check`; bounded `tsc --noEmit` and targeted `eslint` runs timed out in this repo without returning diagnostics
