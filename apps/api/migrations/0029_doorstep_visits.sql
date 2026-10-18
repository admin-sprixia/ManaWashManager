-- Doorstep washes: the hub price plus one visit charge per visit (a "Visit charge" line on the
-- bill). The distance it was worked out from is kept on the job so the bill can be checked later.
-- Head office's visit-charge rules and community volume discount live in business_settings
-- ('doorstep.rules', 'community.tiers').
ALTER TABLE jobs ADD COLUMN visit_km REAL CHECK (visit_km IS NULL OR visit_km BETWEEN 0 AND 500);
