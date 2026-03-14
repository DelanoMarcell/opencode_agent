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
