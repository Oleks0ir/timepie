-- Apply with: npx wrangler d1 execute timepie-friends --remote --file=schema.sql
-- A database made before groups had names needs, once:
--   npx wrangler d1 execute timepie-friends --remote --command="ALTER TABLE groups ADD COLUMN name TEXT"

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
  PRIMARY KEY (group_code, id)
);
