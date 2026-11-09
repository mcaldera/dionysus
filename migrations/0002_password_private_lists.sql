-- Name-and-password login next to the personal link, private lists, and one main list per
-- person (the heart: "Meine Lokale").

ALTER TABLE members ADD COLUMN password_hash TEXT;
ALTER TABLE members ADD COLUMN login_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN locked_until INTEGER NOT NULL DEFAULT 0;

-- One row per password login, so signing in doesn't sign out your other devices.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

ALTER TABLE lists ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lists ADD COLUMN is_main INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS one_main_list ON lists (owner_id) WHERE is_main = 1;
