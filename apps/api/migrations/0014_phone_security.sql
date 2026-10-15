-- Safer sign-in for phones and PINs.
--
-- users.pin_lock_count: how many times in a row the PIN has been locked, so each lock lasts
-- longer (15 min, 1 hour, then a day). Back to 0 after a right PIN or a new PIN.
--
-- trusted_devices.label: the phone's make and model, shown in More → Your phones.
-- trusted_devices.pin_confirmed_at: when the right PIN was last used on this phone. Owners,
-- managers and HQ can only reset their own PIN with a WhatsApp code on such a phone, so a SIM
-- swap alone isn't enough.
ALTER TABLE users ADD COLUMN pin_lock_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE trusted_devices ADD COLUMN label TEXT CHECK (label IS NULL OR length(label) <= 60);
ALTER TABLE trusted_devices ADD COLUMN pin_confirmed_at TEXT;
