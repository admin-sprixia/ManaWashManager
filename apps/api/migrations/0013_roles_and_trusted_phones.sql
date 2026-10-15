-- Managers, people in several branches, trusted phones and PIN resets.
--
-- users is rebuilt because SQLite can't change a CHECK: role gains 'manager' (runs the team and
-- join requests, no money fixes). It also gains pin_digits (owners and managers need 6) and
-- pin_set_at (a reset after it is shown to the person). The two triggers that kept a number to
-- one shop unless it was an owner everywhere are not recreated: anyone may work at several
-- branches now, one row per branch, all sharing one PIN (the API copies it).
--
-- Many tables point at users, so foreign keys are checked once at the end of the migration
-- instead of after each statement. The rows go back into a table already named users (not a
-- users_new renamed afterwards): dropping users counts every row pointing at it as broken, and
-- only inserting the matching users again clears that count before the check at the end.
PRAGMA defer_foreign_keys = true;

CREATE TABLE users_copy AS SELECT * FROM users;
DROP TABLE users;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'manager', 'staff')),
  active INTEGER NOT NULL DEFAULT 1,
  pin_hash TEXT,
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TEXT,
  session_version INTEGER NOT NULL DEFAULT 0,
  removed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  pin_digits INTEGER CHECK (pin_digits IS NULL OR pin_digits BETWEEN 4 AND 6),
  pin_set_at TEXT,
  UNIQUE (shop_id, id)
);

INSERT INTO users (id, shop_id, name, phone, role, active, pin_hash, pin_failed_attempts, pin_locked_until, session_version, removed_at, created_at)
SELECT id, shop_id, name, phone, role, active, pin_hash, pin_failed_attempts, pin_locked_until, session_version, removed_at, created_at FROM users_copy;

DROP TABLE users_copy;

CREATE INDEX idx_users_shop ON users(shop_id);
CREATE UNIQUE INDEX idx_users_shop_phone_live ON users(shop_id, phone) WHERE removed_at IS NULL;
CREATE INDEX idx_users_phone ON users(phone);

-- Phones that proved they hold a number with a WhatsApp code. A PIN only works on these; a new
-- phone needs a code first. Kept until the person signs out on it or their PIN is reset.
CREATE TABLE trusted_devices (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL CHECK (length(phone) = 10),
  device_hash TEXT NOT NULL CHECK (length(device_hash) = 64), -- SHA-256 of the app's device key
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  last_used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (phone, device_hash)
);

-- Every PIN reset: whose, who did it and where. A reset only clears the PIN; the person signs in
-- again with a WhatsApp code and chooses a new one, and is told who reset it.
CREATE TABLE pin_resets (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL CHECK (length(phone) = 10),
  shop_id TEXT REFERENCES shops(id),     -- the branch it was done from; NULL = Sprixia support
  by_phone TEXT CHECK (by_phone IS NULL OR length(by_phone) = 10),
  by_label TEXT NOT NULL CHECK (length(by_label) BETWEEN 1 AND 100),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'))
);

CREATE INDEX idx_pin_resets_phone ON pin_resets(phone, created_at);
