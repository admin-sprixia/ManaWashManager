-- Photos, videos, voice notes and documents customers send to the business number: the file is
-- copied from WhatsApp into the PHOTOS bucket (media_key) so the team sees it in the inbox, with
-- its type (media_type, e.g. image/jpeg). Both stay null for text and for files we couldn't fetch.
ALTER TABLE whatsapp_messages ADD COLUMN media_key TEXT;
ALTER TABLE whatsapp_messages ADD COLUMN media_type TEXT;
