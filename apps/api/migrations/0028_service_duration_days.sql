-- A service's time can now be in days too (a long coating or repair), up to 30 days. SQLite can't
-- widen a CHECK, so the time moves to a new column; duration_min stays, unused.
ALTER TABLE catalog_services ADD COLUMN duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 43200);
UPDATE catalog_services SET duration_minutes = duration_min WHERE duration_min IS NOT NULL;
