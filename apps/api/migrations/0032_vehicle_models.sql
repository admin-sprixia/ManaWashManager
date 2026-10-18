-- Head office's changes to the list of companies and models (the vehicle size guide, and the
-- customer app's "add your vehicle"). The list ships with the app; each row here adds a model,
-- moves one to another kind of vehicle (body_key), or removes one (body_key NULL). A rename is
-- the old name removed and the new one added. Deleting a row undoes the change.
CREATE TABLE vehicle_models (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  model_key TEXT NOT NULL, -- "make|model", lower case, to match whatever the case
  make TEXT NOT NULL CHECK (length(make) BETWEEN 1 AND 40),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 40),
  category TEXT NOT NULL CHECK (category IN ('car', 'bike')),
  body_key TEXT,
  updated_by_phone TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')),
  PRIMARY KEY (business_id, model_key)
);
