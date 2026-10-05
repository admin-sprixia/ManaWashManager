-- MANA Car Wash app, part two: each branch's contact details and opening hours, customers rating
-- their washes and reporting problems, and asking the team to add a vehicle.

-- ─── Branch contact and hours (shown in the app) ────────────────────────────

ALTER TABLE shops ADD COLUMN address TEXT CHECK (address IS NULL OR length(address) BETWEEN 5 AND 300);
ALTER TABLE shops ADD COLUMN contact_phone TEXT CHECK (contact_phone IS NULL OR length(contact_phone) = 10);
-- "HH:MM", IST. Both or neither.
ALTER TABLE shops ADD COLUMN opens_at TEXT CHECK (opens_at IS NULL OR opens_at GLOB '[0-2][0-9]:[0-5][0-9]');
ALTER TABLE shops ADD COLUMN closes_at TEXT CHECK (closes_at IS NULL OR closes_at GLOB '[0-2][0-9]:[0-5][0-9]');
-- Day of the week the branch is closed: Sunday = 0 … Saturday = 6.
ALTER TABLE shops ADD COLUMN weekly_off INTEGER CHECK (weekly_off IS NULL OR weekly_off BETWEEN 0 AND 6);

-- ─── Vehicles ───────────────────────────────────────────────────────────────

-- The customer removed this vehicle from their list in the app (sold it, say). Only hides it there;
-- the vehicle and its washes stay with the car wash.
ALTER TABLE vehicles ADD COLUMN app_hidden_at TEXT;

-- "Add my vehicle" from the app. The team approves (which creates the vehicle for this customer)
-- or declines with a reason the customer sees.
CREATE TABLE vehicle_requests (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  customer_id TEXT NOT NULL,
  registration_number TEXT NOT NULL,
  vehicle_type_id TEXT NOT NULL,
  make TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  vehicle_id TEXT,                   -- set on approval
  handled_by_user_id TEXT,
  handled_at TEXT,
  reason TEXT,                       -- why it was declined, shown to the customer
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers(shop_id, id),
  FOREIGN KEY (shop_id, vehicle_type_id) REFERENCES vehicle_types(shop_id, id),
  FOREIGN KEY (shop_id, vehicle_id) REFERENCES vehicles(shop_id, id),
  FOREIGN KEY (shop_id, handled_by_user_id) REFERENCES users(shop_id, id)
);
CREATE INDEX idx_vehicle_requests_shop_status ON vehicle_requests(shop_id, status, created_at);
CREATE INDEX idx_vehicle_requests_customer ON vehicle_requests(customer_id, created_at);
-- One open request per plate per branch.
CREATE UNIQUE INDEX idx_vehicle_requests_one_pending ON vehicle_requests(shop_id, registration_number) WHERE status = 'pending';

-- ─── Ratings ────────────────────────────────────────────────────────────────

-- One per paid wash, by the customer it belongs to; they can change it for a while after.
CREATE TABLE wash_ratings (
  job_id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  customer_id TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (shop_id, job_id) REFERENCES jobs(shop_id, id),
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers(shop_id, id)
);
CREATE INDEX idx_wash_ratings_shop ON wash_ratings(shop_id, updated_at);

-- ─── Problems ───────────────────────────────────────────────────────────────

-- Reported by a customer, about one wash or the branch in general. The team resolves it with a
-- note the customer sees.
CREATE TABLE wash_problems (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  customer_id TEXT NOT NULL,
  job_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('not_clean', 'damage', 'missed_service', 'billing', 'staff', 'other')),
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution TEXT,
  resolved_by_user_id TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers(shop_id, id),
  FOREIGN KEY (shop_id, job_id) REFERENCES jobs(shop_id, id),
  FOREIGN KEY (shop_id, resolved_by_user_id) REFERENCES users(shop_id, id)
);
CREATE INDEX idx_wash_problems_shop_status ON wash_problems(shop_id, status, created_at);
CREATE INDEX idx_wash_problems_customer ON wash_problems(customer_id, created_at);
