-- Where a cash expense was paid from: the shop's box ('drawer'), or doorstep cash the person who
-- entered it was holding ('held') — fuel on the way, supplies bought at a customer's. Both are
-- expenses in every report; only the box's come off the cash drawer, and held ones come off what
-- that person still has to hand in. Everything before this was paid from the box.
ALTER TABLE expenses ADD COLUMN cash_source TEXT NOT NULL DEFAULT 'drawer' CHECK (cash_source IN ('drawer', 'held'));
CREATE INDEX idx_expenses_held ON expenses(shop_id, created_by_user_id)
  WHERE cash_source = 'held' AND voided_at IS NULL;
