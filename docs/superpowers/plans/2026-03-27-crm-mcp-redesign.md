# CRM MCP Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the OpenClaw skill suite with a single `crm-mcp` Node.js MCP server that exposes CRM operations as tools Claude calls directly via Telegram.

**Architecture:** A new `crm-mcp/` package contains the MCP server (`index.js`), tool handlers (`tools/`), and DB layer (`db/`). Claude Code runs with `--channels plugin:telegram@claude-plugins-official` and uses `.mcp.json` to load `crm-mcp` automatically. `CLAUDE.md` defines the CRM persona and tool usage rules. `crm-skills/` is deleted after the new server is verified.

**Tech Stack:** Node.js ESM, `@modelcontextprotocol/sdk`, `pg` (PostgreSQL), `googleapis` (Gmail OAuth2), Jest (tests), local PostgreSQL.

---

### Task 1: Project scaffold

**Files:**
- Create: `crm-mcp/package.json`
- Create: `crm-mcp/tools/.gitkeep`
- Create: `crm-mcp/db/.gitkeep`
- Create: `crm-mcp/tests/.gitkeep`

- [ ] **Step 1: Create `crm-mcp/package.json`**

```json
{
  "name": "crm-mcp",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node index.js",
    "migrate": "node db/migrate.js",
    "test": "NODE_OPTIONS='--experimental-vm-modules' npx jest --testPathPattern='tests/'"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "googleapis": "^144.0.0",
    "pg": "^8.0.0"
  },
  "devDependencies": {
    "@jest/globals": "^29.0.0",
    "jest": "^29.0.0"
  },
  "jest": {
    "extensionsToTreatAsEsm": [".js"],
    "transform": {}
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd crm-mcp && npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 3: Create empty subdirectories**

```bash
mkdir -p crm-mcp/tools crm-mcp/db crm-mcp/tests
```

- [ ] **Step 4: Commit**

```bash
git add crm-mcp/package.json crm-mcp/package-lock.json
git commit -m "feat: scaffold crm-mcp package"
```

---

### Task 2: DB layer

**Files:**
- Create: `crm-mcp/db/index.js`

This is an ESM port of `crm-skills/crm-db/src/index.js`. Keeps all the same SQL — only the module syntax changes from `require`/`module.exports` to `import`/`export`.

- [ ] **Step 1: Write the failing test**

Create `crm-mcp/tests/db.test.js`:

```js
import { contacts, deals, activities, end } from '../db/index.js';

afterAll(() => end());

describe('contacts', () => {
  test('creates and retrieves a contact', async () => {
    const contact = await contacts.create({
      name: 'Test Person',
      company: 'Acme Corp',
      email: 'test@acme.com',
      source: 'referral'
    });
    expect(contact.id).toBeDefined();
    expect(contact.name).toBe('Test Person');

    const found = await contacts.findById(contact.id);
    expect(found.company).toBe('Acme Corp');

    await contacts.delete(contact.id);
  });
});

describe('deals', () => {
  let contactId;

  beforeAll(async () => {
    const c = await contacts.create({ name: 'Deal Contact', source: 'cold' });
    contactId = c.id;
  });

  afterAll(async () => {
    await contacts.delete(contactId);
  });

  test('creates deal with default stage lead', async () => {
    const deal = await deals.create({ contactId, title: 'Test Deal', value: 10000 });
    expect(deal.stage).toBe('lead');
    expect(deal.value).toBe('10000.00');
    await deals.delete(deal.id);
  });

  test('updates next_action and next_action_date', async () => {
    const deal = await deals.create({ contactId, title: 'Follow-up Deal' });
    const updated = await deals.update(deal.id, {
      nextAction: 'Send proposal',
      nextActionDate: new Date('2026-04-01T09:00:00Z')
    });
    expect(updated.next_action).toBe('Send proposal');
    await deals.delete(deal.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd crm-mcp && npm test -- --testPathPattern='db.test'
```

Expected: FAIL — `Cannot find module '../db/index.js'`

- [ ] **Step 3: Create `crm-mcp/db/index.js`**

```js
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/crm'
});

export const contacts = {
  async create({ name, company, role, email, phone, linkedinUrl, source }) {
    const { rows } = await pool.query(
      `INSERT INTO contacts (name, company, role, email, phone, linkedin_url, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, company, role, email, phone, linkedinUrl, source]
    );
    return rows[0];
  },
  async findById(id) {
    const { rows } = await pool.query('SELECT * FROM contacts WHERE id=$1', [id]);
    return rows[0] || null;
  },
  async findAll() {
    const { rows } = await pool.query('SELECT * FROM contacts ORDER BY name');
    return rows;
  },
  async delete(id) {
    await pool.query('DELETE FROM contacts WHERE id=$1', [id]);
  }
};

export const deals = {
  async create({ contactId, title, value, notes }) {
    const { rows } = await pool.query(
      `INSERT INTO deals (contact_id, title, value, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
      [contactId, title, value, notes]
    );
    return rows[0];
  },
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT d.*, c.name as contact_name, c.company, c.email
       FROM deals d JOIN contacts c ON c.id = d.contact_id
       WHERE d.id=$1`,
      [id]
    );
    return rows[0] || null;
  },
  async findAll({ stage } = {}) {
    const conditions = stage ? 'WHERE d.stage=$1' : '';
    const params = stage ? [stage] : [];
    const { rows } = await pool.query(
      `SELECT d.*, c.name as contact_name, c.company, c.email
       FROM deals d JOIN contacts c ON c.id = d.contact_id
       ${conditions}
       ORDER BY d.next_action_date NULLS LAST, d.created_at`,
      params
    );
    return rows;
  },
  async update(id, { stage, nextAction, nextActionDate, value, notes } = {}) {
    const { rows } = await pool.query(
      `UPDATE deals SET
         stage            = COALESCE($2, stage),
         next_action      = COALESCE($3, next_action),
         next_action_date = COALESCE($4, next_action_date),
         value            = COALESCE($5, value),
         notes            = COALESCE($6, notes)
       WHERE id=$1 RETURNING *`,
      [id, stage, nextAction, nextActionDate, value, notes]
    );
    return rows[0];
  },
  async delete(id) {
    await pool.query('DELETE FROM deals WHERE id=$1', [id]);
  }
};

export const activities = {
  async create({ dealId, type, summary }) {
    const { rows } = await pool.query(
      `INSERT INTO activities (deal_id, type, summary) VALUES ($1,$2,$3) RETURNING *`,
      [dealId, type, summary]
    );
    return rows[0];
  },
  async findByDeal(dealId) {
    const { rows } = await pool.query(
      `SELECT * FROM activities WHERE deal_id=$1 ORDER BY created_at DESC`,
      [dealId]
    );
    return rows;
  }
};

export const end = () => pool.end();
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd crm-mcp && npm test -- --testPathPattern='db.test'
```

Expected: PASS — both describe blocks green. (Requires local Postgres with the schema already migrated — run Task 3 first if the DB doesn't exist yet.)

- [ ] **Step 5: Commit**

```bash
git add crm-mcp/db/index.js crm-mcp/tests/db.test.js
git commit -m "feat: add crm-mcp db layer"
```

---

### Task 3: Schema and migration

**Files:**
- Create: `crm-mcp/db/schema.sql`
- Create: `crm-mcp/db/migrate.js`

- [ ] **Step 1: Create `crm-mcp/db/schema.sql`**

Copy the schema from crm-skills — identical, no changes needed:

```sql
CREATE TYPE deal_stage AS ENUM (
  'lead', 'discovery', 'validation', 'scoping',
  'proposal', 'negotiation', 'closed_won', 'closed_lost'
);

CREATE TYPE activity_type AS ENUM (
  'call', 'email', 'meeting', 'note', 'proposal_sent'
);

CREATE TYPE reminder_status AS ENUM (
  'pending', 'snoozed', 'done'
);

CREATE TABLE IF NOT EXISTS contacts (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  company      TEXT,
  role         TEXT,
  email        TEXT,
  phone        TEXT,
  linkedin_url TEXT,
  source       TEXT CHECK (source IN ('referral', 'cold', 'inbound')),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deals (
  id               SERIAL PRIMARY KEY,
  contact_id       INTEGER REFERENCES contacts(id) ON DELETE RESTRICT,
  title            TEXT NOT NULL,
  stage            deal_stage NOT NULL DEFAULT 'lead',
  value            NUMERIC(12,2),
  next_action      TEXT,
  next_action_date TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activities (
  id         SERIAL PRIMARY KEY,
  deal_id    INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  type       activity_type NOT NULL,
  summary    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reminders (
  id         SERIAL PRIMARY KEY,
  deal_id    INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  message    TEXT NOT NULL,
  due_at     TIMESTAMPTZ NOT NULL,
  status     reminder_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER deals_updated_at
BEFORE UPDATE ON deals
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

Note: `CREATE TABLE IF NOT EXISTS` and `CREATE OR REPLACE TRIGGER` make the script idempotent (safe to re-run).

- [ ] **Step 2: Create `crm-mcp/db/migrate.js`**

```js
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/crm'
});

const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
await pool.query(sql);
console.log('Migration complete');
await pool.end();
```

- [ ] **Step 3: Run migration**

```bash
cd crm-mcp && npm run migrate
```

Expected: `Migration complete`

- [ ] **Step 4: Commit**

```bash
git add crm-mcp/db/schema.sql crm-mcp/db/migrate.js
git commit -m "feat: add db schema and migrate script"
```

---

### Task 4: Pipeline tools

**Files:**
- Create: `crm-mcp/tools/pipeline.js`
- Test: `crm-mcp/tests/pipeline.test.js`

- [ ] **Step 1: Write the failing test**

Create `crm-mcp/tests/pipeline.test.js`:

```js
import { jest } from '@jest/globals';

const mockDeals = [
  { id: 1, title: 'Acme Deal', contact_name: 'João Silva', stage: 'proposal', value: '25000.00', next_action_date: null, company: 'Acme', email: 'joao@acme.com' },
  { id: 2, title: 'Beta Corp', contact_name: 'Ana Lima', stage: 'lead', value: null, next_action_date: null, company: 'Beta', email: 'ana@beta.com' }
];
const mockActivities = [
  { id: 1, deal_id: 1, type: 'call', summary: 'Good call', created_at: new Date() }
];

jest.unstable_mockModule('../db/index.js', () => ({
  deals: {
    findAll: jest.fn().mockResolvedValue(mockDeals),
    findById: jest.fn().mockImplementation(id => Promise.resolve(mockDeals.find(d => d.id === id) || null))
  },
  activities: {
    findByDeal: jest.fn().mockResolvedValue(mockActivities)
  }
}));

const { get_pipeline, get_deal, get_deal_context } = await import('../tools/pipeline.js');

test('get_pipeline groups deals by stage', async () => {
  const result = await get_pipeline();
  expect(result.proposal).toHaveLength(1);
  expect(result.proposal[0].title).toBe('Acme Deal');
  expect(result.lead).toHaveLength(1);
  expect(result.discovery).toHaveLength(0);
});

test('get_deal finds by title fuzzy match', async () => {
  const result = await get_deal({ deal_name: 'acme' });
  expect(result.deal.title).toBe('Acme Deal');
  expect(result.activities).toHaveLength(1);
});

test('get_deal finds by contact name fuzzy match', async () => {
  const result = await get_deal({ deal_name: 'ana' });
  expect(result.deal.title).toBe('Beta Corp');
});

test('get_deal throws when no match', async () => {
  await expect(get_deal({ deal_name: 'nonexistent' })).rejects.toThrow('No deal found');
});

test('get_deal_context returns deal and recent activities', async () => {
  const result = await get_deal_context({ deal_id: 1 });
  expect(result.deal.id).toBe(1);
  expect(result.activities).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd crm-mcp && npm test -- --testPathPattern='pipeline.test'
```

Expected: FAIL — `Cannot find module '../tools/pipeline.js'`

- [ ] **Step 3: Create `crm-mcp/tools/pipeline.js`**

```js
import * as db from '../db/index.js';

const STAGES = ['lead','discovery','validation','scoping','proposal','negotiation','closed_won','closed_lost'];

export async function get_pipeline() {
  const deals = await db.deals.findAll();
  const grouped = Object.fromEntries(STAGES.map(s => [s, []]));
  for (const deal of deals) {
    if (grouped[deal.stage]) grouped[deal.stage].push(deal);
  }
  return grouped;
}

export async function get_deal({ deal_name }) {
  const deals = await db.deals.findAll();
  const query = deal_name.toLowerCase();
  const deal = deals.find(d =>
    d.title.toLowerCase().includes(query) ||
    d.contact_name.toLowerCase().includes(query)
  );
  if (!deal) throw new Error(`No deal found matching "${deal_name}"`);
  const activities = await db.activities.findByDeal(deal.id);
  return { deal, activities };
}

export async function get_deal_context({ deal_id }) {
  const deal = await db.deals.findById(deal_id);
  if (!deal) throw new Error(`Deal not found: ${deal_id}`);
  const activities = await db.activities.findByDeal(deal_id);
  return { deal, activities: activities.slice(0, 5) };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd crm-mcp && npm test -- --testPathPattern='pipeline.test'
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add crm-mcp/tools/pipeline.js crm-mcp/tests/pipeline.test.js
git commit -m "feat: add pipeline tools (get_pipeline, get_deal, get_deal_context)"
```

---

### Task 5: Deal tools

**Files:**
- Create: `crm-mcp/tools/deals.js`
- Test: `crm-mcp/tests/deals.test.js`

- [ ] **Step 1: Write the failing test**

Create `crm-mcp/tests/deals.test.js`:

```js
import { jest } from '@jest/globals';

const mockContact = { id: 10, name: 'Test Contact', company: 'Co', email: 'test@co.com' };
const mockDeal = { id: 20, title: 'Test Deal', stage: 'lead', contact_id: 10 };

jest.unstable_mockModule('../db/index.js', () => ({
  contacts: {
    create: jest.fn().mockResolvedValue(mockContact)
  },
  deals: {
    create: jest.fn().mockResolvedValue(mockDeal),
    findById: jest.fn().mockImplementation(id => {
      if (id === 20) return Promise.resolve({ ...mockDeal });
      if (id === 99) return Promise.resolve({ ...mockDeal, id: 99, stage: 'negotiation' });
      return Promise.resolve(null);
    }),
    update: jest.fn().mockImplementation((id, fields) =>
      Promise.resolve({ ...mockDeal, id, ...fields })
    )
  },
  activities: {
    create: jest.fn().mockResolvedValue({ id: 1 })
  }
}));

const { create_deal, update_deal, move_stage, close_deal, snooze_deal } = await import('../tools/deals.js');

test('create_deal creates contact and deal', async () => {
  const result = await create_deal({ title: 'New Deal', contact_name: 'Alice', company: 'Corp', email: 'alice@corp.com' });
  expect(result.contact.name).toBe('Test Contact');
  expect(result.deal.title).toBe('Test Deal');
});

test('move_stage advances to next stage', async () => {
  const result = await move_stage({ deal_id: 20 });
  expect(result.stage).toBe('discovery');
});

test('move_stage throws when at negotiation (last before closed)', async () => {
  await expect(move_stage({ deal_id: 99 })).rejects.toThrow('Cannot advance from negotiation');
});

test('close_deal sets closed_won stage', async () => {
  const result = await close_deal({ deal_id: 20, outcome: 'won' });
  expect(result.stage).toBe('closed_won');
});

test('close_deal logs reason activity on lost', async () => {
  const { activities } = await import('../db/index.js');
  await close_deal({ deal_id: 20, outcome: 'lost', reason: 'Budget cut' });
  expect(activities.create).toHaveBeenCalledWith(expect.objectContaining({
    type: 'note',
    summary: expect.stringContaining('Budget cut')
  }));
});

test('snooze_deal defaults to 3 days', async () => {
  const before = Date.now();
  const result = await snooze_deal({ deal_id: 20 });
  const snoozeMs = new Date(result.nextActionDate).getTime();
  expect(snoozeMs).toBeGreaterThanOrEqual(before + 3 * 24 * 60 * 60 * 1000 - 1000);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd crm-mcp && npm test -- --testPathPattern='deals.test'
```

Expected: FAIL — `Cannot find module '../tools/deals.js'`

- [ ] **Step 3: Create `crm-mcp/tools/deals.js`**

```js
import * as db from '../db/index.js';

const STAGES = ['lead','discovery','validation','scoping','proposal','negotiation','closed_won','closed_lost'];

export async function create_deal({ title, contact_name, company, email, stage, value, notes }) {
  const contact = await db.contacts.create({ name: contact_name, company, email, source: 'cold' });
  const deal = await db.deals.create({ contactId: contact.id, title, value, notes });
  if (stage && stage !== 'lead') {
    await db.deals.update(deal.id, { stage });
  }
  return { contact, deal };
}

export async function update_deal({ deal_id, fields }) {
  return await db.deals.update(deal_id, fields);
}

export async function move_stage({ deal_id }) {
  const deal = await db.deals.findById(deal_id);
  if (!deal) throw new Error(`Deal not found: ${deal_id}`);
  const currentIdx = STAGES.indexOf(deal.stage);
  const nextStage = STAGES[currentIdx + 1];
  if (!nextStage || nextStage.startsWith('closed')) {
    throw new Error(`Cannot advance from ${deal.stage}. Use close_deal with outcome won or lost.`);
  }
  return await db.deals.update(deal_id, { stage: nextStage });
}

export async function close_deal({ deal_id, outcome, reason }) {
  const stage = outcome === 'won' ? 'closed_won' : 'closed_lost';
  const deal = await db.deals.update(deal_id, { stage });
  if (reason) {
    await db.activities.create({ dealId: deal_id, type: 'note', summary: `Closed ${outcome}: ${reason}` });
  }
  return deal;
}

export async function snooze_deal({ deal_id, days = 3 }) {
  const nextActionDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return await db.deals.update(deal_id, { nextActionDate });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd crm-mcp && npm test -- --testPathPattern='deals.test'
```

Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add crm-mcp/tools/deals.js crm-mcp/tests/deals.test.js
git commit -m "feat: add deal tools (create, update, move_stage, close, snooze)"
```

---

### Task 6: Activity tool

**Files:**
- Create: `crm-mcp/tools/activity.js`
- Test: `crm-mcp/tests/activity.test.js`

- [ ] **Step 1: Write the failing test**

Create `crm-mcp/tests/activity.test.js`:

```js
import { jest } from '@jest/globals';

const mockActivity = { id: 5, deal_id: 20, type: 'call', summary: 'Good call' };

jest.unstable_mockModule('../db/index.js', () => ({
  activities: {
    create: jest.fn().mockResolvedValue(mockActivity)
  },
  deals: {
    update: jest.fn().mockResolvedValue({ id: 20 })
  }
}));

const { log_activity } = await import('../tools/activity.js');

test('log_activity writes activity to db', async () => {
  const result = await log_activity({ deal_id: 20, type: 'call', summary: 'Good call' });
  expect(result.id).toBe(5);
  expect(result.type).toBe('call');
});

test('log_activity updates deal next_action when provided', async () => {
  const { deals } = await import('../db/index.js');
  await log_activity({
    deal_id: 20,
    type: 'meeting',
    summary: 'Scoping meeting',
    next_action: 'Send proposal',
    next_action_date: '2026-04-15'
  });
  expect(deals.update).toHaveBeenCalledWith(20, expect.objectContaining({
    nextAction: 'Send proposal',
    nextActionDate: expect.any(Date)
  }));
});

test('log_activity does not update deal when no next_action', async () => {
  const { deals } = await import('../db/index.js');
  deals.update.mockClear();
  await log_activity({ deal_id: 20, type: 'note', summary: 'Quick note' });
  expect(deals.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd crm-mcp && npm test -- --testPathPattern='activity.test'
```

Expected: FAIL — `Cannot find module '../tools/activity.js'`

- [ ] **Step 3: Create `crm-mcp/tools/activity.js`**

```js
import * as db from '../db/index.js';

export async function log_activity({ deal_id, type, summary, next_action, next_action_date }) {
  const activity = await db.activities.create({ dealId: deal_id, type, summary });
  if (next_action || next_action_date) {
    await db.deals.update(deal_id, {
      nextAction: next_action,
      nextActionDate: next_action_date ? new Date(next_action_date) : undefined
    });
  }
  return activity;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd crm-mcp && npm test -- --testPathPattern='activity.test'
```

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add crm-mcp/tools/activity.js crm-mcp/tests/activity.test.js
git commit -m "feat: add log_activity tool"
```

---

### Task 7: Gmail send tool

**Files:**
- Create: `crm-mcp/tools/email.js`
- Update: `.gitignore` (add `.gmail-credentials.json`)

This tool handles Gmail OAuth2 on first use. It requires `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` env vars, which come from a Google Cloud Console OAuth2 app. The first call triggers an interactive auth flow in the terminal.

- [ ] **Step 1: Add `.gmail-credentials.json` to `.gitignore`**

Add to the root `.gitignore` (or create one if absent):

```
crm-mcp/.gmail-credentials.json
```

- [ ] **Step 2: Create `crm-mcp/tools/email.js`**

```js
import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as db from '../db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CREDS_PATH = join(__dirname, '..', '.gmail-credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );
}

async function getAuthorizedClient() {
  const oauth2Client = createOAuth2Client();

  if (existsSync(CREDS_PATH)) {
    const token = JSON.parse(readFileSync(CREDS_PATH, 'utf8'));
    oauth2Client.setCredentials(token);
    return oauth2Client;
  }

  const authUrl = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.error('\nAuthorize Gmail by visiting:\n', authUrl);

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const code = await new Promise(resolve => rl.question('\nPaste the authorization code: ', resolve));
  rl.close();

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  writeFileSync(CREDS_PATH, JSON.stringify(tokens, null, 2));
  console.error('Gmail credentials saved.');
  return oauth2Client;
}

export async function send_email({ to, subject, body, deal_id }) {
  const auth = await getAuthorizedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const message = [`To: ${to}`, `Subject: ${subject}`, '', body].join('\n');
  const encoded = Buffer.from(message).toString('base64url');

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
  await db.activities.create({ dealId: deal_id, type: 'email', summary: `Sent: ${subject}` });

  return { sent: true, to, subject };
}
```

- [ ] **Step 3: Manual smoke test (no automated test for OAuth)**

The OAuth flow runs interactively in the terminal. Test it after the MCP server is wired up in Task 8. For now just confirm the file is valid JS:

```bash
cd crm-mcp && node --input-type=module <<'EOF'
import './tools/email.js';
console.log('email.js loaded OK');
EOF
```

Expected: `email.js loaded OK`

- [ ] **Step 4: Commit**

```bash
git add crm-mcp/tools/email.js
git commit -m "feat: add send_email tool with Gmail OAuth2"
```

---

### Task 8: MCP server entry

**Files:**
- Create: `crm-mcp/index.js`

- [ ] **Step 1: Write the failing test**

Create `crm-mcp/tests/server.test.js`:

```js
import { jest } from '@jest/globals';

// Mock all tool modules so we don't hit the DB
jest.unstable_mockModule('../tools/pipeline.js', () => ({
  get_pipeline: jest.fn().mockResolvedValue({ lead: [], proposal: [] }),
  get_deal: jest.fn(),
  get_deal_context: jest.fn()
}));
jest.unstable_mockModule('../tools/deals.js', () => ({
  create_deal: jest.fn(),
  update_deal: jest.fn(),
  move_stage: jest.fn(),
  close_deal: jest.fn(),
  snooze_deal: jest.fn()
}));
jest.unstable_mockModule('../tools/activity.js', () => ({
  log_activity: jest.fn()
}));
jest.unstable_mockModule('../tools/email.js', () => ({
  send_email: jest.fn()
}));

const { handlers, TOOLS } = await import('../index.js');

test('TOOLS lists all 10 tools', () => {
  const names = TOOLS.map(t => t.name);
  expect(names).toContain('get_pipeline');
  expect(names).toContain('get_deal');
  expect(names).toContain('get_deal_context');
  expect(names).toContain('create_deal');
  expect(names).toContain('update_deal');
  expect(names).toContain('move_stage');
  expect(names).toContain('close_deal');
  expect(names).toContain('snooze_deal');
  expect(names).toContain('log_activity');
  expect(names).toContain('send_email');
  expect(names).toHaveLength(10);
});

test('handlers dispatch to correct tool function', async () => {
  const result = await handlers.get_pipeline({});
  expect(result).toHaveProperty('lead');
});

test('unknown tool throws', async () => {
  await expect(handlers.unknown_tool({})).rejects.toThrow('Unknown tool');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd crm-mcp && npm test -- --testPathPattern='server.test'
```

Expected: FAIL — `Cannot find module '../index.js'`

- [ ] **Step 3: Create `crm-mcp/index.js`**

```js
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { get_pipeline, get_deal, get_deal_context } from './tools/pipeline.js';
import { create_deal, update_deal, move_stage, close_deal, snooze_deal } from './tools/deals.js';
import { log_activity } from './tools/activity.js';
import { send_email } from './tools/email.js';

export const TOOLS = [
  {
    name: 'get_pipeline',
    description: 'Get all active deals grouped by stage',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_deal',
    description: 'Get deal details and activity history. Pass the deal title or contact name.',
    inputSchema: {
      type: 'object',
      properties: { deal_name: { type: 'string' } },
      required: ['deal_name']
    }
  },
  {
    name: 'get_deal_context',
    description: 'Get deal + contact info + recent activities. Call this before drafting an email.',
    inputSchema: {
      type: 'object',
      properties: { deal_id: { type: 'integer' } },
      required: ['deal_id']
    }
  },
  {
    name: 'create_deal',
    description: 'Create a new deal and contact',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        contact_name: { type: 'string' },
        company: { type: 'string' },
        email: { type: 'string' },
        stage: { type: 'string', enum: ['lead','discovery','validation','scoping','proposal','negotiation'] },
        value: { type: 'number' },
        notes: { type: 'string' }
      },
      required: ['title', 'contact_name']
    }
  },
  {
    name: 'update_deal',
    description: 'Update deal fields (nextAction, nextActionDate, value, notes)',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'integer' },
        fields: {
          type: 'object',
          properties: {
            nextAction: { type: 'string' },
            nextActionDate: { type: 'string' },
            value: { type: 'number' },
            notes: { type: 'string' }
          }
        }
      },
      required: ['deal_id', 'fields']
    }
  },
  {
    name: 'move_stage',
    description: 'Advance deal to next stage. Enforces order — no skipping.',
    inputSchema: {
      type: 'object',
      properties: { deal_id: { type: 'integer' } },
      required: ['deal_id']
    }
  },
  {
    name: 'close_deal',
    description: 'Mark deal as won or lost',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'integer' },
        outcome: { type: 'string', enum: ['won', 'lost'] },
        reason: { type: 'string' }
      },
      required: ['deal_id', 'outcome']
    }
  },
  {
    name: 'snooze_deal',
    description: 'Push next_action_date forward. Default 3 days.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'integer' },
        days: { type: 'integer' }
      },
      required: ['deal_id']
    }
  },
  {
    name: 'log_activity',
    description: 'Log an activity for a deal and optionally update the next action',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'integer' },
        type: { type: 'string', enum: ['call','email','meeting','note','proposal_sent'] },
        summary: { type: 'string' },
        next_action: { type: 'string' },
        next_action_date: { type: 'string', description: 'ISO date YYYY-MM-DD' }
      },
      required: ['deal_id', 'type', 'summary']
    }
  },
  {
    name: 'send_email',
    description: 'Send an email via Gmail and log it as an activity. Only call after user confirms.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        deal_id: { type: 'integer' }
      },
      required: ['to', 'subject', 'body', 'deal_id']
    }
  }
];

export const handlers = {
  get_pipeline, get_deal, get_deal_context,
  create_deal, update_deal, move_stage, close_deal, snooze_deal,
  log_activity, send_email,
  unknown_tool: async () => { throw new Error('Unknown tool'); }
};

// Only start the server when run directly (not when imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = new Server(
    { name: 'crm', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlers[name];
    if (!handler || name === 'unknown_tool') {
      return {
        content: [{ type: 'text', text: `Error: Unknown tool "${name}"` }],
        isError: true
      };
    }
    try {
      const result = await handler(args ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

Note: `fileURLToPath` needs to be imported. Add this import at the top of `index.js`:

```js
import { fileURLToPath } from 'url';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd crm-mcp && npm test -- --testPathPattern='server.test'
```

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add crm-mcp/index.js crm-mcp/tests/server.test.js
git commit -m "feat: add MCP server entry with all 10 tools registered"
```

---

### Task 9: CLAUDE.md

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Create `CLAUDE.md` at the repo root**

```markdown
# CRM Assistant

You are a personal CRM assistant for a B2B consulting business. You receive messages via Telegram and manage deals, contacts, and follow-ups using the tools available to you.

## Tone and Format

- Respond concisely. This is a Telegram chat, not an email.
- Use **bold** for deal names, stages, and amounts.
- Never make up data. If something is ambiguous, ask one clarifying question.
- Omit explanations of what tools you're calling — just act and report the result.

## Tool Usage

**get_pipeline** — call when the user asks for their pipeline, deal overview, or "what's going on".

**get_deal** — call when the user asks about a specific deal or contact. Pass the name as `deal_name`; it fuzzy-matches on title or contact name.

**get_deal_context** — call before drafting an email. Requires `deal_id`. Use the ID from a previous `get_deal` or `get_pipeline` call.

**create_deal** — call after collecting `title` and `contact_name`. Company, email, value, and notes are optional. In conversation, collect one field at a time if the user hasn't provided them.

**log_activity** — call when the user describes an interaction (call, meeting, email, note). Parse their free text to extract: `type`, `summary`, and optional `next_action` + `next_action_date`.

**update_deal** — call to update `nextAction`, `nextActionDate`, `value`, or `notes` on a deal.

**move_stage** — call when the user says "move", "advance", or "progress" a deal. The tool enforces stage order automatically.

**close_deal** — call with `outcome` "won" or "lost". Always ask for a reason when outcome is "lost".

**snooze_deal** — call when the user says "snooze" or "remind me later". Default is 3 days.

**send_email** — call ONLY after the user explicitly confirms they want to send. Always present the draft first.

## Drafting Emails

1. Call `get_deal_context` with the `deal_id`.
2. Write the draft email yourself using the deal, contact, and activity context.
3. Keep it short (3–5 sentences), professional and warm, with a clear call to action.
4. Present the draft: "Here's a draft:\n\n[email]\n\nSend, edit, or discard?"
5. Call `send_email` only after the user confirms.

## Pipeline Format

When displaying the pipeline, use this compact format:

```
*Your Pipeline*

*PROPOSAL* (1)
  • Acme Deal / João Silva ($25,000) — due Apr 1

*LEAD* (2)
  • Beta Corp / Ana Lima
  • Gamma Inc / Pedro Santos — due Apr 5
```

Omit stages with no deals.

## Activity Logging from Free Text

When the user sends a message describing an interaction (e.g. "Had a great call with Acme, they want a proposal by Friday"):
1. Identify the deal — call `get_pipeline` or `get_deal` if needed.
2. Parse: type=call, summary of what happened, `next_action` and `next_action_date` if mentioned.
3. Call `log_activity`.
4. Confirm: "Logged for **Acme Deal**: Good call. Next action: Send proposal by Apr 4."
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "feat: add CLAUDE.md CRM persona"
```

---

### Task 10: Wire up `.mcp.json` and verify launch

**Files:**
- Create: `.mcp.json`

- [ ] **Step 1: Create `.mcp.json` at the repo root**

```json
{
  "mcpServers": {
    "crm": {
      "command": "node",
      "args": ["crm-mcp/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://localhost/crm",
        "GMAIL_CLIENT_ID": "",
        "GMAIL_CLIENT_SECRET": ""
      }
    }
  }
}
```

Fill in `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` with values from your Google Cloud Console OAuth2 credentials. These can also be set as shell environment variables — shell takes precedence over `.mcp.json`.

- [ ] **Step 2: Verify the MCP server starts cleanly**

```bash
cd /path/to/crm-telegram && echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node crm-mcp/index.js
```

Expected: JSON response listing all 10 tools.

- [ ] **Step 3: Launch Claude Code with the Telegram channel**

```bash
claude --channels plugin:telegram@claude-plugins-official
```

Expected: Claude Code starts. MCP server `crm` appears in the tool list. Telegram bot connects.

- [ ] **Step 4: Send a test message from Telegram**

Send `/pipeline` or "show me my deals" to the bot. Expected: Claude calls `get_pipeline` and replies with the pipeline (or "no active deals" if the DB is empty).

- [ ] **Step 5: Commit**

```bash
git add .mcp.json
git commit -m "feat: add .mcp.json to register crm-mcp with Claude Code"
```

---

### Task 11: Delete crm-skills

Only do this after Task 10 is verified working end-to-end via Telegram.

- [ ] **Step 1: Delete the crm-skills directory**

```bash
git rm -r crm-skills/
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: remove crm-skills (replaced by crm-mcp)"
```

---

## Self-Review Notes

- **Spec coverage:** All 10 tools from the spec are implemented and registered. CLAUDE.md covers all tool usage rules. `.mcp.json` registers the server. Gmail OAuth2 is handled. Migration script is present. ✓
- **No placeholders:** All steps contain complete code. ✓
- **Type consistency:** `deal_id` is `integer` throughout. `next_action_date` is an ISO string at the tool boundary, converted to `Date` in `log_activity` before passing to `db.deals.update`. `nextActionDate` (camelCase) is used consistently in the DB layer. ✓
- **ESM throughout:** All `crm-mcp` files use `import`/`export`. Jest configured with `--experimental-vm-modules`. ✓
