-- Every close of a cash day that was later reopened, so a reopen never erases what was counted.
-- cash_days keeps the current state; a row is copied here (id = shop:date:closed_at) just before
-- the day reopens, then stamped with who reopened it and why. Append-only.
CREATE TABLE cash_day_closes (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  date TEXT NOT NULL,
  opening_float INTEGER NOT NULL,
  expected INTEGER,
  counted INTEGER,
  note TEXT,
  closed_by_user_id TEXT,
  closed_at TEXT NOT NULL,
  reopened_by_user_id TEXT,
  reopened_at TEXT,
  reopen_reason TEXT,
  FOREIGN KEY (shop_id, closed_by_user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, reopened_by_user_id) REFERENCES users(shop_id, id)
);

CREATE INDEX idx_cash_day_closes_day ON cash_day_closes(shop_id, date);
