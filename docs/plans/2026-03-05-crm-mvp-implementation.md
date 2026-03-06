# CRM MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Telegram-first personal CRM on a Hetzner VPS using OpenClaw skills, PostgreSQL, and Claude API to eliminate missed follow-ups in a B2B consulting pipeline.

**Architecture:** OpenClaw agent runs as a systemd service on Hetzner CAX11. Custom skills handle CRM logic (CRUD, reminders, email drafting, NLP logging). PostgreSQL stores all data locally. Telegram is the only user interface.

**Tech Stack:** OpenClaw (Node.js), PostgreSQL 16, node-postgres (`pg`), Anthropic SDK (`@anthropic-ai/sdk`), Google APIs (`googleapis`), Jest (testing), Ubuntu 24.04, Hetzner CAX11

**Reference design:** `docs/plans/2026-03-05-crm-mvp-design.md`

---

## Phase 0: Server & Base Setup

### Task 0.1: Provision Hetzner VPS

**No code — infrastructure only.**

**Step 1: Create Hetzner account and server**

- Go to console.hetzner.cloud
- Create project: `crm-mvp`
- Add server: Type `CAX11` (ARM64, 2 vCPU, 4GB RAM), OS `Ubuntu 24.04`, location `Nuremberg` or `Helsinki`
- Add your SSH public key during creation
- Note the server IP (referred to as `$SERVER_IP` below)

**Step 2: SSH in and harden**

```bash
ssh root@$SERVER_IP

# Create non-root user
adduser crm
usermod -aG sudo crm

# Copy SSH key to new user
rsync --archive --chown=crm:crm ~/.ssh /home/crm/

# Disable password auth and root login
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart sshd
```

**Step 3: Reconnect as crm user and update system**

```bash
ssh crm@$SERVER_IP
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential
```

---

### Task 0.2: Install Node.js and PostgreSQL

**Step 1: Install Node.js 22 via nvm**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
node --version  # should print v22.x.x
```

**Step 2: Install PostgreSQL 16**

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

**Step 3: Create database and user**

```bash
sudo -u postgres psql <<'SQL'
CREATE USER crm_user WITH PASSWORD 'change_this_strong_password';
CREATE DATABASE crm_db OWNER crm_user;
GRANT ALL PRIVILEGES ON DATABASE crm_db TO crm_user;
SQL
```

**Step 4: Verify connection**

```bash
psql -U crm_user -d crm_db -h localhost -c "SELECT version();"
# Expected: PostgreSQL 16.x ...
```

---

### Task 0.3: Install OpenClaw

**Step 1: Follow OpenClaw installation**

```bash
# Check https://openclaw.ai for current install instructions
# Typical pattern:
npm install -g openclaw
openclaw --version
```

**Step 2: Initialize OpenClaw**

```bash
openclaw init
# Follow prompts: set Telegram bot token, Claude API key
```

**Step 3: Configure Claude API key**

- Get API key from console.anthropic.com
- Set in OpenClaw config: model = `claude-sonnet-4-6`

**Step 4: Configure Telegram bot**

- Message @BotFather on Telegram: `/newbot`
- Name it e.g. `MyConsultingCRM` / username `my_crm_bot`
- Copy the bot token into OpenClaw config
- Whitelist your Telegram user ID in OpenClaw config (find your ID via @userinfobot)

**Step 5: Test OpenClaw is running**

```bash
openclaw start
# Send "hello" to your bot on Telegram
# Expected: OpenClaw responds
openclaw stop
```

---

### Task 0.4: Initialize project structure

**Step 1: Create skill directories**

```bash
mkdir -p ~/crm-skills/{crm-core,crm-pipeline,crm-remind,crm-log,crm-draft,crm-calendar}
mkdir -p ~/crm-skills/crm-core/{src,tests}
mkdir -p ~/crm-skills/crm-pipeline/{src,tests}
mkdir -p ~/crm-skills/crm-remind/{src,tests}
mkdir -p ~/crm-skills/crm-log/{src,tests}
mkdir -p ~/crm-skills/crm-draft/{src,tests}
mkdir -p ~/crm-skills/crm-calendar/{src,tests}
```

**Step 2: Create root package.json for shared deps**

```bash
cd ~/crm-skills
cat > package.json <<'EOF'
{
  "name": "crm-skills",
  "version": "1.0.0",
  "private": true,
  "workspaces": ["crm-*"],
  "devDependencies": {
    "jest": "^29.0.0"
  }
}
EOF
npm install
```

**Step 3: Create shared db client package**

```bash
mkdir -p ~/crm-skills/crm-db/src
cat > ~/crm-skills/crm-db/package.json <<'EOF'
{
  "name": "crm-db",
  "version": "1.0.0",
  "main": "src/index.js",
  "dependencies": {
    "pg": "^8.11.0"
  }
}
EOF
```

**Step 4: Commit**

```bash
cd ~/crm-skills
git init
git add .
git commit -m "chore: scaffold skill project structure"
```

---

## Phase 1: Database Schema

### Task 1.1: Write and apply schema migrations

**Files:**
- Create: `~/crm-skills/crm-db/src/schema.sql`
- Create: `~/crm-skills/crm-db/src/migrate.js`

**Step 1: Write schema SQL**

```bash
cat > ~/crm-skills/crm-db/src/schema.sql <<'EOF'
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

CREATE TABLE contacts (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  company     TEXT,
  role        TEXT,
  email       TEXT,
  phone       TEXT,
  linkedin_url TEXT,
  source      TEXT CHECK (source IN ('referral', 'cold', 'inbound')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE deals (
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

CREATE TABLE activities (
  id         SERIAL PRIMARY KEY,
  deal_id    INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  type       activity_type NOT NULL,
  summary    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reminders (
  id         SERIAL PRIMARY KEY,
  deal_id    INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  message    TEXT NOT NULL,
  due_at     TIMESTAMPTZ NOT NULL,
  status     reminder_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at on deals
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER deals_updated_at
BEFORE UPDATE ON deals
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EOF
```

**Step 2: Write migrate.js**

```javascript
// ~/crm-skills/crm-db/src/migrate.js
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://crm_user:change_this_strong_password@localhost/crm_db'
});

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Migration complete');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
```

**Step 3: Run migration**

```bash
cd ~/crm-skills/crm-db
npm install
node src/migrate.js
# Expected: Migration complete
```

**Step 4: Verify tables exist**

```bash
psql -U crm_user -d crm_db -h localhost -c "\dt"
# Expected: contacts, deals, activities, reminders
```

**Step 5: Commit**

```bash
git add crm-db/
git commit -m "feat: add database schema with all CRM tables"
```

---

## Phase 2: crm-core Skill (Database CRUD)

### Task 2.1: Create db client module

**Files:**
- Create: `~/crm-skills/crm-db/src/index.js`
- Create: `~/crm-skills/crm-db/tests/db.test.js`

**Step 1: Write failing test**

```javascript
// ~/crm-skills/crm-db/tests/db.test.js
const db = require('../src/index');

afterAll(() => db.end());

describe('contacts', () => {
  test('creates and retrieves a contact', async () => {
    const contact = await db.contacts.create({
      name: 'Test Person',
      company: 'Acme Corp',
      email: 'test@acme.com',
      source: 'referral'
    });
    expect(contact.id).toBeDefined();
    expect(contact.name).toBe('Test Person');

    const found = await db.contacts.findById(contact.id);
    expect(found.company).toBe('Acme Corp');

    await db.contacts.delete(contact.id);
  });
});

describe('deals', () => {
  let contactId;

  beforeAll(async () => {
    const c = await db.contacts.create({ name: 'Deal Contact', source: 'cold' });
    contactId = c.id;
  });

  afterAll(async () => {
    await db.contacts.delete(contactId);
  });

  test('creates deal with default stage lead', async () => {
    const deal = await db.deals.create({
      contactId,
      title: 'Test Deal',
      value: 10000
    });
    expect(deal.stage).toBe('lead');
    expect(deal.value).toBe('10000.00');
    await db.deals.delete(deal.id);
  });

  test('updates next_action and next_action_date', async () => {
    const deal = await db.deals.create({ contactId, title: 'Follow-up Deal' });
    const date = new Date('2026-03-10T09:00:00Z');
    const updated = await db.deals.update(deal.id, {
      nextAction: 'Send proposal',
      nextActionDate: date
    });
    expect(updated.next_action).toBe('Send proposal');
    await db.deals.delete(deal.id);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd ~/crm-skills
npx jest crm-db/tests/db.test.js -v
# Expected: FAIL - Cannot find module '../src/index'
```

**Step 3: Implement db client**

```javascript
// ~/crm-skills/crm-db/src/index.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://crm_user:change_this_strong_password@localhost/crm_db'
});

const contacts = {
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

const deals = {
  async create({ contactId, title, value, notes }) {
    const { rows } = await pool.query(
      `INSERT INTO deals (contact_id, title, value, notes)
       VALUES ($1,$2,$3,$4) RETURNING *`,
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
      `SELECT d.*, c.name as contact_name, c.company
       FROM deals d JOIN contacts c ON c.id = d.contact_id
       ${conditions}
       ORDER BY d.next_action_date NULLS LAST, d.created_at`,
      params
    );
    return rows;
  },
  async update(id, { stage, nextAction, nextActionDate, value, notes }) {
    const { rows } = await pool.query(
      `UPDATE deals SET
         stage = COALESCE($2, stage),
         next_action = COALESCE($3, next_action),
         next_action_date = COALESCE($4, next_action_date),
         value = COALESCE($5, value),
         notes = COALESCE($6, notes)
       WHERE id=$1 RETURNING *`,
      [id, stage, nextAction, nextActionDate, value, notes]
    );
    return rows[0];
  },
  async findStale(daysSinceActivity = 14) {
    const { rows } = await pool.query(
      `SELECT d.*, c.name as contact_name
       FROM deals d JOIN contacts c ON c.id = d.contact_id
       WHERE d.stage NOT IN ('closed_won','closed_lost')
         AND (
           SELECT MAX(a.created_at) FROM activities a WHERE a.deal_id = d.id
         ) < NOW() - INTERVAL '1 day' * $1
       ORDER BY d.updated_at`,
      [daysSinceActivity]
    );
    return rows;
  },
  async findDueForFollowUp() {
    const { rows } = await pool.query(
      `SELECT d.*, c.name as contact_name, c.email
       FROM deals d JOIN contacts c ON c.id = d.contact_id
       WHERE d.next_action_date <= NOW()
         AND d.stage NOT IN ('closed_won','closed_lost')
       ORDER BY d.next_action_date`
    );
    return rows;
  },
  async delete(id) {
    await pool.query('DELETE FROM deals WHERE id=$1', [id]);
  }
};

const activities = {
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

const reminders = {
  async create({ dealId, message, dueAt }) {
    const { rows } = await pool.query(
      `INSERT INTO reminders (deal_id, message, due_at) VALUES ($1,$2,$3) RETURNING *`,
      [dealId, message, dueAt]
    );
    return rows[0];
  },
  async findPending() {
    const { rows } = await pool.query(
      `SELECT r.*, d.title as deal_title, c.name as contact_name
       FROM reminders r
       JOIN deals d ON d.id = r.deal_id
       JOIN contacts c ON c.id = d.contact_id
       WHERE r.status = 'pending' AND r.due_at <= NOW()
       ORDER BY r.due_at`
    );
    return rows;
  },
  async updateStatus(id, status) {
    await pool.query('UPDATE reminders SET status=$2 WHERE id=$1', [id, status]);
  }
};

module.exports = { contacts, deals, activities, reminders, end: () => pool.end() };
```

**Step 4: Run tests to verify they pass**

```bash
DATABASE_URL=postgresql://crm_user:change_this_strong_password@localhost/crm_db \
  npx jest crm-db/tests/db.test.js -v
# Expected: PASS (3 tests)
```

**Step 5: Commit**

```bash
git add crm-db/
git commit -m "feat: add crm-db client with contacts, deals, activities, reminders"
```

---

## Phase 3: crm-core OpenClaw Skill

### Task 3.1: Scaffold crm-core skill

**Files:**
- Create: `~/crm-skills/crm-core/package.json`
- Create: `~/crm-skills/crm-core/src/index.js`
- Create: `~/crm-skills/crm-core/tests/core.test.js`

**Step 1: Check OpenClaw skill API**

```bash
openclaw skill --help
# Read the output to understand the skill registration format
# Also check: ls ~/.openclaw/skills/ for example skill structure
```

**Step 2: Create package.json**

```json
{
  "name": "crm-core",
  "version": "1.0.0",
  "main": "src/index.js",
  "dependencies": {
    "crm-db": "*"
  }
}
```

**Step 3: Write failing test for add_deal command**

```javascript
// ~/crm-skills/crm-core/tests/core.test.js
const { handleCommand } = require('../src/index');
const db = require('crm-db');

afterAll(() => db.end());

test('add_deal creates contact and deal', async () => {
  const result = await handleCommand('add_deal', {
    contactName: 'Jane Smith',
    company: 'Beta Corp',
    email: 'jane@beta.com',
    source: 'referral',
    title: 'Beta Corp Consulting',
    value: 25000
  });
  expect(result.deal.title).toBe('Beta Corp Consulting');
  expect(result.deal.stage).toBe('lead');
  expect(result.contact.name).toBe('Jane Smith');

  // cleanup
  await db.deals.delete(result.deal.id);
  await db.contacts.delete(result.contact.id);
});

test('get_pipeline returns deals grouped by stage', async () => {
  const result = await handleCommand('get_pipeline', {});
  expect(result).toHaveProperty('lead');
  expect(Array.isArray(result.lead)).toBe(true);
});
```

**Step 4: Run test to verify it fails**

```bash
npx jest crm-core/tests/core.test.js -v
# Expected: FAIL - Cannot find module '../src/index'
```

**Step 5: Implement core command handler**

```javascript
// ~/crm-skills/crm-core/src/index.js
const db = require('crm-db');

const STAGES = ['lead','discovery','validation','scoping','proposal','negotiation','closed_won','closed_lost'];

async function handleCommand(command, args) {
  switch (command) {
    case 'add_deal': {
      const contact = await db.contacts.create({
        name: args.contactName,
        company: args.company,
        email: args.email,
        source: args.source || 'cold'
      });
      const deal = await db.deals.create({
        contactId: contact.id,
        title: args.title,
        value: args.value
      });
      return { contact, deal };
    }

    case 'get_pipeline': {
      const deals = await db.deals.findAll();
      const grouped = Object.fromEntries(STAGES.map(s => [s, []]));
      for (const deal of deals) {
        if (grouped[deal.stage]) grouped[deal.stage].push(deal);
      }
      return grouped;
    }

    case 'get_deal': {
      const deal = await db.deals.findById(args.dealId);
      if (!deal) throw new Error(`Deal not found: ${args.dealId}`);
      const activities = await db.activities.findByDeal(args.dealId);
      return { deal, activities };
    }

    case 'move_stage': {
      const deal = await db.deals.findById(args.dealId);
      if (!deal) throw new Error(`Deal not found: ${args.dealId}`);
      const currentIdx = STAGES.indexOf(deal.stage);
      const nextStage = STAGES[currentIdx + 1];
      if (!nextStage || nextStage.startsWith('closed')) {
        throw new Error(`Cannot advance from ${deal.stage} automatically. Use /won or /lost.`);
      }
      return await db.deals.update(args.dealId, { stage: nextStage });
    }

    case 'set_next_action': {
      return await db.deals.update(args.dealId, {
        nextAction: args.action,
        nextActionDate: args.date ? new Date(args.date) : undefined
      });
    }

    case 'log_activity': {
      return await db.activities.create({
        dealId: args.dealId,
        type: args.type,
        summary: args.summary
      });
    }

    case 'close_deal': {
      const stage = args.outcome === 'won' ? 'closed_won' : 'closed_lost';
      const deal = await db.deals.update(args.dealId, { stage });
      if (args.reason) {
        await db.activities.create({
          dealId: args.dealId,
          type: 'note',
          summary: `Closed ${args.outcome}: ${args.reason}`
        });
      }
      return deal;
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

module.exports = { handleCommand, STAGES };
```

**Step 6: Run tests to verify they pass**

```bash
DATABASE_URL=postgresql://crm_user:change_this_strong_password@localhost/crm_db \
  npx jest crm-core/tests/core.test.js -v
# Expected: PASS (2 tests)
```

**Step 7: Commit**

```bash
git add crm-core/
git commit -m "feat: add crm-core skill with deal/pipeline commands"
```

---

## Phase 4: crm-pipeline Skill (Telegram Command Formatters)

### Task 4.1: Format pipeline and deal views for Telegram

**Files:**
- Create: `~/crm-skills/crm-pipeline/src/format.js`
- Create: `~/crm-skills/crm-pipeline/tests/format.test.js`

**Step 1: Write failing test**

```javascript
// ~/crm-skills/crm-pipeline/tests/format.test.js
const { formatPipeline, formatDeal } = require('../src/format');

const mockPipeline = {
  lead: [{ title: 'Acme Deal', contact_name: 'John', next_action_date: null, value: '5000.00' }],
  discovery: [],
  validation: [],
  scoping: [],
  proposal: [{ title: 'Beta Corp', contact_name: 'Jane', next_action_date: new Date('2026-03-10'), value: '25000.00' }],
  negotiation: [],
  closed_won: [],
  closed_lost: []
};

test('formatPipeline renders non-empty stages only', () => {
  const text = formatPipeline(mockPipeline);
  expect(text).toContain('LEAD');
  expect(text).toContain('Acme Deal');
  expect(text).toContain('PROPOSAL');
  expect(text).toContain('Beta Corp');
  expect(text).not.toContain('DISCOVERY');
});

test('formatDeal renders deal details with activities', () => {
  const deal = { id: 1, title: 'Test Deal', stage: 'proposal', contact_name: 'Alice', company: 'Corp', next_action: 'Send proposal', next_action_date: new Date('2026-03-15'), value: '10000.00' };
  const activities = [{ type: 'call', summary: 'Intro call', created_at: new Date('2026-03-01') }];
  const text = formatDeal(deal, activities);
  expect(text).toContain('Test Deal');
  expect(text).toContain('proposal');
  expect(text).toContain('Send proposal');
  expect(text).toContain('Intro call');
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest crm-pipeline/tests/format.test.js -v
# Expected: FAIL
```

**Step 3: Implement formatters**

```javascript
// ~/crm-skills/crm-pipeline/src/format.js
const STAGES = ['lead','discovery','validation','scoping','proposal','negotiation','closed_won','closed_lost'];

const STAGE_LABELS = {
  lead: 'LEAD', discovery: 'DISCOVERY', validation: 'VALIDATION',
  scoping: 'SCOPING', proposal: 'PROPOSAL', negotiation: 'NEGOTIATION',
  closed_won: 'CLOSED WON', closed_lost: 'CLOSED LOST'
};

function formatMoney(val) {
  if (!val) return '';
  return ` ($${Number(val).toLocaleString()})`;
}

function formatDate(d) {
  if (!d) return 'no date set';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatPipeline(grouped) {
  const lines = ['*Your Pipeline*\n'];
  for (const stage of STAGES) {
    const deals = grouped[stage] || [];
    if (deals.length === 0) continue;
    lines.push(`*${STAGE_LABELS[stage]}* (${deals.length})`);
    for (const d of deals) {
      const due = d.next_action_date ? ` — due ${formatDate(d.next_action_date)}` : '';
      lines.push(`  • ${d.title} / ${d.contact_name}${formatMoney(d.value)}${due}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function formatDeal(deal, activities = []) {
  const lines = [
    `*${deal.title}*`,
    `Contact: ${deal.contact_name}${deal.company ? ' @ ' + deal.company : ''}`,
    `Stage: ${STAGE_LABELS[deal.stage] || deal.stage}`,
    deal.value ? `Value: $${Number(deal.value).toLocaleString()}` : null,
    '',
    `*Next action:* ${deal.next_action || 'None set'}`,
    `*Due:* ${formatDate(deal.next_action_date)}`,
    deal.notes ? `\n*Notes:* ${deal.notes}` : null,
    '',
    `*Activity (last ${Math.min(activities.length, 5)}):*`
  ].filter(Boolean);

  for (const a of activities.slice(0, 5)) {
    lines.push(`  [${formatDate(a.created_at)}] ${a.type}: ${a.summary}`);
  }

  return lines.join('\n');
}

module.exports = { formatPipeline, formatDeal };
```

**Step 4: Run tests to verify they pass**

```bash
npx jest crm-pipeline/tests/format.test.js -v
# Expected: PASS (2 tests)
```

**Step 5: Commit**

```bash
git add crm-pipeline/
git commit -m "feat: add pipeline and deal Telegram formatters"
```

---

## Phase 5: crm-remind Skill (Scheduler)

### Task 5.1: Build reminder checker

**Files:**
- Create: `~/crm-skills/crm-remind/src/checker.js`
- Create: `~/crm-skills/crm-remind/tests/checker.test.js`

**Step 1: Write failing test**

```javascript
// ~/crm-skills/crm-remind/tests/checker.test.js
const { buildReminderMessages } = require('../src/checker');

test('builds due follow-up messages', () => {
  const dueDeals = [
    { id: 1, title: 'Acme Deal', contact_name: 'John', next_action: 'Send proposal', next_action_date: new Date() }
  ];
  const messages = buildReminderMessages(dueDeals, []);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('Acme Deal');
  expect(messages[0]).toContain('Send proposal');
});

test('builds stale deal messages', () => {
  const staleDeals = [
    { id: 2, title: 'Old Deal', contact_name: 'Jane', stage: 'scoping' }
  ];
  const messages = buildReminderMessages([], staleDeals);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain('Old Deal');
  expect(messages[0]).toContain('stale');
});

test('returns empty array when nothing is due', () => {
  expect(buildReminderMessages([], [])).toEqual([]);
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest crm-remind/tests/checker.test.js -v
# Expected: FAIL
```

**Step 3: Implement checker**

```javascript
// ~/crm-skills/crm-remind/src/checker.js
function buildReminderMessages(dueDeals, staleDeals) {
  const messages = [];

  for (const deal of dueDeals) {
    messages.push(
      `FOLLOW-UP DUE: *${deal.title}* (${deal.contact_name})\n` +
      `Action: ${deal.next_action || 'Check in'}\n` +
      `Reply /deal ${deal.id} for details or /snooze ${deal.id} to push it out.`
    );
  }

  for (const deal of staleDeals) {
    messages.push(
      `STALE DEAL: *${deal.title}* (${deal.contact_name}) is stale — no activity in 14+ days.\n` +
      `Stage: ${deal.stage}\n` +
      `Reply /deal ${deal.id} to review.`
    );
  }

  return messages;
}

function buildMorningDigest(dueDeals, staleDeals) {
  if (dueDeals.length === 0 && staleDeals.length === 0) {
    return 'Good morning! No follow-ups due today.';
  }
  const lines = ['*Good morning! Here is your CRM digest:*\n'];
  if (dueDeals.length > 0) {
    lines.push(`*Follow-ups due today (${dueDeals.length}):*`);
    for (const d of dueDeals) {
      lines.push(`  • ${d.title} / ${d.contact_name}: ${d.next_action || 'Check in'}`);
    }
  }
  if (staleDeals.length > 0) {
    lines.push(`\n*Stale deals (${staleDeals.length}) — no activity in 14+ days:*`);
    for (const d of staleDeals) {
      lines.push(`  • ${d.title} / ${d.contact_name} (${d.stage})`);
    }
  }
  return lines.join('\n');
}

module.exports = { buildReminderMessages, buildMorningDigest };
```

**Step 4: Run tests to verify they pass**

```bash
npx jest crm-remind/tests/checker.test.js -v
# Expected: PASS (3 tests)
```

**Step 5: Write the scheduler runner**

```javascript
// ~/crm-skills/crm-remind/src/scheduler.js
// This file is called by OpenClaw on a schedule (every 15 min)
const db = require('crm-db');
const { buildReminderMessages, buildMorningDigest } = require('./checker');

async function runCheck(sendMessage) {
  const dueDeals = await db.deals.findDueForFollowUp();
  const staleDeals = await db.deals.findStale(14);
  const messages = buildReminderMessages(dueDeals, staleDeals);
  for (const msg of messages) {
    await sendMessage(msg);
  }
}

async function runMorningDigest(sendMessage) {
  const dueDeals = await db.deals.findDueForFollowUp();
  const staleDeals = await db.deals.findStale(14);
  await sendMessage(buildMorningDigest(dueDeals, staleDeals));
}

module.exports = { runCheck, runMorningDigest };
```

**Step 6: Commit**

```bash
git add crm-remind/
git commit -m "feat: add reminder checker and morning digest scheduler"
```

---

## Phase 6: crm-log Skill (NLP Activity Logging)

### Task 6.1: Build NLP parser for activity logs

**Files:**
- Create: `~/crm-skills/crm-log/src/parser.js`
- Create: `~/crm-skills/crm-log/tests/parser.test.js`

**Step 1: Write failing test**

```javascript
// ~/crm-skills/crm-log/tests/parser.test.js
const { parseActivityLog } = require('../src/parser');

// Mock Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => ({
  Anthropic: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ text: JSON.stringify({
          type: 'call',
          summary: 'Discovery call went well. Client interested.',
          next_action: 'Send proposal',
          next_action_date: '2026-03-15'
        })}]
      })
    }
  }))
}));

test('parses natural language into structured activity', async () => {
  const result = await parseActivityLog(
    'Had a great call with John today, discovery went well, he wants a proposal by March 15',
    { dealTitle: 'Acme Deal', contactName: 'John Smith' }
  );
  expect(result.type).toBe('call');
  expect(result.summary).toBeDefined();
  expect(result.next_action).toBe('Send proposal');
  expect(result.next_action_date).toBe('2026-03-15');
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest crm-log/tests/parser.test.js -v
# Expected: FAIL
```

**Step 3: Implement parser**

```javascript
// ~/crm-skills/crm-log/src/parser.js
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic.Anthropic();

async function parseActivityLog(text, context) {
  const today = new Date().toISOString().split('T')[0];
  const prompt = `You are a CRM assistant. Parse this activity note into structured data.

Deal: ${context.dealTitle}
Contact: ${context.contactName}
Today's date: ${today}

User note: "${text}"

Respond ONLY with a JSON object (no markdown) with these fields:
- type: one of "call", "email", "meeting", "note", "proposal_sent"
- summary: 1-2 sentence summary of what happened
- next_action: what the user should do next (string or null)
- next_action_date: ISO date string YYYY-MM-DD for when to follow up (or null)`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }]
  });

  return JSON.parse(response.content[0].text);
}

module.exports = { parseActivityLog };
```

**Step 4: Add package.json**

```json
{
  "name": "crm-log",
  "version": "1.0.0",
  "main": "src/index.js",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.36.0",
    "crm-db": "*"
  }
}
```

**Step 5: Run tests to verify they pass**

```bash
npx jest crm-log/tests/parser.test.js -v
# Expected: PASS (1 test)
```

**Step 6: Write index.js that wires parser to db**

```javascript
// ~/crm-skills/crm-log/src/index.js
const db = require('crm-db');
const { parseActivityLog } = require('./parser');

async function logActivity(dealId, userText) {
  const deal = await db.deals.findById(dealId);
  if (!deal) throw new Error(`Deal not found: ${dealId}`);

  const parsed = await parseActivityLog(userText, {
    dealTitle: deal.title,
    contactName: deal.contact_name
  });

  const activity = await db.activities.create({
    dealId,
    type: parsed.type,
    summary: parsed.summary
  });

  if (parsed.next_action) {
    await db.deals.update(dealId, {
      nextAction: parsed.next_action,
      nextActionDate: parsed.next_action_date ? new Date(parsed.next_action_date) : undefined
    });
  }

  return { activity, parsed };
}

module.exports = { logActivity };
```

**Step 7: Commit**

```bash
git add crm-log/
git commit -m "feat: add NLP activity log parser using Claude"
```

---

## Phase 7: crm-draft Skill (Email Drafting)

### Task 7.1: Build email draft generator

**Files:**
- Create: `~/crm-skills/crm-draft/src/drafter.js`
- Create: `~/crm-skills/crm-draft/tests/drafter.test.js`

**Step 1: Write failing test**

```javascript
// ~/crm-skills/crm-draft/tests/drafter.test.js
const { draftFollowUp } = require('../src/drafter');

jest.mock('@anthropic-ai/sdk', () => ({
  Anthropic: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ text: JSON.stringify({
          subject: 'Following up on our conversation',
          body: 'Hi John,\n\nThank you for the call...\n\nBest regards'
        })}]
      })
    }
  }))
}));

test('drafts email from deal context', async () => {
  const deal = {
    title: 'Acme Deal',
    stage: 'proposal',
    contact_name: 'John Smith',
    email: 'john@acme.com',
    next_action: 'Send proposal follow-up'
  };
  const activities = [
    { type: 'call', summary: 'Discovery call, John interested in automation project', created_at: new Date() }
  ];

  const draft = await draftFollowUp(deal, activities);
  expect(draft.subject).toBeDefined();
  expect(draft.body).toContain('John');
  expect(draft.to).toBe('john@acme.com');
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest crm-draft/tests/drafter.test.js -v
# Expected: FAIL
```

**Step 3: Implement drafter**

```javascript
// ~/crm-skills/crm-draft/src/drafter.js
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic.Anthropic();

async function draftFollowUp(deal, activities) {
  const activitySummary = activities
    .slice(0, 5)
    .map(a => `- [${a.type}] ${a.summary}`)
    .join('\n');

  const prompt = `You are a consultant's email assistant. Draft a professional, warm follow-up email.

Deal: ${deal.title}
Contact: ${deal.contact_name} <${deal.email}>
Current stage: ${deal.stage}
Next action goal: ${deal.next_action || 'Check in and keep momentum'}

Recent activity history:
${activitySummary || 'No prior activity recorded.'}

Instructions:
- Keep it short (3-5 sentences max)
- Professional but warm tone
- Clear call to action matching the next_action goal
- Do NOT use filler phrases like "I hope this email finds you well"

Respond ONLY with JSON (no markdown):
{
  "subject": "email subject line",
  "body": "full email body with greeting and sign-off"
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });

  const draft = JSON.parse(response.content[0].text);
  return { ...draft, to: deal.email, dealId: deal.id };
}

module.exports = { draftFollowUp };
```

**Step 4: Run tests to verify they pass**

```bash
npx jest crm-draft/tests/drafter.test.js -v
# Expected: PASS (1 test)
```

**Step 5: Write the approval flow handler**

```javascript
// ~/crm-skills/crm-draft/src/index.js
const db = require('crm-db');
const { draftFollowUp } = require('./drafter');

// pending drafts stored in memory (keyed by dealId)
// in production, persist to DB if needed
const pendingDrafts = new Map();

async function requestDraft(dealId) {
  const deal = await db.deals.findById(dealId);
  if (!deal) throw new Error(`Deal not found: ${dealId}`);
  const activities = await db.activities.findByDeal(dealId);
  const draft = await draftFollowUp(deal, activities);
  pendingDrafts.set(dealId, draft);
  return draft;
}

function getPendingDraft(dealId) {
  return pendingDrafts.get(dealId) || null;
}

function clearDraft(dealId) {
  pendingDrafts.delete(dealId);
}

module.exports = { requestDraft, getPendingDraft, clearDraft };
```

**Step 6: Commit**

```bash
git add crm-draft/
git commit -m "feat: add email draft generator with approval flow"
```

---

## Phase 8: crm-calendar Skill

### Task 8.1: Build calendar event suggester

**Files:**
- Create: `~/crm-skills/crm-calendar/src/index.js`
- Create: `~/crm-skills/crm-calendar/tests/calendar.test.js`

**Step 1: Write failing test**

```javascript
// ~/crm-skills/crm-calendar/tests/calendar.test.js
const { formatEventSuggestion } = require('../src/index');

test('formats calendar event suggestion message', () => {
  const deal = { id: 1, title: 'Acme Deal', contact_name: 'John', email: 'john@acme.com' };
  const msg = formatEventSuggestion(deal, {
    title: 'Discovery Call - Acme',
    date: '2026-03-10',
    time: '14:00',
    duration: 60
  });
  expect(msg).toContain('Discovery Call - Acme');
  expect(msg).toContain('2026-03-10');
  expect(msg).toContain('john@acme.com');
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest crm-calendar/tests/calendar.test.js -v
# Expected: FAIL
```

**Step 3: Implement calendar helpers**

```javascript
// ~/crm-skills/crm-calendar/src/index.js
const { google } = require('googleapis');

function formatEventSuggestion(deal, event) {
  return (
    `Create calendar event?\n\n` +
    `*${event.title}*\n` +
    `Date: ${event.date} at ${event.time}\n` +
    `Duration: ${event.duration} min\n` +
    `With: ${deal.contact_name} (${deal.email})\n\n` +
    `Reply /confirm_event to create, or /skip_event to skip.`
  );
}

async function createEvent(auth, { title, date, time, duration, contactEmail }) {
  const calendar = google.calendar({ version: 'v3', auth });
  const startDateTime = new Date(`${date}T${time}:00`);
  const endDateTime = new Date(startDateTime.getTime() + duration * 60000);

  const event = {
    summary: title,
    start: { dateTime: startDateTime.toISOString() },
    end: { dateTime: endDateTime.toISOString() },
    attendees: contactEmail ? [{ email: contactEmail }] : []
  };

  const response = await calendar.events.insert({
    calendarId: 'primary',
    resource: event,
    sendUpdates: 'all'
  });

  return response.data;
}

module.exports = { formatEventSuggestion, createEvent };
```

**Step 4: Run tests to verify they pass**

```bash
npx jest crm-calendar/tests/calendar.test.js -v
# Expected: PASS (1 test)
```

**Step 5: Commit**

```bash
git add crm-calendar/
git commit -m "feat: add calendar event suggester and creator"
```

---

## Phase 9: OpenClaw Skill Registration & Telegram Command Wiring

### Task 9.1: Register all skills with OpenClaw and wire Telegram commands

**Files:**
- Create: `~/crm-skills/openclaw-manifest.json`
- Create: `~/crm-skills/main.js` (OpenClaw skill entry point)

**Step 1: Check OpenClaw skill registration docs**

```bash
openclaw skill list
openclaw skill --help
# Read available commands, then follow the actual registration pattern
```

**Step 2: Create main skill entry point**

This is the file OpenClaw calls when commands arrive. Wire all commands here:

```javascript
// ~/crm-skills/main.js
const { handleCommand, STAGES } = require('./crm-core/src/index');
const { formatPipeline, formatDeal } = require('./crm-pipeline/src/format');
const { logActivity } = require('./crm-log/src/index');
const { requestDraft, getPendingDraft, clearDraft } = require('./crm-draft/src/index');
const { runCheck, runMorningDigest } = require('./crm-remind/src/scheduler');
const { formatEventSuggestion } = require('./crm-calendar/src/index');
const db = require('./crm-db/src/index');

// pendingActions tracks state for multi-step commands per user
const pendingActions = new Map();

// OpenClaw calls this with (command, args, sendMessage)
async function onCommand(command, args, sendMessage) {
  try {
    switch (command) {

      case '/pipeline': {
        const grouped = await handleCommand('get_pipeline', {});
        await sendMessage(formatPipeline(grouped));
        break;
      }

      case '/deal': {
        const deals = await db.deals.findAll();
        const query = args.join(' ').toLowerCase();
        const deal = deals.find(d =>
          d.title.toLowerCase().includes(query) ||
          d.contact_name.toLowerCase().includes(query)
        );
        if (!deal) { await sendMessage(`No deal found matching "${args.join(' ')}"`); break; }
        const { activities } = await handleCommand('get_deal', { dealId: deal.id });
        await sendMessage(formatDeal(deal, activities));
        break;
      }

      case '/add_deal': {
        // guided multi-step — start the flow
        pendingActions.set('add_deal', { step: 1 });
        await sendMessage('Adding new deal. What is the *contact name*?');
        break;
      }

      case '/log': {
        const deals = await db.deals.findAll();
        const query = args.join(' ').toLowerCase();
        const deal = deals.find(d =>
          d.title.toLowerCase().includes(query) ||
          d.contact_name.toLowerCase().includes(query)
        );
        if (!deal) { await sendMessage(`No deal found matching "${args.join(' ')}"`); break; }
        pendingActions.set('log', { dealId: deal.id });
        await sendMessage(`Logging for *${deal.title}*. What happened?`);
        break;
      }

      case '/draft': {
        const deals = await db.deals.findAll();
        const query = args.join(' ').toLowerCase();
        const deal = deals.find(d =>
          d.title.toLowerCase().includes(query) ||
          d.contact_name.toLowerCase().includes(query)
        );
        if (!deal) { await sendMessage(`No deal found matching "${args.join(' ')}"`); break; }
        await sendMessage(`Drafting follow-up for *${deal.title}*...`);
        const draft = await requestDraft(deal.id);
        await sendMessage(
          `*Draft email for ${deal.contact_name}:*\n\n` +
          `To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}\n\n` +
          `Reply /send_draft ${deal.id} to send, or /discard_draft ${deal.id} to cancel.`
        );
        break;
      }

      case '/send_draft': {
        const dealId = parseInt(args[0]);
        const draft = getPendingDraft(dealId);
        if (!draft) { await sendMessage('No pending draft found.'); break; }
        // Gmail send happens here via OpenClaw's gmail integration
        // openclaw.gmail.send(draft) — adapt to actual OpenClaw API
        await sendMessage(`Email sent to ${draft.to}`);
        await db.activities.create({ dealId, type: 'email', summary: `Sent: ${draft.subject}` });
        clearDraft(dealId);
        break;
      }

      case '/discard_draft': {
        const dealId = parseInt(args[0]);
        clearDraft(dealId);
        await sendMessage('Draft discarded.');
        break;
      }

      case '/move': {
        const deals = await db.deals.findAll();
        const query = args.join(' ').toLowerCase();
        const deal = deals.find(d => d.title.toLowerCase().includes(query) || d.contact_name.toLowerCase().includes(query));
        if (!deal) { await sendMessage(`No deal found matching "${args.join(' ')}"`); break; }
        const updated = await handleCommand('move_stage', { dealId: deal.id });
        await sendMessage(`Moved *${deal.title}* to *${updated.stage}*`);
        break;
      }

      case '/won': {
        const deals = await db.deals.findAll();
        const query = args.join(' ').toLowerCase();
        const deal = deals.find(d => d.title.toLowerCase().includes(query));
        if (!deal) { await sendMessage(`No deal found.`); break; }
        await handleCommand('close_deal', { dealId: deal.id, outcome: 'won' });
        await sendMessage(`Congratulations! *${deal.title}* marked as WON.`);
        break;
      }

      case '/lost': {
        const deals = await db.deals.findAll();
        const query = args.join(' ').toLowerCase();
        const deal = deals.find(d => d.title.toLowerCase().includes(query));
        if (!deal) { await sendMessage(`No deal found.`); break; }
        pendingActions.set('lost', { dealId: deal.id, title: deal.title });
        await sendMessage(`Closing *${deal.title}* as lost. What was the reason?`);
        break;
      }

      case '/snooze': {
        const deals = await db.deals.findAll();
        const query = args.join(' ').toLowerCase();
        const deal = deals.find(d => d.title.toLowerCase().includes(query));
        if (!deal) { await sendMessage(`No deal found.`); break; }
        // default snooze: 3 days
        const snoozeDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        await db.deals.update(deal.id, { nextActionDate: snoozeDate });
        await sendMessage(`Snoozed *${deal.title}* until ${snoozeDate.toLocaleDateString()}`);
        break;
      }

      default: {
        await sendMessage(
          'Unknown command. Available commands:\n' +
          '/pipeline /deal /add_deal /log /draft /move /won /lost /snooze'
        );
      }
    }
  } catch (err) {
    await sendMessage(`Error: ${err.message}`);
  }
}

// OpenClaw calls this for free-text (natural language) messages
async function onMessage(text, sendMessage) {
  const pending = pendingActions.get('log');
  if (pending) {
    pendingActions.delete('log');
    const result = await logActivity(pending.dealId, text);
    let reply = `Logged: ${result.parsed.summary}`;
    if (result.parsed.next_action) {
      reply += `\nNext action set: *${result.parsed.next_action}*`;
      if (result.parsed.next_action_date) reply += ` (due ${result.parsed.next_action_date})`;
    }
    await sendMessage(reply);
    return;
  }

  const lostPending = pendingActions.get('lost');
  if (lostPending) {
    pendingActions.delete('lost');
    await handleCommand('close_deal', { dealId: lostPending.dealId, outcome: 'lost', reason: text });
    await sendMessage(`*${lostPending.title}* marked as LOST. Reason logged.`);
    return;
  }

  // Default: treat as NLP query — find best matching deal and log
  await sendMessage('Use /log <deal name> to log activity, or /pipeline to see your deals.');
}

// OpenClaw calls this on schedule (every 15 min)
async function onSchedule(sendMessage) {
  await runCheck(sendMessage);
}

// OpenClaw calls this at 09:00 daily
async function onMorningDigest(sendMessage) {
  await runMorningDigest(sendMessage);
}

module.exports = { onCommand, onMessage, onSchedule, onMorningDigest };
```

**Step 3: Register skill with OpenClaw**

```bash
cd ~/crm-skills
openclaw skill register ./main.js --name crm
# Or follow the actual OpenClaw registration process per their docs
```

**Step 4: Test end-to-end**

```bash
openclaw start
# In Telegram, send: /pipeline
# Expected: Pipeline view (empty at first)

# Send: /add_deal
# Expected: Bot asks for contact name

# Send: /won acme
# Expected: Error (no deal) — confirms command routing works
```

**Step 5: Commit**

```bash
git add main.js openclaw-manifest.json
git commit -m "feat: register CRM skills with OpenClaw, wire all Telegram commands"
```

---

## Phase 10: systemd Service & Backups

### Task 10.1: Run OpenClaw as a systemd service

**Step 1: Create systemd unit file**

```bash
sudo tee /etc/systemd/system/openclaw.service <<'EOF'
[Unit]
Description=OpenClaw CRM Agent
After=network.target postgresql.service

[Service]
Type=simple
User=crm
WorkingDirectory=/home/crm/crm-skills
ExecStart=/home/crm/.nvm/versions/node/v22.x.x/bin/openclaw start
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=DATABASE_URL=postgresql://crm_user:change_this_strong_password@localhost/crm_db
Environment=ANTHROPIC_API_KEY=your_key_here

[Install]
WantedBy=multi-user.target
EOF
```

**Step 2: Enable and start**

```bash
sudo systemctl daemon-reload
sudo systemctl enable openclaw
sudo systemctl start openclaw
sudo systemctl status openclaw
# Expected: active (running)
```

**Step 3: Verify it survives a restart**

```bash
sudo reboot
# After reconnect:
sudo systemctl status openclaw
# Expected: active (running) — started automatically
```

---

### Task 10.2: Daily PostgreSQL backup to Cloudflare R2

**Step 1: Create Cloudflare R2 bucket**

- Go to Cloudflare dashboard → R2 → Create bucket: `crm-backups`
- Create API token with R2 write access
- Note: Account ID, Access Key ID, Secret Access Key

**Step 2: Install rclone and configure R2**

```bash
sudo apt install -y rclone
rclone config
# New remote → name: r2 → type: s3 → provider: Cloudflare
# Enter Access Key ID and Secret Access Key
# Region: auto, Endpoint: https://<account_id>.r2.cloudflarestorage.com
```

**Step 3: Test rclone connection**

```bash
rclone ls r2:crm-backups
# Expected: empty listing (no error)
```

**Step 4: Write backup script**

```bash
cat > ~/backup-crm.sh <<'EOF'
#!/bin/bash
set -e
TIMESTAMP=$(date +%Y-%m-%d_%H-%M)
FILE="/tmp/crm_backup_${TIMESTAMP}.sql.gz"
pg_dump -U crm_user -h localhost crm_db | gzip > "$FILE"
rclone copy "$FILE" r2:crm-backups/
rm "$FILE"
echo "Backup complete: $FILE"
EOF
chmod +x ~/backup-crm.sh
```

**Step 5: Test backup**

```bash
~/backup-crm.sh
rclone ls r2:crm-backups
# Expected: one .sql.gz file listed
```

**Step 6: Schedule via cron**

```bash
crontab -e
# Add:
0 3 * * * /home/crm/backup-crm.sh >> /home/crm/backup.log 2>&1
```

**Step 7: Commit**

```bash
git add backup-crm.sh
git commit -m "chore: add daily PostgreSQL backup script to Cloudflare R2"
```

---

## Phase 11: Google OAuth Setup

### Task 11.1: Configure Gmail and Calendar access

**Step 1: Create Google Cloud project**

- Go to console.cloud.google.com
- Create project: `crm-mvp`
- Enable APIs: Gmail API, Google Calendar API
- Create OAuth 2.0 credentials (Desktop app type)
- Download `credentials.json`

**Step 2: Upload credentials to server**

```bash
scp credentials.json crm@$SERVER_IP:~/.openclaw/google-credentials.json
```

**Step 3: Run OAuth flow via OpenClaw**

```bash
# OpenClaw should handle this — check their Google auth setup docs
openclaw auth google
# This opens a URL — visit it on your local machine, authorize, paste code back
```

**Step 4: Verify Gmail access**

```bash
# Via OpenClaw CLI or test script:
node -e "
const db = require('./crm-db/src/index');
db.contacts.findAll().then(c => console.log('DB ok, contacts:', c.length));
"
# Test Gmail send via OpenClaw's built-in gmail skill
```

---

## Phase 12: End-to-End Smoke Test

### Task 12.1: Run full workflow test

**Step 1: Add your first real deal**

Send in Telegram: `/add_deal`
- Contact name: [a real prospect]
- Company, email, source
- Deal title, value

**Step 2: Log an activity**

Send: `/log <deal name>`
Then: "Had an intro call today, they're interested in a 3-month engagement, want a proposal by end of March"

Expected: Activity logged, next_action and next_action_date updated.

**Step 3: Request a draft**

Send: `/draft <deal name>`

Expected: Claude drafts a follow-up email, shown in Telegram with send/discard options.

**Step 4: Check pipeline**

Send: `/pipeline`

Expected: Deal appears in correct stage.

**Step 5: Verify morning digest fires at 09:00**

Wait until next morning. Expected: Digest arrives in Telegram with today's follow-ups.

**Step 6: Final commit**

```bash
git add .
git commit -m "chore: complete CRM MVP implementation"
```

---

## Summary of Commits

| Commit | Description |
|---|---|
| `chore: scaffold skill project structure` | Project layout |
| `feat: add database schema` | Tables and types |
| `feat: add crm-db client` | CRUD layer |
| `feat: add crm-core skill` | Command handlers |
| `feat: add pipeline formatters` | Telegram display |
| `feat: add reminder checker` | Scheduler logic |
| `feat: add NLP activity log parser` | Claude-powered logging |
| `feat: add email draft generator` | Claude-powered drafting |
| `feat: add calendar event suggester` | Calendar integration |
| `feat: register CRM skills with OpenClaw` | Full wiring |
| `chore: add daily PostgreSQL backup` | Backup cron |
| `chore: complete CRM MVP` | Final smoke test |
