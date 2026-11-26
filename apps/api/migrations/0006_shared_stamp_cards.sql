-- One stamp card fed by several services. A rule with card_service_id set doesn't have a card of
-- its own: its paid washes put `stamps` stamps on that service's card instead (Express and
-- Premium filling the Basic Wash card, Premium counting 2). A card's own rule holds
-- bonus_stamps, given on a car's first wash that counts, and starts_at: washes before it don't
-- count (null = all of the car's history counts, as before).
ALTER TABLE reward_rules ADD COLUMN card_service_id TEXT;
ALTER TABLE reward_rules ADD COLUMN stamps INTEGER NOT NULL DEFAULT 1 CHECK (stamps BETWEEN 1 AND 3);
ALTER TABLE reward_rules ADD COLUMN bonus_stamps INTEGER NOT NULL DEFAULT 0 CHECK (bonus_stamps BETWEEN 0 AND 50);
ALTER TABLE reward_rules ADD COLUMN starts_at TEXT;
