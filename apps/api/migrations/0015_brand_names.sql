-- The brand is now Mana Wash (the customer app) and Mana Wash Partner (the team app). The business
-- row that migration 0008 created as "MANA Car Wash" takes the new name, unless HQ already renamed it.
UPDATE businesses SET name = 'Mana Wash' WHERE id = 'biz_mana' AND name = 'MANA Car Wash';
