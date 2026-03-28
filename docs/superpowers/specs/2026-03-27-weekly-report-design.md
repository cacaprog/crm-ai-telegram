# Weekly Report — Design

**Date:** 2026-03-27
**Status:** Approved

## Context

A weekly report delivered on-demand via Telegram. The goal is not vanity metrics but actionable insight: which deals have gone silent, what moved this week, and whether the pipeline is healthy. Results are persisted as weekly snapshots for trend comparison over time.

## Out of Scope

- Automated delivery (cron/scheduled push) — deferred to scaling phase
- Per-rep metrics (single user CRM)
- Email/PDF export

---

## KPIs

Two sections:

### 1. Deals at Risk

Active deals with no activity logged beyond their stage threshold. The threshold reflects urgency: late-stage deals need more frequent contact than early-stage ones.

| Stage | At-risk after |
|---|---|
| lead / discovery / validation | 14 days |
| scoping | 10 days |
| proposal | 7 days |
| negotiation | 5 days |

**Stale detection logic:** for each active deal, find the most recent activity (`MAX(activities.created_at)`). If no activity exists, fall back to `deals.created_at`. If `NOW() - last_contact > threshold`, the deal is at risk.

After reporting, Claude auto-calls `update_deal` for each at-risk deal:
- `nextAction`: `"Follow-up — sem contato há X dias"`
- `nextActionDate`: tomorrow (today + 1 day)

### 2. Week Snapshot

Covers the 7 days ending at the moment the report is generated.

| Metric | Source |
|---|---|
| Won deals (count + value) | `deals.stage = 'closed_won'` AND `updated_at` in window |
| Lost deals (count) | `deals.stage = 'closed_lost'` AND `updated_at` in window |
| New deals added | `deals.created_at` in window |
| Activities logged | `activities.created_at` in window |
| Active pipeline value | SUM of `deals.value` WHERE stage NOT IN ('closed_won', 'closed_lost') |

---

## Snapshot Persistence

A new `weekly_reports` table stores one row per week. If `get_weekly_report` is called multiple times in the same week, it upserts (updates the existing row). `week_start` is always the Monday of the current week.

```sql
CREATE TABLE IF NOT EXISTS weekly_reports (
  id               SERIAL PRIMARY KEY,
  week_start       DATE NOT NULL UNIQUE,
  week_end         DATE NOT NULL,
  stale_deals      INTEGER NOT NULL DEFAULT 0,
  stale_value      NUMERIC(12,2),
  won_deals        INTEGER NOT NULL DEFAULT 0,
  won_value        NUMERIC(12,2),
  lost_deals       INTEGER NOT NULL DEFAULT 0,
  new_deals        INTEGER NOT NULL DEFAULT 0,
  activities_count INTEGER NOT NULL DEFAULT 0,
  pipeline_value   NUMERIC(12,2),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
```

---

## MCP Tools

### `get_weekly_report()`

No parameters.

1. Computes `week_start` (Monday) and `week_end` (Sunday) for the current week
2. Queries stale deals using per-stage thresholds
3. Queries week snapshot metrics
4. Upserts row in `weekly_reports` via `ON CONFLICT (week_start) DO UPDATE SET ...` — `stale_value` = SUM of `value` of stale deals
5. Returns:

```js
{
  week_start: 'YYYY-MM-DD',
  week_end: 'YYYY-MM-DD',
  stale_deals: [
    {
      id: integer,
      title: string,
      contact_name: string,
      stage: string,
      days_since_contact: integer,
      value: string | null
    }
  ],
  summary: {
    won_deals: integer,
    won_value: string | null,
    lost_deals: integer,
    new_deals: integer,
    activities_count: integer,
    activities_by_type: { call: integer, meeting: integer, email: integer, note: integer, proposal_sent: integer },
    pipeline_value: string | null
  }
}
```

### `get_report_history({ weeks? })`

Returns the last N weekly snapshots ordered by `week_start DESC`. Default: 4 weeks.

```js
[
  {
    week_start: 'YYYY-MM-DD',
    week_end: 'YYYY-MM-DD',
    stale_deals: integer,
    stale_value: string | null,
    won_deals: integer,
    won_value: string | null,
    lost_deals: integer,
    new_deals: integer,
    activities_count: integer,
    pipeline_value: string | null
  }
]
```

---

## Telegram Report Format

```
📊 *Relatório Semanal — 24 Mar a 30 Mar*

⚠️ *Em risco (3 deals, $72k)*
• *Acme Deal* — Proposal — 9 dias sem contato → lembrete criado
• *TechCorp* — Negotiation — 6 dias sem contato → lembrete criado
• *Beta Inc* — Scoping — 11 dias sem contato → lembrete criado

✅ *Esta semana*
Won: GlobalCo ($18k)
Lost: MegaCorp (preço)
Novos deals: 2
Atividades: 8 (3 calls, 2 meetings, 3 emails)
Pipeline ativo: $145k
```

**Edge cases:**
- No stale deals → "Nenhum deal em risco esta semana 🟢"
- No activities this week → flag as alert: "⚠️ Nenhuma atividade registrada esta semana"
- No history for comparison → "Preciso de pelo menos 2 semanas para comparar tendências"

---

## CLAUDE.md Additions

```
**get_weekly_report** — call when the user says "relatório semanal", "como foi a semana", "relatório", or similar. After receiving the result, call update_deal for each stale deal to set nextAction and nextActionDate.

**get_report_history** — call when the user asks to compare weeks or months: "como foi o mês", "evoluiu o pipeline?", "tendência", "compara as semanas". Default to last 4 weeks. Narrate trends: pipeline growth, change in stale deals count, activity pace.
```

---

## File Map

| File | Change |
|---|---|
| `crm-mcp/db/schema.sql` | Add `weekly_reports` table |
| `crm-mcp/db/reports.js` | NEW — `upsertWeeklyReport(data)`, `getReportHistory(weeks)` |
| `crm-mcp/db/index.js` | Export `reports` from `db/reports.js` |
| `crm-mcp/tools/report.js` | NEW — `get_weekly_report`, `get_report_history` |
| `crm-mcp/index.js` | Register 2 new tools + handlers |
| `crm-mcp/tests/report.test.js` | NEW — unit tests (mocked DB) |
| `crm-mcp/tests/db.test.js` | Add integration tests for reports DB layer |
| `crm-mcp/tests/server.test.js` | Update to expect 14 tools |
| `CLAUDE.md` | Add get_weekly_report + get_report_history instructions |
