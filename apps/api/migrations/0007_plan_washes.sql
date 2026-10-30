-- A plan's pack, wash by wash: how many of each wash it holds and how many are used. A ready plan
-- holds its everyday wash and maybe one better one; a plan the customer builds can hold any of
-- the branch's washes (2 Express + 1 Basic + 1 Premium). shop_plan_orders keeps the totals.
CREATE TABLE shop_plan_order_washes (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  order_id TEXT NOT NULL,
  catalog_service_id TEXT NOT NULL,
  washes_total INTEGER NOT NULL CHECK (washes_total BETWEEN 0 AND 400),
  washes_used INTEGER NOT NULL DEFAULT 0 CHECK (washes_used >= 0 AND washes_used <= washes_total),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, order_id, catalog_service_id),
  FOREIGN KEY (shop_id, order_id) REFERENCES shop_plan_orders(shop_id, id)
);
-- Which wash of the pack a use took.
ALTER TABLE shop_plan_uses ADD COLUMN catalog_service_id TEXT;

-- Plans sold before: the everyday wash first, then the better one.
INSERT INTO shop_plan_order_washes (shop_id, order_id, catalog_service_id, washes_total, washes_used, sort_order)
SELECT shop_id, id, catalog_service_id, washes_total - upgrades_total, MIN(washes_used - upgrades_used, washes_total - upgrades_total), 0
  FROM shop_plan_orders
 WHERE upgrade_service_id IS NULL OR upgrades_total = 0 OR upgrade_service_id != catalog_service_id;
INSERT INTO shop_plan_order_washes (shop_id, order_id, catalog_service_id, washes_total, washes_used, sort_order)
SELECT shop_id, id, upgrade_service_id, upgrades_total, MIN(upgrades_used, upgrades_total), 1
  FROM shop_plan_orders
 WHERE upgrade_service_id IS NOT NULL AND upgrades_total > 0 AND upgrade_service_id != catalog_service_id;
UPDATE shop_plan_uses
   SET catalog_service_id = (
     SELECT CASE WHEN shop_plan_uses.kind = 'upgrade' AND o.upgrade_service_id IS NOT NULL THEN o.upgrade_service_id ELSE o.catalog_service_id END
       FROM shop_plan_orders o WHERE o.shop_id = shop_plan_uses.shop_id AND o.id = shop_plan_uses.order_id);
