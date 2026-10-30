-- Wash plans become packs: a plan holds so many everyday washes and so many better ones
-- (upgrades_total), used in any order and on any day (still one a day). A wash a customer paid
-- for and didn't use carries over (carried_in) when they renew; carried_to marks the plan it went
-- to, so it carries once.
ALTER TABLE shop_plan_orders ADD COLUMN upgrades_total INTEGER NOT NULL DEFAULT 0 CHECK (upgrades_total >= 0);
ALTER TABLE shop_plan_orders ADD COLUMN upgrades_used INTEGER NOT NULL DEFAULT 0 CHECK (upgrades_used >= 0);
ALTER TABLE shop_plan_orders ADD COLUMN carried_in INTEGER NOT NULL DEFAULT 0 CHECK (carried_in >= 0);
ALTER TABLE shop_plan_orders ADD COLUMN carried_to TEXT;
-- Which of the pack's washes a use took.
ALTER TABLE shop_plan_uses ADD COLUMN kind TEXT NOT NULL DEFAULT 'base' CHECK (kind IN ('base', 'upgrade'));

-- Plans sold before: every Nth wash was the better one, so their pack is the same washes.
UPDATE shop_plan_orders
   SET upgrades_total = washes_total / upgrade_every,
       upgrades_used = MIN(washes_used / upgrade_every, washes_total / upgrade_every)
 WHERE upgrade_service_id IS NOT NULL AND upgrade_every > 1;
-- …and a use was the better wash when its wash number was a multiple of N.
UPDATE shop_plan_uses
   SET kind = 'upgrade'
 WHERE id IN (
   SELECT u.id FROM shop_plan_uses u
     JOIN shop_plan_orders o ON o.shop_id = u.shop_id AND o.id = u.order_id
    WHERE o.upgrade_service_id IS NOT NULL AND o.upgrade_every > 1
      AND (SELECT COUNT(*) FROM shop_plan_uses e
            WHERE e.shop_id = u.shop_id AND e.order_id = u.order_id AND (e.created_at < u.created_at OR (e.created_at = u.created_at AND e.id <= u.id))) % o.upgrade_every = 0);
CREATE INDEX idx_shop_plan_orders_carried_to ON shop_plan_orders(shop_id, carried_to) WHERE carried_to IS NOT NULL;
