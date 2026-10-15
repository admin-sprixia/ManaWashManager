-- Branches are opened only by HQ, inside its business (routes/business.ts), and new shops can no
-- longer be started from the app. A branch that the old in-app paths left without a business
-- joins MANA's, and its menu is rebuilt from MANA's catalog on its next read.
UPDATE shops SET business_id = 'biz_mana', menu_version = 0
WHERE business_id IS NULL AND EXISTS (SELECT 1 FROM businesses WHERE id = 'biz_mana');

-- The switch that opened public sign-up is gone with it.
DELETE FROM platform_settings WHERE key = 'signup.open';
