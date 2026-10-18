-- What each branch offers: at its hub, at communities, at customers' doors. Head office decides
-- what the branch's agreement allows (allow_*); the owner switches on what it runs now (offer_*).
-- A service runs when both say yes, and doorstep washes need the community team too. The
-- branch's hub and community team follow these (menuRepo.publish). Washing at homes was one
-- switch for the whole business (business_settings branch.homeWash); it is now each branch's.

ALTER TABLE shops ADD COLUMN allow_hub INTEGER NOT NULL DEFAULT 1 CHECK (allow_hub IN (0, 1));
ALTER TABLE shops ADD COLUMN allow_community INTEGER NOT NULL DEFAULT 1 CHECK (allow_community IN (0, 1));
ALTER TABLE shops ADD COLUMN allow_doorstep INTEGER NOT NULL DEFAULT 1 CHECK (allow_doorstep IN (0, 1));
ALTER TABLE shops ADD COLUMN offer_hub INTEGER NOT NULL DEFAULT 1 CHECK (offer_hub IN (0, 1));
ALTER TABLE shops ADD COLUMN offer_community INTEGER NOT NULL DEFAULT 0 CHECK (offer_community IN (0, 1));
ALTER TABLE shops ADD COLUMN offer_doorstep INTEGER NOT NULL DEFAULT 0 CHECK (offer_doorstep IN (0, 1));

-- Today's branches keep exactly what they run now.
UPDATE shops SET offer_community = 1
  WHERE EXISTS (SELECT 1 FROM service_points p WHERE p.shop_id = shops.id AND p.kind = 'doorstep' AND p.active = 1);
UPDATE shops SET offer_hub = 0
  WHERE EXISTS (SELECT 1 FROM service_points p WHERE p.shop_id = shops.id)
    AND NOT EXISTS (SELECT 1 FROM service_points p WHERE p.shop_id = shops.id AND p.kind = 'hub' AND p.active = 1);
UPDATE shops SET offer_doorstep = 1
  WHERE offer_community = 1
    AND business_id IN (SELECT business_id FROM business_settings WHERE key = 'branch.homeWash' AND value = 'true');
DELETE FROM business_settings WHERE key = 'branch.homeWash';
