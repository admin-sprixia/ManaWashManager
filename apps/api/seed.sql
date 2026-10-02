-- Starter data for a fresh LOCAL database: the MANA shop, its vehicle sizes, menu, prices and
-- two sign-in accounts. Applied by `npm run db:reset:local` after the migrations.
-- Production shops are created through the in-app sign-up, never from this file.

-- Seed IDs are short and readable rather than random UUIDs, since this is fixed seed data.
-- Money is stored in paise (1 rupee = 100 paise).

-- ─── Seed: MANA, the first shop on the platform ─────────────────────────────

INSERT INTO shops (id, code, name, city, plan) VALUES ('shop_mana', '482193', 'MANA Car Wash', 'Hyderabad', 'free');

-- ─── Seed: vehicle types ────────────────────────────────────────────────────

INSERT INTO vehicle_types (id, shop_id, name, category, sort_order)
SELECT column1, 'shop_mana', column2, column3, column4 FROM (VALUES
  ('vt_hatchback',  'Hatchback',        'car',  0),
  ('vt_sedan',      'Sedan',            'car',  1),
  ('vt_mini_suv',   'Mini SUV',         'car',  2),
  ('vt_large_suv',  'Large SUV / XUV',  'car',  3),
  ('vt_bike',       'Bike',             'bike', 10),
  ('vt_scooter',    'Scooter',          'bike', 11));

-- ─── Seed: services ─────────────────────────────────────────────────────────

INSERT INTO services (id, shop_id, name, description, active, applies_to, sort_order)
SELECT column1, 'shop_mana', column2, column3, column4, column5, column6 FROM (VALUES
  -- Car menu
  ('svc_complete_wash',      'Complete Car Wash',    'Exterior foam wash + interior vacuum + tyres + glass', 1, 'car', 0),
  ('svc_exterior_wash',      'Exterior Wash',        'Exterior foam wash + wheels + tyres + glass',          1, 'car', 1),
  ('svc_interior_cleaning',  'Interior Cleaning',    'Vacuum + mats + dashboard wipe + interior glass',      1, 'car', 2),
  ('svc_mana_combo',         'MANA Combo',           'Complete Car Wash + tyre and dashboard dressing',      1, 'car', 3),
  ('svc_ac_hygiene',         'AC & Cabin Hygiene',   'AC vent and cabin refresh treatment',                  1, 'car', 4),
  ('svc_underbody',          'Underbody Cleaning',   'Underbody wash and mud removal',                       1, 'car', 5),
  ('svc_tyre_dressing',      'Tyre Dressing',        'Add-on',                                               1, 'car', 6),
  ('svc_dashboard_dressing', 'Dashboard Dressing',   'Add-on',                                               1, 'car', 7),
  ('svc_fragrance',          'Car Fragrance',        'Add-on',                                               1, 'car', 8),
  -- Bike menu
  ('svc_bike_complete',      'Complete Bike Wash',   'Foam wash + chain area wipe + dry',                    1, 'bike', 100),
  ('svc_bike_exterior',      'Bike Foam Wash',       'Exterior foam wash + wheels + dry',                    1, 'bike', 101),
  ('svc_bike_chain',         'Chain Clean & Lube',   'Chain degrease, clean, and lube',                      1, 'bike', 102),
  ('svc_bike_engine',        'Engine Degrease',      'Engine bay degrease and wipe',                         1, 'bike', 103),
  ('svc_bike_polish',        'Bike Polish',          'Body polish and shine',                                1, 'bike', 104),
  ('svc_bike_tyre',          'Bike Tyre Dressing',   'Add-on',                                               1, 'bike', 105),
  ('svc_bike_seat',          'Seat Clean & Protect', 'Seat wipe and protectant',                             1, 'bike', 106));

-- ─── Seed: prices (paise) ───────────────────────────────────────────────────

INSERT INTO service_prices (id, shop_id, service_id, vehicle_type_id, price)
SELECT column1, 'shop_mana', column2, column3, column4 FROM (VALUES
  -- Complete Car Wash: 400 / 500 / 600 / 700
  ('sp_complete_wash_hatchback', 'svc_complete_wash', 'vt_hatchback', 40000),
  ('sp_complete_wash_sedan',     'svc_complete_wash', 'vt_sedan',     50000),
  ('sp_complete_wash_mini_suv',  'svc_complete_wash', 'vt_mini_suv',  60000),
  ('sp_complete_wash_large_suv', 'svc_complete_wash', 'vt_large_suv', 70000),

  -- Exterior Wash: 250 / 300 / 350 / 400
  ('sp_exterior_wash_hatchback', 'svc_exterior_wash', 'vt_hatchback', 25000),
  ('sp_exterior_wash_sedan',     'svc_exterior_wash', 'vt_sedan',     30000),
  ('sp_exterior_wash_mini_suv',  'svc_exterior_wash', 'vt_mini_suv',  35000),
  ('sp_exterior_wash_large_suv', 'svc_exterior_wash', 'vt_large_suv', 40000),

  -- Interior Cleaning: 250 / 300 / 350 / 400
  ('sp_interior_cleaning_hatchback', 'svc_interior_cleaning', 'vt_hatchback', 25000),
  ('sp_interior_cleaning_sedan',     'svc_interior_cleaning', 'vt_sedan',     30000),
  ('sp_interior_cleaning_mini_suv',  'svc_interior_cleaning', 'vt_mini_suv',  35000),
  ('sp_interior_cleaning_large_suv', 'svc_interior_cleaning', 'vt_large_suv', 40000),

  -- MANA Combo: 500 / 600 / 700 / 800
  ('sp_mana_combo_hatchback', 'svc_mana_combo', 'vt_hatchback', 50000),
  ('sp_mana_combo_sedan',     'svc_mana_combo', 'vt_sedan',     60000),
  ('sp_mana_combo_mini_suv',  'svc_mana_combo', 'vt_mini_suv',  70000),
  ('sp_mana_combo_large_suv', 'svc_mana_combo', 'vt_large_suv', 80000),

  -- AC & Cabin Hygiene: flat 2,500
  ('sp_ac_hygiene_hatchback', 'svc_ac_hygiene', 'vt_hatchback', 250000),
  ('sp_ac_hygiene_sedan',     'svc_ac_hygiene', 'vt_sedan',     250000),
  ('sp_ac_hygiene_mini_suv',  'svc_ac_hygiene', 'vt_mini_suv',  250000),
  ('sp_ac_hygiene_large_suv', 'svc_ac_hygiene', 'vt_large_suv', 250000),

  -- Underbody Cleaning: flat 500 starting price
  ('sp_underbody_hatchback', 'svc_underbody', 'vt_hatchback', 50000),
  ('sp_underbody_sedan',     'svc_underbody', 'vt_sedan',     50000),
  ('sp_underbody_mini_suv',  'svc_underbody', 'vt_mini_suv',  50000),
  ('sp_underbody_large_suv', 'svc_underbody', 'vt_large_suv', 50000),

  -- Car add-ons: Tyre Dressing 50, Dashboard Dressing 100, Fragrance 50
  ('sp_tyre_dressing_hatchback', 'svc_tyre_dressing', 'vt_hatchback', 5000),
  ('sp_tyre_dressing_sedan',     'svc_tyre_dressing', 'vt_sedan',     5000),
  ('sp_tyre_dressing_mini_suv',  'svc_tyre_dressing', 'vt_mini_suv',  5000),
  ('sp_tyre_dressing_large_suv', 'svc_tyre_dressing', 'vt_large_suv', 5000),

  ('sp_dashboard_dressing_hatchback', 'svc_dashboard_dressing', 'vt_hatchback', 10000),
  ('sp_dashboard_dressing_sedan',     'svc_dashboard_dressing', 'vt_sedan',     10000),
  ('sp_dashboard_dressing_mini_suv',  'svc_dashboard_dressing', 'vt_mini_suv',  10000),
  ('sp_dashboard_dressing_large_suv', 'svc_dashboard_dressing', 'vt_large_suv', 10000),

  ('sp_fragrance_hatchback', 'svc_fragrance', 'vt_hatchback', 5000),
  ('sp_fragrance_sedan',     'svc_fragrance', 'vt_sedan',     5000),
  ('sp_fragrance_mini_suv',  'svc_fragrance', 'vt_mini_suv',  5000),
  ('sp_fragrance_large_suv', 'svc_fragrance', 'vt_large_suv', 5000),

  -- Bike menu: Bike / Scooter
  ('sp_bike_complete_bike',    'svc_bike_complete', 'vt_bike',    25000),
  ('sp_bike_complete_scooter', 'svc_bike_complete', 'vt_scooter', 20000),
  ('sp_bike_exterior_bike',    'svc_bike_exterior', 'vt_bike',    15000),
  ('sp_bike_exterior_scooter', 'svc_bike_exterior', 'vt_scooter', 12000),
  ('sp_bike_chain_bike',       'svc_bike_chain',    'vt_bike',    10000),
  ('sp_bike_chain_scooter',    'svc_bike_chain',    'vt_scooter', 10000),
  ('sp_bike_engine_bike',      'svc_bike_engine',   'vt_bike',    15000),
  ('sp_bike_engine_scooter',   'svc_bike_engine',   'vt_scooter', 15000),
  ('sp_bike_polish_bike',      'svc_bike_polish',   'vt_bike',    25000),
  ('sp_bike_polish_scooter',   'svc_bike_polish',   'vt_scooter', 20000),
  ('sp_bike_tyre_bike',        'svc_bike_tyre',     'vt_bike',    5000),
  ('sp_bike_tyre_scooter',     'svc_bike_tyre',     'vt_scooter', 5000),
  ('sp_bike_seat_bike',        'svc_bike_seat',     'vt_bike',    8000),
  ('sp_bike_seat_scooter',     'svc_bike_seat',     'vt_scooter', 8000));

-- ─── Seed: owner account ────────────────────────────────────────────────────

-- Placeholder owner account — replace the phone number with the real one, then sign in once
-- with a WhatsApp code (or the OWNER_RECOVERY_CODE secret) and set a PIN.
-- Stored as a plain 10-digit local number (no +91): that's what the login screen's phone-pad
-- keyboard actually produces.
INSERT INTO users (id, shop_id, name, phone, role) VALUES
  ('user_owner_seed', 'shop_mana', 'Owner', '9100000000', 'owner');

-- Demo staff account for trying the Staff role end to end. Remove (or deactivate from the
-- Team screen) before go-live; real staff are added by the owner from the app.
INSERT INTO users (id, shop_id, name, phone, role) VALUES
  ('user_staff_seed', 'shop_mana', 'Staff Demo', '9100000001', 'staff');
