-- Opening a branch without typing a code. HQ gives the pincode and pins the branch on the map;
-- India Post's office list (post_offices, loaded by scripts/import-post-offices.mjs) says the
-- district, state and the towns and areas around it. Each town of a business gets one 3-letter
-- code for good (branch_towns), and its branches are numbered from it: KVR-001, KVR-002.

-- India Post offices (data.gov.in, Open Government Data License – India). Reference data only:
-- replaced whole by the import script, never edited by the app.
CREATE TABLE post_offices (
  pincode TEXT NOT NULL CHECK (length(pincode) = 6 AND pincode GLOB '[1-9][0-9][0-9][0-9][0-9][0-9]'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  kind TEXT NOT NULL CHECK (kind IN ('HO', 'PO', 'BO')),
  district TEXT NOT NULL,
  state TEXT NOT NULL,
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN 6 AND 37.6),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN 68 AND 97.5)
);
CREATE INDEX idx_post_offices_pincode ON post_offices(pincode);

-- The towns a business has branches in, each with its code for good. One town per spelling-proof
-- name in a district (name_key, packages/domain branchTowns.ts townKey); no two share a code.
CREATE TABLE branch_towns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  code TEXT NOT NULL CHECK (length(code) = 3 AND code GLOB '[A-Z][A-Z][A-Z]'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  name_key TEXT NOT NULL,
  district TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  UNIQUE (business_id, code),
  UNIQUE (business_id, state, district, name_key)
);

ALTER TABLE shops ADD COLUMN town_id TEXT REFERENCES branch_towns(id);
ALTER TABLE shops ADD COLUMN pincode TEXT CHECK (pincode IS NULL OR (length(pincode) = 6 AND pincode GLOB '[1-9][0-9][0-9][0-9][0-9][0-9]'));
