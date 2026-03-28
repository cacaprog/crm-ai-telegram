# CRM AI Telegram

Personal CRM assistant for B2B consulting. Claude receives Telegram messages, manages deals and contacts, logs activities, drafts emails, and pulls a daily briefing from Google Calendar — all via natural language.

## Architecture

```
Telegram ──► Claude Code (--channels plugin:telegram)
                 │
                 ├── crm-mcp/      MCP server (Node.js)
                 │    ├── tools/   14 CRM tools
                 │    └── db/      PostgreSQL via pg
                 │
                 └── CLAUDE.md     Persona + tool instructions
```

## Requirements

- Node.js 18+
- Bun (Telegram plugin runtime) — `curl -fsSL https://bun.sh/install | bash`
- PostgreSQL running locally
- Google Cloud OAuth2 credentials (Gmail API + Calendar API enabled)
- Claude Code with Telegram plugin installed

## Setup

### 1. PostgreSQL

```sh
createdb crm
cd crm-mcp && npm install && npm run migrate
```

### 2. Environment — `.mcp.json`

```json
{
  "mcpServers": {
    "crm": {
      "command": "node",
      "args": ["crm-mcp/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://localhost/crm",
        "GMAIL_CLIENT_ID": "your-client-id",
        "GMAIL_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

Get credentials from [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → OAuth 2.0 Client ID. Enable **Gmail API** and **Google Calendar API**.

### 3. Telegram bot

1. Chat with [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token
2. In Claude Code: `/plugin install telegram@claude-plugins-official`
3. `/telegram:configure <token>`

### 4. Launch

```sh
claude --channels plugin:telegram@claude-plugins-official
```

### 5. Pair

DM your bot on Telegram. It replies with a 6-character code. In Claude Code:

```
/telegram:access pair <code>
```

Then lock it down:

```
/telegram:access policy allowlist
```

### 6. Google OAuth (first use)

On the first `send_email` or `get_today_briefing` call, Claude will print an auth URL in the terminal. Open it, authorize, paste the code back. Token saved to `crm-mcp/.google-credentials.json`.

## MCP Tools

| Tool | Description |
|---|---|
| `get_pipeline` | All active deals grouped by stage |
| `get_deal` | Deal details + full activity history |
| `get_deal_context` | Contact + recent activities (used before drafting emails) |
| `create_deal` | Create contact + deal |
| `update_deal` | Update next action, date, value, notes |
| `update_contact` | Update contact fields (email, phone, name, company, role, linkedin) |
| `move_stage` | Advance deal to next stage (enforces order) |
| `close_deal` | Mark as won or lost |
| `snooze_deal` | Push next action date forward (default 3 days) |
| `log_activity` | Log call, meeting, email, note |
| `send_email` | Send via Gmail + log activity |
| `get_today_briefing` | Today's Calendar events matched to CRM deals |
| `get_weekly_report` | Stale deals by stage threshold + week snapshot (won/lost/new/activities). Auto-persists snapshot. |
| `get_report_history` | Last N weekly snapshots for trend comparison (default 4 weeks) |

## Pipeline Stages

```
lead → discovery → validation → scoping → proposal → negotiation → closed_won | closed_lost
```

`move_stage` enforces this order. Use `close_deal` to mark won/lost.

## Project Structure

```
crm-telegram/
├── crm-mcp/
│   ├── index.js          MCP server entry (registers all 14 tools)
│   ├── package.json
│   ├── tools/
│   │   ├── pipeline.js   get_pipeline, get_deal, get_deal_context
│   │   ├── deals.js      create_deal, update_deal, update_contact, move_stage, close_deal, snooze_deal
│   │   ├── activity.js   log_activity
│   │   ├── email.js      send_email
│   │   ├── calendar.js   get_today_briefing
│   │   ├── report.js     get_weekly_report, get_report_history
│   │   └── google-auth.js  shared OAuth2 (Gmail + Calendar)
│   ├── db/
│   │   ├── index.js      connection + query helpers
│   │   ├── reports.js    upsertWeeklyReport, getReportHistory
│   │   ├── migrate.js    run schema migration
│   │   └── schema.sql    tables: contacts, deals, activities, reminders, weekly_reports
│   ├── lib/
│   │   └── stages.js     pipeline stages constant
│   └── tests/            Jest test suite (40 tests)
├── CLAUDE.md             CRM persona + tool usage instructions
├── .mcp.json             registers crm-mcp with Claude Code
└── docs/
    └── superpowers/      design specs + implementation plans
```

## Running Tests

```sh
cd crm-mcp
npm test
```

Requires a live PostgreSQL `crm` database for `db.test.js`.

## Scaling to Hetzner (future)

1. Deploy Postgres on Hetzner
2. Update `DATABASE_URL` in `.mcp.json`
3. Run `npm run migrate` remotely
4. Run `claude --channels plugin:telegram@claude-plugins-official` as a systemd service
5. Add cron at 07:45 to trigger the morning briefing via Telegram API (see [Automating the morning briefing](docs/superpowers/specs/2026-03-27-crm-telegram-redesign-design.md))
