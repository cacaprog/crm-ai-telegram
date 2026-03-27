# CRM Telegram Redesign — Direct Claude Integration

**Date:** 2026-03-27
**Status:** Approved

## Context

The original CRM ran as an OpenClaw skill suite. OpenClaw acted as middleware between Telegram and Claude — routing commands, managing skill lifecycle, and owning integrations (Gmail, Google Calendar). This redesign removes OpenClaw entirely and connects Telegram directly to Claude Code via the official Telegram channel plugin, with CRM operations exposed as MCP tools.

## Goals

- Remove OpenClaw dependency
- Claude receives Telegram messages natively via the channel plugin
- All CRM operations (pipeline, logging, drafting, sending) available as MCP tools
- Claude holds multi-step conversation state in its context window — no external state maps
- Run locally for now; deployable to Hetzner when ready to scale

## Out of Scope

- Scheduled tasks (morning digest, 15-min reminder checks) — deferred to a future iteration
- Google Calendar integration — not needed for MVP redesign
- Multi-user access
- Web dashboard

## Architecture

```
Your machine
├── claude --channels plugin:telegram@claude-plugins-official
│   ├── Telegram channel (MCP) — inbound/outbound messages
│   └── crm-mcp (MCP) — CRM tools
│
├── crm-mcp/          ← new: single Node.js MCP server
│   ├── tools/        ← one file per tool group
│   └── db/           ← crm-db moved here (unchanged schema)
│
└── PostgreSQL (local)

External
├── Telegram Bot API  → user interface
├── Gmail API         → send approved drafts
└── Claude API        → claude-sonnet-4-6
```

**What changes from the original design:**
- `crm-skills/` (6 OpenClaw packages) → deleted after migration
- `crm-mcp/` replaces all skill logic — one MCP server, ~10 tools
- `CLAUDE.md` defines CRM behaviour: how to interpret messages, when to call which tool, reply formatting
- Multi-step flows (e.g. guided `add_deal`) handled by Claude's context window, not a `pendingActions` Map

## MCP Tools

Claude calls these tools when handling Telegram messages. Claude performs all NLP; tools are pure DB/API operations.

| Tool | Inputs | What it does |
|---|---|---|
| `get_pipeline` | — | All active deals grouped by stage |
| `get_deal` | `deal_name` | Deal details + full activity history |
| `get_deal_context` | `deal_id` | Contact info + recent activities (used before drafting) |
| `create_deal` | `title, contact_name, company, email, stage?, value?, notes?` | Creates contact + deal |
| `log_activity` | `deal_id, type, summary, next_action?, next_action_date?` | Writes activity, updates deal's next action |
| `update_deal` | `deal_id, fields{}` | Updates any deal fields |
| `move_stage` | `deal_id` | Advances to next stage (enforces order, no skipping) |
| `close_deal` | `deal_id, outcome, reason?` | Marks won/lost |
| `snooze_deal` | `deal_id, days?` | Pushes `next_action_date` forward (default 3 days) |
| `send_email` | `to, subject, body, deal_id` | Sends via Gmail API, logs activity |

## Data Flow Examples

**Free-text activity log:**
> "Had a great call with Acme, they want a proposal by Friday"

Claude parses intent → calls `get_pipeline` to resolve the Acme deal → calls `log_activity` with parsed summary and `next_action_date`. No slash command required.

**Email draft and send:**
> "Draft a follow-up for João"

Claude calls `get_deal_context` → drafts email in reply → asks "Send, edit, or discard?" → on confirmation calls `send_email`.

**Pipeline view:**
> "/pipeline" or "show me the pipeline"

Claude calls `get_pipeline` → formats reply as compact stage groups.

## Repository Structure

```
crm-telegram/
├── crm-mcp/
│   ├── package.json
│   ├── index.js          ← MCP server entry, registers all tools
│   ├── tools/
│   │   ├── pipeline.js   ← get_pipeline, get_deal, get_deal_context
│   │   ├── deals.js      ← create_deal, update_deal, move_stage, close_deal, snooze_deal
│   │   ├── activity.js   ← log_activity
│   │   └── email.js      ← send_email (Gmail OAuth2)
│   └── db/
│       ├── index.js      ← connection + query helpers
│       ├── deals.js
│       ├── contacts.js
│       └── activities.js
├── CLAUDE.md             ← CRM persona + tool usage instructions
├── .mcp.json             ← registers crm-mcp with Claude Code
└── crm-skills/           ← deleted after migration
```

## CLAUDE.md Responsibilities

- Persona: personal CRM assistant, responds via Telegram
- Free-text messages: parse intent, identify the relevant deal, call the appropriate tool
- Draft flow: always call `get_deal_context` before drafting; present draft for approval before calling `send_email`
- Pipeline format: compact — stage → deal name, next action due date
- Guided flows (add_deal): ask one field at a time, collect all required inputs, then call `create_deal`

## Configuration

**`.mcp.json`:**
```json
{
  "mcpServers": {
    "crm": {
      "command": "node",
      "args": ["crm-mcp/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://localhost/crm"
      }
    }
  }
}
```

**Launch:**
```sh
claude --channels plugin:telegram@claude-plugins-official
```

## Gmail OAuth2

`crm-mcp` manages OAuth2 directly. On first `send_email` call, the server runs the OAuth2 flow in the terminal and stores credentials in `crm-mcp/.gmail-credentials.json`. Subsequent calls reuse the token silently. `.gmail-credentials.json` is gitignored.

## Local Postgres

`crm-mcp/db/migrate.js` creates the schema on first run. Same tables as the original design — no data model changes.

## Pipeline Stages

```
lead → discovery → validation → scoping → proposal → negotiation → closed_won | closed_lost
```

`move_stage` enforces this order. No skipping.

## Migration Path

1. Build and test `crm-mcp` locally
2. Verify all commands work via Telegram
3. Delete `crm-skills/`
4. When scaling: deploy to Hetzner, point `DATABASE_URL` at Hetzner Postgres, run as systemd service
