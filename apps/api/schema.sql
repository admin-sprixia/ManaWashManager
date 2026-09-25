-- The complete mana_db schema + launch seed in one file. Applied with:
--   npm run db:reset:local    (or db:reset:remote)
-- which runs `wrangler d1 execute mana_db --file=./schema.sql`.
--
-- DESTRUCTIVE: drops and recreates every table, so all data is wiped. Safe only while there is
-- no production data. Once real data exists, switch back to incremental migrations.
--
-- Must stay in sync with packages/db/prisma/schema.prisma (Prisma generates types from that
-- file; this SQL is what actually creates the tables, since D1 isn't managed by `prisma migrate`).
--
-- Seed IDs are short and readable rather than random UUIDs, since this is fixed seed data,
-- not runtime-created rows (those get real UUIDs via Prisma's @default(uuid())).
-- Money is stored in paise (1 rupee = 100 paise).

DROP TABLE IF EXISTS vehicle_reminders;
DROP TABLE IF EXISTS coupons;
DROP TABLE IF EXISTS job_events;
DROP TABLE IF EXISTS job_services;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS service_prices;
DROP TABLE IF EXISTS services;
DROP TABLE IF EXISTS vehicle_types;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS d1_migrations;

-- ─── Schema ─────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'staff', -- owner | staff
  active INTEGER NOT NULL DEFAULT 1,  -- deactivated users can't sign in or call the API
  pin_hash TEXT,                      -- PBKDF2 "iterations$salt$hash"; NULL = PIN sign-in not set up
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE vehicle_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'car', -- car | bike
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  applies_to TEXT NOT NULL DEFAULT 'car', -- car | bike | both
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE service_prices (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id),
  vehicle_type_id TEXT NOT NULL REFERENCES vehicle_types(id),
  price INTEGER NOT NULL, -- paise
  UNIQUE (service_id, vehicle_type_id)
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT NOT NULL UNIQUE,
  source TEXT,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE vehicles (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  registration_number TEXT NOT NULL UNIQUE,
  make TEXT,
  model TEXT,
  vehicle_type_id TEXT NOT NULL REFERENCES vehicle_types(id),
  -- Bumped whenever anything New Wash's customer suggestions show for this vehicle changes
  -- (the vehicle, its owner's name/phone, or a job for that owner). Phones sync their offline
  -- customer directory by pulling rows changed since their last cursor.
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting | washing | ready | paid | void
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  discount_reason TEXT,
  total INTEGER NOT NULL,
  payment_method TEXT, -- cash | upi | other
  payment_status TEXT NOT NULL DEFAULT 'pending',
  paid_by_user_id TEXT REFERENCES users(id),   -- who collected the money
  voided_by_user_id TEXT REFERENCES users(id),
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- Append-only audit trail: every create, status change, payment, void, and correction.
-- Never updated or deleted, so any number on a report can be traced back to who did what.
CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL, -- created | status_changed | paid | voided | payment_method_changed
  from_value TEXT,
  to_value TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE job_services (
  job_id TEXT NOT NULL REFERENCES jobs(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  price_at_time INTEGER NOT NULL, -- copied at creation time; never re-joins to the live price
  quantity INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (job_id, service_id)
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL, -- paise
  description TEXT,
  date TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  voided_by_user_id TEXT REFERENCES users(id),
  void_reason TEXT,
  voided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Comeback coupons. Bound to the vehicle it was issued for and to that vehicle's owner at
-- issue time: redeemable on that vehicle or the same owner's other vehicles, once, before
-- expires_at. "Expired" is derived (status stays 'active'); a vehicle changing hands cancels it.
CREATE TABLE coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  percent INTEGER NOT NULL CHECK (percent BETWEEN 5 AND 10),
  status TEXT NOT NULL DEFAULT 'active', -- active | redeemed | cancelled
  expires_at TEXT NOT NULL,
  issued_by_user_id TEXT NOT NULL REFERENCES users(id),
  -- Claimed before the job row is written (same request), so this is deliberately not a FK.
  redeemed_job_id TEXT UNIQUE,
  redeemed_by_user_id TEXT REFERENCES users(id),
  redeemed_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT, -- replaced | owner_changed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- What the team did about a vehicle's reminder. Tied to the visit it was about
-- (last_visit_at): once the vehicle comes back, the old state no longer applies.
CREATE TABLE vehicle_reminders (
  vehicle_id TEXT PRIMARY KEY REFERENCES vehicles(id),
  last_visit_at TEXT NOT NULL,
  reminded_at TEXT,
  reminded_by_user_id TEXT REFERENCES users(id),
  snoozed_until TEXT,
  dismissed_at TEXT,
  dismissed_by_user_id TEXT REFERENCES users(id)
);

-- Indexes for the app's actual hot paths: today's job board, the dashboard, and lookups.
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at);
CREATE INDEX idx_job_events_job_id ON job_events(job_id);
CREATE INDEX idx_job_events_created_at ON job_events(created_at);
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_vehicles_customer_id ON vehicles(customer_id);
CREATE INDEX idx_vehicles_updated_at ON vehicles(updated_at, id);
CREATE INDEX idx_jobs_customer_id ON jobs(customer_id);
CREATE INDEX idx_jobs_vehicle_id ON jobs(vehicle_id);
CREATE INDEX idx_service_prices_service_id ON service_prices(service_id);
CREATE INDEX idx_coupons_customer_id ON coupons(customer_id);
-- At most one live coupon per vehicle, enforced by the database even under concurrent issues.
CREATE UNIQUE INDEX idx_coupons_one_active_per_vehicle ON coupons(vehicle_id) WHERE status = 'active';

-- ─── Seed: vehicle types ────────────────────────────────────────────────────

INSERT INTO vehicle_types (id, name, category, sort_order) VALUES
  ('vt_hatchback',  'Hatchback',        'car',  0),
  ('vt_sedan',      'Sedan',            'car',  1),
  ('vt_mini_suv',   'Mini SUV',         'car',  2),
  ('vt_large_suv',  'Large SUV / XUV',  'car',  3),
  ('vt_bike',       'Bike',             'bike', 10),
  ('vt_scooter',    'Scooter',          'bike', 11);

-- ─── Seed: services ─────────────────────────────────────────────────────────

INSERT INTO services (id, name, description, active, applies_to, sort_order) VALUES
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
  ('svc_bike_seat',          'Seat Clean & Protect', 'Seat wipe and protectant',                             1, 'bike', 106);

-- ─── Seed: prices (paise) ───────────────────────────────────────────────────

INSERT INTO service_prices (id, service_id, vehicle_type_id, price) VALUES
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
  ('sp_bike_seat_scooter',     'svc_bike_seat',     'vt_scooter', 8000);

-- ─── Seed: owner account ────────────────────────────────────────────────────

-- Placeholder owner account — replace the phone number with the real one, then sign in via OTP.
-- Stored as a plain 10-digit local number (no +91): that's what the login screen's phone-pad
-- keyboard actually produces.
INSERT INTO users (id, name, phone, role) VALUES
  ('user_owner_seed', 'Owner', '9100000000', 'owner');

-- Demo staff account for trying the Staff role end to end. Remove (or deactivate from the
-- Team screen) before go-live; real staff are added by the owner from the app.
INSERT INTO users (id, name, phone, role) VALUES
  ('user_staff_seed', 'Staff Demo', '9100000001', 'staff');
