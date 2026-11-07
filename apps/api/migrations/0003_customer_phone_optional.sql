-- Some customers don't give a mobile number: the vehicle number identifies them instead, and
-- they get no WhatsApp messages. SQLite can't drop NOT NULL in place, and D1 won't rebuild a
-- table other tables point at, so the old required column is renamed to number_key (an internal
-- key: the number for customers from before, a random value for new ones) and phone is added
-- again as optional, with every number copied over. Still one customer per number in a branch.
ALTER TABLE customers RENAME COLUMN phone TO number_key;
ALTER TABLE customers ADD COLUMN phone TEXT CHECK (phone IS NULL OR length(phone) = 10);
UPDATE customers SET phone = number_key;
CREATE UNIQUE INDEX idx_customers_phone ON customers(shop_id, phone);
