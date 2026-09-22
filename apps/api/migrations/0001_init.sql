-- Provisions mana_db. Applied with:
--   wrangler d1 migrations apply mana_db --local   (or --remote)
-- Must stay in sync with packages/db/prisma/schema.prisma (Prisma generates types from that
-- file; this SQL is what actually creates the tables, since D1 is migrated via wrangler, not
-- `prisma migrate`).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'staff',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE vehicle_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
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
  vehicle_type_id TEXT NOT NULL REFERENCES vehicle_types(id)
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
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
  created_by_user_id TEXT NOT NULL REFERENCES users(id)
);

-- Indexes for the app's actual hot paths: today's job board, the dashboard, and lookups.
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at);
CREATE INDEX idx_vehicles_customer_id ON vehicles(customer_id);
CREATE INDEX idx_service_prices_service_id ON service_prices(service_id);
