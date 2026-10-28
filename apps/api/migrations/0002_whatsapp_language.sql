-- The language a customer picked on WhatsApp (or wrote to us in): the assistant answers in it.
ALTER TABLE whatsapp_contacts ADD COLUMN language TEXT CHECK (language IS NULL OR language IN ('en', 'te'));
