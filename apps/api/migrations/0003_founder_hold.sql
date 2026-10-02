-- Founder slots are counted from founder_at (paid at least once) plus slots held for shops whose
-- founder-price payment is still on its way: an open checkout, or AutoPay approved with the first
-- charge due at the end of the trial. Without the hold, more than 50 shops could be offered the
-- founder price while their first charges are pending. The hold lapses if the shop never pays.

ALTER TABLE shops ADD COLUMN founder_hold_until TEXT;
-- When the current hold was taken. If two shops grab the last slot at the same moment, the
-- earlier claim keeps it (ties broken by shop id), so exactly one of them gets it.
ALTER TABLE shops ADD COLUMN founder_hold_at TEXT;

CREATE INDEX idx_shops_founder_hold ON shops(founder_hold_until) WHERE founder_hold_until IS NOT NULL;
