-- Doorstep cash and the drawer. A doorstep wash paid in cash leaves the money with the team
-- member who collected it, not in the shop's box, so the drawer only counts it once they hand it
-- over. Each handover settles part or all of what they hold (due, worked out by the server) with
-- what was actually received; a short handover needs a note. Received cash goes into the drawer
-- of the day it was handed in. Append-only: a mistaken handover is voided by the owner, never
-- edited or deleted. id = shop:collector:n (n = their handovers so far), so two people taking the
-- same cash at once can't both record it.
CREATE TABLE cash_handovers (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  date TEXT NOT NULL,
  collector_user_id TEXT NOT NULL,
  due INTEGER NOT NULL CHECK (due >= 0),
  received INTEGER NOT NULL CHECK (received >= 0),
  note TEXT,
  received_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  voided_by_user_id TEXT,
  voided_at TEXT,
  void_reason TEXT,
  FOREIGN KEY (shop_id, collector_user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, received_by_user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, voided_by_user_id) REFERENCES users(shop_id, id)
);
CREATE INDEX idx_cash_handovers_day ON cash_handovers(shop_id, date);
CREATE INDEX idx_cash_handovers_collector ON cash_handovers(shop_id, collector_user_id);
CREATE INDEX idx_jobs_doorstep_cash ON jobs(shop_id, paid_by_user_id)
  WHERE delivery_mode = 'doorstep' AND status = 'paid' AND payment_method = 'cash';

-- Doorstep cash still held when a day closed, frozen with the count.
ALTER TABLE cash_days ADD COLUMN held_at_close INTEGER CHECK (held_at_close >= 0);
ALTER TABLE cash_day_closes ADD COLUMN held_at_close INTEGER;

-- Doorstep cash taken before handovers was counted in that day's drawer: record it as handed in
-- on the same IST day, so past days keep exactly the totals they were closed with.
INSERT INTO cash_handovers (id, shop_id, date, collector_user_id, due, received, note, received_by_user_id, created_at)
SELECT 'before:' || shop_id || ':' || paid_by_user_id || ':' || day, shop_id, day, paid_by_user_id, total, total,
       'Counted in the drawer before handovers', paid_by_user_id,
       strftime('%Y-%m-%dT%H:%M:%f+00:00', day || ' 23:59:59', '-330 minutes')
FROM (
  SELECT shop_id, paid_by_user_id, date(completed_at, '+330 minutes') AS day, SUM(total) AS total
  FROM jobs
  WHERE delivery_mode = 'doorstep' AND status = 'paid' AND payment_method = 'cash'
    AND paid_by_user_id IS NOT NULL AND completed_at IS NOT NULL
  GROUP BY shop_id, paid_by_user_id, day
);
