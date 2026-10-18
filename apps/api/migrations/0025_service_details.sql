-- More about each service, set by head office and copied to every branch's menu:
--   team_at       where the community team does it: communities, customers' homes, or both
--                 (with modes: shop, community, doorstep can be ticked in any combination)
--   duration_min  how long it takes, in minutes
--   kind          wash | protection | add-on, to group the menu
--   popular       shown with a "Most popular" badge
--   show_in_app   offered in the customer app (off = staff sell it at the shop only)
--   checklist     what's included, a JSON list of short lines
ALTER TABLE catalog_services ADD COLUMN team_at TEXT NOT NULL DEFAULT 'both' CHECK (team_at IN ('both', 'community', 'doorstep'));
ALTER TABLE catalog_services ADD COLUMN duration_min INTEGER CHECK (duration_min IS NULL OR duration_min BETWEEN 1 AND 480);
ALTER TABLE catalog_services ADD COLUMN kind TEXT NOT NULL DEFAULT 'wash' CHECK (kind IN ('wash', 'protection', 'addon'));
ALTER TABLE catalog_services ADD COLUMN popular INTEGER NOT NULL DEFAULT 0 CHECK (popular IN (0, 1));
ALTER TABLE catalog_services ADD COLUMN show_in_app INTEGER NOT NULL DEFAULT 1 CHECK (show_in_app IN (0, 1));
ALTER TABLE catalog_services ADD COLUMN checklist TEXT;

ALTER TABLE services ADD COLUMN team_at TEXT NOT NULL DEFAULT 'both' CHECK (team_at IN ('both', 'community', 'doorstep'));
ALTER TABLE services ADD COLUMN duration_min INTEGER;
ALTER TABLE services ADD COLUMN kind TEXT NOT NULL DEFAULT 'wash' CHECK (kind IN ('wash', 'protection', 'addon'));
ALTER TABLE services ADD COLUMN popular INTEGER NOT NULL DEFAULT 0 CHECK (popular IN (0, 1));
ALTER TABLE services ADD COLUMN show_in_app INTEGER NOT NULL DEFAULT 1 CHECK (show_in_app IN (0, 1));
ALTER TABLE services ADD COLUMN checklist TEXT;
