DO $$ BEGIN
  CREATE TYPE deal_stage AS ENUM (
    'lead', 'discovery', 'validation', 'scoping',
    'proposal', 'negotiation', 'closed_won', 'closed_lost'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE activity_type AS ENUM (
    'call', 'email', 'meeting', 'note', 'proposal_sent'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE reminder_status AS ENUM (
    'pending', 'snoozed', 'done'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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
