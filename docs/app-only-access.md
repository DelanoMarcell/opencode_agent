# App-Only (Client Credentials) Access — Setup & Permissions

This document covers the app-only access pattern: how it was set up, what each permission does, and important precautions.

---

## Table of Contents

1. [What Is App-Only Access](#what-is-app-only-access)
2. [App Registration Steps](#app-registration-steps)
3. [Application Permissions Reference](#application-permissions-reference)
4. [How to Get a Token](#how-to-get-a-token)
5. [Example API Calls](#example-api-calls)
6. [Precautions](#precautions)

---

## What Is App-Only Access

App-only access (also called "client credentials flow") allows your application to access Microsoft 365 data **without any user being signed in**. The app authenticates as itself using a client ID and secret, and receives a token that can access data across **every user in the organization**.

This is different from the delegated (per-user) flow:

| | Delegated | App-Only |
|---|---|---|
| A user must sign in | Yes | No |
| Sees one user's data | Yes | No — sees everyone's data |
| grant_type | `authorization_code` | `client_credentials` |
| Token endpoint | `login.microsoftonline.com/common/...` | `login.microsoftonline.com/{tenant-id}/...` |
| Refresh token | Yes | No (just request a new token) |
| Admin consent required | Sometimes | Always |

---

## App Registration Steps

These are the steps taken to create the app-only registration in Azure.

### 1. Create the App Registration

1. Go to [Microsoft Entra admin center](https://entra.microsoft.com)
2. Navigate to **App registrations** → **New registration**
3. Fill in:
   - **Name**: A descriptive name for the agent (e.g. "LNP Agent Service")
   - **Supported account types**: **Single tenant only - LNP Attorneys Inc**
     - Single tenant because the agent only needs access to our organization
     - Not multi-tenant — we don't want other orgs authenticating
   - **Redirect URI**: Leave blank — app-only access has no user sign-in, so there's no redirect
4. Click **Register**

### 2. Copy the IDs

On the app registration **Overview** page, copy:
- **Application (client) ID** — identifies the app
- **Directory (tenant) ID** — identifies the organization (needed in the token endpoint URL)

### 3. Create a Client Secret

1. Go to **Certificates & secrets** → **New client secret**
2. Add a description and pick an expiry (6 months, 12 months, 24 months, or custom)
3. Click **Add**
4. **Copy the Value immediately** — this is the only time it's visible. If you navigate away without copying, you'll have to create a new one.

### 4. Add Application Permissions

1. Go to **API permissions** → **Add a permission**
2. Select **Microsoft APIs** tab
3. Click **Microsoft Graph**
4. Choose **Application permissions** (not Delegated)
5. Search for and add each permission listed in the next section
6. Click **Add permissions**

### 5. Grant Admin Consent

Back on the **API permissions** page, click **Grant admin consent for LNP Attorneys Inc**.

This is mandatory for application permissions. Without it, token requests will fail. This only needs to be done **once** — it covers all users in the organization.

---

## Application Permissions Reference

### User.Read.All

- **What it does**: Read the full profile of every user in the organization
- **What the agent can access**: Display name, email, job title, department, office location, manager, phone numbers, profile photos
- **Example endpoint**: `GET /users` (all users) or `GET /users/{email}` (specific user)
- **Why it's needed**: The agent needs to know who's in the organization — look up employees, get their details, resolve names to email addresses

### Mail.Read

- **What it does**: Read emails in every user's mailbox across the organization
- **What the agent can access**: Subject, body, sender, recipients, attachments metadata, read/unread status
- **Example endpoint**: `GET /users/{email}/messages`
- **Why it's needed**: The agent can search through or summarize emails for any employee
- **Note**: This is read-only — the agent cannot modify or delete emails with this permission

### Mail.ReadWrite

- **What it does**: Read, create, update, and delete emails in every user's mailbox
- **What the agent can access**: Everything Mail.Read can, plus the ability to create drafts, move emails between folders, mark as read/unread, and delete emails
- **Example endpoint**: `PATCH /users/{email}/messages/{id}` or `POST /users/{email}/messages`
- **Why it's needed**: If the agent needs to draft emails, organize mailboxes, or manage messages on behalf of users
- **Caution**: This is more powerful than Mail.Read — the agent can modify and delete emails

### Mail.Send

- **What it does**: Send emails as any user in the organization
- **What the agent can access**: The ability to send an email that appears to come from any user's mailbox
- **Example endpoint**: `POST /users/{email}/sendMail`
- **Why it's needed**: The agent can send emails on behalf of employees (e.g. automated responses, notifications)
- **Caution**: This is a high-risk permission — the agent can impersonate any user via email. Audit usage carefully.

### Files.Read.All

- **What it does**: Read files in every user's OneDrive for Business
- **What the agent can access**: File names, contents, metadata, folder structure, sharing info, download URLs
- **Example endpoint**: `GET /users/{email}/drive/root/children`
- **Why it's needed**: The agent can search for and read documents stored in any employee's OneDrive
- **Note**: Read-only — the agent cannot create, modify, or delete files

### Sites.Read.All

- **What it does**: Read all SharePoint sites and their contents
- **What the agent can access**: Site metadata, document libraries, files stored in SharePoint, lists, Teams channel files (Teams stores files in SharePoint behind the scenes)
- **Example endpoint**: `GET /sites?search=*` or `GET /sites/{site-id}/drive/root/children`
- **Why it's needed**: The agent can access company-wide documents, shared libraries, and files in Teams channels
- **Note**: Read-only — the agent cannot create sites or modify content

### Calendars.Read

- **What it does**: Read calendar events for every user in the organization
- **What the agent can access**: Event titles, times, locations, attendees, descriptions, recurring patterns, availability
- **Example endpoint**: `GET /users/{email}/events` or `GET /users/{email}/calendar/calendarView`
- **Why it's needed**: The agent can check availability, find meeting conflicts, or summarize schedules

---

## How to Get a Token

App-only tokens are obtained via a direct server-to-server call. No browser, no user interaction.

```python
import requests

tenant_id = "your-tenant-id"
client_id = "your-client-id"
client_secret = "your-client-secret"

response = requests.post(
    f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
    data={
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": "https://graph.microsoft.com/.default",
        "grant_type": "client_credentials",
    },
)

token = response.json()["access_token"]
# Valid for ~1 hour. When it expires, just make this same request again.
```

Key differences from the delegated flow:
- `grant_type` is `client_credentials` (not `authorization_code`)
- `scope` is always `https://graph.microsoft.com/.default` (the `.default` scope tells Azure AD to issue all configured application permissions)
- The tenant ID must be used in the URL (not `common`)
- No refresh token is returned — just request a new token when the old one expires

---

## Example API Calls

Once you have the token, all calls use the same pattern:

```python
headers = {"Authorization": f"Bearer {token}"}
```

### List all users in the org

```python
users = requests.get(
    "https://graph.microsoft.com/v1.0/users",
    headers=headers,
).json()
```

### Read a specific user's emails

```python
emails = requests.get(
    "https://graph.microsoft.com/v1.0/users/delano@nexabeyond.com/messages?$top=10",
    headers=headers,
).json()
```

### Send an email as a user

```python
requests.post(
    "https://graph.microsoft.com/v1.0/users/delano@nexabeyond.com/sendMail",
    headers=headers,
    json={
        "message": {
            "subject": "Automated notification",
            "body": {"contentType": "Text", "content": "This was sent by the agent."},
            "toRecipients": [
                {"emailAddress": {"address": "someone@nexabeyond.com"}}
            ],
        }
    },
)
```

### Read a user's OneDrive files

```python
files = requests.get(
    "https://graph.microsoft.com/v1.0/users/delano@nexabeyond.com/drive/root/children",
    headers=headers,
).json()
```

### List SharePoint sites

```python
sites = requests.get(
    "https://graph.microsoft.com/v1.0/sites?search=*",
    headers=headers,
).json()
```

### Read a user's calendar events

```python
events = requests.get(
    "https://graph.microsoft.com/v1.0/users/delano@nexabeyond.com/events",
    headers=headers,
).json()
```

### Important: /me does NOT work with app-only tokens

App-only tokens have no "me" — there's no signed-in user. Always use `/users/{email}` instead of `/me`.

---

## Precautions

### 1. The client secret is a master key

The client secret + client ID can access every user's email, files, calendar, and profile in the entire organization. If it leaks, an attacker has full read access (and send access for email) across the whole company.

- **Never commit it to git** (`.env.local` is in `.gitignore`)
- **Never expose it in client-side code** — it should only exist on the server
- **Never log it** — not in console.log, not in error messages, not in monitoring tools
- **Rotate it regularly** — create a new secret and update the old one before it expires

### 2. Use the least permissions necessary

Only add the permissions your agent actually needs. You can always add more later. If the agent only reads emails, don't add `Mail.Send`. If it doesn't need files, don't add `Files.Read.All`.

### 3. Admin consent is org-wide and permanent

When you click "Grant admin consent", every permission is immediately active for the entire organization. There's no per-user consent — it's all or nothing. To revoke, go back to API permissions and remove the specific permissions.

### 4. Audit what the agent does

Microsoft 365 has audit logs that track API access. Since app-only actions appear as "the application" (not a specific user), keep your own logs of what the agent accesses and why. This is important for compliance, especially with email and file access.

### 5. Token handling

- App-only tokens expire after ~1 hour. Just request a new one — there's no refresh token.
- Don't cache tokens longer than necessary.
- Never send the token to a browser or client-side code.

### 6. Separate app registrations

The app-only registration is separate from the NextAuth (delegated) registration. This is intentional:

- **NextAuth app**: Delegated permissions, user-facing, has redirect URIs
- **Agent app**: Application permissions, server-only, no redirect URIs

Keeping them separate means compromising one doesn't compromise the other. The NextAuth app can only access data for the user who signed in. The agent app can access everything, but its credentials only exist on the server.

### 7. Consider restricting mailbox access

By default, `Mail.Read` and `Mail.Send` with application permissions can access **every** mailbox. Microsoft supports [application access policies](https://learn.microsoft.com/en-us/graph/auth-limit-mailbox-access) to restrict the app to specific mailboxes or security groups. Consider setting this up if the agent doesn't need access to all mailboxes.
