-- Communities are set up by the team before anyone can join: a teammate visits and inspects the
-- place (photos, checklist, the secretary's number, the days residents asked for) and saves a
-- draft; they send it for review; the owner sets the days, time and team and makes it live.
-- `stage` is that setup; `status` (active / paused / closed) is how a live community runs.
-- Places made before this were live already.

ALTER TABLE places ADD COLUMN stage TEXT NOT NULL DEFAULT 'live' CHECK (stage IN ('draft', 'review', 'live'));
-- What the visit found, JSON (packages/domain communities.ts): water, power, parking, space,
-- the society's permission, rough vehicle counts, the best time.
ALTER TABLE places ADD COLUMN inspection TEXT CHECK (inspection IS NULL OR length(inspection) <= 2000);
ALTER TABLE places ADD COLUMN contact_name TEXT CHECK (contact_name IS NULL OR length(contact_name) BETWEEN 1 AND 60);
ALTER TABLE places ADD COLUMN contact_phone TEXT CHECK (contact_phone IS NULL OR length(contact_phone) = 10);
-- For the team on site: "call security before entering", where the tap is.
ALTER TABLE places ADD COLUMN notes TEXT CHECK (notes IS NULL OR length(notes) <= 500);
-- Days and times residents asked for, best first, JSON: [{"days":[3,5,0],"time":"06:30"}].
ALTER TABLE places ADD COLUMN proposed_slots TEXT CHECK (proposed_slots IS NULL OR length(proposed_slots) <= 500);
-- Who goes there: user ids, comma separated.
ALTER TABLE places ADD COLUMN team_user_ids TEXT CHECK (team_user_ids IS NULL OR length(team_user_ids) <= 1000);
-- Why the owner sent a draft back.
ALTER TABLE places ADD COLUMN review_note TEXT CHECK (review_note IS NULL OR length(review_note) <= 300);
ALTER TABLE places ADD COLUMN submitted_at TEXT;
ALTER TABLE places ADD COLUMN reviewed_by_user_id TEXT;
ALTER TABLE places ADD COLUMN reviewed_at TEXT;

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
CREATE INDEX idx_place_photos_place ON place_photos(place_id, created_at);

-- Proof of a wash: the after photo, and how far from the place the washer was when they recorded it.
ALTER TABLE place_visits ADD COLUMN photo_key TEXT;
ALTER TABLE place_visits ADD COLUMN distance_m INTEGER CHECK (distance_m IS NULL OR distance_m >= 0);
-- A plan wash used at the shop: the shop wash it paid for (undone when that wash is voided).
ALTER TABLE place_visits ADD COLUMN job_id TEXT;
CREATE UNIQUE INDEX idx_place_visits_job ON place_visits(job_id) WHERE job_id IS NOT NULL;
