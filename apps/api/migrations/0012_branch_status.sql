-- Software plans are gone: the app comes with the Mana Wash franchise, so no branch pays for it
-- and nothing is locked behind Free or Pro. What a branch may do is now its status, set only by
-- Mana Wash HQ (active, paused or closed), with every change kept in branch_status_events.
--
-- The shop's subscription columns go. Past subscription charges stay in billing_payments and
-- billing_events for the record. Cancel any live Razorpay subscription from the Razorpay
-- dashboard before applying this: nothing in the API will manage it afterwards.

DROP INDEX idx_shops_subscription;
DROP INDEX idx_shops_founder;
DROP INDEX idx_shops_founder_hold;

ALTER TABLE shops DROP COLUMN plan;
ALTER TABLE shops DROP COLUMN trial_ends_at;
ALTER TABLE shops DROP COLUMN paid_until;
ALTER TABLE shops DROP COLUMN subscription_id;
ALTER TABLE shops DROP COLUMN billing_interval;
ALTER TABLE shops DROP COLUMN price_paise;
ALTER TABLE shops DROP COLUMN founder_at;
ALTER TABLE shops DROP COLUMN founder_hold_until;
ALTER TABLE shops DROP COLUMN founder_hold_at;

ALTER TABLE shops ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed'));
ALTER TABLE shops ADD COLUMN status_reason TEXT CHECK (status_reason IS NULL OR length(status_reason) BETWEEN 3 AND 200);
ALTER TABLE shops ADD COLUMN status_changed_at TEXT;

CREATE TABLE branch_status_events (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'closed')),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 3 AND 200),
  changed_by_phone TEXT NOT NULL CHECK (length(changed_by_phone) = 10),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'))
);

CREATE INDEX idx_branch_status_events_shop ON branch_status_events(shop_id, created_at);
