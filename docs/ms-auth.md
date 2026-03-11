# Microsoft Authentication — How It All Works

This document explains how Microsoft authentication is set up in this project, how tokens work, where they're stored, and how they're used to call the Microsoft Graph API.

---

## Table of Contents

1. [The Big Picture](#the-big-picture)
2. [Files Overview](#files-overview)
3. [The Sign-In Flow (Step by Step)](#the-sign-in-flow-step-by-step)
4. [What Tokens Are and Where They Come From](#what-tokens-are-and-where-they-come-from)
5. [Where Tokens Are Stored (The Cookie)](#where-tokens-are-stored-the-cookie)
6. [Why the Cookie Is Safe](#why-the-cookie-is-safe)
7. [The JWT Callback — Saving the Access Token](#the-jwt-callback--saving-the-access-token)
8. [Using the Access Token to Call the Graph API](#using-the-access-token-to-call-the-graph-api)
9. [Access Token Expiry and Refresh Tokens](#access-token-expiry-and-refresh-tokens)
10. [Session vs Access Token — Two Different Things](#session-vs-access-token--two-different-things)
11. [Protecting Pages](#protecting-pages)
12. [Signing Out](#signing-out)
13. [Environment Variables](#environment-variables)
14. [Azure Portal Setup](#azure-portal-setup)

---

## The Big Picture

When a user clicks "Sign in with Microsoft", the following happens at a high level:

```
User clicks button
  → Browser goes to Microsoft's login page
    → User enters their Microsoft credentials
      → Microsoft sends back tokens (access token, refresh token, etc.)
        → NextAuth encrypts them into a cookie
          → User is now "logged in"
            → Access token is used server-side to call Microsoft Graph API
```

The user never sees or touches any tokens. Everything is handled server-side by NextAuth.

---

## Files Overview

| File | Purpose |
|------|---------|
| `lib/auth.ts` | Shared NextAuth configuration (providers, callbacks, options) |
| `app/api/auth/[...nextauth]/route.ts` | The NextAuth API endpoint — handles sign-in, sign-out, callbacks |
| `app/auth/page.tsx` | The sign-in page (server component) |
| `app/auth/sign-in-card.tsx` | The sign-in UI (client component with the button) |
| `.env.local` | Environment variables (client ID, client secret, NextAuth secret) |

---

## The Sign-In Flow (Step by Step)

### Step 1: User Clicks "Sign in with Microsoft"

The button in `sign-in-card.tsx` calls:

```typescript
signIn("microsoft")
```

This does NOT talk to Microsoft directly. It sends a request to your own NextAuth backend at `/api/auth/signin/microsoft`.

### Step 2: NextAuth Redirects to Microsoft

NextAuth constructs a URL to Microsoft's OAuth authorization endpoint and redirects the browser there. The URL includes:

- Your **Client ID** (so Microsoft knows which app is asking)
- The **scopes** you requested (what permissions you want)
- A **redirect URI** (where Microsoft should send the user back)

### Step 3: User Logs In on Microsoft's Site

The user sees Microsoft's login page. They enter their email and password. This happens entirely on Microsoft's domain — your app never sees their Microsoft password.

### Step 4: Microsoft Redirects Back with an Authorization Code

After successful login, Microsoft redirects the browser back to:

```
http://localhost:3000/api/auth/callback/microsoft?code=AUTHORIZATION_CODE
```

This authorization code is a short-lived, one-time-use code.

### Step 5: NextAuth Exchanges the Code for Tokens (Server-Side)

This is the critical step. NextAuth, **on the server**, sends a request to Microsoft's token endpoint:

```
POST https://login.microsoftonline.com/common/oauth2/v2.0/token

  client_id=YOUR_CLIENT_ID
  client_secret=YOUR_CLIENT_SECRET
  code=AUTHORIZATION_CODE
  grant_type=authorization_code
  redirect_uri=http://localhost:3000/api/auth/callback/microsoft
```

Microsoft verifies the code, the client ID, and the client secret, then responds with:

```json
{
  "access_token": "EwB4A8l6B...",
  "refresh_token": "M.C544_SN1...",
  "id_token": "eyJ0eXAiOi...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

This exchange happens server-to-server. The browser is not involved.

### Step 6: NextAuth Creates the Session Cookie

NextAuth takes the token data, runs it through the `jwt` callback (where you can save the access token), encrypts everything, and sets it as an HTTP-only cookie called `next-auth.session-token`.

### Step 7: User Is Redirected to /dashboard

The `redirect` callback in `lib/auth.ts` sends the user to `/dashboard`.

---

## What Tokens Are and Where They Come From

After sign-in, Microsoft gives you three tokens:

| Token | What It Is | Lifespan | Purpose |
|-------|-----------|----------|---------|
| **Access Token** | A key that lets you call Microsoft APIs as the user | ~1 hour | Call Graph API (read emails, files, etc.) |
| **Refresh Token** | A key that lets you get a new access token when the old one expires | ~90 days | Silently renew access without re-login |
| **ID Token** | Contains user profile info (name, email) | Short-lived | Identify who signed in |

You don't create these. You don't get them from the Azure Portal. Microsoft generates and returns them automatically during the OAuth flow (Step 5 above).

### Where they come from in the code

These tokens arrive in the `account` parameter of the `jwt` callback:

```typescript
async jwt({ token, account }) {
  // account is only populated on the initial sign-in
  if (account) {
    // account.access_token  ← the access token from Microsoft
    // account.refresh_token ← the refresh token from Microsoft
    // account.expires_at    ← when the access token expires (unix timestamp)
  }
}
```

The `account` object is **only available once** — during the initial sign-in. After that, it's `undefined` because no new OAuth flow is happening. The user is just browsing your app with a cookie.

---

## Where Tokens Are Stored (The Cookie)

NextAuth v4 uses the **JWT strategy** by default. This means:

- There is **no database** storing sessions
- There is **no server-side session store**
- Everything is stored in a single **encrypted cookie** called `next-auth.session-token`

The cookie contains the JWT, which holds:

- Basic user info (name, email)
- Whatever you add in the `jwt` callback (access token, refresh token, expiry)

On every request:

```
Browser sends request
  → Cookie is automatically included
    → NextAuth decrypts it on the server using NEXTAUTH_SECRET
      → Returns the session/token data
```

---

## Why the Cookie Is Safe

You might think: "The tokens are in a cookie in the browser — can't someone just read them?"

No. NextAuth's cookie is **not** a regular JWT. Here's why:

### Regular JWT (like jwt.io)

- Base64-encoded (anyone can decode and read the payload)
- **Signed** (tamper-proof, but not secret)
- You can paste it into jwt.io and see everything

### NextAuth's Session Cookie

- **Encrypted** using JWE (JSON Web Encryption) with AES-256
- Uses `NEXTAUTH_SECRET` as the encryption key
- **Cannot be decoded** without the secret
- Pasting it into jwt.io gives you meaningless gibberish
- Also marked as `httpOnly` (JavaScript in the browser cannot access it)
- Also marked as `secure` in production (only sent over HTTPS)

| Property | Regular JWT | NextAuth Cookie |
|----------|------------|-----------------|
| Readable by browser JS | Yes | No (`httpOnly`) |
| Decodable by anyone | Yes (base64) | No (encrypted) |
| Decodable by jwt.io | Yes | No |
| Readable by your server | Yes | Yes (has the secret) |

So even though the cookie physically sits in the browser, it's an opaque encrypted blob. Only your server (which has `NEXTAUTH_SECRET`) can read it.

---

## The JWT Callback — Saving the Access Token

By default, NextAuth does NOT save the Microsoft access token. The `jwt` callback is where you intercept the sign-in and persist the tokens.

```typescript
callbacks: {
  async jwt({ token, account }) {
    if (account) {
      token.accessToken = account.access_token;
      token.refreshToken = account.refresh_token;
      token.expiresAt = account.expires_at;
    }
    return token;
  },
}
```

### How this callback runs

**On initial sign-in:**

```
account = {
  access_token: "EwB4A8l6B...",     ← fresh from Microsoft
  refresh_token: "M.C544_SN1...",   ← fresh from Microsoft
  expires_at: 1741824000,           ← unix timestamp (~1 hour from now)
  provider: "microsoft",
  type: "oauth",
}

token = {
  name: "Delano Martin",
  email: "delano@example.com",
  sub: "abc123",
}
```

The callback copies the tokens from `account` into `token`. Now when `token` gets encrypted into the cookie, the Microsoft tokens are included.

**On every subsequent request:**

```
account = undefined   ← no OAuth happened, just a normal page visit

token = {
  name: "Delano Martin",
  email: "delano@example.com",
  sub: "abc123",
  accessToken: "EwB4A8l6B...",      ← still here from the sign-in
  refreshToken: "M.C544_SN1...",    ← still here from the sign-in
  expiresAt: 1741824000,            ← still here from the sign-in
}
```

The `if (account)` check is false, so the token passes through unchanged. The data persists in the cookie between requests.

### Without this callback

The Microsoft tokens arrive at sign-in, NextAuth doesn't save them, and they're gone forever. You have a session that says "Delano is logged in" but no way to call the Graph API on their behalf.

---

## Using the Access Token to Call the Graph API

The Microsoft Graph API is the REST API for all Microsoft 365 data. It lives at `https://graph.microsoft.com/v1.0/`.

### Common endpoints

| Endpoint | What it returns | Required scope |
|----------|----------------|----------------|
| `GET /me` | User profile (name, email, job title) | `User.Read` |
| `GET /me/messages` | Emails in the inbox | `Mail.Read` |
| `GET /me/drive/root/children` | OneDrive files | `Files.Read` |
| `GET /sites` | SharePoint sites | `Sites.Read.All` |

### How to call it (server-side only)

The access token should **never be exposed to the client**. Instead, create Next.js API routes that act as a proxy:

```
Browser → Your API route (/api/mail) → Microsoft Graph API
                ↑
         token lives here only
```

Example API route:

```typescript
// app/api/mail/route.ts
import { getToken } from "next-auth/jwt";

export async function GET(req: Request) {
  const token = await getToken({ req });

  if (!token?.accessToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const res = await fetch("https://graph.microsoft.com/v1.0/me/messages", {
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
    },
  });

  return Response.json(await res.json());
}
```

`getToken({ req })` decrypts the cookie and returns the full JWT contents, including the `accessToken` you saved in the `jwt` callback.

Your client component just calls `/api/mail` — it never sees the Microsoft token.

### Why not expose the token client-side?

If the access token leaks to the browser (via XSS, browser extensions, devtools, etc.), anyone can call the Microsoft Graph API as that user until the token expires. Keeping it server-side means the token never leaves your server.

---

## Access Token Expiry and Refresh Tokens

### The problem

Microsoft access tokens expire after approximately **1 hour**. But the NextAuth session (the cookie) lasts **30 days** by default.

This means after 1 hour:

| Thing | Status |
|-------|--------|
| NextAuth session | Still valid (user appears "logged in") |
| Access token | **Expired** (Graph API calls return 401) |

The user looks logged in, your app works normally, but every Microsoft API call fails.

### The solution: refresh tokens

When the access token expires, you use the refresh token to get a new one. This happens silently on the server — the user doesn't notice.

Add this logic to the `jwt` callback:

```typescript
async jwt({ token, account }) {
  // On initial sign-in — save the tokens
  if (account) {
    token.accessToken = account.access_token;
    token.refreshToken = account.refresh_token;
    token.expiresAt = account.expires_at;
    return token;
  }

  // Token hasn't expired yet — use as-is
  if (Date.now() < (token.expiresAt as number) * 1000) {
    return token;
  }

  // Token expired — use refresh token to get a new access token
  const res = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken as string,
      }),
    }
  );

  const tokens = await res.json();

  token.accessToken = tokens.access_token;
  token.refreshToken = tokens.refresh_token ?? token.refreshToken;
  token.expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;

  return token;
},
```

Now on every request, the callback checks:

1. Is this the initial sign-in? → Save tokens.
2. Is the access token still valid? → Pass through.
3. Has it expired? → Call Microsoft's token endpoint with the refresh token, get a new access token, update the cookie.

The user only needs to re-sign-in if:

- They explicitly sign out
- The refresh token expires (~90 days for Microsoft)
- They revoke app access from their Microsoft account

---

## Session vs Access Token — Two Different Things

This is a common point of confusion. The NextAuth **session** and the Microsoft **access token** are independent:

| | NextAuth Session | Microsoft Access Token |
|---|---|---|
| What it answers | "Is this user logged in to our app?" | "Can we call Microsoft APIs as this user?" |
| Controlled by | NextAuth (`session.maxAge`, default 30 days) | Microsoft (~1 hour) |
| Stored in | Encrypted cookie | Inside the same encrypted cookie (if you save it) |
| Can expire independently | Yes | Yes |

After 1 hour, the access token expires but the session is still valid. The user is "logged in" but Microsoft features are broken (unless you implement refresh token logic).

After 30 days (or whatever `session.maxAge` is), the session itself expires. The cookie is gone. The user needs to sign in again, which triggers a fresh OAuth flow and gives you brand new tokens.

---

## Protecting Pages

### Server component (recommended)

Check the session at the top of the page. If not authenticated, redirect. No HTML is ever sent to the browser for unauthenticated users.

```typescript
// app/some-page/page.tsx (server component — no "use client")
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

export default async function SomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/auth");

  return <div>Protected content here</div>;
}
```

The `redirect()` from `next/navigation` sends an HTTP 307 redirect. The browser never receives any page content — it just gets told "go to `/auth`".

### Middleware (alternative)

A single `middleware.ts` file at the project root that intercepts requests before any page code runs:

```typescript
export { default } from "next-auth/middleware";

export const config = {
  matcher: ["/dashboard/:path*", "/some-page/:path*"],
};
```

This protects all matching routes. Unauthenticated users are redirected to the sign-in page automatically.

### API routes (security boundary)

Always check authentication in API routes, even if you have middleware or page-level checks:

```typescript
export async function GET(req: Request) {
  const token = await getToken({ req });
  if (!token) return new Response("Unauthorized", { status: 401 });

  // ... handle request
}
```

The recommended approach is to use **both**: middleware/page checks for UX (redirect unauthenticated users) and API route checks for security (never trust that the middleware ran).

---

## Signing Out

When a user signs out (via `signOut()` from `next-auth/react`):

1. NextAuth **deletes the session cookie** from the browser
2. All tokens stored inside the cookie are gone (access token, refresh token, everything)
3. There is no server-side session to clean up (JWT strategy is stateless)
4. The user is now unauthenticated

When they sign in again, the entire OAuth flow repeats and Microsoft issues **fresh tokens**. The old tokens are irrelevant — they've either expired or been superseded.

---

## Environment Variables

Stored in `.env.local` (git-ignored, never committed):

| Variable | What it is | Where you get it |
|----------|-----------|-----------------|
| `MICROSOFT_CLIENT_ID` | Your app's ID in Azure | Azure Portal → App registrations → Overview |
| `MICROSOFT_CLIENT_SECRET` | Your app's secret key | Azure Portal → App registrations → Certificates & secrets |
| `NEXTAUTH_SECRET` | Encryption key for the session cookie | Generate with `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Your app's base URL | `http://localhost:3000` for local dev |

`NEXTAUTH_SECRET` is critical. If someone gets this key, they can decrypt any session cookie and forge sessions. Keep it secret, rotate it if compromised.

---

## Azure Portal Setup

### 1. Register an App

Go to [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**

- **Name**: Whatever you want (e.g., "LNP Agent")
- **Supported account types**: Choose based on who should be able to sign in
- **Redirect URI**: Set platform to **Web** and URL to `http://localhost:3000/api/auth/callback/microsoft`
- Click **Register**

### 2. Copy the Client ID

On the **Overview** page after registration, find **Application (client) ID**. Copy it into `MICROSOFT_CLIENT_ID` in `.env.local`.

### 3. Create a Client Secret

Go to **Certificates & secrets** → **New client secret**

- Add a description, pick an expiry
- Click **Add**
- **Copy the Value immediately** — this is the only time you'll see it
- Paste it into `MICROSOFT_CLIENT_SECRET` in `.env.local`

### 4. Configure API Permissions (if needed)

Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**

Add the scopes your app requests:

- `openid`
- `profile`
- `email`
- `offline_access`
- `User.Read`
- `Mail.Read`
- `Files.Read`
- `Sites.Read.All`

Some of these (like `Mail.Read`, `Sites.Read.All`) may require **admin consent** depending on your organization's policies.

---

## Quick Reference

### Check if user is logged in (server-side)

```typescript
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const session = await getServerSession(authOptions);
// session is null if not logged in
// session.user.name, session.user.email if logged in
```

### Get the access token (server-side, in API routes)

```typescript
import { getToken } from "next-auth/jwt";

const token = await getToken({ req });
// token.accessToken — use this to call Graph API
```

### Call Microsoft Graph API

```typescript
const res = await fetch("https://graph.microsoft.com/v1.0/me", {
  headers: { Authorization: `Bearer ${token.accessToken}` },
});
const profile = await res.json();
```

### Sign in (client-side)

```typescript
import { signIn } from "next-auth/react";
signIn("microsoft");
```

### Sign out (client-side)

```typescript
import { signOut } from "next-auth/react";
signOut();
```
