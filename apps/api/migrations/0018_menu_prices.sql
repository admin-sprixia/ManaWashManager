-- A printed menu, exactly. A base price can carry its own community (doorstep) price instead of
-- the doorstep rule; a wash plan can have a fixed price per vehicle size and way of washing
-- instead of "wash price × washes − discount"; and a plan can make every Nth wash a better one
-- (Shine: 3 Basic + 1 Premium a month).

ALTER TABLE price_book_entries ADD COLUMN doorstep_price INTEGER CHECK (doorstep_price IS NULL OR doorstep_price BETWEEN 0 AND 10000000);

ALTER TABLE wash_plans ADD COLUMN upgrade_service_id TEXT REFERENCES catalog_services(id);
ALTER TABLE wash_plans ADD COLUMN upgrade_every INTEGER CHECK (upgrade_every IS NULL OR upgrade_every BETWEEN 2 AND 12);

-- What one vehicle of a size pays for a plan, at the hub or at a community. No row: the plan is
-- priced from its wash's price.
CREATE TABLE wash_plan_prices (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  plan_id TEXT NOT NULL,
  size_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('hub', 'doorstep')),
  price INTEGER NOT NULL CHECK (price BETWEEN 0 AND 100000000),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (plan_id, size_id, mode),
  FOREIGN KEY (business_id, plan_id) REFERENCES wash_plans(business_id, id),
  FOREIGN KEY (business_id, size_id) REFERENCES vehicle_sizes(business_id, id)
);
