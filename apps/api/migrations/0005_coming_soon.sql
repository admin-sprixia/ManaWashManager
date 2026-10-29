-- A head-office service can be "coming soon": shown to customers (WhatsApp, posters) as coming
-- soon, without a price, and not sold at any branch until it's switched off again.
ALTER TABLE catalog_services ADD COLUMN coming_soon INTEGER NOT NULL DEFAULT 0 CHECK (coming_soon IN (0, 1));
