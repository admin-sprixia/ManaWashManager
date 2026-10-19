-- Mana Wash HQ people who work at no branch sign in through their business's HQ home: a shop row
-- of kind 'hq' that holds only their team rows (no washes, menu, cash or customers). It never
-- shows as a branch anywhere.
ALTER TABLE shops ADD COLUMN kind TEXT NOT NULL DEFAULT 'branch' CHECK (kind IN ('branch', 'hq'));
