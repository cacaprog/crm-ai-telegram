# Weekly Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `get_weekly_report` and `get_report_history` MCP tools that surface stale deals, week activity snapshot, and persist weekly snapshots to PostgreSQL for trend comparison.

**Architecture:** A new `db/reports.js` handles the `weekly_reports` table (upsert + history). The pool is exported from `db/index.js` so `db/reports.js` can reuse it. `tools/report.js` orchestrates DB calls, computes stale deals per stage-threshold, and returns structured results.

**Tech Stack:** Node.js ESM, PostgreSQL via `pg`, Jest 29 with `jest.unstable_mockModule` for ESM mocking.

---

## File Map

| File | Change |
|---|---|
| `crm-mcp/db/schema.sql` | Add `weekly_reports` table |
| `crm-mcp/db/index.js` | Export `pool` + add `activities.countByTypeInRange(start, end)` |
| `crm-mcp/db/reports.js` | NEW — `upsertWeeklyReport(data)`, `getReportHistory(weeks)` |
| `crm-mcp/tools/report.js` | NEW — `get_weekly_report()`, `get_report_history({ weeks })` |
| `crm-mcp/index.js` | Register 2 new tools + handlers (12 → 14 tools) |
| `crm-mcp/tests/db.test.js` | Add integration tests for reports DB layer |
| `crm-mcp/tests/report.test.js` | NEW — unit tests (mocked DB) |
| `crm-mcp/tests/server.test.js` | Update to expect 14 tools |
| `CLAUDE.md` | Add `get_weekly_report` + `get_report_history` instructions |

---

### Task 1: DB Layer — schema, db/reports.js, db/index.js, integration tests

**Files:**
- Modify: `crm-mcp/db/schema.sql`
- Modify: `crm-mcp/db/index.js`
- Create: `crm-mcp/db/reports.js`
- Modify: `crm-mcp/tests/db.test.js`

- [ ] **Step 1: Add `weekly_reports` table to schema.sql**

Append to `crm-mcp/db/schema.sql`:

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

CREATE OR REPLACE TRIGGER weekly_reports_updated_at
BEFORE UPDATE ON weekly_reports
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

- [ ] **Step 2: Apply the schema change**

```bash
cd crm-mcp && npm run migrate
```

Expected: No error output.

- [ ] **Step 3: Export `pool` and add `activities.countByTypeInRange` to db/index.js**

In `crm-mcp/db/index.js`, change the pool declaration to export it:

```js
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/crm'
});
```

Then add `countByTypeInRange` to the `activities` object (after `findByDeal`):

```js
  async countByTypeInRange(start, end) {
    const { rows } = await pool.query(
      `SELECT type, COUNT(*)::int as count
       FROM activities
       WHERE created_at >= $1 AND created_at < $2
       GROUP BY type`,
      [start, end]
    );
    const byType = { call: 0, meeting: 0, email: 0, note: 0, proposal_sent: 0 };
    for (const row of rows) byType[row.type] = row.count;
    return byType;
  }
```

- [ ] **Step 4: Create `crm-mcp/db/reports.js`**

```js
import { pool } from './index.js';

export async function upsertWeeklyReport({
  week_start, week_end,
  stale_deals, stale_value,
  won_deals, won_value,
  lost_deals, new_deals,
  activities_count, pipeline_value
}) {
  const { rows } = await pool.query(
    `INSERT INTO weekly_reports
       (week_start, week_end, stale_deals, stale_value, won_deals, won_value,
        lost_deals, new_deals, activities_count, pipeline_value)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (week_start) DO UPDATE SET
       week_end         = EXCLUDED.week_end,
       stale_deals      = EXCLUDED.stale_deals,
       stale_value      = EXCLUDED.stale_value,
       won_deals        = EXCLUDED.won_deals,
       won_value        = EXCLUDED.won_value,
       lost_deals       = EXCLUDED.lost_deals,
       new_deals        = EXCLUDED.new_deals,
       activities_count = EXCLUDED.activities_count,
       pipeline_value   = EXCLUDED.pipeline_value,
       updated_at       = NOW()
     RETURNING *`,
    [week_start, week_end, stale_deals, stale_value, won_deals, won_value,
     lost_deals, new_deals, activities_count, pipeline_value]
  );
  return rows[0];
}

export async function getReportHistory(weeks = 4) {
  const { rows } = await pool.query(
    `SELECT week_start, week_end, stale_deals, stale_value, won_deals, won_value,
            lost_deals, new_deals, activities_count, pipeline_value
     FROM weekly_reports
     ORDER BY week_start DESC
     LIMIT $1`,
    [weeks]
  );
  return rows;
}
```

- [ ] **Step 5: Write integration tests for db/reports.js**

Add a new `describe('reports', ...)` block to `crm-mcp/tests/db.test.js`:

```js
import { contacts, deals, activities, end } from '../db/index.js';
import { upsertWeeklyReport, getReportHistory } from '../db/reports.js';
```

Change the existing `import` line to also import from `../db/reports.js`. Full file header becomes:

```js
import { contacts, deals, activities, end } from '../db/index.js';
import { upsertWeeklyReport, getReportHistory } from '../db/reports.js';
```

Then append at the end of the file:

```js
describe('reports', () => {
  const TEST_WEEK_START = '2026-01-05'; // a Monday far from real data

  afterAll(async () => {
    await pool.query('DELETE FROM weekly_reports WHERE week_start = $1', [TEST_WEEK_START]);
  });

  test('upserts a weekly report row', async () => {
    const row = await upsertWeeklyReport({
      week_start: TEST_WEEK_START,
      week_end: '2026-01-11',
      stale_deals: 2,
      stale_value: 50000,
      won_deals: 1,
      won_value: 18000,
      lost_deals: 0,
      new_deals: 3,
      activities_count: 8,
      pipeline_value: 145000
    });
    expect(row.week_start).toBe(TEST_WEEK_START);
    expect(row.stale_deals).toBe(2);
    expect(Number(row.won_value)).toBe(18000);
  });

  test('upsert updates existing row', async () => {
    const updated = await upsertWeeklyReport({
      week_start: TEST_WEEK_START,
      week_end: '2026-01-11',
      stale_deals: 3,
      stale_value: 75000,
      won_deals: 2,
      won_value: 36000,
      lost_deals: 1,
      new_deals: 3,
      activities_count: 10,
      pipeline_value: 130000
    });
    expect(updated.stale_deals).toBe(3);
    expect(updated.won_deals).toBe(2);
  });

  test('getReportHistory returns rows ordered desc', async () => {
    const history = await getReportHistory(4);
    expect(Array.isArray(history)).toBe(true);
    const testRow = history.find(r => r.week_start === TEST_WEEK_START);
    expect(testRow).toBeDefined();
    expect(testRow.activities_count).toBe(10);
  });
});
```

Also add `pool` to the import line in `db.test.js`:

```js
import { contacts, deals, activities, end, pool } from '../db/index.js';
import { upsertWeeklyReport, getReportHistory } from '../db/reports.js';
```

- [ ] **Step 6: Run db tests to verify**

```bash
cd crm-mcp && npm test -- --testPathPattern=db.test
```

Expected: All existing tests pass + 3 new `reports` tests pass.

- [ ] **Step 7: Commit**

```bash
cd crm-mcp && git add db/schema.sql db/index.js db/reports.js tests/db.test.js
git commit -m "feat: add weekly_reports table and DB layer"
```

---

### Task 2: `get_weekly_report` tool + registration + unit tests

**Files:**
- Create: `crm-mcp/tools/report.js`
- Modify: `crm-mcp/index.js`
- Create: `crm-mcp/tests/report.test.js`
- Modify: `crm-mcp/tests/server.test.js`

- [ ] **Step 1: Write the failing unit test for `get_weekly_report`**

Create `crm-mcp/tests/report.test.js`:

```js
import { jest } from '@jest/globals';

// --- mock DB modules ---
jest.unstable_mockModule('../db/index.js', () => ({
  pool: {},
  contacts: {},
  deals: {
    findAllWithLastActivity: jest.fn()
  },
  activities: {
    countByTypeInRange: jest.fn()
  },
  end: jest.fn()
}));

jest.unstable_mockModule('../db/reports.js', () => ({
  upsertWeeklyReport: jest.fn().mockResolvedValue({}),
  getReportHistory: jest.fn()
}));

const db = await import('../db/index.js');
const { upsertWeeklyReport, getReportHistory } = await import('../db/reports.js');
const { get_weekly_report, get_report_history } = await import('../tools/report.js');

// Helpers
function makeDeal(overrides) {
  return {
    id: 1,
    title: 'Test Deal',
    stage: 'proposal',
    value: '25000.00',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-03-01T00:00:00Z'),
    contact_name: 'João Silva',
    ...overrides
  };
}

describe('get_weekly_report', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.activities.countByTypeInRange.mockResolvedValue({
      call: 3, meeting: 2, email: 3, note: 0, proposal_sent: 0
    });
  });

  test('identifies stale proposal deal (8 days, threshold 7)', async () => {
    const now = new Date();
    const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000);
    db.deals.findAllWithLastActivity.mockResolvedValue([
      makeDeal({ stage: 'proposal', updated_at: eightDaysAgo, created_at: new Date('2026-01-01') })
    ]);

    const result = await get_weekly_report();
    expect(result.stale_deals).toHaveLength(1);
    expect(result.stale_deals[0].stage).toBe('proposal');
    expect(result.stale_deals[0].days_since_contact).toBeGreaterThanOrEqual(8);
  });

  test('does not flag proposal deal within threshold (5 days)', async () => {
    const now = new Date();
    const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000);
    db.deals.findAllWithLastActivity.mockResolvedValue([
      makeDeal({ stage: 'proposal', updated_at: fiveDaysAgo, created_at: new Date('2026-01-01') })
    ]);

    const result = await get_weekly_report();
    expect(result.stale_deals).toHaveLength(0);
  });

  test('does not flag closed deals', async () => {
    db.deals.findAllWithLastActivity.mockResolvedValue([
      makeDeal({ stage: 'closed_won', updated_at: new Date('2026-01-01') })
    ]);

    const result = await get_weekly_report();
    expect(result.stale_deals).toHaveLength(0);
  });

  test('uses created_at as last contact when no activity date is available', async () => {
    const now = new Date();
    const fifteenDaysAgo = new Date(now - 15 * 24 * 60 * 60 * 1000);
    db.deals.findAllWithLastActivity.mockResolvedValue([
      makeDeal({ stage: 'lead', created_at: fifteenDaysAgo, updated_at: fifteenDaysAgo, last_activity_at: null })
    ]);

    const result = await get_weekly_report();
    expect(result.stale_deals).toHaveLength(1);
    expect(result.stale_deals[0].days_since_contact).toBeGreaterThanOrEqual(15);
  });

  test('returns summary with correct shape', async () => {
    db.deals.findAllWithLastActivity.mockResolvedValue([
      makeDeal({ stage: 'proposal', updated_at: new Date('2026-01-01') })
    ]);

    const result = await get_weekly_report();
    expect(result).toHaveProperty('week_start');
    expect(result).toHaveProperty('week_end');
    expect(result).toHaveProperty('stale_deals');
    expect(result).toHaveProperty('summary');
    expect(result.summary).toHaveProperty('won_deals');
    expect(result.summary).toHaveProperty('won_value');
    expect(result.summary).toHaveProperty('lost_deals');
    expect(result.summary).toHaveProperty('new_deals');
    expect(result.summary).toHaveProperty('activities_count');
    expect(result.summary).toHaveProperty('activities_by_type');
    expect(result.summary).toHaveProperty('pipeline_value');
  });

  test('calls upsertWeeklyReport after computing results', async () => {
    db.deals.findAllWithLastActivity.mockResolvedValue([]);

    await get_weekly_report();
    expect(upsertWeeklyReport).toHaveBeenCalledTimes(1);
    const args = upsertWeeklyReport.mock.calls[0][0];
    expect(args).toHaveProperty('week_start');
    expect(args).toHaveProperty('week_end');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd crm-mcp && npm test -- --testPathPattern=report.test
```

Expected: FAIL — `Cannot find module '../tools/report.js'`

- [ ] **Step 3: Add `deals.findAllWithLastActivity()` to db/index.js**

Add a new method to the `deals` object in `crm-mcp/db/index.js`, after `findAll`:

```js
  async findAllWithLastActivity() {
    const { rows } = await pool.query(
      `SELECT d.*, c.name as contact_name, c.company, c.email,
              MAX(a.created_at) as last_activity_at
       FROM deals d
       JOIN contacts c ON c.id = d.contact_id
       LEFT JOIN activities a ON a.deal_id = d.id
       GROUP BY d.id, c.name, c.company, c.email
       ORDER BY d.next_action_date NULLS LAST, d.created_at`
    );
    return rows;
  },
```

- [ ] **Step 4: Create `crm-mcp/tools/report.js` with `get_weekly_report`**

```js
import * as db from '../db/index.js';
import { upsertWeeklyReport, getReportHistory } from '../db/reports.js';

const STALE_THRESHOLDS = {
  lead: 14, discovery: 14, validation: 14,
  scoping: 10,
  proposal: 7,
  negotiation: 5
};

function getWeekBounds() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon...
  const diffToMonday = (day === 0 ? -6 : 1 - day);
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);
  const fmt = d => d.toISOString().slice(0, 10);
  return { week_start: fmt(monday), week_end: fmt(sunday), monday, sunday };
}

function daysSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

export async function get_weekly_report() {
  const { week_start, week_end, monday, sunday } = getWeekBounds();

  // findAllWithLastActivity returns last_activity_at via LEFT JOIN on activities
  const allDeals = await db.deals.findAllWithLastActivity();
  const activeDeals = allDeals.filter(d => !d.stage.startsWith('closed'));

  // Stale detection: use last_activity_at if present, else fall back to created_at
  const staleDeals = activeDeals
    .map(d => {
      const lastContact = d.last_activity_at || d.created_at;
      const days = daysSince(lastContact);
      return { ...d, days_since_contact: days };
    })
    .filter(d => {
      const threshold = STALE_THRESHOLDS[d.stage];
      return threshold != null && d.days_since_contact > threshold;
    });

  // Week snapshot
  const weekStart = monday;
  const weekEnd = new Date(sunday.getTime() + 1); // exclusive upper bound

  const wonDeals = allDeals.filter(
    d => d.stage === 'closed_won' &&
         new Date(d.updated_at) >= weekStart &&
         new Date(d.updated_at) < weekEnd
  );
  const lostDeals = allDeals.filter(
    d => d.stage === 'closed_lost' &&
         new Date(d.updated_at) >= weekStart &&
         new Date(d.updated_at) < weekEnd
  );
  const newDeals = allDeals.filter(
    d => new Date(d.created_at) >= weekStart && new Date(d.created_at) < weekEnd
  );
  const pipelineDeals = allDeals.filter(d => !d.stage.startsWith('closed'));
  const pipeline_value = pipelineDeals.reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

  const activities_by_type = await db.activities.countByTypeInRange(weekStart, weekEnd);
  const activities_count = Object.values(activities_by_type).reduce((s, v) => s + v, 0);

  const won_value = wonDeals.reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);
  const stale_value = staleDeals.reduce((sum, d) => sum + (parseFloat(d.value) || 0), 0);

  await upsertWeeklyReport({
    week_start,
    week_end,
    stale_deals: staleDeals.length,
    stale_value: stale_value || null,
    won_deals: wonDeals.length,
    won_value: won_value || null,
    lost_deals: lostDeals.length,
    new_deals: newDeals.length,
    activities_count,
    pipeline_value: pipeline_value || null
  });

  return {
    week_start,
    week_end,
    stale_deals: staleDeals.map(d => ({
      id: d.id,
      title: d.title,
      contact_name: d.contact_name,
      stage: d.stage,
      days_since_contact: d.days_since_contact,
      value: d.value || null
    })),
    summary: {
      won_deals: wonDeals.length,
      won_value: won_value ? String(won_value) : null,
      lost_deals: lostDeals.length,
      new_deals: newDeals.length,
      activities_count,
      activities_by_type,
      pipeline_value: pipeline_value ? String(pipeline_value) : null
    }
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd crm-mcp && npm test -- --testPathPattern=report.test
```

Expected: All 6 tests in `get_weekly_report` describe block pass. (The `get_report_history` tests will not exist yet — that's Task 3.)

- [ ] **Step 5: Register `get_weekly_report` in index.js**

In `crm-mcp/index.js`, add the import at the top:

```js
import { get_weekly_report, get_report_history } from './tools/report.js';
```

Add to `TOOLS` array (after `get_today_briefing`):

```js
  {
    name: 'get_weekly_report',
    description: 'Generate the weekly CRM report: stale deals (no contact beyond stage threshold) and week activity snapshot. Persists a snapshot to DB.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
```

Add to `handlers` object:

```js
  get_weekly_report,
```

- [ ] **Step 6: Update server.test.js to expect 13 tools**

In `crm-mcp/tests/server.test.js`:

Add mock for report.js before the import:

```js
jest.unstable_mockModule('../tools/report.js', () => ({
  get_weekly_report: jest.fn(),
  get_report_history: jest.fn()
}));
```

Update the tool count test:

```js
test('TOOLS lists all 13 tools', () => {
  const names = TOOLS.map(t => t.name);
  expect(names).toContain('get_pipeline');
  expect(names).toContain('get_deal');
  expect(names).toContain('get_deal_context');
  expect(names).toContain('create_deal');
  expect(names).toContain('update_deal');
  expect(names).toContain('move_stage');
  expect(names).toContain('close_deal');
  expect(names).toContain('snooze_deal');
  expect(names).toContain('update_contact');
  expect(names).toContain('log_activity');
  expect(names).toContain('send_email');
  expect(names).toContain('get_today_briefing');
  expect(names).toContain('get_weekly_report');
  expect(names).toHaveLength(13);
});
```

- [ ] **Step 7: Run all tests**

```bash
cd crm-mcp && npm test
```

Expected: All tests pass (the 2 new report tests + all 29 existing).

- [ ] **Step 8: Commit**

```bash
cd crm-mcp && git add db/index.js tools/report.js index.js tests/report.test.js tests/server.test.js
git commit -m "feat: add get_weekly_report tool (stale detection + week snapshot)"
```

---

### Task 3: `get_report_history` + CLAUDE.md

**Files:**
- Modify: `crm-mcp/tools/report.js`
- Modify: `crm-mcp/index.js`
- Modify: `crm-mcp/tests/report.test.js`
- Modify: `crm-mcp/tests/server.test.js`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `get_report_history` tests to report.test.js**

Append a new describe block to `crm-mcp/tests/report.test.js`:

```js
describe('get_report_history', () => {
  test('returns history from getReportHistory with default 4 weeks', async () => {
    getReportHistory.mockResolvedValue([
      { week_start: '2026-03-24', week_end: '2026-03-30', stale_deals: 2, won_deals: 1 }
    ]);

    const result = await get_report_history({});
    expect(getReportHistory).toHaveBeenCalledWith(4);
    expect(result).toHaveLength(1);
    expect(result[0].week_start).toBe('2026-03-24');
  });

  test('passes custom weeks parameter', async () => {
    getReportHistory.mockResolvedValue([]);

    await get_report_history({ weeks: 8 });
    expect(getReportHistory).toHaveBeenCalledWith(8);
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd crm-mcp && npm test -- --testPathPattern=report.test
```

Expected: 2 new `get_report_history` tests FAIL — function exists but returns nothing useful yet.

- [ ] **Step 3: Add `get_report_history` to tools/report.js**

Append to `crm-mcp/tools/report.js`:

```js
export async function get_report_history({ weeks } = {}) {
  return getReportHistory(weeks ?? 4);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd crm-mcp && npm test -- --testPathPattern=report.test
```

Expected: All 8 tests pass.

- [ ] **Step 5: Register `get_report_history` in index.js**

Add to `TOOLS` array (after `get_weekly_report`):

```js
  {
    name: 'get_report_history',
    description: 'Return the last N weekly report snapshots ordered by week descending. Default 4 weeks.',
    inputSchema: {
      type: 'object',
      properties: {
        weeks: { type: 'integer', description: 'Number of weeks to return. Default 4.' }
      },
      required: []
    }
  },
```

Add to `handlers` object:

```js
  get_report_history,
```

- [ ] **Step 6: Update server.test.js to expect 14 tools**

In `crm-mcp/tests/server.test.js`, update the count test:

```js
test('TOOLS lists all 14 tools', () => {
  const names = TOOLS.map(t => t.name);
  expect(names).toContain('get_pipeline');
  expect(names).toContain('get_deal');
  expect(names).toContain('get_deal_context');
  expect(names).toContain('create_deal');
  expect(names).toContain('update_deal');
  expect(names).toContain('move_stage');
  expect(names).toContain('close_deal');
  expect(names).toContain('snooze_deal');
  expect(names).toContain('update_contact');
  expect(names).toContain('log_activity');
  expect(names).toContain('send_email');
  expect(names).toContain('get_today_briefing');
  expect(names).toContain('get_weekly_report');
  expect(names).toContain('get_report_history');
  expect(names).toHaveLength(14);
});
```

- [ ] **Step 7: Run all tests**

```bash
cd crm-mcp && npm test
```

Expected: All tests pass.

- [ ] **Step 8: Update CLAUDE.md**

Append to the `## Tool Usage` section in `CLAUDE.md`:

```
**get_weekly_report** — call when the user says "relatório semanal", "como foi a semana", "relatório", or similar. After receiving the result, call update_deal for each stale deal to set nextAction to "Follow-up — sem contato há X dias" and nextActionDate to tomorrow.

**get_report_history** — call when the user asks to compare weeks or months: "como foi o mês", "evoluiu o pipeline?", "tendência", "compara as semanas". Default to last 4 weeks. Narrate trends: pipeline growth, change in stale deal count, activity pace.
```

- [ ] **Step 9: Run all tests one final time**

```bash
cd crm-mcp && npm test
```

Expected: All tests pass. Total test count grows by ~11 tests from before Task 1.

- [ ] **Step 10: Commit**

```bash
cd crm-mcp && git add tools/report.js index.js tests/report.test.js tests/server.test.js ../CLAUDE.md
git commit -m "feat: add get_report_history tool and CLAUDE.md instructions"
```
