-- Which sizes of each kind of vehicle a service is for (a ceramic coat for cars S–L, a wash for
-- every size). Prices are set in Base prices only for these sizes, and branches sell only these.
-- Before this, the sizes a service had were simply the ones with a price.
CREATE TABLE catalog_service_sizes (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  service_id TEXT NOT NULL,
  size_id TEXT NOT NULL,
  PRIMARY KEY (service_id, size_id),
  FOREIGN KEY (business_id, service_id) REFERENCES catalog_services(business_id, id),
  FOREIGN KEY (business_id, size_id) REFERENCES vehicle_sizes(business_id, id)
);

-- Every service keeps the sizes it's priced for in the default price book...
INSERT OR IGNORE INTO catalog_service_sizes (business_id, service_id, size_id)
SELECT DISTINCT e.business_id, e.service_id, e.size_id
FROM price_book_entries e
JOIN price_books b ON b.id = e.price_book_id AND b.is_default = 1
JOIN vehicle_sizes z ON z.id = e.size_id
JOIN catalog_service_classes sc ON sc.service_id = e.service_id AND sc.class_id = z.class_id;

-- ...and a kind of vehicle with no price yet gets all its sizes.
INSERT OR IGNORE INTO catalog_service_sizes (business_id, service_id, size_id)
SELECT sc.business_id, sc.service_id, z.id
FROM catalog_service_classes sc
JOIN vehicle_sizes z ON z.class_id = sc.class_id
WHERE NOT EXISTS (
  SELECT 1 FROM catalog_service_sizes x JOIN vehicle_sizes y ON y.id = x.size_id
  WHERE x.service_id = sc.service_id AND y.class_id = sc.class_id
);
