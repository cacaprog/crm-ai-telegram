# CRM Improvements — Contact Update + Calendar Briefing

**Date:** 2026-03-27
**Status:** Approved

## Context

Two incremental improvements to the `crm-mcp` MCP server:

1. **`update_contact`** — allows updating contact fields (email, phone, etc.) for an existing deal via Telegram
2. **`get_today_briefing`** — on-demand tool that fetches today's Google Calendar events, matches them to CRM deals, and returns structured data for Claude to generate a full meeting briefing

Scheduling (automated morning delivery) is out of scope — deferred to a future iteration when scaling to Hetzner.

## Out of Scope

- Automated morning briefing (cron/systemd) — future iteration
- Google Calendar write access (creating/editing events)
- Multi-calendar support (primary calendar only)

---

## Feature 1 — update_contact

### Tool

```
update_contact({ deal_id, email?, phone?, name?, company?, role?, linkedin_url? })
```

- Looks up the contact linked to `deal_id`
- Updates only the fields provided (COALESCE pattern — same as `deals.update`)
- Returns the updated contact row

### Files

**`crm-mcp/db/index.js`** — add `contacts.update(id, fields)`:

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
}
```

**`crm-mcp/tools/deals.js`** — add `update_contact`:

```js
export async function update_contact({ deal_id, email, phone, name, company, role, linkedin_url }) {
  const deal = await db.deals.findById(deal_id);
  if (!deal) throw new Error(`Deal not found: ${deal_id}`);
  return await db.contacts.update(deal.contact_id, { name, company, role, email, phone, linkedinUrl: linkedin_url });
}
```

**`crm-mcp/index.js`** — add tool definition and handler:

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
}
```

### CLAUDE.md addition

```
**update_contact** — call when the user says "update email/phone/contact for [deal]" or "o João mudou de empresa". Requires deal_id — call get_deal first if needed. Update only the fields mentioned.
```

---

## Feature 2 — get_today_briefing

### Tool

```
get_today_briefing()
```

No parameters. Returns structured data — Claude writes the briefing from it.

### What it does

1. Fetches all events from the primary Google Calendar for today (midnight → midnight, local time)
2. For each event: extracts `summary` (title), `start`, `end`, attendee emails
3. Matches each event to a CRM deal:
   - **Email match**: attendee email found in `contacts.email`
   - **Name match**: event title fuzzy-matches deal title or contact name (case-insensitive `includes`)
4. For matched events: fetches deal + last 5 activities via existing `db` layer
5. Returns:

```js
{
  date: 'YYYY-MM-DD',
  events: [
    {
      title: string,
      start: string,       // ISO datetime
      end: string,
      attendees: string[], // email list
      deal: object | null, // full deal row (null if no match)
      activities: array    // last 5 activities (empty if no match)
    }
  ]
}
```

Claude uses this data to write, for each matched event:
- Deal summary (stage, value, last activity)
- Suggested agenda (what to discuss, objective)
- Draft next steps post-meeting

### Google Auth — shared module

**`crm-mcp/tools/google-auth.js`** — replaces inline OAuth2 in `email.js`:

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

**`crm-mcp/tools/email.js`** — updated to import from `google-auth.js` (removes duplicated OAuth2 code).

**`crm-mcp/tools/calendar.js`** — new file implementing `get_today_briefing`.

### `.gitignore` update

Replace:
```
crm-mcp/.gmail-credentials.json
```
With:
```
crm-mcp/.google-credentials.json
```

### Migration

Delete the existing token before next use:
```sh
rm crm-mcp/.gmail-credentials.json
```
On the next `send_email` or `get_today_briefing` call, the auth flow runs once and saves `.google-credentials.json` with both scopes.

### CLAUDE.md addition

```
**get_today_briefing** — call when the user says "agenda de hoje", "briefing", "reuniões de hoje", or similar. No parameters needed.

**Briefing format** — for each matched event, write:
1. Event time + title
2. Deal: stage, value, last activity
3. Suggested agenda (2–3 bullet points: objective + key topics)
4. Draft next steps post-meeting (1–2 actions)

For unmatched events (no CRM deal found), list them briefly without a briefing.
```

---

## Repository Structure After Changes

```
crm-mcp/
├── tools/
│   ├── google-auth.js   ← NEW: shared OAuth2 (gmail.send + calendar.readonly)
│   ├── email.js         ← UPDATED: imports from google-auth.js
│   ├── calendar.js      ← NEW: get_today_briefing
│   ├── deals.js         ← UPDATED: add update_contact
│   ├── pipeline.js      (unchanged)
│   └── activity.js      (unchanged)
├── db/
│   └── index.js         ← UPDATED: contacts.update()
├── index.js             ← UPDATED: 2 new tools registered
└── .google-credentials.json  ← gitignored (replaces .gmail-credentials.json)
```

## Environment Variables

No new env vars. Reuses `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` already in `.mcp.json`.
