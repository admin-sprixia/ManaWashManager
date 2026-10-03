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
-- Multi-shop: every table except shops, platform_settings, signup_codes, rate_limits and
-- billing_events has a shop_id. Each parent table
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
  founder_hold_at TEXT
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

CREATE TABLE service_prices (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  service_id TEXT NOT NULL,
  vehicle_type_id TEXT NOT NULL,
  price INTEGER NOT NULL, -- paise
  UNIQUE (service_id, vehicle_type_id),
  FOREIGN KEY (shop_id, service_id) REFERENCES services(shop_id, id),
  FOREIGN KEY (shop_id, vehicle_type_id) REFERENCES vehicle_types(shop_id, id)
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
  purpose TEXT NOT NULL, -- signup | join
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'))
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

