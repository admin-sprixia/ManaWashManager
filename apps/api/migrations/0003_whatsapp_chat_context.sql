-- The price list a customer saw last on WhatsApp ("pr|<branch>|<make>|<model>"), so replying with
-- a number shows that service or plan.
ALTER TABLE whatsapp_contacts ADD COLUMN chat_context TEXT CHECK (chat_context IS NULL OR length(chat_context) <= 200);
