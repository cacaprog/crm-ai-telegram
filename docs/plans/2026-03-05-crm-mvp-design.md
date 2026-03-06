# CRM MVP Design

**Date:** 2026-03-05
**Status:** Approved

## Context

A personal CRM for a B2B consulting business with longer sales cycles. Currently managing <10 active deals. Biggest pain point: forgetting to follow up. Primary interface: Telegram.

## Goals

- Never let a deal go silent due to forgotten follow-ups
- Clear view of the pipeline at any moment
- Draft follow-up emails with one request, send with one tap
- Log calls/meetings in natural language
- Proactive reminders without manual scheduling

## Architecture

**OpenClaw-first on Hetzner CAX11 (~€4/mo).**

OpenClaw runs as a local AI agent (systemd service) on a Hetzner VPS. It connects to Telegram natively, orchestrates custom CRM skills, and persists all data in PostgreSQL. Claude powers natural language parsing and email drafting. Gmail and Google Calendar are managed through OpenClaw's existing integrations.

```
Hetzner CAX11 (Ubuntu 24.04)
├── OpenClaw (Node.js, systemd, auto-restart)
│   ├── crm-core skill
│   ├── crm-pipeline skill
│   ├── crm-remind skill (scheduler, every 15min)
│   ├── crm-draft skill
│   ├── crm-log skill
│   └── crm-calendar skill
├── PostgreSQL 16 (localhost only)
└── Daily backup cron → Cloudflare R2 (free tier)

External
├── Telegram Bot API  → primary user interface
├── Gmail API         → send approved drafts, read thread context
├── Google Calendar   → create/read events
└── Claude API        → claude-sonnet-4-6 (NLP + drafting)
```

## Data Model

```sql
contacts (
  id, name, company, role,
  email, phone, linkedin_url,
  source  -- referral | cold | inbound
)

deals (
  id, contact_id, title,
  stage,           -- see pipeline stages below
  value,           -- estimated contract value
  next_action,     -- text: what to do next
  next_action_date,-- drives reminders
  notes            -- freeform context
)

activities (
  id, deal_id,
  type,      -- call | email | meeting | note | proposal_sent
  summary,   -- what happened
  created_at
)

reminders (
  id, deal_id,
  message,   -- what to remind about
  due_at,
  status     -- pending | snoozed | done
)
```

## Pipeline Stages

```
lead → discovery → validation → scoping → proposal → negotiation → closed_won | closed_lost
```

Stage transitions are enforced by `crm-pipeline` (no skipping stages).

## Telegram Interface

### Commands
```
/add_deal     — add a new deal (guided flow)
/pipeline     — all active deals grouped by stage
/deal <name>  — full deal detail + activity history
/log <name>   — log a call/meeting note
/next <name>  — update next_action and next_action_date
/move <name>  — advance deal to next stage
/snooze <name>— push next_action_date forward
/lost <name>  — mark closed_lost (asks for reason)
/won <name>   — mark closed_won
```

### Natural Language
Free-text messages are parsed by Claude via `crm-log`:
- "Had a great call with Acme, they want a proposal by March 20" → logs activity, sets next_action_date = March 18
- "Draft a follow-up for João at Foobar" → Claude drafts from activity history, sends to Telegram for approval

### Proactive Alerts (outbound)
- **09:00 morning digest** — follow-ups due today
- **Due reminders** — fires when `next_action_date` is reached
- **Stale deal alerts** — no activity in 14+ days
- **Email approval requests** — drafted emails with ✅ Send / ✏️ Edit / ❌ Discard

## OpenClaw Skills

| Skill | Responsibility |
|---|---|
| `crm-core` | CRUD against PostgreSQL; all other skills call this |
| `crm-pipeline` | Pipeline view, stage transitions, stage validation |
| `crm-remind` | Scheduler (every 15min); fires reminders and stale alerts |
| `crm-draft` | Pulls deal context → Claude drafts email → Telegram approval → Gmail send |
| `crm-log` | Parses natural language → structured activity + next_action update |
| `crm-calendar` | Suggests and creates Calendar events after confirmation |

## Integrations

| Service | Scope | Notes |
|---|---|---|
| Telegram | Read + Write | Bot whitelisted to owner user ID only |
| Gmail | `gmail.send`, `gmail.readonly` | OAuth2 via Google API, OpenClaw native |
| Google Calendar | `calendar.events` | OAuth2, OpenClaw native |
| Claude API | — | `claude-sonnet-4-6`, est. <$5/mo at <10 deals |
| PostgreSQL | — | Localhost only, no external exposure |
| Cloudflare R2 | — | Daily pg_dump backup, free tier (10GB) |

## Infrastructure

- **Server:** Hetzner CAX11, 2 ARM vCPU, 4GB RAM, ~€4/mo
- **OS:** Ubuntu 24.04
- **SSH:** Key-only authentication, password auth disabled
- **OpenClaw:** systemd service with auto-restart on failure
- **PostgreSQL:** Bound to localhost, no external port
- **Backups:** Daily cron → pg_dump → Cloudflare R2

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| OpenClaw API changes breaking skills | Pin OpenClaw version; test before upgrading |
| Server downtime = no reminders | Hetzner 99.9% SLA + systemd auto-restart |
| Claude API cost growth | Monitor usage; <10 deals stays well under $5/mo |
| Data loss | Daily pg_dump to Cloudflare R2 |
| Telegram as sole interface | Acceptable for MVP; web UI is a future option |

## Out of Scope (MVP)

- Web dashboard / kanban UI
- Multi-user access
- Email inbox parsing (inbound)
- Deal reporting / analytics
- Mobile app
