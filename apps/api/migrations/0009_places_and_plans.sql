-- Places and plans. A branch's team washes regularly at places (a building, a gated colony, a
-- street) on fixed wash days. People there join as members from the MANA Car Wash app (QR poster,
-- a neighbour's link, or by location) or are added by the team, with their flat and vehicles.
-- Each vehicle takes a plan (monthly, quarterly, yearly — set up once for the business) or a
-- one-time wash, paid online through Razorpay before the first wash, in full or in parts. Washers
-- see who is paid on each wash day; every payment gets a numbered receipt with GST.

-- ─── Places ─────────────────────────────────────────────────────────────────

CREATE TABLE places (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  -- On the QR poster and in invite links; letters people can't misread (packages/domain places.ts).
  code TEXT NOT NULL UNIQUE CHECK (length(code) = 7),
  type TEXT NOT NULL CHECK (type IN ('building', 'colony', 'street')),
  -- Many buildings have no name: the label and photo are how people recognise them.
  name TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 80),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 2 AND 80),
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  photo_key TEXT,
  -- Weekdays the team comes, Sunday = 0: "2" or "2,5". Time is "HH:MM" IST.
  wash_days TEXT NOT NULL CHECK (length(wash_days) BETWEEN 1 AND 13),
  wash_time TEXT NOT NULL CHECK (wash_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  -- Joins wait for the team (the society must agree to each new member).
  needs_approval INTEGER NOT NULL DEFAULT 0 CHECK (needs_approval IN (0, 1)),
  -- Vehicles the team can wash there on one wash day; NULL = no limit. Beyond it: waiting list.
  capacity INTEGER CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, created_by_user_id) REFERENCES users(shop_id, id)
);
CREATE INDEX idx_places_shop ON places(shop_id, status);
CREATE INDEX idx_places_location ON places(latitude, longitude) WHERE status = 'active';

-- Flats and houses, so people pick theirs instead of typing. Optional: without them, people type.
CREATE TABLE place_units (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  place_id TEXT NOT NULL,
  block TEXT CHECK (block IS NULL OR length(block) BETWEEN 1 AND 20),
  number TEXT NOT NULL CHECK (length(number) BETWEEN 1 AND 20),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, place_id) REFERENCES places(shop_id, id)
);
CREATE UNIQUE INDEX idx_place_units_live ON place_units(place_id, ifnull(block, ''), number) WHERE archived_at IS NULL;

-- A customer living at a place. pending = the team confirms first (joined away from the place, or
-- the society approves each member); left = moved out; removed = the team took them off.
CREATE TABLE place_members (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  place_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  unit_id TEXT,
  unit_text TEXT CHECK (unit_text IS NULL OR length(unit_text) BETWEEN 1 AND 40),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'left', 'removed')),
  joined_via TEXT NOT NULL CHECK (joined_via IN ('qr', 'link', 'app', 'staff')),
  -- From the place's pin when they joined; NULL = no location shared.
  distance_m INTEGER CHECK (distance_m IS NULL OR distance_m >= 0),
  -- What the team should look at: far_away, needs_approval, unit_taken, not_found (comma list).
  checks TEXT,
  parking_note TEXT CHECK (parking_note IS NULL OR length(parking_note) <= 120),
  added_by_user_id TEXT,
  handled_by_user_id TEXT,
  handled_at TEXT,
  ended_at TEXT,
  end_reason TEXT CHECK (end_reason IS NULL OR length(end_reason) <= 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  CHECK (unit_id IS NOT NULL OR unit_text IS NOT NULL),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, place_id) REFERENCES places(shop_id, id),
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers(shop_id, id),
  FOREIGN KEY (shop_id, unit_id) REFERENCES place_units(shop_id, id),
  FOREIGN KEY (shop_id, added_by_user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, handled_by_user_id) REFERENCES users(shop_id, id)
);
CREATE UNIQUE INDEX idx_place_members_live ON place_members(place_id, customer_id) WHERE status IN ('pending', 'active');
CREATE INDEX idx_place_members_place ON place_members(shop_id, place_id, status);
CREATE INDEX idx_place_members_customer ON place_members(customer_id, status);
CREATE INDEX idx_place_members_unit ON place_members(unit_id) WHERE unit_id IS NOT NULL;

-- A member's vehicle. Joining only asks the kind of vehicle; the washer records the plate at the
-- first wash, which links it to the branch's vehicle (vehicle_id). Existing customers pick theirs.
CREATE TABLE member_vehicles (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  member_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  vehicle_type_id TEXT NOT NULL,
  vehicle_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, member_id) REFERENCES place_members(shop_id, id),
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers(shop_id, id),
  FOREIGN KEY (shop_id, vehicle_type_id) REFERENCES vehicle_types(shop_id, id),
  FOREIGN KEY (shop_id, vehicle_id) REFERENCES vehicles(shop_id, id)
);
CREATE INDEX idx_member_vehicles_member ON member_vehicles(member_id, status);
CREATE UNIQUE INDEX idx_member_vehicles_one_live ON member_vehicles(vehicle_id) WHERE vehicle_id IS NOT NULL AND status = 'active';

-- ─── Plans (business catalog) ───────────────────────────────────────────────

-- Monthly 4 washes, Quarterly 12 (5% off)… Each wash is one catalog service; the price is that
-- service's branch price for the vehicle × washes, less the discount. Plans are switched off,
-- never deleted, because orders point at them.
CREATE TABLE wash_plans (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  washes INTEGER NOT NULL CHECK (washes BETWEEN 1 AND 400),
  months INTEGER NOT NULL CHECK (months BETWEEN 1 AND 24),
  catalog_service_id TEXT NOT NULL,
  discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 9000),
  allow_parts INTEGER NOT NULL DEFAULT 0 CHECK (allow_parts IN (0, 1)),
  popular INTEGER NOT NULL DEFAULT 0 CHECK (popular IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, catalog_service_id) REFERENCES catalog_services(business_id, id)
);
CREATE INDEX idx_wash_plans_business ON wash_plans(business_id, sort_order);
CREATE UNIQUE INDEX idx_wash_plans_one_popular ON wash_plans(business_id) WHERE popular = 1 AND active = 1;

-- ─── Orders: what each vehicle bought ───────────────────────────────────────

-- A plan or a one-time wash for one member vehicle. `snapshot` keeps what was sold (names, prices,
-- rules) so later price changes never touch it. waitlist = the place is full on its first wash
-- day; awaiting_payment = joined, not paid (no washes); active; ended = every wash given.
CREATE TABLE place_orders (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  customer_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  member_vehicle_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('plan', 'single')),
  plan_id TEXT REFERENCES wash_plans(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  snapshot TEXT NOT NULL,
  washes_total INTEGER NOT NULL CHECK (washes_total BETWEEN 1 AND 400),
  washes_used INTEGER NOT NULL DEFAULT 0 CHECK (washes_used >= 0 AND washes_used <= washes_total),
  months INTEGER NOT NULL DEFAULT 1 CHECK (months BETWEEN 1 AND 24),
  per_week INTEGER NOT NULL DEFAULT 1 CHECK (per_week BETWEEN 1 AND 7),
  -- Price of one wash of this kind on this vehicle, for refunds of a cancelled plan.
  single_price INTEGER NOT NULL CHECK (single_price >= 0),
  total INTEGER NOT NULL CHECK (total >= 0),
  pay_mode TEXT NOT NULL DEFAULT 'full' CHECK (pay_mode IN ('full', 'parts')),
  status TEXT NOT NULL CHECK (status IN ('waitlist', 'awaiting_payment', 'active', 'ended', 'cancelled')),
  -- The first wash day ("YYYY-MM-DD"): moves forward while unpaid, fixed once paid.
  first_wash_on TEXT,
  renewal_of TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 200),
  cancelled_by TEXT CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'staff', 'system')),
  refund_due INTEGER NOT NULL DEFAULT 0 CHECK (refund_due >= 0),
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  CHECK ((kind = 'plan') = (plan_id IS NOT NULL)),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers(shop_id, id),
  FOREIGN KEY (shop_id, member_id) REFERENCES place_members(shop_id, id),
  FOREIGN KEY (shop_id, member_vehicle_id) REFERENCES member_vehicles(shop_id, id),
  FOREIGN KEY (shop_id, renewal_of) REFERENCES place_orders(shop_id, id)
);
CREATE INDEX idx_place_orders_member ON place_orders(member_id, status);
CREATE INDEX idx_place_orders_vehicle ON place_orders(member_vehicle_id, status);
CREATE INDEX idx_place_orders_customer ON place_orders(customer_id, created_at);
CREATE INDEX idx_place_orders_shop_status ON place_orders(shop_id, status, first_wash_on);
-- A plan is renewed once.
CREATE UNIQUE INDEX idx_place_orders_one_renewal ON place_orders(renewal_of) WHERE renewal_of IS NOT NULL AND status != 'cancelled';

-- What is paid when: one row in full, or the first part and the equal parts after it.
CREATE TABLE order_installments (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  order_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq BETWEEN 1 AND 13),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  due_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'paid', 'cancelled')),
  payment_id TEXT,
  paid_at TEXT,
  UNIQUE (order_id, seq),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, order_id) REFERENCES place_orders(shop_id, id)
);
CREATE INDEX idx_order_installments_due ON order_installments(shop_id, status, due_on);

-- Holidays: no washes between the two days (inclusive); the plan runs on after.
CREATE TABLE order_pauses (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  order_id TEXT NOT NULL,
  from_on TEXT NOT NULL,
  to_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  cancelled_at TEXT,
  CHECK (to_on >= from_on),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, order_id) REFERENCES place_orders(shop_id, id)
);
CREATE INDEX idx_order_pauses_order ON order_pauses(order_id);

-- What happened to a vehicle on a wash day. done uses a wash; skipped (the customer, before the
-- cut-off), not_found and missed (our side) don't, so the plan runs on.
CREATE TABLE place_visits (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  place_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  member_vehicle_id TEXT NOT NULL,
  date TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('done', 'skipped', 'not_found', 'missed')),
  by_user_id TEXT,
  by_customer INTEGER NOT NULL DEFAULT 0 CHECK (by_customer IN (0, 1)),
  note TEXT CHECK (note IS NULL OR length(note) <= 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (order_id, date),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, place_id) REFERENCES places(shop_id, id),
  FOREIGN KEY (shop_id, order_id) REFERENCES place_orders(shop_id, id),
  FOREIGN KEY (shop_id, member_vehicle_id) REFERENCES member_vehicles(shop_id, id),
  FOREIGN KEY (shop_id, by_user_id) REFERENCES users(shop_id, id)
);
CREATE INDEX idx_place_visits_place_date ON place_visits(place_id, date);

-- ─── Payments (Razorpay only) ───────────────────────────────────────────────

-- One attempt to pay one installment: a Razorpay payment link (or the local test checkout). Money
-- is never edited: a refund adds to refunded and keeps the payment. receipt_no is given when paid.
CREATE TABLE customer_payments (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  customer_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  installment_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'expired')),
  provider TEXT NOT NULL CHECK (provider IN ('razorpay', 'test')),
  link_id TEXT UNIQUE,
  link_url TEXT,
  provider_payment_id TEXT,
  method TEXT,
  refunded INTEGER NOT NULL DEFAULT 0 CHECK (refunded >= 0 AND refunded <= amount),
  receipt_no TEXT UNIQUE,
  gst_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (gst_rate_bp BETWEEN 0 AND 2800),
  created_by TEXT NOT NULL CHECK (created_by IN ('customer', 'staff')),
  expires_at TEXT NOT NULL,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers(shop_id, id),
  FOREIGN KEY (shop_id, order_id) REFERENCES place_orders(shop_id, id),
  FOREIGN KEY (shop_id, installment_id) REFERENCES order_installments(shop_id, id)
);
CREATE INDEX idx_customer_payments_order ON customer_payments(order_id, created_at);
CREATE INDEX idx_customer_payments_open ON customer_payments(status, created_at) WHERE status = 'created';
CREATE INDEX idx_customer_payments_shop_paid ON customer_payments(shop_id, paid_at) WHERE status = 'paid';
-- One installment is paid once, however many links were opened for it.
CREATE UNIQUE INDEX idx_customer_payments_one_paid ON customer_payments(installment_id) WHERE status = 'paid';

-- Money sent back through Razorpay (a cancelled plan, a removed member).
CREATE TABLE customer_refunds (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  payment_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
  provider_refund_id TEXT,
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  processed_at TEXT,
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, payment_id) REFERENCES customer_payments(shop_id, id),
  FOREIGN KEY (shop_id, order_id) REFERENCES place_orders(shop_id, id)
);
CREATE INDEX idx_customer_refunds_payment ON customer_refunds(payment_id);
CREATE INDEX idx_customer_refunds_pending ON customer_refunds(status) WHERE status = 'pending';

-- Receipt numbers per branch per financial year: MCW-<shop code>/26-27/00001. Taken in the same
-- batch as the payment, so they never skip or repeat.
CREATE TABLE receipt_series (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  financial_year TEXT NOT NULL CHECK (length(financial_year) = 5),
  last_number INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  PRIMARY KEY (shop_id, financial_year)
);

-- ─── "Call me back" gets shorter ────────────────────────────────────────────

-- A request now needs only the location, the vehicles and when: name, address and the kind of
-- place become optional. invited_place_id is set when a place starts near the request, so the
-- person can join it in one tap. SQLite can't relax NOT NULL, so the table is rebuilt.
CREATE TABLE service_requests_new (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  phone TEXT NOT NULL,
  name TEXT,
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  area_id TEXT,
  address TEXT,
  place_kind TEXT CHECK (place_kind IS NULL OR place_kind IN ('apartment', 'house', 'small_building', 'office', 'other')),
  place_name TEXT,
  home_text TEXT,
  cars INTEGER NOT NULL DEFAULT 0 CHECK (cars BETWEEN 0 AND 20),
  bikes INTEGER NOT NULL DEFAULT 0 CHECK (bikes BETWEEN 0 AND 20),
  preferred_time TEXT CHECK (preferred_time IS NULL OR preferred_time IN ('early_morning', 'morning', 'evening', 'any')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'out_of_area', 'approved', 'rejected', 'cancelled')),
  handled_by_user_id TEXT,
  handled_at TEXT,
  reason TEXT,
  customer_id TEXT,
  invited_place_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  CHECK (cars + bikes >= 1),
  FOREIGN KEY (shop_id, area_id) REFERENCES service_areas(shop_id, id),
  FOREIGN KEY (shop_id, handled_by_user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers(shop_id, id),
  FOREIGN KEY (shop_id, invited_place_id) REFERENCES places(shop_id, id)
);

INSERT INTO service_requests_new (
  id, shop_id, phone, name, latitude, longitude, area_id, address, place_kind, place_name, home_text,
  cars, bikes, preferred_time, notes, status, handled_by_user_id, handled_at, reason, customer_id, created_at
)
SELECT
  id, shop_id, phone, name, latitude, longitude, area_id, address, place_kind, place_name, home_text,
  cars, bikes, preferred_time, notes, status, handled_by_user_id, handled_at, reason, customer_id, created_at
FROM service_requests;

DROP TABLE service_requests;
ALTER TABLE service_requests_new RENAME TO service_requests;

CREATE INDEX idx_service_requests_shop_status ON service_requests(shop_id, status, created_at);
CREATE INDEX idx_service_requests_phone ON service_requests(phone, created_at);
CREATE UNIQUE INDEX idx_service_requests_one_open ON service_requests(phone) WHERE status IN ('pending', 'out_of_area');
CREATE INDEX idx_service_requests_invited ON service_requests(invited_place_id) WHERE invited_place_id IS NOT NULL;
