-- Head office switches each kind of vehicle on or off for the whole business (body_types.active).
-- A branch vehicle type HQ switched off is hidden (active = 0) and marked here, so switching it
-- back on brings back exactly those, never one the owner removed themselves.

ALTER TABLE vehicle_types ADD COLUMN hq_hidden INTEGER NOT NULL DEFAULT 0 CHECK (hq_hidden IN (0, 1));
