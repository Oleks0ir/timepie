-- Apply with: npx wrangler d1 execute timepie-friends --remote --file=schema.sql
-- A database made before groups had names needs, once:
--   npx wrangler d1 execute timepie-friends --remote --command="ALTER TABLE groups ADD COLUMN name TEXT"
-- and one made before live timers needs, once:
--   npx wrangler d1 execute timepie-friends --remote --command="ALTER TABLE members ADD COLUMN live TEXT; ALTER TABLE members ADD COLUMN live_since TEXT; ALTER TABLE members ADD COLUMN live_seen TEXT"

CREATE TABLE IF NOT EXISTS groups (
  code TEXT PRIMARY KEY,
  -- Shared by everyone in it; null shows the code instead.
  name TEXT,
  created_at TEXT NOT NULL
);

-- One row per person per group. `weeks` is the JSON the app last sent: a few weeks of
-- totals and slices, replaced whole on every push, so it can never drift from the app.
CREATE TABLE IF NOT EXISTS members (
  group_code TEXT NOT NULL REFERENCES groups(code),
  id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  weeks TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- A timer running right now: { name, colorSlot } as JSON, when it started and when the
  -- app last said it still was, both by the server's clock. Null when nothing's running.
  live TEXT,
  live_since TEXT,
  live_seen TEXT,
  PRIMARY KEY (group_code, id)
);
