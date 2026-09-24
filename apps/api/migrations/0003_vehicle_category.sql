-- Cars and bikes are separate catalogs: vehicle types carry a category, and each
-- service declares which category it applies to. New Wash only offers matching services.
-- SQLite: ADD COLUMN with DEFAULT backfills existing rows.

ALTER TABLE vehicle_types ADD COLUMN category TEXT NOT NULL DEFAULT 'car';
ALTER TABLE services ADD COLUMN applies_to TEXT NOT NULL DEFAULT 'car';

-- Any type the owner already named like a two-wheeler becomes a bike type.
UPDATE vehicle_types
SET category = 'bike'
WHERE lower(name) LIKE '%bike%'
   OR lower(name) LIKE '%scooter%'
   OR lower(name) LIKE '%two%';

-- Seed a Bike type when none exists yet (fresh DBs, or car-only installs).
INSERT INTO vehicle_types (id, name, sort_order, category)
SELECT 'vt_bike', 'Bike', 10, 'bike'
WHERE NOT EXISTS (
  SELECT 1 FROM vehicle_types WHERE category = 'bike'
);

INSERT INTO vehicle_types (id, name, sort_order, category)
SELECT 'vt_scooter', 'Scooter', 11, 'bike'
WHERE NOT EXISTS (
  SELECT 1 FROM vehicle_types WHERE lower(name) LIKE '%scooter%'
)
AND EXISTS (
  SELECT 1 FROM vehicle_types WHERE category = 'bike'
);

-- Bike-only menu (car wash names stay car-only via applies_to = 'car').
INSERT OR IGNORE INTO services (id, name, description, active, sort_order, applies_to) VALUES
  ('svc_bike_complete',   'Complete Bike Wash',  'Foam wash + chain area wipe + dry',           1, 100, 'bike'),
  ('svc_bike_exterior',   'Bike Foam Wash',      'Exterior foam wash + wheels + dry',           1, 101, 'bike'),
  ('svc_bike_chain',      'Chain Clean & Lube',  'Chain degrease, clean, and lube',             1, 102, 'bike'),
  ('svc_bike_engine',     'Engine Degrease',     'Engine bay degrease and wipe',                1, 103, 'bike'),
  ('svc_bike_polish',     'Bike Polish',         'Body polish and shine',                       1, 104, 'bike'),
  ('svc_bike_tyre',       'Bike Tyre Dressing',  'Add-on',                                      1, 105, 'bike'),
  ('svc_bike_seat',       'Seat Clean & Protect','Seat wipe and protectant',                    1, 106, 'bike');

-- Prices for every bike-category vehicle type currently in the DB.
INSERT OR IGNORE INTO service_prices (id, service_id, vehicle_type_id, price)
SELECT 'sp_bike_complete_' || vt.id, 'svc_bike_complete', vt.id,
  CASE WHEN lower(vt.name) LIKE '%scooter%' THEN 20000 ELSE 25000 END
FROM vehicle_types vt WHERE vt.category = 'bike';

INSERT OR IGNORE INTO service_prices (id, service_id, vehicle_type_id, price)
SELECT 'sp_bike_exterior_' || vt.id, 'svc_bike_exterior', vt.id,
  CASE WHEN lower(vt.name) LIKE '%scooter%' THEN 12000 ELSE 15000 END
FROM vehicle_types vt WHERE vt.category = 'bike';

INSERT OR IGNORE INTO service_prices (id, service_id, vehicle_type_id, price)
SELECT 'sp_bike_chain_' || vt.id, 'svc_bike_chain', vt.id, 10000
FROM vehicle_types vt WHERE vt.category = 'bike';

INSERT OR IGNORE INTO service_prices (id, service_id, vehicle_type_id, price)
SELECT 'sp_bike_engine_' || vt.id, 'svc_bike_engine', vt.id, 15000
FROM vehicle_types vt WHERE vt.category = 'bike';

INSERT OR IGNORE INTO service_prices (id, service_id, vehicle_type_id, price)
SELECT 'sp_bike_polish_' || vt.id, 'svc_bike_polish', vt.id,
  CASE WHEN lower(vt.name) LIKE '%scooter%' THEN 20000 ELSE 25000 END
FROM vehicle_types vt WHERE vt.category = 'bike';

INSERT OR IGNORE INTO service_prices (id, service_id, vehicle_type_id, price)
SELECT 'sp_bike_tyre_' || vt.id, 'svc_bike_tyre', vt.id, 5000
FROM vehicle_types vt WHERE vt.category = 'bike';

INSERT OR IGNORE INTO service_prices (id, service_id, vehicle_type_id, price)
SELECT 'sp_bike_seat_' || vt.id, 'svc_bike_seat', vt.id, 8000
FROM vehicle_types vt WHERE vt.category = 'bike';
