# CRM Improvements — Contact Update + Calendar Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `update_contact` to edit contact fields via Telegram, and `get_today_briefing` to fetch today's Google Calendar events matched to CRM deals.

**Architecture:** Two new MCP tools added to the existing `crm-mcp` Node.js ESM server. Gmail OAuth2 is extracted into a shared `google-auth.js` module so Calendar reuses the same credentials file (`.google-credentials.json`) with combined scopes. All existing tests continue to pass throughout.

**Tech Stack:** Node.js ESM, `@modelcontextprotocol/sdk`, `googleapis` (v144), `pg`, Jest 29 with `--experimental-vm-modules`, `jest.unstable_mockModule` for ESM mocking.

---

## File Map

| File | Change |
|---|---|
| `crm-mcp/db/index.js` | Add `contacts.update(id, fields)` |
| `crm-mcp/tools/deals.js` | Add `update_contact` function |
| `crm-mcp/tools/google-auth.js` | NEW — shared OAuth2 (gmail.send + calendar.readonly) |
| `crm-mcp/tools/email.js` | Import auth from `google-auth.js` instead of inline |
| `crm-mcp/tools/calendar.js` | NEW — `get_today_briefing` |
| `crm-mcp/index.js` | Register 2 new tools + handlers |
| `crm-mcp/tests/db.test.js` | Add contacts.update integration test |
| `crm-mcp/tests/deals.test.js` | Add update_contact unit test |
| `crm-mcp/tests/calendar.test.js` | NEW — get_today_briefing unit tests |
| `crm-mcp/tests/server.test.js` | Update to expect 12 tools |
| `CLAUDE.md` | Add update_contact + get_today_briefing instructions |
| `.gitignore` | Replace `.gmail-credentials.json` with `.google-credentials.json` |

---

## Task 1: contacts.update() DB method

**Files:**
- Modify: `crm-mcp/db/index.js`
- Modify: `crm-mcp/tests/db.test.js`

- [ ] **Step 1: Write the failing integration test**

Add a new test inside the existing `describe('contacts', ...)` block in `crm-mcp/tests/db.test.js`. The full updated `describe('contacts', ...)` block:

```js
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

  test('updates email and phone', async () => {
    const contact = await contacts.create({ name: 'Update Me', source: 'cold' });
    const updated = await contacts.update(contact.id, {
      email: 'updated@example.com',
      phone: '+351 910 000 000'
    });
    expect(updated.email).toBe('updated@example.com');
    expect(updated.phone).toBe('+351 910 000 000');
    expect(updated.name).toBe('Update Me'); // untouched fields preserved
    await contacts.delete(contact.id);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```sh
cd crm-mcp && NODE_OPTIONS='--experimental-vm-modules' npx jest tests/db.test.js -t 'updates email and phone' --no-coverage
```

Expected: FAIL — `contacts.update is not a function`

- [ ] **Step 3: Add contacts.update to db/index.js**

Inside the `contacts` object in `crm-mcp/db/index.js`, add after the `delete` method:

```js
async update(id, { name, company, role, email, phone, linkedinUrl } = {}) {
  const { rows } = await pool.query(
    `UPDATE contacts SET
       name         = COALESCE($2, name),
       company      = COALESCE($3, company),
       role         = COALESCE($4, role),
       email        = COALESCE($5, email),
       phone        = COALESCE($6, phone),
       linkedin_url = COALESCE($7, linkedin_url)
     WHERE id=$1 RETURNING *`,
    [id, name, company, role, email, phone, linkedinUrl]
  );
  return rows[0];
},
```

- [ ] **Step 4: Run the test to confirm it passes**

```sh
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/db.test.js --no-coverage
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```sh
git add crm-mcp/db/index.js crm-mcp/tests/db.test.js
git commit -m "feat: add contacts.update() to db layer"
```

---

## Task 2: update_contact tool

**Files:**
- Modify: `crm-mcp/tools/deals.js`
- Modify: `crm-mcp/tests/deals.test.js`
- Modify: `crm-mcp/index.js`
- Modify: `crm-mcp/tests/server.test.js`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the failing unit test**

The test goes in `crm-mcp/tests/deals.test.js`. Replace the full file with this (adds `contacts.update` mock and new test):

```js
import { jest } from '@jest/globals';

const mockContact = { id: 10, name: 'Test Contact', company: 'Co', email: 'test@co.com', phone: null };
const mockDeal = { id: 20, title: 'Test Deal', stage: 'lead', contact_id: 10 };

jest.unstable_mockModule('../db/index.js', () => ({
  contacts: {
    create: jest.fn().mockResolvedValue(mockContact),
    update: jest.fn().mockImplementation((id, fields) =>
      Promise.resolve({ ...mockContact, id, ...fields })
    )
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

const { create_deal, update_deal, move_stage, close_deal, snooze_deal, update_contact } = await import('../tools/deals.js');

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
    dealId: 20,
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

test('update_contact updates contact fields via deal', async () => {
  const result = await update_contact({ deal_id: 20, email: 'new@co.com', phone: '+351 900 000 000' });
  expect(result.email).toBe('new@co.com');
  expect(result.phone).toBe('+351 900 000 000');
});

test('update_contact throws when deal not found', async () => {
  await expect(update_contact({ deal_id: 999 })).rejects.toThrow('Deal not found: 999');
});
```

- [ ] **Step 2: Run the test to confirm the new tests fail**

```sh
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/deals.test.js --no-coverage
```

Expected: existing tests PASS, new `update_contact` tests FAIL — `update_contact is not a function`

- [ ] **Step 3: Add update_contact to tools/deals.js**

Append to the end of `crm-mcp/tools/deals.js`:

```js
export async function update_contact({ deal_id, email, phone, name, company, role, linkedin_url }) {
  const deal = await db.deals.findById(deal_id);
  if (!deal) throw new Error(`Deal not found: ${deal_id}`);
  return await db.contacts.update(deal.contact_id, {
    name, company, role, email, phone, linkedinUrl: linkedin_url
  });
}
```

- [ ] **Step 4: Run deals tests to confirm all pass**

```sh
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/deals.test.js --no-coverage
```

Expected: all 8 tests PASS

- [ ] **Step 5: Register the tool in index.js**

In `crm-mcp/index.js`, update the import from `tools/deals.js`:

```js
import { create_deal, update_deal, move_stage, close_deal, snooze_deal, update_contact } from './tools/deals.js';
```

Add to the `TOOLS` array (after the `snooze_deal` entry):

```js
{
  name: 'update_contact',
  description: 'Update contact fields (email, phone, name, company, role, linkedin_url) for a deal',
  inputSchema: {
    type: 'object',
    properties: {
      deal_id:      { type: 'integer' },
      email:        { type: 'string' },
      phone:        { type: 'string' },
      name:         { type: 'string' },
      company:      { type: 'string' },
      role:         { type: 'string' },
      linkedin_url: { type: 'string' }
    },
    required: ['deal_id']
  }
},
```

Add to the `handlers` object:

```js
export const handlers = {
  get_pipeline, get_deal, get_deal_context,
  create_deal, update_deal, move_stage, close_deal, snooze_deal, update_contact,
  log_activity, send_email,
  unknown_tool: async () => { throw new Error('Unknown tool'); }
};
```

- [ ] **Step 6: Update server.test.js to expect 11 tools**

In `crm-mcp/tests/server.test.js`, update the deals mock to include `update_contact`, and fix the tool count:

```js
jest.unstable_mockModule('../tools/deals.js', () => ({
  create_deal: jest.fn(),
  update_deal: jest.fn(),
  move_stage: jest.fn(),
  close_deal: jest.fn(),
  snooze_deal: jest.fn(),
  update_contact: jest.fn()
}));
```

Update the count assertion:

```js
test('TOOLS lists all 11 tools', () => {
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
  expect(names).toHaveLength(11);
});
```

- [ ] **Step 7: Run server tests**

```sh
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/server.test.js --no-coverage
```

Expected: all tests PASS

- [ ] **Step 8: Add update_contact to CLAUDE.md**

In `CLAUDE.md`, add after the `**snooze_deal**` line in the Tool Usage section:

```
**update_contact** — call when the user says "atualiza o e-mail/telefone do [deal]", "o João mudou de empresa", or any instruction to update contact info. Requires `deal_id` — call `get_deal` first if needed. Update only the fields explicitly mentioned.
```

- [ ] **Step 9: Run full test suite**

```sh
NODE_OPTIONS='--experimental-vm-modules' npx jest --testPathPattern='tests/' --no-coverage
```

Expected: all tests PASS

- [ ] **Step 10: Commit**

```sh
git add crm-mcp/tools/deals.js crm-mcp/index.js crm-mcp/tests/deals.test.js crm-mcp/tests/server.test.js CLAUDE.md
git commit -m "feat: add update_contact tool"
```

---

## Task 3: google-auth.js shared module

**Files:**
- Create: `crm-mcp/tools/google-auth.js`
- Modify: `crm-mcp/tools/email.js`
- Modify: `.gitignore`

- [ ] **Step 1: Create crm-mcp/tools/google-auth.js**

```js
import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CREDS_PATH = join(__dirname, '..', '.google-credentials.json');
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly'
];

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );
}

export async function getAuthorizedClient() {
  const oauth2Client = createOAuth2Client();

  if (existsSync(CREDS_PATH)) {
    oauth2Client.setCredentials(JSON.parse(readFileSync(CREDS_PATH, 'utf8')));
    return oauth2Client;
  }

  const authUrl = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.error('\nAuthorize Google by visiting:\n', authUrl);

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const code = await new Promise(resolve => rl.question('\nPaste the authorization code: ', resolve));
  rl.close();

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  writeFileSync(CREDS_PATH, JSON.stringify(tokens, null, 2));
  console.error('Google credentials saved.');
  return oauth2Client;
}
```

- [ ] **Step 2: Replace email.js with version that imports from google-auth.js**

Full replacement for `crm-mcp/tools/email.js`:

```js
import { google } from 'googleapis';
import { getAuthorizedClient } from './google-auth.js';
import * as db from '../db/index.js';

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

- [ ] **Step 3: Update .gitignore**

In `.gitignore` at the repo root, replace:

```
crm-mcp/.gmail-credentials.json
```

with:

```
crm-mcp/.google-credentials.json
```

- [ ] **Step 4: Delete old credentials file if it exists**

```sh
rm -f crm-mcp/.gmail-credentials.json
```

(The next call to `send_email` or `get_today_briefing` will trigger a new OAuth flow and save `.google-credentials.json` with both scopes.)

- [ ] **Step 5: Run full test suite to confirm nothing broke**

```sh
cd crm-mcp && NODE_OPTIONS='--experimental-vm-modules' npx jest --testPathPattern='tests/' --no-coverage
```

Expected: all tests PASS (server.test.js mocks `email.js` entirely, so the refactor is transparent)

- [ ] **Step 6: Commit**

```sh
git add crm-mcp/tools/google-auth.js crm-mcp/tools/email.js .gitignore
git commit -m "refactor: extract shared google-auth.js with gmail+calendar scopes"
```

---

## Task 4: get_today_briefing calendar tool

**Files:**
- Create: `crm-mcp/tools/calendar.js`
- Create: `crm-mcp/tests/calendar.test.js`
- Modify: `crm-mcp/index.js`
- Modify: `crm-mcp/tests/server.test.js`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the failing unit tests**

Create `crm-mcp/tests/calendar.test.js`:

```js
import { jest } from '@jest/globals';

const mockDeal = {
  id: 1,
  title: 'Acme Deal',
  contact_name: 'João Silva',
  email: 'joao@acme.com',
  stage: 'proposal',
  value: '25000.00'
};

const mockActivity = { id: 1, type: 'call', summary: 'Good intro call', created_at: '2026-03-20T09:00:00Z' };

jest.unstable_mockModule('../tools/google-auth.js', () => ({
  getAuthorizedClient: jest.fn().mockResolvedValue({})
}));

jest.unstable_mockModule('googleapis', () => ({
  google: {
    calendar: jest.fn().mockReturnValue({
      events: {
        list: jest.fn().mockResolvedValue({
          data: {
            items: [
              {
                summary: 'Call with Acme',
                start: { dateTime: '2026-03-27T10:00:00Z' },
                end: { dateTime: '2026-03-27T11:00:00Z' },
                attendees: [{ email: 'joao@acme.com' }, { email: 'me@myco.com' }]
              },
              {
                summary: 'Unrelated meeting',
                start: { dateTime: '2026-03-27T14:00:00Z' },
                end: { dateTime: '2026-03-27T15:00:00Z' },
                attendees: []
              }
            ]
          }
        })
      }
    })
  }
}));

jest.unstable_mockModule('../db/index.js', () => ({
  deals: {
    findAll: jest.fn().mockResolvedValue([mockDeal]),
    findById: jest.fn().mockResolvedValue(mockDeal)
  },
  activities: {
    findByDeal: jest.fn().mockResolvedValue([mockActivity])
  }
}));

const { get_today_briefing } = await import('../tools/calendar.js');

test('returns today date and events array', async () => {
  const result = await get_today_briefing();
  expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(Array.isArray(result.events)).toBe(true);
  expect(result.events).toHaveLength(2);
});

test('matches event to deal by attendee email', async () => {
  const result = await get_today_briefing();
  const matched = result.events.find(e => e.title === 'Call with Acme');
  expect(matched.deal).not.toBeNull();
  expect(matched.deal.id).toBe(1);
  expect(matched.activities).toHaveLength(1);
  expect(matched.activities[0].summary).toBe('Good intro call');
});

test('returns null deal for unmatched event', async () => {
  const result = await get_today_briefing();
  const unmatched = result.events.find(e => e.title === 'Unrelated meeting');
  expect(unmatched.deal).toBeNull();
  expect(unmatched.activities).toHaveLength(0);
});

test('returns attendee email list', async () => {
  const result = await get_today_briefing();
  const matched = result.events.find(e => e.title === 'Call with Acme');
  expect(matched.attendees).toContain('joao@acme.com');
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```sh
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/calendar.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../tools/calendar.js'`

- [ ] **Step 3: Create crm-mcp/tools/calendar.js**

```js
import { google } from 'googleapis';
import { getAuthorizedClient } from './google-auth.js';
import * as db from '../db/index.js';

export async function get_today_briefing() {
  const auth = await getAuthorizedClient();
  const calendar = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: 'startTime'
  });

  const events = response.data.items || [];
  const allDeals = await db.deals.findAll();

  const result = [];
  for (const event of events) {
    const title = event.summary || '(no title)';
    const start = event.start?.dateTime || event.start?.date || '';
    const end = event.end?.dateTime || event.end?.date || '';
    const attendees = (event.attendees || [])
      .map(a => a.email?.toLowerCase())
      .filter(Boolean);

    // Match by attendee email first, then fuzzy title/name
    let matchedDeal = allDeals.find(d =>
      d.email && attendees.includes(d.email.toLowerCase())
    );
    if (!matchedDeal) {
      const titleLower = title.toLowerCase();
      matchedDeal = allDeals.find(d =>
        d.title.toLowerCase().includes(titleLower) ||
        titleLower.includes(d.contact_name.toLowerCase()) ||
        d.contact_name.toLowerCase().includes(titleLower)
      );
    }

    if (matchedDeal) {
      const deal = await db.deals.findById(matchedDeal.id);
      const activities = (await db.activities.findByDeal(matchedDeal.id)).slice(0, 5);
      result.push({ title, start, end, attendees, deal, activities });
    } else {
      result.push({ title, start, end, attendees, deal: null, activities: [] });
    }
  }

  return { date: startOfDay.toISOString().slice(0, 10), events: result };
}
```

- [ ] **Step 4: Run calendar tests to confirm they pass**

```sh
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/calendar.test.js --no-coverage
```

Expected: all 4 tests PASS

- [ ] **Step 5: Register the tool in index.js**

Add import at top of `crm-mcp/index.js`:

```js
import { get_today_briefing } from './tools/calendar.js';
```

Add to `TOOLS` array (after `send_email`):

```js
{
  name: 'get_today_briefing',
  description: "Fetch today's Google Calendar events and match them to CRM deals. Returns event list with deal context and recent activities for matched events.",
  inputSchema: { type: 'object', properties: {}, required: [] }
},
```

Update `handlers`:

```js
export const handlers = {
  get_pipeline, get_deal, get_deal_context,
  create_deal, update_deal, move_stage, close_deal, snooze_deal, update_contact,
  log_activity, send_email, get_today_briefing,
  unknown_tool: async () => { throw new Error('Unknown tool'); }
};
```

- [ ] **Step 6: Update server.test.js to expect 12 tools**

Add calendar mock at the top of `crm-mcp/tests/server.test.js` (after the email mock):

```js
jest.unstable_mockModule('../tools/calendar.js', () => ({
  get_today_briefing: jest.fn()
}));
```

Update the tool count test:

```js
test('TOOLS lists all 12 tools', () => {
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
  expect(names).toHaveLength(12);
});
```

- [ ] **Step 7: Add get_today_briefing to CLAUDE.md**

In `CLAUDE.md`, add after the `**update_contact**` line that was added in Task 2:

```
**get_today_briefing** — call when the user says "agenda de hoje", "briefing", "reuniões de hoje", or similar. No parameters needed.
```

Also add a new section at the end of `CLAUDE.md`:

```
## Daily Briefing Format

When `get_today_briefing` returns events, format the response as:

```
*Agenda de hoje — [date]*

*10:00 — Call with Acme* ✅ match
**Acme Deal** | Proposal | $25,000
Última atividade: Good intro call (Mar 20)

📋 Pauta sugerida:
  • Objetivo: [derive from stage + last activity]
  • [Key topic 1]
  • [Key topic 2]

➡️ Próximos passos:
  • [Draft action 1]
  • [Draft action 2]

---

*14:00 — Unrelated meeting* (sem match no CRM)
```

For events with no CRM match, list them briefly without a briefing.
```

- [ ] **Step 8: Run the full test suite**

```sh
NODE_OPTIONS='--experimental-vm-modules' npx jest --testPathPattern='tests/' --no-coverage
```

Expected: all tests PASS

- [ ] **Step 9: Commit**

```sh
git add crm-mcp/tools/calendar.js crm-mcp/tests/calendar.test.js crm-mcp/index.js crm-mcp/tests/server.test.js CLAUDE.md
git commit -m "feat: add get_today_briefing calendar tool"
```
