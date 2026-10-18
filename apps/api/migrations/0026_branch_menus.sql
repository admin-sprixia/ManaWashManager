-- Which head-office services each branch sells. Adding or changing a service at HQ no longer
-- reaches every branch: HQ switches it on branch by branch (from the branch's page, or when
-- opening the branch), and a branch's menu is built only from the services switched on for it.
-- Switching a service off at HQ still takes it off everywhere.
CREATE TABLE branch_menu_services (
  shop_id TEXT NOT NULL REFERENCES shops(id),
  catalog_service_id TEXT NOT NULL REFERENCES catalog_services(id),
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (shop_id, catalog_service_id)
);
CREATE INDEX idx_branch_menu_services_service ON branch_menu_services(catalog_service_id);

-- Every branch keeps exactly what it sells today: all of its business's live services.
INSERT INTO branch_menu_services (shop_id, catalog_service_id)
SELECT s.id, c.id FROM shops s JOIN catalog_services c ON c.business_id = s.business_id WHERE c.active = 1;
