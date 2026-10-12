-- The service network. A business owns one catalog: vehicle classes and sizes, body types,
-- services, base prices by size (price books) and pricing rules (doorstep extra, zones, what
-- branches may change). Each branch runs service points (a hub, doorstep teams) that say how and
-- what it washes. A branch's menu — its services and service_prices, which washes, rewards,
-- commissions and reports already read — is generated from those, so a price changed once at the
-- top reaches every branch. Services a branch made by hand (no catalog link) keep working as before.

-- ─── Businesses ─────────────────────────────────────────────────────────────

CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  -- Bumped on every catalog change; a branch whose menu_version is behind gets its menu rebuilt.
  catalog_version INTEGER NOT NULL DEFAULT 1 CHECK (catalog_version >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'))
);

-- People who run the business catalog (prices, services, rules), by phone: the same person has
-- one owner row per branch, and a future admin panel signs in with the same number.
CREATE TABLE business_admins (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  phone TEXT NOT NULL CHECK (length(phone) = 10),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (business_id, phone)
);
CREATE INDEX idx_business_admins_phone ON business_admins(phone);

-- Business-wide settings, e.g. the pricing policy (packages/domain serviceNetwork.ts).
CREATE TABLE business_settings (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_by_phone TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (business_id, key)
);

-- ─── Vehicles: classes, sizes, body types ───────────────────────────────────

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

-- Sedan, Tractor…: what a branch's vehicle type stands for. The size can be moved (an MUV priced
-- as L or XL); the size must belong to the body type's class.
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

-- ─── Catalog services ───────────────────────────────────────────────────────

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
CREATE INDEX idx_catalog_services_business ON catalog_services(business_id, sort_order);

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

-- ─── Prices ─────────────────────────────────────────────────────────────────

-- A price table ("Nellore city standard"). Every business has exactly one default; a branch uses
-- the default unless it is given another.
CREATE TABLE price_books (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX idx_price_books_one_default ON price_books(business_id) WHERE is_default = 1;

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
-- a class-specific rule wins. The id is derived from (business, mode, class) so each is unique.
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
CREATE INDEX idx_mode_adjustments_business ON mode_adjustments(business_id);

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

-- ─── Branches join a business ───────────────────────────────────────────────

ALTER TABLE shops ADD COLUMN business_id TEXT REFERENCES businesses(id);
ALTER TABLE shops ADD COLUMN price_book_id TEXT REFERENCES price_books(id);
ALTER TABLE shops ADD COLUMN price_zone_id TEXT REFERENCES price_zones(id);
-- The catalog_version this branch's menu was last built from.
ALTER TABLE shops ADD COLUMN menu_version INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_shops_business ON shops(business_id);

-- ─── Service points ─────────────────────────────────────────────────────────

-- How a branch delivers: its hub, and each doorstep team with its base and how far it goes. A
-- branch with none behaves as a plain hub that washes every class (branches made before this).
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
CREATE INDEX idx_service_points_shop ON service_points(shop_id, sort_order);

-- The vehicle classes a service point can wash (a doorstep team with a tank kit adds Farm).
CREATE TABLE service_point_classes (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  point_id TEXT NOT NULL,
  class_id TEXT NOT NULL REFERENCES vehicle_classes(id),
  PRIMARY KEY (point_id, class_id),
  FOREIGN KEY (shop_id, point_id) REFERENCES service_points(shop_id, id)
);

-- ─── Branch menus ───────────────────────────────────────────────────────────

-- The body type a branch's vehicle type stands for (prices come from its class and size).
ALTER TABLE vehicle_types ADD COLUMN body_type_id TEXT REFERENCES body_types(id);

-- A branch service generated from the catalog, or NULL for one the branch made by hand.
ALTER TABLE services ADD COLUMN catalog_service_id TEXT REFERENCES catalog_services(id);
ALTER TABLE services ADD COLUMN modes TEXT NOT NULL DEFAULT 'both' CHECK (modes IN ('hub', 'doorstep', 'both'));
-- The branch stopped offering this catalog service (when the pricing policy allows it).
ALTER TABLE services ADD COLUMN branch_hidden INTEGER NOT NULL DEFAULT 0 CHECK (branch_hidden IN (0, 1));
CREATE UNIQUE INDEX idx_services_catalog ON services(shop_id, catalog_service_id) WHERE catalog_service_id IS NOT NULL;

-- service_prices gains how the wash is delivered (hub or doorstep price) and where the price came
-- from. SQLite can't change a UNIQUE constraint, so the table is rebuilt; nothing references it.
CREATE TABLE service_prices_new (
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

INSERT INTO service_prices_new (id, shop_id, service_id, vehicle_type_id, price)
SELECT id, shop_id, service_id, vehicle_type_id, price FROM service_prices;

DROP TABLE service_prices;
ALTER TABLE service_prices_new RENAME TO service_prices;

CREATE INDEX idx_service_prices_service_id ON service_prices(service_id);
CREATE INDEX idx_service_prices_shop_type ON service_prices(shop_id, vehicle_type_id);

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
CREATE INDEX idx_branch_price_overrides_shop ON branch_price_overrides(shop_id);

-- ─── Washes ─────────────────────────────────────────────────────────────────

ALTER TABLE jobs ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'hub' CHECK (delivery_mode IN ('hub', 'doorstep'));
ALTER TABLE jobs ADD COLUMN service_point_id TEXT REFERENCES service_points(id);

-- ─── Existing data ──────────────────────────────────────────────────────────

-- Every branch on the platform is MANA's (MANA Wash Manager is no longer sold), so they join one
-- business, run by their owners. Its catalog (classes, sizes, body types, default price book) is
-- created by the API on first use, from the same defaults new businesses get.
INSERT INTO businesses (id, name) SELECT 'biz_mana', 'MANA Car Wash' WHERE EXISTS (SELECT 1 FROM shops);
UPDATE shops SET business_id = 'biz_mana';
INSERT INTO business_admins (business_id, phone)
SELECT DISTINCT 'biz_mana', phone FROM users
WHERE role = 'owner' AND removed_at IS NULL AND length(phone) = 10;
