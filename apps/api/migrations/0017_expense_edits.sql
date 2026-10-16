-- Owners and managers can edit an expense (with a reason); each edit is kept here for the record.
-- Every edit of an expense, append-only: who changed it, why, and each field's old and new value
-- (`changes` is a JSON list of {field, from, to}). Deleting stays a void on the expense itself.
CREATE TABLE expense_edits (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  expense_id TEXT NOT NULL,
  edited_by_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  changes TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (shop_id, expense_id) REFERENCES expenses(shop_id, id),
  FOREIGN KEY (shop_id, edited_by_user_id) REFERENCES users(shop_id, id)
);

CREATE INDEX idx_expense_edits_shop_created ON expense_edits(shop_id, created_at);
CREATE INDEX idx_expense_edits_expense ON expense_edits(shop_id, expense_id);
