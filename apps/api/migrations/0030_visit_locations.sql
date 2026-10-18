-- Doorstep visits are measured, never typed: the home's location (the phone's GPS at the home,
-- or the customer's saved home) is kept on the wash, and the latest one becomes the customer's
-- home for next time. The distance in visit_km is worked out from it by the server.
ALTER TABLE customers ADD COLUMN home_latitude REAL CHECK (home_latitude IS NULL OR home_latitude BETWEEN -90 AND 90);
ALTER TABLE customers ADD COLUMN home_longitude REAL CHECK (home_longitude IS NULL OR home_longitude BETWEEN -180 AND 180);
ALTER TABLE jobs ADD COLUMN visit_latitude REAL CHECK (visit_latitude IS NULL OR visit_latitude BETWEEN -90 AND 90);
ALTER TABLE jobs ADD COLUMN visit_longitude REAL CHECK (visit_longitude IS NULL OR visit_longitude BETWEEN -180 AND 180);
