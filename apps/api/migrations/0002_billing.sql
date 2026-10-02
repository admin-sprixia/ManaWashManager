-- Plans and payments: Free / Pro, paid through Razorpay subscriptions (UPI AutoPay or card).
-- A shop's tier is worked out from trial_ends_at and paid_until (see packages/domain/src/plans.ts);
-- these columns record the subscription that keeps paid_until moving.

ALTER TABLE shops ADD COLUMN subscription_id TEXT;             -- Razorpay subscription (sub_…) currently attached
ALTER TABLE shops ADD COLUMN billing_interval TEXT CHECK (billing_interval IN ('monthly', 'yearly'));
ALTER TABLE shops ADD COLUMN price_paise INTEGER CHECK (price_paise >= 0); -- what the attached subscription charges
-- Set when the shop's first founder-price payment succeeds. Counts toward the 50 founder slots
-- forever, even after cancelling (the founder price itself is only kept while subscribed).
ALTER TABLE shops ADD COLUMN founder_at TEXT;

CREATE INDEX idx_shops_subscription ON shops(subscription_id);
CREATE INDEX idx_shops_founder ON shops(founder_at) WHERE founder_at IS NOT NULL;

-- Every successful (or failed) subscription charge, for the owner's payment history.
CREATE TABLE billing_payments (
  id TEXT PRIMARY KEY,               -- Razorpay payment id (pay_…)
  shop_id TEXT NOT NULL REFERENCES shops(id),
  subscription_id TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
  status TEXT NOT NULL CHECK (status IN ('captured', 'failed', 'refunded')),
  method TEXT,                       -- upi | card | …
  period_end TEXT,                   -- paid_until this charge bought
  paid_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (shop_id, id)
);

CREATE INDEX idx_billing_payments_shop_paid ON billing_payments(shop_id, paid_at);

-- Razorpay webhook deliveries already handled (x-razorpay-event-id), so a retried delivery is a
-- no-op. Not shop data; kept for the record.
CREATE TABLE billing_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  shop_id TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'))
);

CREATE INDEX idx_billing_events_received ON billing_events(received_at);
