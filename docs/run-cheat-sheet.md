# CRM MVP Run Cheat Sheet

This project is an OpenClaw skill monorepo. The app runtime is OpenClaw + PostgreSQL, with the skill entry in `crm-skills/main.js`.

## 1) One-time local setup

```bash
cd /home/cairo/code/crm-mvp/crm-skills
npm install
```

## 2) Start PostgreSQL and create DB

If you do not already have the DB/user:

```bash
sudo -u postgres psql <<'SQL'
CREATE USER crm_user WITH PASSWORD 'change_this_strong_password';
CREATE DATABASE crm_db OWNER crm_user;
GRANT ALL PRIVILEGES ON DATABASE crm_db TO crm_user;
SQL
```

Optional: export connection string (recommended)

```bash
export DATABASE_URL='postgresql://crm_user:change_this_strong_password@localhost/crm_db'
```

## 3) Apply schema migration

```bash
cd /home/cairo/code/crm-mvp/crm-skills
node crm-db/src/migrate.js
```

## 4) Run tests

From monorepo root:

```bash
cd /home/cairo/code/crm-mvp/crm-skills
npx jest --runInBand
```

Run a single package test file:

```bash
cd /home/cairo/code/crm-mvp/crm-skills
npx jest crm-db/tests/db.test.js
npx jest crm-core/tests/core.test.js
npx jest crm-log/tests/parser.test.js
```

## 5) Run with OpenClaw (actual app runtime)

Install/configure OpenClaw first (if needed):

```bash
npm install -g openclaw
openclaw init
```

Then point OpenClaw to this skill project:

- Manifest: `crm-skills/openclaw-manifest.json`
- Entry file: `crm-skills/main.js`

Start runtime:

```bash
openclaw start
```

Stop runtime:

```bash
openclaw stop
```

## 6) Telegram commands you can test

Once OpenClaw is running with your bot configured:

- `/pipeline`
- `/deal <name>`
- `/add_deal`
- `/log <deal name>`
- `/draft <deal name>`
- `/send_draft <dealId>`
- `/discard_draft <dealId>`
- `/move <deal name>`
- `/won <deal name>`
- `/lost <deal name>`
- `/snooze <deal name>`

## 7) Useful maintenance commands

Run DB backup script:

```bash
cd /home/cairo/code/crm-mvp
chmod +x backup-crm.sh
./backup-crm.sh
```

## 8) Common issues

1. `relation "contacts" does not exist`
- You forgot migration. Run `node crm-db/src/migrate.js`.

2. DB auth/connect errors
- Verify PostgreSQL is running.
- Verify `DATABASE_URL` or default local credentials.

3. OpenClaw starts but commands do nothing
- Confirm OpenClaw is loading `openclaw-manifest.json` and `main.js` from this repo.
- Confirm Telegram token and user whitelist are set.

4. Claude/NLP or drafting failures
- Ensure Anthropic API key is configured in OpenClaw.
