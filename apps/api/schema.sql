-- The current mana_db schema, in one readable file. This is NOT run against any database:
-- databases are built and changed only by the numbered files in ./migrations, applied with
-- `wrangler d1 migrations apply` (npm run db:migrate:local / db:migrate:remote).
--
-- Changing the schema: add a new migrations/NNNN_what.sql AND update this file to match.
-- `npm run db:check` builds a database from each and fails if they differ in any table,
-- column, index or trigger, so the two can't drift.
--
-- Must also stay in sync with packages/db/prisma/schema.prisma (Prisma generates types from
-- that file; D1 isn't managed by `prisma migrate`).
--
-- Money is stored in paise (1 rupee = 100 paise). Timestamps are ISO-8601 UTC text in the
-- exact shape Prisma writes ("2026-10-02T09:02:18.357+00:00"), defaults included, so text
-- comparisons and ordering stay correct whichever side wrote the row.
--
-- Multi-shop: every table except shops, platform_settings, signup_codes, rate_limits,
-- billing_events, customer_accounts and the business-level service network tables (which carry a
-- business_id instead) has a shop_id. Each parent table
-- has UNIQUE (shop_id, id), and every link to it is a composite foreign key on (shop_id, x_id),
-- so the database itself refuses a row that points at another shop's customer, vehicle,
-- service or staff member — isolation doesn't depend on every route remembering to check.
-- (D1 enforces foreign keys.) shop_id has no default on purpose: see schema.prisma.

-- ─── Schema ─────────────────────────────────────────────────────────────────

-- One car wash on the platform.
CREATE TABLE shops (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,         -- 6-digit shop ID staff type to ask to join; not a secret
  name TEXT NOT NULL,
  city TEXT,
  -- Subscription status from Razorpay: trial | pending | active | past_due | cancelled | free.
  -- Free vs Pro is worked out from the dates below (packages/domain/src/plans.ts), not this.
  plan TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at TEXT,
  paid_until TEXT,                   -- end of the last paid period
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  subscription_id TEXT,              -- Razorpay subscription (sub_…) currently attached
  billing_interval TEXT CHECK (billing_interval IN ('monthly', 'yearly')),
  price_paise INTEGER CHECK (price_paise >= 0), -- what the attached subscription charges
  -- Set when the shop's first founder-price payment succeeds. Counts toward the 50 founder slots
  -- forever, even after cancelling (the founder price itself is only kept while subscribed).
  founder_at TEXT,
  -- A founder slot kept for this shop while its founder-price payment is on its way (open
  -- checkout, or first charge due at the end of the trial). Lapses if the shop never pays.
  founder_hold_until TEXT,
  -- When that hold was taken: for the last slot, the earlier claim wins (ties by shop id).
  founder_hold_at TEXT,
  -- Listed in the MANA Car Wash app. Set by Sprixia for MANA's own branches, never by an owner, so
  -- other car washes on the platform never show up there and their customers can't sign in to it.
  in_customer_app INTEGER NOT NULL DEFAULT 0 CHECK (in_customer_app IN (0, 1)),
  -- The hub and how far from it the branch washes. No radius = only its service_areas.
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  service_radius_km REAL CHECK (service_radius_km IS NULL OR service_radius_km BETWEEN 0.5 AND 50),
  -- Contact details and opening hours shown in the app. Hours are "HH:MM" IST, both or neither;
  -- weekly_off is the day the branch is closed (Sunday = 0 … Saturday = 6).
  address TEXT CHECK (address IS NULL OR length(address) BETWEEN 5 AND 300),
  contact_phone TEXT CHECK (contact_phone IS NULL OR length(contact_phone) = 10),
  opens_at TEXT CHECK (opens_at IS NULL OR opens_at GLOB '[0-2][0-9]:[0-5][0-9]'),
  closes_at TEXT CHECK (closes_at IS NULL OR closes_at GLOB '[0-2][0-9]:[0-5][0-9]'),
  weekly_off INTEGER CHECK (weekly_off IS NULL OR weekly_off BETWEEN 0 AND 6),
  -- The business this branch belongs to, the price book and zone it is priced with (NULL =
  -- the business's default book, no zone), and the catalog_version its menu was last built from.
  business_id TEXT REFERENCES businesses(id),
  price_book_id TEXT REFERENCES price_books(id),
  price_zone_id TEXT REFERENCES price_zones(id),
  menu_version INTEGER NOT NULL DEFAULT 0
);

-- Every successful (or failed) subscription charge, for the owner's payment history.
CREATE TABLE billing_payments (
  id TEXT PRIMARY KEY,               -- Razorpay payment id (pay_…)
  shop_id TEXT NOT NULL REFERENCES shops(id),
  subscription_id TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise >= 0),
  status TEXT NOT NULL CHECK (status IN ('captured', 'failed', 'refunded')),
  method TEXT,                       -- upi | card | …
  period_end TEXT,                   -- paid_until this charge bought
  paid_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (shop_id, id)
);

-- Razorpay webhook deliveries already handled (x-razorpay-event-id), so a retried delivery is a
-- no-op. Not shop data; kept for the record.
CREATE TABLE billing_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  shop_id TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'))
);

-- Settings for the platform itself (Sprixia), not any one shop.
CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'))
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,                -- staff: one shop; an owner may run several branches, one row each (same PIN)
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'staff')),
  active INTEGER NOT NULL DEFAULT 1,  -- deactivated users can't sign in or call the API
  pin_hash TEXT,                      -- PBKDF2 "iterations$salt$hash"; NULL = PIN sign-in not set up
  pin_failed_attempts INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TEXT,
  -- Copied into every session token. Bumping it (PIN changed or reset, removed, turned off)
  -- signs out every phone holding an older token on its next request.
  session_version INTEGER NOT NULL DEFAULT 0,
  removed_at TEXT,                    -- removed from the team: kept for history, number is free again
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (shop_id, id)
);

CREATE TABLE vehicle_types (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'car', -- car | bike
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,  -- 0 = owner deselected it; kept because customers' vehicles use it
  body_type_id TEXT REFERENCES body_types(id), -- what it stands for; prices come from its class and size
  UNIQUE (shop_id, id)
);

CREATE TABLE services (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  applies_to TEXT NOT NULL DEFAULT 'car', -- car | bike | both
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Generated from this catalog service (NULL = made by hand at the branch).
  catalog_service_id TEXT REFERENCES catalog_services(id),
  modes TEXT NOT NULL DEFAULT 'both' CHECK (modes IN ('hub', 'doorstep', 'both')),
  -- The branch stopped offering this catalog service (when the pricing policy allows it).
  branch_hidden INTEGER NOT NULL DEFAULT 0 CHECK (branch_hidden IN (0, 1)),
  UNIQUE (shop_id, id)
);

-- A combo is a service of its own (own price per vehicle) that bundles other services.
-- These rows list what it includes, so New Wash can show "Includes …" and stop double-picking.
CREATE TABLE service_combo_items (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  combo_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  PRIMARY KEY (combo_id, service_id),
  FOREIGN KEY (shop_id, combo_id) REFERENCES services(shop_id, id),
  FOREIGN KEY (shop_id, service_id) REFERENCES services(shop_id, id)
);

-- The branch menu's prices: one per service, vehicle type and way of delivering. For catalog
-- services these rows are generated (source template/override); never edit them directly.
CREATE TABLE service_prices (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  service_id TEXT NOT NULL,
  vehicle_type_id TEXT NOT NULL,
  price INTEGER NOT NULL, -- paise
  mode TEXT NOT NULL DEFAULT 'hub' CHECK (mode IN ('hub', 'doorstep')),
  -- manual = typed at the branch; template = from the catalog; override = branch price within policy
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'template', 'override')),
  list_price INTEGER CHECK (list_price IS NULL OR list_price >= 0), -- the catalog price, for template/override
  UNIQUE (service_id, vehicle_type_id, mode),
  FOREIGN KEY (shop_id, service_id) REFERENCES services(shop_id, id),
  FOREIGN KEY (shop_id, vehicle_type_id) REFERENCES vehicle_types(shop_id, id)
);

-- A branch's own price for a catalog service, kept even when the policy stops applying it.
CREATE TABLE branch_price_overrides (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  service_id TEXT NOT NULL,
  vehicle_type_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('hub', 'doorstep')),
  price INTEGER NOT NULL CHECK (price BETWEEN 0 AND 10000000),
  updated_by_user_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (service_id, vehicle_type_id, mode),
  FOREIGN KEY (shop_id, service_id) REFERENCES services(shop_id, id),
  FOREIGN KEY (shop_id, vehicle_type_id) REFERENCES vehicle_types(shop_id, id),
  FOREIGN KEY (shop_id, updated_by_user_id) REFERENCES users(shop_id, id)
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT,
  phone TEXT NOT NULL,
  source TEXT,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (shop_id, phone),
  UNIQUE (shop_id, id)
);

CREATE TABLE vehicles (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  customer_id TEXT NOT NULL,
  registration_number TEXT NOT NULL,
  make TEXT,
  model TEXT,
  vehicle_type_id TEXT NOT NULL,
  -- Bumped whenever anything New Wash's customer suggestions show for this vehicle changes
  -- (the vehicle, its owner's name/phone, or a job for that owner). Phones sync their offline
  -- customer directory by pulling rows changed since their last cursor.
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  -- The customer removed it from their list in the MANA Car Wash app. Only hides it there.
  app_hidden_at TEXT,
  UNIQUE (shop_id, registration_number),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers(shop_id, id),
  FOREIGN KEY (shop_id, vehicle_type_id) REFERENCES vehicle_types(shop_id, id)
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  customer_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'washing', 'ready', 'paid', 'void')),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  discount_reason TEXT,
  total INTEGER NOT NULL CHECK (total >= 0 AND total = subtotal - discount),
  payment_method TEXT CHECK (payment_method IN ('cash', 'upi', 'other')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
  paid_by_user_id TEXT,   -- who collected the money
  voided_by_user_id TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  completed_at TEXT,
  delivery_mode TEXT NOT NULL DEFAULT 'hub' CHECK (delivery_mode IN ('hub', 'doorstep')),
  service_point_id TEXT REFERENCES service_points(id), -- the hub or doorstep team that did it
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers(shop_id, id),
  FOREIGN KEY (shop_id, vehicle_id) REFERENCES vehicles(shop_id, id),
  FOREIGN KEY (shop_id, created_by_user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, paid_by_user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, voided_by_user_id) REFERENCES users(shop_id, id)
);

-- Append-only audit trail: every create, status change, payment, void, and correction.
-- Never updated or deleted, so any number on a report can be traced back to who did what.
CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL, -- created | status_changed | paid | voided | payment_method_changed
  from_value TEXT,
  to_value TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (shop_id, job_id) REFERENCES jobs(shop_id, id),
  FOREIGN KEY (shop_id, user_id) REFERENCES users(shop_id, id)
);

CREATE TABLE job_services (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  job_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  -- copied at creation time; never re-joins to the live price
  price_at_time INTEGER NOT NULL CHECK (price_at_time >= 0),
  -- washer commission per unit, copied the same way
  commission_at_time INTEGER NOT NULL DEFAULT 0 CHECK (commission_at_time >= 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  PRIMARY KEY (job_id, service_id),
  FOREIGN KEY (shop_id, job_id) REFERENCES jobs(shop_id, id),
  FOREIGN KEY (shop_id, service_id) REFERENCES services(shop_id, id)
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  category TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0), -- paise
  description TEXT,        -- "used for" / free note
  item_name TEXT,          -- what was bought, e.g. "Foam shampoo"
  quantity REAL,           -- how much, in `unit`; set together with unit
  unit TEXT,               -- ml | l | g | kg | pcs | kwh | days | hours | tankers
  bill_photo_key TEXT,     -- R2 key; required for new entries, kept as long as the expense
  item_photo_key TEXT,     -- R2 key of the product / meter / part photo
  -- only cash leaves the drawer
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'upi', 'other')),
  date TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  voided_by_user_id TEXT,
  void_reason TEXT,
  voided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, created_by_user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, voided_by_user_id) REFERENCES users(shop_id, id)
);

-- Comeback and referral coupons. Bound to the vehicle it was issued for and to that vehicle's
-- owner at issue time: redeemable on that vehicle or the same owner's other vehicles, once,
-- before expires_at. "Expired" is derived (status stays 'active'); a vehicle changing hands
-- cancels it.
CREATE TABLE coupons (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  code TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'comeback' CHECK (kind IN ('comeback', 'referral')),
  vehicle_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  percent INTEGER NOT NULL CHECK (percent BETWEEN 5 AND 10),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'cancelled')),
  expires_at TEXT NOT NULL,
  issued_by_user_id TEXT NOT NULL,
  -- Claimed before the job row is written (same request), so this is deliberately not a FK.
  redeemed_job_id TEXT UNIQUE,
  redeemed_by_user_id TEXT,
  redeemed_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT, -- replaced | owner_changed | referral_voided
  notified_at TEXT,   -- when someone sent it to the customer on WhatsApp
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (shop_id, code),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, vehicle_id) REFERENCES vehicles(shop_id, id),
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers(shop_id, id),
  FOREIGN KEY (shop_id, issued_by_user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, redeemed_by_user_id) REFERENCES users(shop_id, id)
);

-- A new customer's first wash, credited to the existing customer who sent them. The new
-- customer's discount is applied on that wash; the referrer's reward coupon is issued once the
-- wash is paid (status 'rewarded'), or only counted when they already hold a live referral
-- coupon ('counted'). Voiding the wash cancels the referral and any unused reward.
CREATE TABLE referrals (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  referred_customer_id TEXT NOT NULL UNIQUE,
  referrer_customer_id TEXT NOT NULL,
  -- Written before the job row (same request), so like coupons.redeemed_job_id not a FK.
  job_id TEXT NOT NULL UNIQUE,
  percent INTEGER NOT NULL CHECK (percent BETWEEN 5 AND 10),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'rewarded', 'counted', 'cancelled')),
  reward_coupon_id TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  settled_at TEXT,
  FOREIGN KEY (shop_id, referred_customer_id) REFERENCES customers(shop_id, id),
  FOREIGN KEY (shop_id, referrer_customer_id) REFERENCES customers(shop_id, id),
  FOREIGN KEY (shop_id, reward_coupon_id) REFERENCES coupons(shop_id, id),
  FOREIGN KEY (shop_id, created_by_user_id) REFERENCES users(shop_id, id)
);

-- Shop-wide settings the owner edits in the app (e.g. the Google review link).
CREATE TABLE app_settings (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_by_user_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (shop_id, key),
  FOREIGN KEY (shop_id, updated_by_user_id) REFERENCES users(shop_id, id)
);

-- Staff commission (paise) for getting a customer to take a service, per service per vehicle
-- size. Only the services the owner picks carry one (e.g. rust coating); everything else has
-- no row. Copied onto each job line when the job is created, so changing a rate never
-- rewrites past earnings.
CREATE TABLE commission_rates (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  service_id TEXT NOT NULL,
  vehicle_type_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (service_id, vehicle_type_id),
  FOREIGN KEY (shop_id, service_id) REFERENCES services(shop_id, id),
  FOREIGN KEY (shop_id, vehicle_type_id) REFERENCES vehicle_types(shop_id, id)
);

-- Who washed the car — an optional record, no money attached.
CREATE TABLE job_washers (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assigned_by_user_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (job_id, user_id),
  FOREIGN KEY (shop_id, job_id) REFERENCES jobs(shop_id, id),
  FOREIGN KEY (shop_id, user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, assigned_by_user_id) REFERENCES users(shop_id, id)
);

-- Who got the customer to take the job's commission services. The job's commission is split
-- equally between them. Only jobs with a commission service have rows.
CREATE TABLE job_sellers (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assigned_by_user_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (job_id, user_id),
  FOREIGN KEY (shop_id, job_id) REFERENCES jobs(shop_id, id),
  FOREIGN KEY (shop_id, user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, assigned_by_user_id) REFERENCES users(shop_id, id)
);

-- Owner-marked attendance, one row per person per IST calendar day (YYYY-MM-DD).
CREATE TABLE attendance (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'half', 'absent')),
  marked_by_user_id TEXT NOT NULL,
  marked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (user_id, date),
  FOREIGN KEY (shop_id, user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, marked_by_user_id) REFERENCES users(shop_id, id)
);

-- The cash drawer, one row per shop per IST calendar day (YYYY-MM-DD). `expected` is frozen at
-- close so a later correction shows up as a difference against what the closer actually saw.
CREATE TABLE cash_days (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  date TEXT NOT NULL,
  opening_float INTEGER NOT NULL CHECK (opening_float >= 0),
  float_set_by_user_id TEXT NOT NULL,
  float_set_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  expected INTEGER,
  counted INTEGER CHECK (counted >= 0),
  note TEXT,
  closed_by_user_id TEXT,
  closed_at TEXT,
  reopened_by_user_id TEXT,
  reopened_at TEXT,
  reopen_reason TEXT,
  PRIMARY KEY (shop_id, date),
  FOREIGN KEY (shop_id, float_set_by_user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, closed_by_user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, reopened_by_user_id) REFERENCES users(shop_id, id)
);

-- Every close of a cash day that was later reopened, so a reopen never erases what was counted.
-- cash_days keeps the current state; a row is copied here (id = shop:date:closed_at) just before
-- the day reopens, then stamped with who reopened it and why. Append-only.
CREATE TABLE cash_day_closes (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  date TEXT NOT NULL,
  opening_float INTEGER NOT NULL,
  expected INTEGER,
  counted INTEGER,
  note TEXT,
  closed_by_user_id TEXT,
  closed_at TEXT NOT NULL,
  reopened_by_user_id TEXT,
  reopened_at TEXT,
  reopen_reason TEXT,
  FOREIGN KEY (shop_id, closed_by_user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, reopened_by_user_id) REFERENCES users(shop_id, id)
);

-- Before/after photos. The image lives in R2 under r2_key (shops/<shop>/photos/...); rows older
-- than the retention window are purged (object and row) by the daily scheduled job.
CREATE TABLE job_photos (
  id TEXT PRIMARY KEY, -- client-generated, so a replayed upload is idempotent
  shop_id TEXT NOT NULL REFERENCES shops(id),
  job_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('before', 'after')),
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  taken_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  deleted_at TEXT,
  deleted_by_user_id TEXT,
  FOREIGN KEY (shop_id, job_id) REFERENCES jobs(shop_id, id),
  FOREIGN KEY (shop_id, taken_by_user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, deleted_by_user_id) REFERENCES users(shop_id, id)
);

-- One-time sign-in codes sent to the owner on WhatsApp (first sign-in, forgotten PIN). Only a
-- keyed hash is stored; a code dies after it's used, after too many wrong tries, or at expiry.
CREATE TABLE login_codes (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (shop_id, user_id) REFERENCES users(shop_id, id)
);

-- WhatsApp codes for people who don't have an account yet: starting a new shop, or asking to
-- join one. Not tied to a shop. `ip` lets one device be capped however many numbers it tries.
CREATE TABLE signup_codes (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL, -- signup | join | phone | customer
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'))
);

-- Named places a branch serves ("Kovur", "Nellore"): the backup when a customer of the MANA Car
-- Wash app doesn't share their location. Switching one off keeps the row (requests point at it).
CREATE TABLE service_areas (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,            -- lower-cased, single-spaced name; one live area per name
  pincode TEXT CHECK (pincode IS NULL OR length(pincode) = 6),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (shop_id, id)
);

-- One per phone number that has signed in to the MANA Car Wash app — platform-level, because one
-- person can be a customer of several branches. Which branches is never stored: it's every listed
-- shop with a customer on this number, so registering (or removing) them takes effect at once.
CREATE TABLE customer_accounts (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  -- In every customer token; bumping it signs the app out on every phone.
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  last_seen_at TEXT
);

-- "Request service" from the app, by a phone proved with a WhatsApp code. shop_id is the branch
-- that serves the place, or for out_of_area the nearest one, so somebody always sees it.
-- Approving registers a customer on that phone (customer_id), which is what lets them sign in.
-- Only the location, vehicles and when are required; invited_place_id is a place started near it.
CREATE TABLE service_requests (
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

-- "Add my vehicle" from the app. The team approves (which creates the vehicle for this customer)
-- or declines with a reason the customer sees. One open request per plate per branch.
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

-- A customer's rating of one of their paid washes; they can change it for a while after.
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

-- A problem a customer reported from the app, about one wash (job_id) or the branch in general.
-- The team resolves it with a note the customer sees.
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

-- Someone asking to join a shop with its shop ID. Nothing is created in the team until the owner
-- approves; approval creates the user, who then picks their own PIN. Pending requests older than
-- JOIN_REQUEST_TTL_DAYS count as expired.
CREATE TABLE join_requests (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  user_id TEXT,                           -- set on approval
  decided_by_user_id TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (shop_id, user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, decided_by_user_id) REFERENCES users(shop_id, id)
);

-- Crashes from the app and unhandled API errors. Each owner sees their own shop's; shop_id is
-- NULL for platform errors (nightly job, requests before sign-in), which only Sprixia sees.
CREATE TABLE app_errors (
  id TEXT PRIMARY KEY,
  shop_id TEXT REFERENCES shops(id),
  source TEXT NOT NULL, -- app | api
  user_id TEXT,
  message TEXT NOT NULL,
  stack TEXT,
  context TEXT,
  app_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'))
);

-- What the team did about a vehicle's reminder. Tied to the visit it was about
-- (last_visit_at): once the vehicle comes back, the old state no longer applies.
CREATE TABLE vehicle_reminders (
  vehicle_id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  last_visit_at TEXT NOT NULL,
  reminded_at TEXT,
  reminded_by_user_id TEXT,
  snoozed_until TEXT,
  dismissed_at TEXT,
  dismissed_by_user_id TEXT,
  FOREIGN KEY (shop_id, vehicle_id) REFERENCES vehicles(shop_id, id),
  FOREIGN KEY (shop_id, reminded_by_user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, dismissed_by_user_id) REFERENCES users(shop_id, id)
);

-- Inventory: consumables the shop keeps (shampoo, wax, cloths, bill books). `balance` is in the
-- base unit and always equals the sum of the item's stock_moves; low_at is the owner's alert level.
CREATE TABLE stock_items (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,            -- lower-cased, single-spaced name; one live item per name
  -- ml and g entries are converted
  unit TEXT NOT NULL CHECK (unit IN ('l', 'kg', 'pcs')),
  balance REAL NOT NULL DEFAULT 0,
  low_at REAL,                       -- warn at or below this; NULL = no warning
  active INTEGER NOT NULL DEFAULT 1, -- 0 = removed from the list; moves are kept for history
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, created_by_user_id) REFERENCES users(shop_id, id)
);

-- Every change to a balance, append-only: bought (from an expense or by hand), used, counted,
-- handed to a customer as a welcome gift, or reversed when its expense or gift was voided.
-- `quantity` is signed, in the item's unit.
CREATE TABLE stock_moves (
  id TEXT PRIMARY KEY,               -- client-generated, so a replayed offline entry is idempotent
  shop_id TEXT NOT NULL REFERENCES shops(id),
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('in', 'use', 'count', 'void', 'gift')),
  quantity REAL NOT NULL,
  balance_after REAL NOT NULL,
  note TEXT,
  expense_id TEXT,                   -- the purchase this came from, if any
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (shop_id, item_id) REFERENCES stock_items(shop_id, id),
  FOREIGN KEY (shop_id, expense_id) REFERENCES expenses(shop_id, id),
  FOREIGN KEY (shop_id, created_by_user_id) REFERENCES users(shop_id, id)
);

-- Rewards (Pro). Stamp cards: one row per service the owner put on a card. A car's stamps are
-- never stored — they're worked out from its paid washes (and combos that include the service),
-- so voids and rule changes can't leave a card wrong. Switching a card off keeps the row.
CREATE TABLE reward_rules (
  service_id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  every INTEGER NOT NULL CHECK (every BETWEEN 2 AND 100), -- paid visits that earn one free wash
  active INTEGER NOT NULL DEFAULT 1,
  updated_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (shop_id, service_id) REFERENCES services(shop_id, id),
  FOREIGN KEY (shop_id, updated_by_user_id) REFERENCES users(shop_id, id)
);

-- A free wash used from a car's card. `seq` numbers the free washes taken from one card; the
-- unique index makes two phones spending the same free wash at once fail instead of both
-- succeeding. A claim counts while its job isn't voided. Written before the job row (same
-- request) and deleted if the job can't be created, so job_id is deliberately not a FK.
CREATE TABLE reward_claims (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  vehicle_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  job_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (vehicle_id, service_id, seq),
  UNIQUE (job_id, service_id),
  FOREIGN KEY (shop_id, vehicle_id) REFERENCES vehicles(shop_id, id),
  FOREIGN KEY (shop_id, service_id) REFERENCES services(shop_id, id),
  FOREIGN KEY (shop_id, created_by_user_id) REFERENCES users(shop_id, id)
);

-- What every new car gets on its first paid visit: inventory items and how much of each
-- (in the item's unit).
CREATE TABLE reward_gift_items (
  stock_item_id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_by_user_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (shop_id, stock_item_id) REFERENCES stock_items(shop_id, id),
  FOREIGN KEY (shop_id, updated_by_user_id) REFERENCES users(shop_id, id)
);

-- One welcome-gift item for one car. Written when its first wash is paid: 'given' when the stock
-- was there (taken out by stock move "gift:<id>"), otherwise 'owed' until someone hands it over.
-- Owed gifts never expire. Voiding the wash cancels the gift and puts given stock back
-- (move "gift-back:<id>"). id = "<job_id>:<stock_item_id>", so a retried payment can't add it twice.
CREATE TABLE reward_gifts (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  job_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  stock_item_id TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'owed' CHECK (status IN ('owed', 'given', 'cancelled')),
  given_at TEXT,
  given_by_user_id TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (shop_id, job_id) REFERENCES jobs(shop_id, id),
  FOREIGN KEY (shop_id, vehicle_id) REFERENCES vehicles(shop_id, id),
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers(shop_id, id),
  FOREIGN KEY (shop_id, stock_item_id) REFERENCES stock_items(shop_id, id),
  FOREIGN KEY (shop_id, given_by_user_id) REFERENCES users(shop_id, id)
);

-- Fixed-window request counters for brute-force protection (PIN and code guesses, sign-up),
-- keyed by what is being limited, e.g. "pin:ip:1.2.3.4". Not shop data; old windows are
-- deleted by the nightly job.
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL, -- unix seconds, start of the current window
  count INTEGER NOT NULL
);

-- ─── Service network ────────────────────────────────────────────────────────
-- A business owns one catalog (vehicle classes and sizes, body types, services, base prices by
-- size, pricing rules); its branches run service points (a hub, doorstep teams). Each branch's
-- services and service_prices are generated from those (packages/db catalogRepo.publishShop).
-- These tables are business-level, not shop-scoped: they carry business_id, and every link
-- inside a business is a composite foreign key on (business_id, x_id).

CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  -- Bumped on every catalog change; a branch whose menu_version is behind gets its menu rebuilt.
  catalog_version INTEGER NOT NULL DEFAULT 1 CHECK (catalog_version >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'))
);

-- People who run the business catalog, by phone (one owner row per branch, same number).
CREATE TABLE business_admins (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  phone TEXT NOT NULL CHECK (length(phone) = 10),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (business_id, phone)
);

-- Business-wide settings, e.g. the pricing policy (packages/domain serviceNetwork.ts).
CREATE TABLE business_settings (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_by_phone TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (business_id, key)
);

-- Keys come from packages/domain vehicleCatalog.ts and never change; names are the business's.
CREATE TABLE vehicle_classes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  key TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (business_id, key),
  UNIQUE (business_id, id)
);

CREATE TABLE vehicle_sizes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  class_id TEXT NOT NULL,
  key TEXT NOT NULL CHECK (key IN ('S', 'M', 'L', 'XL')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (class_id, key),
  UNIQUE (business_id, id),
  UNIQUE (class_id, id),
  FOREIGN KEY (business_id, class_id) REFERENCES vehicle_classes(business_id, id)
);

-- Sedan, Tractor…: what a branch's vehicle type stands for. The size can be moved; it must
-- belong to the body type's class.
CREATE TABLE body_types (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  key TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  class_id TEXT NOT NULL,
  size_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (business_id, key),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, class_id) REFERENCES vehicle_classes(business_id, id),
  FOREIGN KEY (class_id, size_id) REFERENCES vehicle_sizes(class_id, id)
);

CREATE TABLE catalog_services (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  description TEXT CHECK (description IS NULL OR length(description) <= 160),
  -- Where it can be done: underbody needs the hub's ramp, so it's 'hub'.
  modes TEXT NOT NULL DEFAULT 'both' CHECK (modes IN ('hub', 'doorstep', 'both')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (business_id, id)
);

-- Which vehicle classes a service is for.
CREATE TABLE catalog_service_classes (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  service_id TEXT NOT NULL,
  class_id TEXT NOT NULL,
  PRIMARY KEY (service_id, class_id),
  FOREIGN KEY (business_id, service_id) REFERENCES catalog_services(business_id, id),
  FOREIGN KEY (business_id, class_id) REFERENCES vehicle_classes(business_id, id)
);

-- What a combo bundles (a combo has its own price; this stops double-charging).
CREATE TABLE catalog_combo_items (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  combo_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  PRIMARY KEY (combo_id, service_id),
  CHECK (combo_id != service_id),
  FOREIGN KEY (business_id, combo_id) REFERENCES catalog_services(business_id, id),
  FOREIGN KEY (business_id, service_id) REFERENCES catalog_services(business_id, id)
);

-- A price table; exactly one default per business, used by branches not given another.
CREATE TABLE price_books (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (business_id, id)
);

-- Base price of a service for one vehicle size, in paise. No row = not offered for that size.
CREATE TABLE price_book_entries (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  price_book_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  size_id TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price BETWEEN 0 AND 10000000),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (price_book_id, service_id, size_id),
  FOREIGN KEY (business_id, price_book_id) REFERENCES price_books(business_id, id),
  FOREIGN KEY (business_id, service_id) REFERENCES catalog_services(business_id, id),
  FOREIGN KEY (business_id, size_id) REFERENCES vehicle_sizes(business_id, id)
);

-- Extra for delivering a different way (doorstep: travel + water). class_id NULL = every class;
-- a class-specific rule wins. The id is derived from (business, mode, class).
CREATE TABLE mode_adjustments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  mode TEXT NOT NULL CHECK (mode IN ('hub', 'doorstep')),
  class_id TEXT,
  percent_bp INTEGER NOT NULL DEFAULT 0 CHECK (percent_bp BETWEEN -9000 AND 20000),
  fixed_paise INTEGER NOT NULL DEFAULT 0 CHECK (fixed_paise BETWEEN -1000000 AND 1000000),
  min_extra_paise INTEGER NOT NULL DEFAULT 0 CHECK (min_extra_paise BETWEEN 0 AND 1000000),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  FOREIGN KEY (business_id, class_id) REFERENCES vehicle_classes(business_id, id)
);

-- A city or area priced up or down ("Nellore city +10%"); branches are put in a zone.
CREATE TABLE price_zones (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  percent_bp INTEGER NOT NULL DEFAULT 0 CHECK (percent_bp BETWEEN -5000 AND 10000),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (business_id, id)
);

-- How a branch delivers: its hub and each doorstep team, with base and reach. A branch with none
-- behaves as a plain hub that washes every class.
CREATE TABLE service_points (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  kind TEXT NOT NULL CHECK (kind IN ('hub', 'doorstep')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  radius_km REAL CHECK (radius_km IS NULL OR radius_km BETWEEN 0.5 AND 50),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (radius_km IS NULL OR latitude IS NOT NULL),
  UNIQUE (shop_id, id)
);

-- The vehicle classes a service point can wash (a doorstep team with a tank kit adds Farm).
CREATE TABLE service_point_classes (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  point_id TEXT NOT NULL,
  class_id TEXT NOT NULL REFERENCES vehicle_classes(id),
  PRIMARY KEY (point_id, class_id),
  FOREIGN KEY (shop_id, point_id) REFERENCES service_points(shop_id, id)
);

-- ─── Places and plans ───────────────────────────────────────────────────────

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
  -- Setup before anyone can join: a teammate inspects and saves a draft, sends it for review, the
  -- owner makes it live. `status` is how a live community runs.
  stage TEXT NOT NULL DEFAULT 'live' CHECK (stage IN ('draft', 'review', 'live')),
  -- What the visit found, JSON (packages/domain communities.ts).
  inspection TEXT CHECK (inspection IS NULL OR length(inspection) <= 2000),
  contact_name TEXT CHECK (contact_name IS NULL OR length(contact_name) BETWEEN 1 AND 60),
  contact_phone TEXT CHECK (contact_phone IS NULL OR length(contact_phone) = 10),
  -- For the team on site: "call security before entering", where the tap is.
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 500),
  -- Days and times residents asked for, best first, JSON: [{"days":[3,5,0],"time":"06:30"}].
  proposed_slots TEXT CHECK (proposed_slots IS NULL OR length(proposed_slots) <= 500),
  -- Who goes there: user ids, comma separated.
  team_user_ids TEXT CHECK (team_user_ids IS NULL OR length(team_user_ids) <= 1000),
  review_note TEXT CHECK (review_note IS NULL OR length(review_note) <= 300),
  submitted_at TEXT,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, created_by_user_id) REFERENCES users(shop_id, id)
);

-- The gate, parking, water point and building, from the inspection or later visits.
CREATE TABLE place_photos (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  place_id TEXT NOT NULL,
  photo_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('gate', 'parking', 'water', 'building', 'other')),
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, place_id) REFERENCES places(shop_id, id),
  FOREIGN KEY (shop_id, created_by_user_id) REFERENCES users(shop_id, id)
);

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
-- A plan is renewed once.

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
  -- Proof of a wash: the after photo, and how far from the place the washer recorded it.
  photo_key TEXT,
  distance_m INTEGER CHECK (distance_m IS NULL OR distance_m >= 0),
  -- A plan wash used at the shop: the shop wash it paid for (undone when that wash is voided).
  job_id TEXT,
  UNIQUE (order_id, date),
  UNIQUE (shop_id, id),
  FOREIGN KEY (shop_id, place_id) REFERENCES places(shop_id, id),
  FOREIGN KEY (shop_id, order_id) REFERENCES place_orders(shop_id, id),
  FOREIGN KEY (shop_id, member_vehicle_id) REFERENCES member_vehicles(shop_id, id),
  FOREIGN KEY (shop_id, by_user_id) REFERENCES users(shop_id, id)
);

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
-- One installment is paid once, however many links were opened for it.

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

-- Receipt numbers per branch per financial year: MCW-<shop code>/26-27/00001. Taken in the same
-- batch as the payment, so they never skip or repeat.
CREATE TABLE receipt_series (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  financial_year TEXT NOT NULL CHECK (length(financial_year) = 5),
  last_number INTEGER NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  PRIMARY KEY (shop_id, financial_year)
);


-- Indexes for the app's actual hot paths: today's job board, the dashboard, and lookups. Every
-- list the app shows is one shop's, so those indexes lead with shop_id.
CREATE INDEX idx_users_shop ON users(shop_id);
-- Removed team members keep their row for history but give up the number. A number can be live in
-- several shops only as the owner of each (enforced by the API: routes/auth.ts `/shops`).
CREATE UNIQUE INDEX idx_users_shop_phone_live ON users(shop_id, phone) WHERE removed_at IS NULL;
CREATE INDEX idx_users_phone ON users(phone);

-- Same rule in the database: a number live in more than one shop must be the owner in all of them.
CREATE TRIGGER trg_users_phone_insert BEFORE INSERT ON users
WHEN NEW.removed_at IS NULL AND EXISTS (
  SELECT 1 FROM users u
  WHERE u.phone = NEW.phone AND u.removed_at IS NULL AND u.shop_id != NEW.shop_id
    AND (u.role != 'owner' OR NEW.role != 'owner')
)
BEGIN
  SELECT RAISE(ABORT, 'phone_in_use');
END;

CREATE TRIGGER trg_users_phone_update BEFORE UPDATE OF phone, role, removed_at ON users
WHEN NEW.removed_at IS NULL AND EXISTS (
  SELECT 1 FROM users u
  WHERE u.phone = NEW.phone AND u.removed_at IS NULL AND u.id != NEW.id AND u.shop_id != NEW.shop_id
    AND (u.role != 'owner' OR NEW.role != 'owner')
)
BEGIN
  SELECT RAISE(ABORT, 'phone_in_use');
END;
-- The audit trails are append-only in the database too, not just by convention: a bug or a
-- hand-run query can't rewrite who did what. (Back-dating a stock move's created_at in demo
-- data is still allowed; its amounts and links are not.)
CREATE TRIGGER trg_job_events_no_update BEFORE UPDATE ON job_events
BEGIN
  SELECT RAISE(ABORT, 'job_events_append_only');
END;

CREATE TRIGGER trg_job_events_no_delete BEFORE DELETE ON job_events
BEGIN
  SELECT RAISE(ABORT, 'job_events_append_only');
END;

CREATE TRIGGER trg_stock_moves_no_update
BEFORE UPDATE OF id, shop_id, item_id, kind, quantity, balance_after, expense_id, created_by_user_id
ON stock_moves
BEGIN
  SELECT RAISE(ABORT, 'stock_moves_append_only');
END;

CREATE TRIGGER trg_stock_moves_no_delete BEFORE DELETE ON stock_moves
BEGIN
  SELECT RAISE(ABORT, 'stock_moves_append_only');
END;

CREATE INDEX idx_vehicle_types_shop ON vehicle_types(shop_id);
CREATE INDEX idx_services_shop ON services(shop_id);
CREATE INDEX idx_jobs_shop_status ON jobs(shop_id, status);
CREATE INDEX idx_jobs_shop_created_at ON jobs(shop_id, created_at);
CREATE INDEX idx_jobs_shop_completed_at ON jobs(shop_id, completed_at);
CREATE INDEX idx_jobs_customer_id ON jobs(customer_id, created_at);
-- "Latest visit per vehicle" for reminders reads the newest job of each vehicle.
CREATE INDEX idx_jobs_vehicle_created ON jobs(vehicle_id, created_at);
CREATE INDEX idx_job_events_job_id ON job_events(job_id);
CREATE INDEX idx_job_events_shop_created_at ON job_events(shop_id, created_at);
CREATE INDEX idx_expenses_shop_date ON expenses(shop_id, date);
CREATE UNIQUE INDEX idx_stock_items_name_live ON stock_items(shop_id, name_key) WHERE active = 1;
CREATE INDEX idx_stock_moves_item_created ON stock_moves(item_id, created_at);
CREATE INDEX idx_stock_moves_shop_kind_created ON stock_moves(shop_id, kind, created_at);
CREATE INDEX idx_stock_moves_expense ON stock_moves(expense_id);
CREATE INDEX idx_reward_rules_shop ON reward_rules(shop_id);
CREATE INDEX idx_reward_claims_job ON reward_claims(job_id);
CREATE INDEX idx_reward_claims_shop_created ON reward_claims(shop_id, created_at);
CREATE INDEX idx_reward_gift_items_shop ON reward_gift_items(shop_id);
CREATE INDEX idx_reward_gifts_job ON reward_gifts(job_id);
CREATE INDEX idx_reward_gifts_shop_status ON reward_gifts(shop_id, status);
CREATE INDEX idx_reward_gifts_shop_given ON reward_gifts(shop_id, given_at);
CREATE INDEX idx_reward_gifts_item_status ON reward_gifts(stock_item_id, status);
-- One live gift of each item per car, even if two of its first washes are paid at once.
CREATE UNIQUE INDEX idx_reward_gifts_one_live ON reward_gifts(vehicle_id, stock_item_id) WHERE status != 'cancelled';
CREATE INDEX idx_vehicles_customer_id ON vehicles(customer_id);
CREATE INDEX idx_vehicles_shop_updated_at ON vehicles(shop_id, updated_at, id);
CREATE INDEX idx_service_prices_service_id ON service_prices(service_id);
CREATE INDEX idx_coupons_customer_id ON coupons(customer_id);
CREATE INDEX idx_coupons_shop_status_expires ON coupons(shop_id, status, expires_at);
CREATE INDEX idx_coupons_shop_redeemed_at ON coupons(shop_id, redeemed_at);
CREATE INDEX idx_vehicle_reminders_shop ON vehicle_reminders(shop_id);
CREATE INDEX idx_referrals_shop_status ON referrals(shop_id, status);
-- At most one live coupon of each kind per vehicle, enforced by the database even under
-- concurrent issues.
CREATE UNIQUE INDEX idx_coupons_one_active_per_vehicle ON coupons(vehicle_id, kind) WHERE status = 'active';
CREATE INDEX idx_referrals_referrer ON referrals(referrer_customer_id);
CREATE INDEX idx_job_washers_user_id ON job_washers(user_id);
CREATE INDEX idx_job_sellers_user_id ON job_sellers(user_id);
CREATE INDEX idx_attendance_shop_date ON attendance(shop_id, date);
CREATE INDEX idx_cash_day_closes_day ON cash_day_closes(shop_id, date);
CREATE INDEX idx_job_photos_job_id ON job_photos(job_id);
CREATE INDEX idx_job_photos_created_at ON job_photos(created_at);
CREATE INDEX idx_job_photos_deleted_at ON job_photos(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);
CREATE INDEX idx_shops_subscription ON shops(subscription_id);
CREATE INDEX idx_shops_founder ON shops(founder_at) WHERE founder_at IS NOT NULL;
CREATE INDEX idx_shops_founder_hold ON shops(founder_hold_until) WHERE founder_hold_until IS NOT NULL;
CREATE INDEX idx_billing_payments_shop_paid ON billing_payments(shop_id, paid_at);
CREATE INDEX idx_billing_events_received ON billing_events(received_at);
CREATE INDEX idx_app_errors_shop_created_at ON app_errors(shop_id, created_at);
CREATE INDEX idx_app_errors_created_at ON app_errors(created_at);
CREATE INDEX idx_login_codes_user_created ON login_codes(user_id, created_at);
CREATE INDEX idx_signup_codes_phone_created ON signup_codes(phone, created_at);
CREATE INDEX idx_signup_codes_ip_created ON signup_codes(ip, created_at);
CREATE INDEX idx_join_requests_shop_status ON join_requests(shop_id, status);
-- One open request per number, even across shops.
CREATE UNIQUE INDEX idx_join_requests_one_pending ON join_requests(phone) WHERE status = 'pending';
CREATE INDEX idx_service_areas_shop ON service_areas(shop_id);
CREATE UNIQUE INDEX idx_service_areas_name_live ON service_areas(shop_id, name_key) WHERE active = 1;
CREATE INDEX idx_service_requests_shop_status ON service_requests(shop_id, status, created_at);
CREATE INDEX idx_service_requests_phone ON service_requests(phone, created_at);
-- One open service request per number, across every branch; asking again replaces it.
CREATE UNIQUE INDEX idx_service_requests_one_open ON service_requests(phone) WHERE status IN ('pending', 'out_of_area');
CREATE INDEX idx_vehicle_requests_shop_status ON vehicle_requests(shop_id, status, created_at);
CREATE INDEX idx_vehicle_requests_customer ON vehicle_requests(customer_id, created_at);
CREATE UNIQUE INDEX idx_vehicle_requests_one_pending ON vehicle_requests(shop_id, registration_number) WHERE status = 'pending';
CREATE INDEX idx_wash_ratings_shop ON wash_ratings(shop_id, updated_at);
CREATE INDEX idx_wash_problems_shop_status ON wash_problems(shop_id, status, created_at);
CREATE INDEX idx_wash_problems_customer ON wash_problems(customer_id, created_at);

CREATE INDEX idx_business_admins_phone ON business_admins(phone);
CREATE INDEX idx_catalog_services_business ON catalog_services(business_id, sort_order);
CREATE UNIQUE INDEX idx_price_books_one_default ON price_books(business_id) WHERE is_default = 1;
CREATE INDEX idx_mode_adjustments_business ON mode_adjustments(business_id);
CREATE INDEX idx_shops_business ON shops(business_id);
CREATE INDEX idx_service_points_shop ON service_points(shop_id, sort_order);
-- One branch service per catalog service.
CREATE UNIQUE INDEX idx_services_catalog ON services(shop_id, catalog_service_id) WHERE catalog_service_id IS NOT NULL;
CREATE INDEX idx_service_prices_shop_type ON service_prices(shop_id, vehicle_type_id);
CREATE INDEX idx_branch_price_overrides_shop ON branch_price_overrides(shop_id);

CREATE INDEX idx_places_shop ON places(shop_id, status);
CREATE INDEX idx_places_location ON places(latitude, longitude) WHERE status = 'active';
CREATE UNIQUE INDEX idx_place_units_live ON place_units(place_id, ifnull(block, ''), number) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX idx_place_members_live ON place_members(place_id, customer_id) WHERE status IN ('pending', 'active');
CREATE INDEX idx_place_members_place ON place_members(shop_id, place_id, status);
CREATE INDEX idx_place_members_customer ON place_members(customer_id, status);
CREATE INDEX idx_place_members_unit ON place_members(unit_id) WHERE unit_id IS NOT NULL;
CREATE INDEX idx_member_vehicles_member ON member_vehicles(member_id, status);
CREATE UNIQUE INDEX idx_member_vehicles_one_live ON member_vehicles(vehicle_id) WHERE vehicle_id IS NOT NULL AND status = 'active';
CREATE INDEX idx_wash_plans_business ON wash_plans(business_id, sort_order);
CREATE UNIQUE INDEX idx_wash_plans_one_popular ON wash_plans(business_id) WHERE popular = 1 AND active = 1;
CREATE INDEX idx_place_orders_member ON place_orders(member_id, status);
CREATE INDEX idx_place_orders_vehicle ON place_orders(member_vehicle_id, status);
CREATE INDEX idx_place_orders_customer ON place_orders(customer_id, created_at);
CREATE INDEX idx_place_orders_shop_status ON place_orders(shop_id, status, first_wash_on);
CREATE UNIQUE INDEX idx_place_orders_one_renewal ON place_orders(renewal_of) WHERE renewal_of IS NOT NULL AND status != 'cancelled';
CREATE INDEX idx_order_installments_due ON order_installments(shop_id, status, due_on);
CREATE INDEX idx_order_pauses_order ON order_pauses(order_id);
CREATE INDEX idx_place_visits_place_date ON place_visits(place_id, date);
CREATE UNIQUE INDEX idx_place_visits_job ON place_visits(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX idx_place_photos_place ON place_photos(place_id, created_at);
CREATE INDEX idx_customer_payments_order ON customer_payments(order_id, created_at);
CREATE INDEX idx_customer_payments_open ON customer_payments(status, created_at) WHERE status = 'created';
CREATE INDEX idx_customer_payments_shop_paid ON customer_payments(shop_id, paid_at) WHERE status = 'paid';
CREATE UNIQUE INDEX idx_customer_payments_one_paid ON customer_payments(installment_id) WHERE status = 'paid';
CREATE INDEX idx_customer_refunds_payment ON customer_refunds(payment_id);
CREATE INDEX idx_customer_refunds_pending ON customer_refunds(status) WHERE status = 'pending';
CREATE INDEX idx_service_requests_invited ON service_requests(invited_place_id) WHERE invited_place_id IS NOT NULL;
