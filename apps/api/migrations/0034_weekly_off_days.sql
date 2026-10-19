-- A branch can close on more than one day a week: weekly_off_days lists them ("0,6" = Sunday and
-- Saturday; Sunday = 0 … Saturday = 6). weekly_off stays as the first of them for older apps.
ALTER TABLE shops ADD COLUMN weekly_off_days TEXT CHECK (weekly_off_days IS NULL OR weekly_off_days GLOB '[0-6]*');
UPDATE shops SET weekly_off_days = CAST(weekly_off AS TEXT) WHERE weekly_off IS NOT NULL;
