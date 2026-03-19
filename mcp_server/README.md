# LNP Graph MCP Server

Read-only Microsoft Graph API MCP server for LNP Attorneys.
Uses the **stdio** transport — compatible with Claude Code, OpenCode, Codex, and any MCP-capable agent.

---

## Setup

### 1. Install & build

```bash
cd mcp_server
npm install
npm run build
```

### 2. Configure credentials

Copy `.env.example` to `.env` and fill in your Azure AD app values:

```bash
cp .env.example .env
```

```env
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret-value
```

> **Never commit `.env` to source control.** It is in `.gitignore`.

All three values come from **Azure Portal → App registrations → your app**:
- `AZURE_TENANT_ID` — Overview → Directory (tenant) ID
- `AZURE_CLIENT_ID` — Overview → Application (client) ID
- `AZURE_CLIENT_SECRET` — Certificates & secrets → Client secret **Value** (not the ID)

---

## Connecting to agents

The server speaks MCP over **stdin/stdout**. Each agent reads the binary path and passes env vars.

### Claude Code (`~/.claude/settings.json`)

```json
{
  "mcpServers": {
    "lnp-graph": {
      "command": "node",
      "args": ["/absolute/path/to/mcp_server/dist/index.js"],
      "env": {
        "AZURE_TENANT_ID": "your-tenant-id",
        "AZURE_CLIENT_ID": "your-client-id",
        "AZURE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

> Or omit `env` and rely on the `.env` file if the server is started from its own directory.

### OpenCode (`opencode.json` or `~/.config/opencode/config.json`)

```json
{
  "mcp": {
    "lnp-graph": {
      "command": "node",
      "args": ["/absolute/path/to/mcp_server/dist/index.js"],
      "env": {
        "AZURE_TENANT_ID": "your-tenant-id",
        "AZURE_CLIENT_ID": "your-client-id",
        "AZURE_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

### Codex / OpenAI Agents

Pass the server as a local MCP server in your agent config pointing to the same `node dist/index.js` command.

---

## Available tools

| Tool | Description |
|------|-------------|
| `graph_list_users` | List organisation users with optional search & field selection |
| `graph_get_user` | Get a user by ID or UPN (email) |
| `graph_list_calendar_events` | List a user's calendar events; supports time-range (calendarView) |
| `graph_get_calendar_event` | Get a specific calendar event by ID |
| `graph_list_messages` | List a user's emails; filter by folder, date, OData, or full-text search |
| `graph_get_message` | Get a full email message including body |
| `graph_list_mail_folders` | List all mail folders for a user |
| `graph_list_sites` | List SharePoint sites; search by keyword |
| `graph_get_site` | Get a specific SharePoint site by ID |
| `graph_list_drives` | List document libraries (drives) in a SharePoint site |
| `graph_list_drive_items` | Browse files/folders in a drive or SharePoint site |
| `graph_get_drive_item` | Get metadata for a specific file or folder |
| `graph_search_drive_items` | Search files by name/content within a drive or site |

---

## Security notes

- Authentication uses the **OAuth2 Client Credentials** flow — no user context, no delegated tokens.
- Access tokens are cached in memory and refreshed automatically 5 minutes before expiry.
- All credentials are read from environment variables; never hardcoded.
- All Graph calls are **read-only** — the app has no write permissions except `Mail.ReadWrite` and `Mail.Send` which are **not exposed** as tools.
- No credentials are ever written to stdout (the MCP protocol channel).
