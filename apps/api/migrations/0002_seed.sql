-- Seeds MANA's real launch menu (from the build plan). Applied the same way as 0001:
--   wrangler d1 migrations apply mana_db --local   (or --remote)
--
-- IDs here are short and readable rather than random UUIDs, since this is fixed seed data,
-- not runtime-created rows (those get real UUIDs via Prisma's @default(uuid())).
-- Prices are in paise (1 rupee = 100 paise).

INSERT INTO vehicle_types (id, name, sort_order) VALUES
  ('vt_hatchback',  'Hatchback',        0),
  ('vt_sedan',      'Sedan',            1),
  ('vt_mini_suv',   'Mini SUV',         2),
  ('vt_large_suv',  'Large SUV / XUV',  3);

INSERT INTO services (id, name, description, active, sort_order) VALUES
  ('svc_complete_wash',      'Complete Car Wash',   'Exterior foam wash + interior vacuum + tyres + glass', 1, 0),
  ('svc_exterior_wash',      'Exterior Wash',       'Exterior foam wash + wheels + tyres + glass',          1, 1),
  ('svc_interior_cleaning',  'Interior Cleaning',   'Vacuum + mats + dashboard wipe + interior glass',      1, 2),
  ('svc_mana_combo',         'MANA Combo',          'Complete Car Wash + tyre and dashboard dressing',      1, 3),
  ('svc_ac_hygiene',         'AC & Cabin Hygiene',  'AC vent and cabin refresh treatment',                  1, 4),
  ('svc_underbody',          'Underbody Cleaning',  'Underbody wash and mud removal',                       1, 5),
  ('svc_tyre_dressing',      'Tyre Dressing',       'Add-on',                                                1, 6),
  ('svc_dashboard_dressing', 'Dashboard Dressing',  'Add-on',                                                1, 7),
  ('svc_fragrance',          'Car Fragrance',       'Add-on',                                                1, 8);

INSERT INTO service_prices (id, service_id, vehicle_type_id, price) VALUES
  -- Complete Car Wash: 400 / 500 / 600 / 700
  ('sp_complete_wash_hatchback', 'svc_complete_wash', 'vt_hatchback', 40000),
  ('sp_complete_wash_sedan',     'svc_complete_wash', 'vt_sedan',     50000),
  ('sp_complete_wash_mini_suv',  'svc_complete_wash', 'vt_mini_suv',  60000),
  ('sp_complete_wash_large_suv', 'svc_complete_wash', 'vt_large_suv', 70000),

  -- Exterior Wash: 250 / 300 / 350 / 400
  ('sp_exterior_wash_hatchback', 'svc_exterior_wash', 'vt_hatchback', 25000),
  ('sp_exterior_wash_sedan',     'svc_exterior_wash', 'vt_sedan',     30000),
  ('sp_exterior_wash_mini_suv',  'svc_exterior_wash', 'vt_mini_suv',  35000),
  ('sp_exterior_wash_large_suv', 'svc_exterior_wash', 'vt_large_suv', 40000),

  -- Interior Cleaning: 250 / 300 / 350 / 400
  ('sp_interior_cleaning_hatchback', 'svc_interior_cleaning', 'vt_hatchback', 25000),
  ('sp_interior_cleaning_sedan',     'svc_interior_cleaning', 'vt_sedan',     30000),
  ('sp_interior_cleaning_mini_suv',  'svc_interior_cleaning', 'vt_mini_suv',  35000),
  ('sp_interior_cleaning_large_suv', 'svc_interior_cleaning', 'vt_large_suv', 40000),

  -- MANA Combo: 500 / 600 / 700 / 800
  ('sp_mana_combo_hatchback', 'svc_mana_combo', 'vt_hatchback', 50000),
  ('sp_mana_combo_sedan',     'svc_mana_combo', 'vt_sedan',     60000),
  ('sp_mana_combo_mini_suv',  'svc_mana_combo', 'vt_mini_suv',  70000),
  ('sp_mana_combo_large_suv', 'svc_mana_combo', 'vt_large_suv', 80000),

  -- AC & Cabin Hygiene: flat 2,500 across vehicle types
  ('sp_ac_hygiene_hatchback', 'svc_ac_hygiene', 'vt_hatchback', 250000),
  ('sp_ac_hygiene_sedan',     'svc_ac_hygiene', 'vt_sedan',     250000),
  ('sp_ac_hygiene_mini_suv',  'svc_ac_hygiene', 'vt_mini_suv',  250000),
  ('sp_ac_hygiene_large_suv', 'svc_ac_hygiene', 'vt_large_suv', 250000),

  -- Underbody Cleaning: flat 500 starting price
  ('sp_underbody_hatchback', 'svc_underbody', 'vt_hatchback', 50000),
  ('sp_underbody_sedan',     'svc_underbody', 'vt_sedan',     50000),
  ('sp_underbody_mini_suv',  'svc_underbody', 'vt_mini_suv',  50000),
  ('sp_underbody_large_suv', 'svc_underbody', 'vt_large_suv', 50000),

  -- Add-ons: Tyre Dressing 50, Dashboard Dressing 100, Fragrance 50 — same for every vehicle type
  ('sp_tyre_dressing_hatchback', 'svc_tyre_dressing', 'vt_hatchback', 5000),
  ('sp_tyre_dressing_sedan',     'svc_tyre_dressing', 'vt_sedan',     5000),
  ('sp_tyre_dressing_mini_suv',  'svc_tyre_dressing', 'vt_mini_suv',  5000),
  ('sp_tyre_dressing_large_suv', 'svc_tyre_dressing', 'vt_large_suv', 5000),

  ('sp_dashboard_dressing_hatchback', 'svc_dashboard_dressing', 'vt_hatchback', 10000),
  ('sp_dashboard_dressing_sedan',     'svc_dashboard_dressing', 'vt_sedan',     10000),
  ('sp_dashboard_dressing_mini_suv',  'svc_dashboard_dressing', 'vt_mini_suv',  10000),
  ('sp_dashboard_dressing_large_suv', 'svc_dashboard_dressing', 'vt_large_suv', 10000),

  ('sp_fragrance_hatchback', 'svc_fragrance', 'vt_hatchback', 5000),
  ('sp_fragrance_sedan',     'svc_fragrance', 'vt_sedan',     5000),
  ('sp_fragrance_mini_suv',  'svc_fragrance', 'vt_mini_suv',  5000),
  ('sp_fragrance_large_suv', 'svc_fragrance', 'vt_large_suv', 5000);

-- Placeholder owner account — replace the phone number with the real one, then sign in via OTP.
-- Stored as a plain 10-digit local number (no +91): that's what the login screen's phone-pad
-- keyboard actually produces, and phone numbers aren't normalized yet (see Next steps below).
INSERT INTO users (id, name, phone, role) VALUES
  ('user_owner_seed', 'Owner', '9100000000', 'owner');
