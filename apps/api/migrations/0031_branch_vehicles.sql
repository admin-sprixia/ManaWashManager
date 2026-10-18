-- Which kinds of vehicle each branch washes. A farming town's branch may wash tractors while a
-- city branch washes only cars and bikes, so this is set branch by branch (when opening it, or
-- on its page), no longer by one switch for the whole business. Which size each kind is priced
-- as stays with head office (Base prices).
CREATE TABLE branch_body_types (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  body_type_id TEXT NOT NULL REFERENCES body_types(id),
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (shop_id, body_type_id)
);
CREATE INDEX idx_branch_body_types_body ON branch_body_types(body_type_id);

-- Every branch keeps exactly what it washes today: the kinds that were switched on.
INSERT INTO branch_body_types (shop_id, body_type_id)
SELECT s.id, b.id FROM shops s JOIN body_types b ON b.business_id = s.business_id WHERE b.active = 1;

-- The business-wide switch is retired: every kind can be chosen for a branch.
UPDATE body_types SET active = 1 WHERE active = 0;
