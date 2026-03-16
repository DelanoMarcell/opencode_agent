# High Priority

## SSR Chat Memory Pressure

1. Reduce SSR-selected chat history size on chat routes.
   Current issue: chat routes SSR up to `1000` stored messages plus session status, which can create heavy server payloads and large client hydration cost for long chats.
2. Keep SSR for only the most recent chat window plus status.
   Recommendation: send only the latest `50-100` messages server-side for:
   `/agent/chats/:trackedSessionId`
   `/agent/matters/:matterId/chats/:trackedSessionId`.
3. Load older chat history client-side on demand.
   Recommendation: fetch older messages only when needed, for example when the user scrolls upward or requests more history.
4. Preserve current SSR benefits while shrinking memory use.
   Recommendation: keep server-side status, latest messages, and session metadata so route loads still feel immediate.
5. Consider timeline virtualization only after reducing the SSR payload.
   Recommendation: virtualization is a secondary optimization for very long chats with heavy markdown/code blocks, not the first fix.

## Replace `session.list()`-Driven Sidebar Metadata With Mongo Metadata

1. Move sidebar display ownership to Mongo for routes that do not need full OpenCode session discovery.
   Goal: stop relying on OpenCode `session.list()` for LHS rendering when the app already knows which tracked sessions exist.
2. Extend tracked session storage to include local sidebar metadata.
   Add or derive enough data for display rows:
   `rawSessionId`
   `title`
   `createdAt`
   `updatedAt`
   Keep using Mongo as the source of truth for route ids and matter assignment.
3. Stop depending on OpenCode session titles.
   Recommendation: define an app-owned title policy.
   First choice: set title from the first user message snippet.
   Fallback: `Untitled`.
4. Update tracked-session creation flow.
   When a new tracked session is first registered, initialize local metadata in Mongo rather than waiting for `session.list()`.
5. Update chat metadata only on coarse lifecycle events.
   Do not write on every stream chunk.
   Update Mongo metadata when:
   - a session is created
   - the first prompt assigns the title
   - a user sends a prompt
   - optionally when a run completes if ordering needs tightening
6. Route-by-route data source after the change.
   `/agent/matters`: Mongo only for LHS and matter list.
   `/agent/matters/:matterId`: Mongo only for matter details and expanded matter chat rows.
   `/agent`: Mongo only for recent chats list.
   `/agent/chats/:trackedSessionId`: Mongo for sidebar rows, OpenCode only for the selected chat messages/status.
   `/agent/matters/:matterId/chats/:trackedSessionId`: Mongo for matter folder rows, OpenCode only for the selected chat messages/status.
7. Keep OpenCode responsible only for selected-chat runtime data.
   OpenCode remains the source of truth for:
   - selected chat messages
   - selected chat status
   - prompt sending
   - live event stream
   - provider/model catalog
8. Add migration/backfill for existing tracked sessions.
   Existing Mongo rows currently do not store title or updated time, so add a one-time backfill strategy before removing `session.list()` entirely.
9. Remove `availableSessions` / `session.list()` dependency from sidebar rendering after migration.
   Refactor `AgentClientRuntime` and bootstrap so sidebar rows are built directly from Mongo-backed tracked session metadata instead of filtered OpenCode session metadata.
10. Treat this as architecture cleanup, not the primary OOM diagnosis.
    Current conclusion: `session.list()` returns metadata only, so this is a worthwhile simplification and pressure reduction, but it is not yet proven to be the main cause of the recent dev-server memory crash.

# Auth — Remaining To-Do

## Matter + Session Routing

1. Add canonical agent routes for chat navigation:
   `/agent/chats/:trackedSessionId`,
   `/agent/matters/:matterId`,
   `/agent/matters/:matterId/chats/:trackedSessionId`.
2. Use `opencode_sessions._id` as the route `trackedSessionId`, not the raw OpenCode `sessionId`.
3. Resolve `trackedSessionId` to the raw OpenCode `sessionId` before resuming a session in the agent UI.
4. Add canonical redirect rules:
   unassigned tracked sessions resolve to `/agent/chats/:trackedSessionId`,
   assigned tracked sessions resolve to `/agent/matters/:matterId/chats/:trackedSessionId`.
5. Add route validation so `/agent/matters/:matterId/chats/:trackedSessionId` verifies:
   the user is in `matter_members` and the tracked session is linked in `matter_sessions`.
6. Update the `/agent` sidebar and session selection flow to push canonical URLs instead of relying only on local `selectedSessionID` state.
7. Add deep-link hydration so opening a canonical chat URL loads the correct tracked session, resolves the raw OpenCode session id, and resumes it automatically.

## Deferred Layout Refactor

1. Introduce `app/agent/layout.tsx` so the chat sidebar becomes a persistent shell across `/agent` routes.
2. Move sidebar/workspace state into a client provider rendered by the `/agent` layout instead of tying sidebar refresh to route changes.
3. Keep layout data uncached on the server and use client-side optimistic updates plus targeted `router.refresh()` only when the currently rendered server route becomes stale.
4. Define mutation flows for layout updates:
   creating a chat,
   deleting a chat,
   moving a chat to a matter,
   creating a matter.
5. Refactor the current `/agent` runtime so the RHS remains route-driven while the LHS sidebar is owned by the persistent layout.

## Forgot Password

1. Create API route `POST /api/auth/forgot-password` that generates a time-limited reset token, stores it against the user in MongoDB, and sends an email with the reset link.
2. Choose and configure an email provider (e.g. Resend, SendGrid, Nodemailer + SMTP).
3. Create a `/auth/reset-password` page that accepts the token from the email link, lets the user set a new password, and calls a backend route to verify the token and update the hash.
4. Create API route `POST /api/auth/reset-password` that validates the token, checks expiry, hashes the new password with bcrypt, and updates the user document.
5. Add a `resetToken` and `resetTokenExpiry` field to the User model in `lib/models/user.ts`.
6. Invalidate the reset token after successful use (single-use).

## Session & Security

7. Add CSRF protection review — confirm NextAuth's built-in CSRF token is covering all auth routes.
8. Add rate limiting to `/api/auth/register` and `/api/auth/[...nextauth]` to prevent brute-force attacks (e.g. `next-rate-limit` or custom middleware).
9. Add account lockout or progressive delay after repeated failed sign-in attempts.
10. Set secure cookie options in `authOptions` for production (`secure: true`, `sameSite: "lax"`).

## User Management

11. Add a profile/settings page where the user can update their name and password.
12. Add email verification flow — send a confirmation email on registration, restrict access until verified.
13. Add an `emailVerified` field to the User model.
14. Add a `/api/auth/verify-email` route that accepts a verification token.

## Route Protection

15. Audit all protected routes in `proxy.ts` matcher — add new routes as they are created (e.g. `/settings/:path*`, `/profile/:path*`).
16. Add role-based access control if needed in the future (admin vs regular user).

## Cleanup

17. Remove any leftover Microsoft/Azure AD references if still present in env or docs.
18. Add `.env.example` with required auth environment variables (`MONGODB_URI`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`).
