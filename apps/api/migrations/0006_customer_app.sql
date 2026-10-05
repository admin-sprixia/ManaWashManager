-- MANA Car Wash, the app for car owners: where each branch washes, customer sign-in, and
-- "Request service" from people the car wash hasn't registered yet.

-- ─── Service area ───────────────────────────────────────────────────────────

-- Listed in the MANA Car Wash app. Set by Sprixia for MANA's own branches, never by an owner, so
-- other car washes on the platform never show up there and their customers can't sign in to it.
ALTER TABLE shops ADD COLUMN in_customer_app INTEGER NOT NULL DEFAULT 0 CHECK (in_customer_app IN (0, 1));
-- The hub and how far from it the branch washes. No radius = only the area list below.
ALTER TABLE shops ADD COLUMN latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE shops ADD COLUMN longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
ALTER TABLE shops ADD COLUMN service_radius_km REAL CHECK (service_radius_km IS NULL OR service_radius_km BETWEEN 0.5 AND 50);

-- Named places a branch serves ("Kovur", "Nellore"): the backup when a customer doesn't share
-- their location. Switching one off keeps the row, because requests point at it.
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
CREATE INDEX idx_service_areas_shop ON service_areas(shop_id);
CREATE UNIQUE INDEX idx_service_areas_name_live ON service_areas(shop_id, name_key) WHERE active = 1;

-- ─── Customer sign-in ───────────────────────────────────────────────────────

-- One per phone number that has signed in to the app — platform-level, because one person can be
-- a customer of several branches. Which branches is never stored here: it's every listed shop
-- with a customer on this number, so a branch registering (or removing) them takes effect at once.
CREATE TABLE customer_accounts (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  -- In every customer token; bumping it signs the app out on every phone.
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  last_seen_at TEXT
);

-- ─── Request service ────────────────────────────────────────────────────────

-- From the app, by a phone proved with a WhatsApp code. shop_id is the branch that serves the
-- place, or for out_of_area the nearest one, so somebody always sees it. Approving registers a
-- customer on that phone (customer_id), which is what lets them sign in.
CREATE TABLE service_requests (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id),
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  area_id TEXT,
  address TEXT NOT NULL,
  place_kind TEXT NOT NULL CHECK (place_kind IN ('apartment', 'house', 'small_building', 'office', 'other')),
  place_name TEXT,                   -- apartment or building name, as typed
  home_text TEXT,                    -- flat or house number, as typed
  cars INTEGER NOT NULL DEFAULT 0 CHECK (cars BETWEEN 0 AND 20),
  bikes INTEGER NOT NULL DEFAULT 0 CHECK (bikes BETWEEN 0 AND 20),
  preferred_time TEXT CHECK (preferred_time IS NULL OR preferred_time IN ('early_morning', 'morning', 'evening', 'any')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'out_of_area', 'approved', 'rejected', 'cancelled')),
  handled_by_user_id TEXT,
  handled_at TEXT,
  reason TEXT,                       -- why it was declined, shown to the customer
  customer_id TEXT,                  -- set on approval
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  CHECK (cars + bikes >= 1),
  FOREIGN KEY (shop_id, area_id) REFERENCES service_areas(shop_id, id),
  FOREIGN KEY (shop_id, handled_by_user_id) REFERENCES users(shop_id, id),
  FOREIGN KEY (shop_id, customer_id) REFERENCES customers(shop_id, id)
);
CREATE INDEX idx_service_requests_shop_status ON service_requests(shop_id, status, created_at);
CREATE INDEX idx_service_requests_phone ON service_requests(phone, created_at);
-- One open request per number, across every branch; asking again replaces it.
CREATE UNIQUE INDEX idx_service_requests_one_open ON service_requests(phone) WHERE status IN ('pending', 'out_of_area');
