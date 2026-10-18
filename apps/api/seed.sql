-- Starter data for a fresh LOCAL database: the MANA shop, its vehicle sizes, menu, prices and
-- two sign-in accounts. Applied by `npm run db:reset:local` after the migrations.
-- Production shops are created through the in-app sign-up, never from this file.

-- Seed IDs are short and readable rather than random UUIDs, since this is fixed seed data.
-- Money is stored in paise (1 rupee = 100 paise).

-- ─── Seed: MANA, the first shop on the platform ─────────────────────────────

INSERT INTO shops (id, code, name, city) VALUES ('shop_mana', 'NLR-01', 'Mana Wash Nellore City', 'Nellore');

-- Listed in the Mana Wash app, washing within 8 km of the Kovur hub, plus two named areas
-- for customers who don't share their location. Contact details and hours for the branch page.
UPDATE shops SET in_customer_app = 1, latitude = 14.4936, longitude = 79.9884, service_radius_km = 8,
  address = 'Main Road, near Bus Stand, Kovur, Nellore 524137', contact_phone = '9888626111',
  opens_at = '07:00', closes_at = '20:00', weekly_off = NULL
WHERE id = 'shop_mana';
INSERT INTO service_areas (id, shop_id, name, name_key, pincode) VALUES
  ('area_kovur',   'shop_mana', 'Kovur',   'kovur',   '524137'),
  ('area_nellore', 'shop_mana', 'Nellore', 'nellore', '524001');

-- ─── Seed: vehicle types ────────────────────────────────────────────────────

INSERT INTO vehicle_types (id, shop_id, name, category, sort_order)
SELECT column1, 'shop_mana', column2, column3, column4 FROM (VALUES
  ('vt_hatchback',  'Hatchback',        'car',  0),
  ('vt_sedan',      'Sedan',            'car',  1),
  ('vt_mini_suv',   'Mini SUV',         'car',  2),
  ('vt_large_suv',  'Large SUV / XUV',  'car',  3),
  ('vt_bike',       'Bike',             'bike', 10),
  ('vt_scooter',    'Scooter',          'bike', 11));

-- ─── Seed: services ─────────────────────────────────────────────────────────

INSERT INTO services (id, shop_id, name, description, active, applies_to, sort_order)
SELECT column1, 'shop_mana', column2, column3, column4, column5, column6 FROM (VALUES
  -- Car menu
  ('svc_complete_wash',      'Complete Car Wash',    'Exterior foam wash + interior vacuum + tyres + glass', 1, 'car', 0),
  ('svc_exterior_wash',      'Exterior Wash',        'Exterior foam wash + wheels + tyres + glass',          1, 'car', 1),
  ('svc_interior_cleaning',  'Interior Cleaning',    'Vacuum + mats + dashboard wipe + interior glass',      1, 'car', 2),
  ('svc_mana_combo',         'MANA Combo',           'Complete Car Wash + tyre and dashboard dressing',      1, 'car', 3),
  ('svc_ac_hygiene',         'AC & Cabin Hygiene',   'AC vent and cabin refresh treatment',                  1, 'car', 4),
  ('svc_underbody',          'Underbody Cleaning',   'Underbody wash and mud removal',                       1, 'car', 5),
  ('svc_tyre_dressing',      'Tyre Dressing',        'Add-on',                                               1, 'car', 6),
  ('svc_dashboard_dressing', 'Dashboard Dressing',   'Add-on',                                               1, 'car', 7),
  ('svc_fragrance',          'Car Fragrance',        'Add-on',                                               1, 'car', 8),
  -- Bike menu
  ('svc_bike_complete',      'Complete Bike Wash',   'Foam wash + chain area wipe + dry',                    1, 'bike', 100),
  ('svc_bike_exterior',      'Bike Foam Wash',       'Exterior foam wash + wheels + dry',                    1, 'bike', 101),
  ('svc_bike_chain',         'Chain Clean & Lube',   'Chain degrease, clean, and lube',                      1, 'bike', 102),
  ('svc_bike_engine',        'Engine Degrease',      'Engine bay degrease and wipe',                         1, 'bike', 103),
  ('svc_bike_polish',        'Bike Polish',          'Body polish and shine',                                1, 'bike', 104),
  ('svc_bike_tyre',          'Bike Tyre Dressing',   'Add-on',                                               1, 'bike', 105),
  ('svc_bike_seat',          'Seat Clean & Protect', 'Seat wipe and protectant',                             1, 'bike', 106));

-- ─── Seed: prices (paise) ───────────────────────────────────────────────────

INSERT INTO service_prices (id, shop_id, service_id, vehicle_type_id, price)
SELECT column1, 'shop_mana', column2, column3, column4 FROM (VALUES
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

  -- AC & Cabin Hygiene: flat 2,500
  ('sp_ac_hygiene_hatchback', 'svc_ac_hygiene', 'vt_hatchback', 250000),
  ('sp_ac_hygiene_sedan',     'svc_ac_hygiene', 'vt_sedan',     250000),
  ('sp_ac_hygiene_mini_suv',  'svc_ac_hygiene', 'vt_mini_suv',  250000),
  ('sp_ac_hygiene_large_suv', 'svc_ac_hygiene', 'vt_large_suv', 250000),

  -- Underbody Cleaning: flat 500 starting price
  ('sp_underbody_hatchback', 'svc_underbody', 'vt_hatchback', 50000),
  ('sp_underbody_sedan',     'svc_underbody', 'vt_sedan',     50000),
  ('sp_underbody_mini_suv',  'svc_underbody', 'vt_mini_suv',  50000),
  ('sp_underbody_large_suv', 'svc_underbody', 'vt_large_suv', 50000),

  -- Car add-ons: Tyre Dressing 50, Dashboard Dressing 100, Fragrance 50
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
  ('sp_fragrance_large_suv', 'svc_fragrance', 'vt_large_suv', 5000),

  -- Bike menu: Bike / Scooter
  ('sp_bike_complete_bike',    'svc_bike_complete', 'vt_bike',    25000),
  ('sp_bike_complete_scooter', 'svc_bike_complete', 'vt_scooter', 20000),
  ('sp_bike_exterior_bike',    'svc_bike_exterior', 'vt_bike',    15000),
  ('sp_bike_exterior_scooter', 'svc_bike_exterior', 'vt_scooter', 12000),
  ('sp_bike_chain_bike',       'svc_bike_chain',    'vt_bike',    10000),
  ('sp_bike_chain_scooter',    'svc_bike_chain',    'vt_scooter', 10000),
  ('sp_bike_engine_bike',      'svc_bike_engine',   'vt_bike',    15000),
  ('sp_bike_engine_scooter',   'svc_bike_engine',   'vt_scooter', 15000),
  ('sp_bike_polish_bike',      'svc_bike_polish',   'vt_bike',    25000),
  ('sp_bike_polish_scooter',   'svc_bike_polish',   'vt_scooter', 20000),
  ('sp_bike_tyre_bike',        'svc_bike_tyre',     'vt_bike',    5000),
  ('sp_bike_tyre_scooter',     'svc_bike_tyre',     'vt_scooter', 5000),
  ('sp_bike_seat_bike',        'svc_bike_seat',     'vt_bike',    8000),
  ('sp_bike_seat_scooter',     'svc_bike_seat',     'vt_scooter', 8000));

-- ─── Seed: owner account ────────────────────────────────────────────────────

-- Placeholder owner account — replace the phone number with the real one, then sign in once
-- with a WhatsApp code and set a 6-digit PIN.
-- Stored as a plain 10-digit local number (no +91): that's what the login screen's phone-pad
-- keyboard actually produces.
INSERT INTO users (id, shop_id, name, phone, role) VALUES
  ('user_owner_seed', 'shop_mana', 'Owner', '9100000000', 'owner');

-- Demo staff account for trying the Staff role end to end. Remove (or deactivate from the
-- Team screen) before go-live; real staff are added by the owner from the app.
INSERT INTO users (id, shop_id, name, phone, role) VALUES
  ('user_staff_seed', 'shop_mana', 'Staff Demo', '9100000001', 'staff');

-- ─── Seed: the business catalog (service network) ───────────────────────────

-- Mana Wash runs every branch from one catalog. The branch's services above are adopted by
-- the catalog services of the same name on the first menu build, so their ids, commissions and
-- rewards stay; their prices come from the price book below from then on. The rest of the
-- default classes, sizes and body types are filled in by the API on first use.
INSERT INTO businesses (id, name) VALUES ('biz_mana', 'Mana Wash');
UPDATE shops SET business_id = 'biz_mana' WHERE id = 'shop_mana';
INSERT INTO business_admins (business_id, phone) VALUES ('biz_mana', '9100000000');

INSERT INTO vehicle_classes (id, business_id, key, name, sort_order) VALUES
  ('vc_biz_mana_twoWheeler', 'biz_mana', 'twoWheeler', 'Two-wheeler', 0),
  ('vc_biz_mana_car',        'biz_mana', 'car',        'Car',         1);
INSERT INTO vehicle_sizes (id, business_id, class_id, key, name, sort_order) VALUES
  ('vs_biz_mana_twoWheeler_S', 'biz_mana', 'vc_biz_mana_twoWheeler', 'S',  'Small',       0),
  ('vs_biz_mana_twoWheeler_M', 'biz_mana', 'vc_biz_mana_twoWheeler', 'M',  'Medium',      1),
  ('vs_biz_mana_twoWheeler_L', 'biz_mana', 'vc_biz_mana_twoWheeler', 'L',  'Large',       2),
  ('vs_biz_mana_car_S',        'biz_mana', 'vc_biz_mana_car',        'S',  'Small',       0),
  ('vs_biz_mana_car_M',        'biz_mana', 'vc_biz_mana_car',        'M',  'Medium',      1),
  ('vs_biz_mana_car_L',        'biz_mana', 'vc_biz_mana_car',        'L',  'Large',       2),
  ('vs_biz_mana_car_XL',       'biz_mana', 'vc_biz_mana_car',        'XL', 'Extra large', 3);
-- MANA prices a compact SUV a size up from a sedan, and a full SUV as extra large.
INSERT INTO body_types (id, business_id, key, name, class_id, size_id, sort_order) VALUES
  ('bt_biz_mana_hatch',    'biz_mana', 'hatch',    'Hatchback',   'vc_biz_mana_car',        'vs_biz_mana_car_S',        0),
  ('bt_biz_mana_sedan',    'biz_mana', 'sedan',    'Sedan',       'vc_biz_mana_car',        'vs_biz_mana_car_M',        1),
  ('bt_biz_mana_suvMini',  'biz_mana', 'suvMini',  'Compact SUV', 'vc_biz_mana_car',        'vs_biz_mana_car_L',        2),
  ('bt_biz_mana_suvLarge', 'biz_mana', 'suvLarge', 'SUV',         'vc_biz_mana_car',        'vs_biz_mana_car_XL',       3),
  ('bt_biz_mana_scooter',  'biz_mana', 'scooter',  'Scooter',     'vc_biz_mana_twoWheeler', 'vs_biz_mana_twoWheeler_S', 25),
  ('bt_biz_mana_bike',     'biz_mana', 'bike',     'Bike',        'vc_biz_mana_twoWheeler', 'vs_biz_mana_twoWheeler_M', 27);
UPDATE vehicle_types SET body_type_id = 'bt_biz_mana_hatch'    WHERE id = 'vt_hatchback';
UPDATE vehicle_types SET body_type_id = 'bt_biz_mana_sedan'    WHERE id = 'vt_sedan';
UPDATE vehicle_types SET body_type_id = 'bt_biz_mana_suvMini'  WHERE id = 'vt_mini_suv';
UPDATE vehicle_types SET body_type_id = 'bt_biz_mana_suvLarge' WHERE id = 'vt_large_suv';
UPDATE vehicle_types SET body_type_id = 'bt_biz_mana_bike'     WHERE id = 'vt_bike';
UPDATE vehicle_types SET body_type_id = 'bt_biz_mana_scooter'  WHERE id = 'vt_scooter';

INSERT INTO catalog_services (id, business_id, name, description, modes, sort_order)
SELECT column1, 'biz_mana', column2, column3, column4, column5 FROM (VALUES
  ('cs_complete_wash',      'Complete Car Wash',    'Exterior foam wash + interior vacuum + tyres + glass', 'both', 0),
  ('cs_exterior_wash',      'Exterior Wash',        'Exterior foam wash + wheels + tyres + glass',          'both', 1),
  ('cs_interior_cleaning',  'Interior Cleaning',    'Vacuum + mats + dashboard wipe + interior glass',      'both', 2),
  ('cs_mana_combo',         'MANA Combo',           'Complete Car Wash + tyre and dashboard dressing',      'both', 3),
  ('cs_ac_hygiene',         'AC & Cabin Hygiene',   'AC vent and cabin refresh treatment',                  'both', 4),
  -- Needs the hub's ramp.
  ('cs_underbody',          'Underbody Cleaning',   'Underbody wash and mud removal',                       'hub',  5),
  ('cs_tyre_dressing',      'Tyre Dressing',        'Add-on',                                               'both', 6),
  ('cs_dashboard_dressing', 'Dashboard Dressing',   'Add-on',                                               'both', 7),
  ('cs_fragrance',          'Car Fragrance',        'Add-on',                                               'both', 8),
  ('cs_bike_complete',      'Complete Bike Wash',   'Foam wash + chain area wipe + dry',                    'both', 100),
  ('cs_bike_exterior',      'Bike Foam Wash',       'Exterior foam wash + wheels + dry',                    'both', 101),
  ('cs_bike_chain',         'Chain Clean & Lube',   'Chain degrease, clean, and lube',                      'both', 102),
  ('cs_bike_engine',        'Engine Degrease',      'Engine bay degrease and wipe',                         'both', 103),
  ('cs_bike_polish',        'Bike Polish',          'Body polish and shine',                                'both', 104),
  ('cs_bike_tyre',          'Bike Tyre Dressing',   'Add-on',                                               'both', 105),
  ('cs_bike_seat',          'Seat Clean & Protect', 'Seat wipe and protectant',                             'both', 106));

INSERT INTO catalog_service_classes (business_id, service_id, class_id)
SELECT 'biz_mana', id, CASE WHEN sort_order >= 100 THEN 'vc_biz_mana_twoWheeler' ELSE 'vc_biz_mana_car' END
FROM catalog_services WHERE business_id = 'biz_mana';

-- Every branch of the business sells every one of these to start with.
INSERT INTO branch_menu_services (shop_id, catalog_service_id)
SELECT s.id, c.id FROM shops s JOIN catalog_services c ON c.business_id = s.business_id WHERE s.business_id = 'biz_mana';

INSERT INTO catalog_combo_items (business_id, combo_id, service_id) VALUES
  ('biz_mana', 'cs_mana_combo', 'cs_complete_wash'),
  ('biz_mana', 'cs_mana_combo', 'cs_tyre_dressing'),
  ('biz_mana', 'cs_mana_combo', 'cs_dashboard_dressing');
-- The branch's combo bundles the same services (adoption keeps the branch's combo items).
INSERT INTO service_combo_items (shop_id, combo_id, service_id) VALUES
  ('shop_mana', 'svc_mana_combo', 'svc_complete_wash'),
  ('shop_mana', 'svc_mana_combo', 'svc_tyre_dressing'),
  ('shop_mana', 'svc_mana_combo', 'svc_dashboard_dressing');

INSERT INTO price_books (id, business_id, name, is_default) VALUES ('pb_biz_mana_default', 'biz_mana', 'Standard', 1);

-- Base prices (paise) by size: car S / M / L / XL, two-wheeler S / M — the same as the branch's.
INSERT INTO price_book_entries (business_id, price_book_id, service_id, size_id, price)
SELECT 'biz_mana', 'pb_biz_mana_default', column1, 'vs_biz_mana_' || column2, column3 FROM (VALUES
  ('cs_complete_wash', 'car_S', 40000), ('cs_complete_wash', 'car_M', 50000), ('cs_complete_wash', 'car_L', 60000), ('cs_complete_wash', 'car_XL', 70000),
  ('cs_exterior_wash', 'car_S', 25000), ('cs_exterior_wash', 'car_M', 30000), ('cs_exterior_wash', 'car_L', 35000), ('cs_exterior_wash', 'car_XL', 40000),
  ('cs_interior_cleaning', 'car_S', 25000), ('cs_interior_cleaning', 'car_M', 30000), ('cs_interior_cleaning', 'car_L', 35000), ('cs_interior_cleaning', 'car_XL', 40000),
  ('cs_mana_combo', 'car_S', 50000), ('cs_mana_combo', 'car_M', 60000), ('cs_mana_combo', 'car_L', 70000), ('cs_mana_combo', 'car_XL', 80000),
  ('cs_ac_hygiene', 'car_S', 250000), ('cs_ac_hygiene', 'car_M', 250000), ('cs_ac_hygiene', 'car_L', 250000), ('cs_ac_hygiene', 'car_XL', 250000),
  ('cs_underbody', 'car_S', 50000), ('cs_underbody', 'car_M', 50000), ('cs_underbody', 'car_L', 50000), ('cs_underbody', 'car_XL', 50000),
  ('cs_tyre_dressing', 'car_S', 5000), ('cs_tyre_dressing', 'car_M', 5000), ('cs_tyre_dressing', 'car_L', 5000), ('cs_tyre_dressing', 'car_XL', 5000),
  ('cs_dashboard_dressing', 'car_S', 10000), ('cs_dashboard_dressing', 'car_M', 10000), ('cs_dashboard_dressing', 'car_L', 10000), ('cs_dashboard_dressing', 'car_XL', 10000),
  ('cs_fragrance', 'car_S', 5000), ('cs_fragrance', 'car_M', 5000), ('cs_fragrance', 'car_L', 5000), ('cs_fragrance', 'car_XL', 5000),
  ('cs_bike_complete', 'twoWheeler_S', 20000), ('cs_bike_complete', 'twoWheeler_M', 25000),
  ('cs_bike_exterior', 'twoWheeler_S', 12000), ('cs_bike_exterior', 'twoWheeler_M', 15000),
  ('cs_bike_chain', 'twoWheeler_S', 10000), ('cs_bike_chain', 'twoWheeler_M', 10000),
  ('cs_bike_engine', 'twoWheeler_S', 15000), ('cs_bike_engine', 'twoWheeler_M', 15000),
  ('cs_bike_polish', 'twoWheeler_S', 20000), ('cs_bike_polish', 'twoWheeler_M', 25000),
  ('cs_bike_tyre', 'twoWheeler_S', 5000), ('cs_bike_tyre', 'twoWheeler_M', 5000),
  ('cs_bike_seat', 'twoWheeler_S', 8000), ('cs_bike_seat', 'twoWheeler_M', 8000));

-- Doorstep washes cost 15% more (travel and water), at least ₹50.
INSERT INTO mode_adjustments (id, business_id, mode, class_id, percent_bp, fixed_paise, min_extra_paise)
VALUES ('ma_biz_mana_doorstep_all', 'biz_mana', 'doorstep', NULL, 1500, 0, 5000);

-- Community plans (buildings, colonies, streets): priced from the community (doorstep) price of
-- their catalog service, washes × price less the discount. Weekly is once a week outside, Regular
-- twice, Premium three times with the inside done too; Premium can be paid in parts.
INSERT INTO wash_plans (id, business_id, name, washes, months, catalog_service_id, discount_bp, allow_parts, popular, sort_order) VALUES
  ('wp_mana_weekly',       'biz_mana', 'Weekly',       4,  1, 'cs_exterior_wash', 0,    0, 0, 0),
  ('wp_mana_regular',      'biz_mana', 'Regular',      8,  1, 'cs_exterior_wash', 1500, 0, 1, 1),
  ('wp_mana_premium',      'biz_mana', 'Premium',      12, 1, 'cs_complete_wash', 2000, 1, 0, 2),
  ('wp_mana_bike_monthly', 'biz_mana', 'Bike Monthly', 4,  1, 'cs_bike_complete', 0,    0, 0, 3);

-- ─── Seed: a few India Post offices ──────────────────────────────────────────

-- Enough pincodes to open test branches (Kovur, Kavali, Nellore, Vijayawada, Ongole, Kukatpally).
-- The full list is loaded with `npm run data:post-offices -- --into local`.
INSERT INTO post_offices (pincode, name, kind, district, state, latitude, longitude) VALUES
  ('500072', 'Kukatpally Court Complex SO', 'PO', 'MEDCHAL MALKAJGIRI', 'TELANGANA', 17.464567, 78.390157),
  ('500072', 'Kukatpally S.O', 'PO', 'MEDCHAL MALKAJGIRI', 'TELANGANA', 17.49279, 78.396612),
  ('500072', 'Vivekanandanagar Colony S.O', 'PO', 'MEDCHAL MALKAJGIRI', 'TELANGANA', 17.492917, 78.409056),
  ('520010', 'International Business Centre PO', 'PO', 'NTR', 'ANDHRA PRADESH', NULL, NULL),
  ('520010', 'Moghalrajpuram S.O', 'PO', 'NTR', 'ANDHRA PRADESH', 16.508194, 80.6415),
  ('520010', 'Punnamathota S.O', 'PO', 'NTR', 'ANDHRA PRADESH', 16.504944, 80.636861),
  ('520010', 'Venkateswarapuram S.O', 'PO', 'NTR', 'ANDHRA PRADESH', 16.335861, 80.635472),
  ('523001', 'Addanki Gate S.O', 'PO', 'PRAKASAM', 'ANDHRA PRADESH', 15.500917, 80.050889),
  ('523001', 'Dcp(O) S.O', 'PO', 'PRAKASAM', 'ANDHRA PRADESH', 15.503389, 80.043722),
  ('523001', 'Gopala Nagar (O) S.O', 'PO', 'PRAKASAM', 'ANDHRA PRADESH', 15.511461, 80.052095),
  ('523001', 'N.S.C Colony (O) S.O', 'PO', 'PRAKASAM', 'ANDHRA PRADESH', 15.47865, 80.0537),
  ('523001', 'Ongole Bazar S.O', 'PO', 'PRAKASAM', 'ANDHRA PRADESH', 15.50425, 80.046389),
  ('523001', 'Ongole H.O', 'HO', 'PRAKASAM', 'ANDHRA PRADESH', 15.500472, 80.048611),
  ('523001', 'Prakasam Bhavan S.O', 'PO', 'PRAKASAM', 'ANDHRA PRADESH', 15.49825, 80.049833),
  ('523001', 'Ramnagar(O) S.O', 'PO', 'PRAKASAM', 'ANDHRA PRADESH', 15.491694, 80.052667),
  ('523001', 'Santhapeta (O) S.O', 'PO', 'PRAKASAM', 'ANDHRA PRADESH', 15.496778, 80.056528),
  ('523001', 'Thurupupalem S.O', 'PO', 'PRAKASAM', 'ANDHRA PRADESH', 15.510333, 80.036333),
  ('524001', 'Nellore H.O', 'HO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.451895, 79.980856),
  ('524001', 'Pogathota S.O', 'PO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.450194, 79.984639),
  ('524001', 'Trunk Road S.O (Nellore)', 'PO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.454003, 79.983802),
  ('524137', 'Cherlopalem B.O', 'BO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.528952, 80.017862),
  ('524137', 'Damaramadugu B.O', 'BO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.501522, 79.931862),
  ('524137', 'Gangavaram B.O', 'BO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.495067, 79.957391),
  ('524137', 'Gummalladibba B.O', 'BO', 'SPSR NELLORE', 'ANDHRA PRADESH', NULL, NULL),
  ('524137', 'Inamadugu B.O', 'BO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.511563, 80.015064),
  ('524137', 'Kovur Cutchery S.O', 'PO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.509194, 79.985694),
  ('524137', 'Kovur S.O', 'PO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.508611, 79.983917),
  ('524137', 'Leguntapadu B.O', 'BO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.51411, 80.024149),
  ('524137', 'Mudivarthi B.O', 'BO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.554407, 80.108659),
  ('524137', 'Padugupadu B.O', 'BO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.480336, 79.991301),
  ('524137', 'Patur B.O', 'BO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.513459, 79.941736),
  ('524137', 'Pothireddypalem B.O', 'BO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.47767, 79.979416),
  ('524137', 'Vegur B.O', 'BO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.534819, 80.054191),
  ('524201', 'Janathapeta S.O', 'PO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.030532, 80.02901),
  ('524201', 'Kavali Bazar S.O', 'PO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.91325, 79.992972),
  ('524201', 'Kavali Co op Colony S.O', 'PO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.451891, 79.981077),
  ('524201', 'Kavali H.O', 'HO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.91658, 79.993121),
  ('524201', 'Musunur B.O', 'BO', 'SPSR NELLORE', 'ANDHRA PRADESH', 14.87972, 79.983611),
  ('524201', 'Vengalarao Nagar TSO', 'PO', 'SPSR NELLORE', 'ANDHRA PRADESH', NULL, NULL);
