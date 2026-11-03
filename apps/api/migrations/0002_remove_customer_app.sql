-- Customers use WhatsApp only: the Mana Wash customer app is gone, and so is everything that
-- only it wrote or read — its sign-ins, "Request service", "Add my vehicle", ratings, problem
-- reports, the named service areas it offered, and the "listed in the app" and "hidden in the
-- app" flags. Children first; nothing else points at these tables.

DROP INDEX IF EXISTS idx_service_requests_invited;
DROP INDEX IF EXISTS idx_service_requests_one_open;
DROP INDEX IF EXISTS idx_service_requests_phone;
DROP INDEX IF EXISTS idx_service_requests_shop_status;
DROP INDEX IF EXISTS idx_vehicle_requests_one_pending;
DROP INDEX IF EXISTS idx_vehicle_requests_customer;
DROP INDEX IF EXISTS idx_vehicle_requests_shop_status;
DROP INDEX IF EXISTS idx_wash_ratings_shop;
DROP INDEX IF EXISTS idx_wash_problems_customer;
DROP INDEX IF EXISTS idx_wash_problems_shop_status;
DROP INDEX IF EXISTS idx_service_areas_name_live;
DROP INDEX IF EXISTS idx_service_areas_shop;

DROP TABLE service_requests;
DROP TABLE vehicle_requests;
DROP TABLE wash_ratings;
DROP TABLE wash_problems;
DROP TABLE service_areas;
DROP TABLE customer_accounts;

ALTER TABLE shops DROP COLUMN in_customer_app;
ALTER TABLE vehicles DROP COLUMN app_hidden_at;
