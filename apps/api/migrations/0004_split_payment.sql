-- A wash paid partly in cash and partly by UPI (or card), and cash handed over without change
-- (₹300 for a ₹299 bill). payment_method stays the method of the non-cash part, or 'cash' for
-- all cash; cash_amount is the bill's cash part when it was split (null: the whole bill by
-- payment_method); cash_received is the cash actually taken when it was more than the cash part
-- (the extra is kept as a round-off and expected in the drawer).
ALTER TABLE jobs ADD COLUMN cash_amount INTEGER CHECK (cash_amount IS NULL OR cash_amount >= 0);
ALTER TABLE jobs ADD COLUMN cash_received INTEGER CHECK (cash_received IS NULL OR cash_received >= 0);
