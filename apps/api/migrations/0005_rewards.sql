-- Rewards: stamp cards and welcome gifts (Pro).

-- Stamp cards: one row per service the owner put on a card. A car's stamps are never stored —
-- they're worked out from its paid washes (and combos that include the service), so voids and
-- rule changes can't leave a card wrong. Switching a card off keeps the row (active = 0).
CREATE TABLE reward_rules (
  service_id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  every INTEGER NOT NULL CHECK (every BETWEEN 2 AND 100), -- paid visits that earn one free wash
  active INTEGER NOT NULL DEFAULT 1,
  updated_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (shop_id, service_id) REFERENCES services(shop_id, id),
  FOREIGN KEY (shop_id, updated_by_user_id) REFERENCES users(shop_id, id)
);

-- A free wash used from a car's card. `seq` numbers the free washes taken from one card; the
-- unique index makes two phones spending the same free wash at once fail instead of both
-- succeeding. A claim counts while its job isn't voided. Written before the job row (same
-- request) and deleted if the job can't be created, so job_id is deliberately not a FK.
CREATE TABLE reward_claims (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  vehicle_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  job_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (vehicle_id, service_id, seq),
  UNIQUE (job_id, service_id),
  FOREIGN KEY (shop_id, vehicle_id) REFERENCES vehicles(shop_id, id),
  FOREIGN KEY (shop_id, service_id) REFERENCES services(shop_id, id),
  FOREIGN KEY (shop_id, created_by_user_id) REFERENCES users(shop_id, id)
);

-- What every new car gets on its first paid visit: inventory items and how much of each
-- (in the item's unit).
CREATE TABLE reward_gift_items (
  stock_item_id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_by_user_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (shop_id, stock_item_id) REFERENCES stock_items(shop_id, id),
  FOREIGN KEY (shop_id, updated_by_user_id) REFERENCES users(shop_id, id)
);

-- One welcome-gift item for one car. Written when its first wash is paid: 'given' when the stock
-- was there (taken out by stock move "gift:<id>"), otherwise 'owed' until someone hands it over.
-- Owed gifts never expire. Voiding the wash cancels the gift and puts given stock back
-- (move "gift-back:<id>"). id = "<job_id>:<stock_item_id>", so a retried payment can't add it twice.
CREATE TABLE reward_gifts (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  job_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  stock_item_id TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'owed' CHECK (status IN ('owed', 'given', 'cancelled')),
  given_at TEXT,
  given_by_user_id TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (shop_id, job_id) REFERENCES jobs(shop_id, id),
  FOREIGN KEY (shop_id, vehicle_id) REFERENCES vehicles(shop_id, id),
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers(shop_id, id),
  FOREIGN KEY (shop_id, stock_item_id) REFERENCES stock_items(shop_id, id),
  FOREIGN KEY (shop_id, given_by_user_id) REFERENCES users(shop_id, id)
);

CREATE INDEX idx_reward_rules_shop ON reward_rules(shop_id);
CREATE INDEX idx_reward_claims_job ON reward_claims(job_id);
CREATE INDEX idx_reward_claims_shop_created ON reward_claims(shop_id, created_at);
CREATE INDEX idx_reward_gift_items_shop ON reward_gift_items(shop_id);
CREATE INDEX idx_reward_gifts_job ON reward_gifts(job_id);
CREATE INDEX idx_reward_gifts_shop_status ON reward_gifts(shop_id, status);
CREATE INDEX idx_reward_gifts_shop_given ON reward_gifts(shop_id, given_at);
CREATE INDEX idx_reward_gifts_item_status ON reward_gifts(stock_item_id, status);
-- One live gift of each item per car, even if two of its first washes are paid at once.
CREATE UNIQUE INDEX idx_reward_gifts_one_live ON reward_gifts(vehicle_id, stock_item_id) WHERE status != 'cancelled';

-- stock_moves gains kind 'gift'. SQLite can't alter a CHECK, so the table is rebuilt; nothing
-- references stock_moves, and its triggers and indexes are recreated as they were.
CREATE TABLE stock_moves_new (
  id TEXT PRIMARY KEY,               -- client-generated, so a replayed offline entry is idempotent
  shop_id TEXT NOT NULL REFERENCES shops(id),
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('in', 'use', 'count', 'void', 'gift')),
  quantity REAL NOT NULL,
  balance_after REAL NOT NULL,
  note TEXT,
  expense_id TEXT,                   -- the purchase this came from, if any
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (shop_id, item_id) REFERENCES stock_items(shop_id, id),
  FOREIGN KEY (shop_id, expense_id) REFERENCES expenses(shop_id, id),
  FOREIGN KEY (shop_id, created_by_user_id) REFERENCES users(shop_id, id)
);

INSERT INTO stock_moves_new (id, shop_id, item_id, kind, quantity, balance_after, note, expense_id, created_by_user_id, created_at)
SELECT id, shop_id, item_id, kind, quantity, balance_after, note, expense_id, created_by_user_id, created_at FROM stock_moves;

DROP TABLE stock_moves;
ALTER TABLE stock_moves_new RENAME TO stock_moves;

CREATE INDEX idx_stock_moves_item_created ON stock_moves(item_id, created_at);
CREATE INDEX idx_stock_moves_shop_kind_created ON stock_moves(shop_id, kind, created_at);
CREATE INDEX idx_stock_moves_expense ON stock_moves(expense_id);

CREATE TRIGGER trg_stock_moves_no_update
BEFORE UPDATE OF id, shop_id, item_id, kind, quantity, balance_after, expense_id, created_by_user_id
ON stock_moves
BEGIN
  SELECT RAISE(ABORT, 'stock_moves_append_only');
END;

CREATE TRIGGER trg_stock_moves_no_delete BEFORE DELETE ON stock_moves
BEGIN
  SELECT RAISE(ABORT, 'stock_moves_append_only');
END;
