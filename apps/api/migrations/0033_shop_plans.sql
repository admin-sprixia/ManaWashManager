-- Wash plans at the shop. A plan is sold at communities (as before), at the shop, or both; a
-- community plan can also pay for a wash at the shop unless head office switches that off.
ALTER TABLE wash_plans ADD COLUMN sold_at TEXT NOT NULL DEFAULT 'community' CHECK (sold_at IN ('community', 'shop', 'both'));
ALTER TABLE wash_plans ADD COLUMN shop_use INTEGER NOT NULL DEFAULT 1 CHECK (shop_use IN (0, 1));

-- A plan sold at the counter: for one vehicle, at this branch only, used before it ends (its
-- months from the day it's sold), at most one wash a day. Paid in full when sold: the money is a
-- paid bill (jobs.plan_sale_id), so the cash drawer and Reports count it.
CREATE TABLE shop_plan_orders (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  plan_id TEXT NOT NULL REFERENCES wash_plans(id),
  customer_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  title TEXT NOT NULL,
  catalog_service_id TEXT NOT NULL,
  upgrade_service_id TEXT,
  upgrade_every INTEGER,
  washes_total INTEGER NOT NULL CHECK (washes_total BETWEEN 1 AND 400),
  washes_used INTEGER NOT NULL DEFAULT 0 CHECK (washes_used >= 0 AND washes_used <= washes_total),
  price INTEGER NOT NULL CHECK (price >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'upi', 'other')),
  sale_job_id TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'void')),
  sold_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  ended_at TEXT,
  UNIQUE (shop_id, id),
  UNIQUE (shop_id, sale_job_id),
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers(shop_id, id),
  FOREIGN KEY (shop_id, vehicle_id) REFERENCES vehicles(shop_id, id)
);
CREATE INDEX idx_shop_plan_orders_vehicle ON shop_plan_orders(shop_id, vehicle_id, status);

-- Each wash a shop plan paid for: one a day per plan, one plan per wash.
CREATE TABLE shop_plan_uses (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  order_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (shop_id, order_id, day),
  UNIQUE (shop_id, job_id),
  FOREIGN KEY (shop_id, order_id) REFERENCES shop_plan_orders(shop_id, id)
);

-- The bill a plan was sold on: money in, but not a wash in the counts.
ALTER TABLE jobs ADD COLUMN plan_sale_id TEXT;
