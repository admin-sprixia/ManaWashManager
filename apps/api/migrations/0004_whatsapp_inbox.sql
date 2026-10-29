-- The WhatsApp inbox: a customer whose message the assistant couldn't answer waits for a person
-- (awaiting_reply_at); after a teammate replies the assistant stays quiet for a while
-- (bot_paused_until), and the reply records who sent it.
ALTER TABLE whatsapp_contacts ADD COLUMN awaiting_reply_at TEXT;
ALTER TABLE whatsapp_contacts ADD COLUMN bot_paused_until TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN sent_by_user_id TEXT;
CREATE INDEX idx_whatsapp_contacts_awaiting ON whatsapp_contacts(awaiting_reply_at) WHERE awaiting_reply_at IS NOT NULL;
