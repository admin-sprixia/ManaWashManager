// Service network end to end: the business catalog (services, base prices by size, doorstep
// extra, zones, policy), branch menus built from it, service points (hub and doorstep teams),
// branch prices within the policy, hiding services, hub and doorstep washes, the customer app's
// branch list, importing a branch's menu and adopting same-named services. Run against the local
// API:
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:catalog                       (in another)
import { API, apiFetch, d1Rows, d1Run, DEV_CODE, signIn as signInWith } from './lib/target.mjs';

const PIN = '258025';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`;

async function call(token, method, path, body) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await apiFetch(API + path, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const run = Date.now().toString(36);
const rand = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');

const BIZ = `biz_cc_${run}`;
const A = `shop_cca_${run}`;
const B = `shop_ccb_${run}`;
const C = `shop_ccc_${run}`;
const D = `shop_ccd_${run}`;
const phoneA = `95${rand(8)}`;
const phoneB = `95${rand(8)}`;
const staffPhone = `95${rand(8)}`;
const OWNER_A = `user_cca_${run}`;
const STAFF_A = `user_ccs_${run}`;
const OWNER_C = `user_ccc_${run}`;
const OWNER_D = `user_ccd_${run}`;

const shopRow = (id, name) =>
  `INSERT INTO shops (id, code, name, business_id) VALUES ('${id}', '${rand(6)}', '${name}', '${BIZ}');`;
d1Run(
  `INSERT INTO businesses (id, name) VALUES ('${BIZ}', 'Catalog Check Co');` +
    shopRow(A, 'Catalog Hub') +
    shopRow(B, 'Catalog Town') +
    shopRow(C, 'Catalog Import') +
    shopRow(D, 'Catalog Adopt') +
    `UPDATE shops SET latitude = 15.5, longitude = 80.05, service_radius_km = 5 WHERE id = '${A}';` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('${OWNER_A}', '${A}', 'Hub Owner', '${phoneA}', 'owner');` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('${STAFF_A}', '${A}', 'Hub Staff', '${staffPhone}', 'staff');` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('user_ccb_${run}', '${B}', 'Town Owner', '${phoneB}', 'owner');` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('${OWNER_C}', '${C}', 'Import Owner', '95${rand(8)}', 'owner');` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('${OWNER_D}', '${D}', 'Adopt Owner', '95${rand(8)}', 'owner');` +
    `INSERT INTO business_admins (business_id, phone) VALUES ('${BIZ}', '${phoneA}');` +
    // Branch C has its own hand-made menu, to import.
    `INSERT INTO vehicle_types (id, shop_id, name, category, sort_order) VALUES ('vt_ccc_h_${run}', '${C}', 'Hatchback', 'car', 0);` +
    `INSERT INTO services (id, shop_id, name, applies_to, sort_order) VALUES ('svc_ccc_foam_${run}', '${C}', 'Foam Wash', 'car', 0);` +
    `INSERT INTO service_prices (id, shop_id, service_id, vehicle_type_id, price) VALUES ('sp_ccc_${run}', '${C}', 'svc_ccc_foam_${run}', 'vt_ccc_h_${run}', 30000);` +
    // Branch D has a hand-made "Full Wash" that the catalog's Full Wash should adopt.
    `INSERT INTO vehicle_types (id, shop_id, name, category, sort_order) VALUES ('vt_ccd_h_${run}', '${D}', 'Hatchback', 'car', 0);` +
    `INSERT INTO services (id, shop_id, name, applies_to, sort_order) VALUES ('svc_ccd_full_${run}', '${D}', 'Full Wash', 'car', 0);` +
    `INSERT INTO service_prices (id, shop_id, service_id, vehicle_type_id, price) VALUES ('sp_ccd_${run}', '${D}', 'svc_ccd_full_${run}', 'vt_ccd_h_${run}', 39000);` +
    `INSERT INTO commission_rates (shop_id, service_id, vehicle_type_id, amount) VALUES ('${D}', 'svc_ccd_full_${run}', 'vt_ccd_h_${run}', 2000);`,
);

async function signIn(phone) {
  const p = await signInWith(phone, PIN);
  if (!p.body?.token) console.log(`      (sign-in for ${phone} failed: ${show(p)})`);
  return p.body?.token;
}
const OA = await signIn(phoneA);
const OB = await signIn(phoneB);
d1Run(`UPDATE users SET pin_hash = (SELECT pin_hash FROM users WHERE id = '${OWNER_A}') WHERE id = '${STAFF_A}';`);
const SA = (await signInWith(staffPhone, PIN)).body?.token;
check('Admin owner, other branch owner and staff sign in', !!OA && !!OB && !!SA);
if (!OA || !OB || !SA) process.exit(1);

// ─── The catalog ─────────────────────────────────────────────────────────────

let r = await call(OA, 'GET', '/business/catalog');
const cat = r.body;
check('An admin opens the catalog with the default classes, sizes and body types', r.status === 200 && cat.classes?.length === 6 && cat.bodyTypes?.length >= 31, show(r));
check('…and a default price book and policy', cat.priceBooks?.some((b) => b.isDefault) && cat.policy?.maxIncreasePct === 20, show(r));
check('…listing its branches', ['Catalog Hub', 'Catalog Town'].every((n) => cat.branches?.some((b) => b.name === n)));
r = await call(OB, 'GET', '/business/catalog');
check('A branch owner who isn’t an admin can’t open it', r.status === 403, show(r));
r = await call(SA, 'GET', '/business/catalog');
check('Staff can’t either', r.status === 403, show(r));

const cls = Object.fromEntries(cat.classes.map((c) => [c.key, c]));
const size = (classKey, key) => cls[classKey].sizes.find((s) => s.key === key).id;
const book = cat.priceBooks.find((b) => b.isDefault).id;

r = await call(OA, 'POST', '/business/services', {
  name: 'Full Wash',
  description: 'Foam, vacuum, tyres',
  classIds: [cls.car.id, cls.twoWheeler.id, cls.farm.id],
});
const FULL = r.body?.id;
check('Admin adds a service for cars, two-wheelers and farm vehicles', r.status === 201 && !!FULL, show(r));
r = await call(OA, 'POST', '/business/services', { name: 'Underbody', modes: 'hub', classIds: [cls.car.id] });
const UNDER = r.body?.id;
r = await call(OA, 'POST', '/business/services', { name: 'Full + Underbody', classIds: [cls.car.id], includes: [FULL, UNDER] });
const COMBO = r.body?.id;
check('…a hub-only service and a combo of both', !!UNDER && !!COMBO, show(r));
r = await call(OA, 'POST', '/business/services', { name: 'Combo of combo', classIds: [cls.car.id], includes: [COMBO, FULL] });
check('A combo can’t bundle another combo', r.status === 400 && r.body?.error === 'nested_combo', show(r));
r = await call(OA, 'POST', '/business/services', { name: 'No class', classIds: [] });
check('A service needs a vehicle class', r.status === 400, show(r));

r = await call(OA, 'PUT', '/business/prices', {
  priceBookId: book,
  entries: [
    { serviceId: FULL, sizeId: size('car', 'S'), price: 40000 },
    { serviceId: FULL, sizeId: size('car', 'M'), price: 50000 },
    { serviceId: FULL, sizeId: size('car', 'L'), price: 60000 },
    { serviceId: FULL, sizeId: size('twoWheeler', 'S'), price: 15000 },
    { serviceId: UNDER, sizeId: size('car', 'S'), price: 30000 },
    { serviceId: UNDER, sizeId: size('car', 'M'), price: 30000 },
    { serviceId: COMBO, sizeId: size('car', 'S'), price: 65000 },
  ],
});
check('Admin sets base prices by size in one save', r.status === 200 && r.body?.ok, show(r));
r = await call(OA, 'PUT', '/business/prices', { priceBookId: book, entries: [{ serviceId: FULL, sizeId: 'vs_nope', price: 100 }] });
check('An unknown size is refused', r.status === 404, show(r));
r = await call(OA, 'PUT', '/business/adjustments', { mode: 'doorstep', classId: null, percentBp: 1500, fixedPaise: 0, minExtraPaise: 5000 });
check('Admin sets the doorstep extra (15%, at least ₹50)', r.status === 200, show(r));
r = await call(OA, 'PUT', '/business/adjustments', { mode: 'doorstep', classId: null, percentBp: 99999, fixedPaise: 0, minExtraPaise: 0 });
check('An extra beyond the limits is refused', r.status === 400, show(r));
r = await call(OB, 'PUT', '/business/prices', { priceBookId: book, entries: [{ serviceId: FULL, sizeId: size('car', 'S'), price: 1 }] });
check('A non-admin can’t change base prices', r.status === 403, show(r));

// ─── A branch menu built from it ─────────────────────────────────────────────

r = await call(OA, 'GET', '/services');
const svcA = Object.fromEntries((r.body ?? []).map((s) => [s.name, s]));
check('The branch menu has the catalog services', r.status === 200 && !!svcA['Full Wash'] && !!svcA['Underbody'] && !!svcA['Full + Underbody'], show(r));
check('…linked to the catalog, the combo bundling both', svcA['Full Wash']?.catalogServiceId === FULL && svcA['Full + Underbody']?.includes?.length === 2);
r = await call(OA, 'GET', '/services/vehicle-types');
const vtA = Object.fromEntries((r.body ?? []).map((v) => [v.name, v]));
check('Vehicle types the branch can price were added (Hatchback, Sedan, SUV, Scooter)', ['Hatchback', 'Sedan', 'SUV', 'Scooter'].every((n) => vtA[n]?.bodyTypeId), Object.keys(vtA).join(', '));
check('…but none for sizes without a price (no Luxury car, no Bus)', !vtA['Luxury car'] && !vtA['Bus']);
r = await call(OA, 'GET', '/branch/points');
check('The branch got its hub as its first service point', r.status === 200 && r.body?.points?.length === 1 && r.body.points[0].kind === 'hub', show(r));
const classesA = r.body?.classes ?? [];

r = await call(OA, 'GET', '/services/prices');
const priceOf = (rows, svc, vt, mode = 'hub') => rows.find((p) => p.serviceId === svc && p.vehicleTypeId === vt && p.mode === mode);
let prices = r.body ?? [];
const fullA = svcA['Full Wash'].id;
const underA = svcA['Underbody'].id;
check('Hub prices come from the price book', priceOf(prices, fullA, vtA.Hatchback.id)?.price === 40000 && priceOf(prices, fullA, vtA.SUV.id)?.price === 60000, show(r));
check('…marked as catalog prices', priceOf(prices, fullA, vtA.Hatchback.id)?.source === 'template' && priceOf(prices, fullA, vtA.Hatchback.id)?.listPrice === 40000);
check('A hub-only branch has no doorstep prices', !prices.some((p) => p.mode === 'doorstep'));

// ─── Doorstep team ───────────────────────────────────────────────────────────

r = await call(SA, 'POST', '/branch/points', { kind: 'doorstep', name: 'Van 1', classIds: [cls.car.id] });
check('Staff can’t add a service point', r.status === 403, show(r));
r = await call(OA, 'POST', '/branch/points', { kind: 'doorstep', name: 'Van 1', radiusKm: 5, classIds: [cls.car.id] });
check('A distance without a map point is refused', r.status === 400, show(r));
r = await call(OA, 'POST', '/branch/points', {
  kind: 'doorstep',
  name: 'Van 1',
  latitude: 15.7,
  longitude: 80.05,
  radiusKm: 10,
  classIds: [cls.car.id, cls.farm.id],
});
const VAN = r.body?.id;
check('Owner adds a doorstep team for cars and farm vehicles', r.status === 201 && !!VAN, show(r));
prices = (await call(OA, 'GET', '/services/prices')).body ?? [];
check('Doorstep prices appear with the extra (₹400 → ₹460)', priceOf(prices, fullA, vtA.Hatchback.id, 'doorstep')?.price === 46000, JSON.stringify(priceOf(prices, fullA, vtA.Hatchback.id, 'doorstep')));
check('…the extra is at least ₹50 (₹150 bike wash isn’t done at the door: bikes aren’t on the van)', !priceOf(prices, fullA, vtA.Scooter.id, 'doorstep'));
check('A hub-only service gets no doorstep price', !priceOf(prices, underA, vtA.Hatchback.id, 'doorstep'));

r = await call(OA, 'PUT', '/business/prices', { priceBookId: book, entries: [{ serviceId: FULL, sizeId: size('farm', 'L'), price: 150000 }] });
let vts = (await call(OA, 'GET', '/services/vehicle-types')).body ?? [];
const tractor = vts.find((v) => v.name === 'Tractor');
check('Pricing farm vehicles adds a Tractor type to the branch with a farm doorstep team', !!tractor, vts.map((v) => v.name).join(', '));
prices = (await call(OA, 'GET', '/services/prices')).body ?? [];
check('…priced at the door (₹1,500 + 15% = ₹1,725 → ₹1,730)', priceOf(prices, fullA, tractor?.id, 'doorstep')?.price === 173000, JSON.stringify(priceOf(prices, fullA, tractor?.id, 'doorstep')));
check('…but not at the hub, which doesn’t take tractors', !priceOf(prices, fullA, tractor?.id, 'hub'));
r = await call(OB, 'GET', '/services/vehicle-types');
check('A branch without a farm team gets no Tractor type', !(r.body ?? []).some((v) => v.name === 'Tractor'), show(r));

r = await call(OA, 'GET', '/services/network');
check('With washing at homes off, the doorstep team only goes to communities: New Wash is at the shop', r.status === 200 && r.body?.homeWash === false && r.body?.modes?.join() === 'hub', show(r));
r = await call(OA, 'GET', '/branch/points');
check('…and the branch’s setup knows it', r.body?.homeWash === false, show(r));
r = await call(OA, 'PATCH', '/business/plan-rules', { homeWash: true });
check('The admin turns washing at homes on', r.status === 200 && r.body?.rules?.homeWash === true, show(r));
r = await call(OA, 'GET', '/services/network');
check('The branch sees how it works and the policy', r.status === 200 && r.body?.homeWash === true && r.body?.modes?.join() === 'hub,doorstep' && r.body?.isBusinessAdmin === true && r.body?.policy?.maxIncreasePct === 20, show(r));
r = await call(OA, 'GET', '/business/catalog');
check('…and so does the business price list', r.body?.homeWash === true, show(r));

// ─── Branch prices within the policy ─────────────────────────────────────────

r = await call(OA, 'PUT', '/services/prices', { serviceId: fullA, vehicleTypeId: vtA.Hatchback.id, mode: 'hub', price: 44000 });
check('Owner sets the branch’s own price within 20%', r.status === 200 && r.body?.price === 44000 && r.body?.overridden === true, show(r));
r = await call(OA, 'PUT', '/services/prices', { serviceId: fullA, vehicleTypeId: vtA.Hatchback.id, mode: 'hub', price: 60000 });
check('…but not beyond it', r.status === 400, show(r));
prices = (await call(OA, 'GET', '/services/prices')).body ?? [];
check('The menu shows the branch price', priceOf(prices, fullA, vtA.Hatchback.id)?.price === 44000 && priceOf(prices, fullA, vtA.Hatchback.id)?.source === 'override');

r = await call(OA, 'PUT', '/business/prices', { priceBookId: book, entries: [{ serviceId: FULL, sizeId: size('car', 'S'), price: 42000 }] });
prices = (await call(OA, 'GET', '/services/prices')).body ?? [];
check('A base price change keeps the branch’s own price', priceOf(prices, fullA, vtA.Hatchback.id)?.price === 44000 && priceOf(prices, fullA, vtA.Hatchback.id)?.listPrice === 42000);
const svcB = Object.fromEntries(((await call(OB, 'GET', '/services')).body ?? []).map((s) => [s.name, s]));
const vtB = Object.fromEntries(((await call(OB, 'GET', '/services/vehicle-types')).body ?? []).map((v) => [v.name, v]));
let pricesB = (await call(OB, 'GET', '/services/prices')).body ?? [];
check('…and reaches the other branch', priceOf(pricesB, svcB['Full Wash']?.id, vtB.Hatchback?.id)?.price === 42000, JSON.stringify(priceOf(pricesB, svcB['Full Wash']?.id, vtB.Hatchback?.id)));

r = await call(OA, 'PATCH', '/business/policy', { branchOverrides: false });
prices = (await call(OA, 'GET', '/services/prices')).body ?? [];
check('Switching branch prices off brings back the list price', r.status === 200 && priceOf(prices, fullA, vtA.Hatchback.id)?.price === 42000, show(r));
r = await call(OA, 'PUT', '/services/prices', { serviceId: fullA, vehicleTypeId: vtA.Hatchback.id, mode: 'hub', price: 43000 });
check('…and branch prices can’t be set', r.status === 400, show(r));
await call(OA, 'PATCH', '/business/policy', { branchOverrides: true });
prices = (await call(OA, 'GET', '/services/prices')).body ?? [];
check('Switching them back on restores the kept branch price', priceOf(prices, fullA, vtA.Hatchback.id)?.price === 44000);
r = await call(OA, 'DELETE', '/services/prices', { serviceId: fullA, vehicleTypeId: vtA.Hatchback.id, mode: 'hub' });
prices = (await call(OA, 'GET', '/services/prices')).body ?? [];
check('Clearing it goes back to the list price', r.status === 200 && priceOf(prices, fullA, vtA.Hatchback.id)?.price === 42000 && priceOf(prices, fullA, vtA.Hatchback.id)?.source === 'template', `${show(r)} ${JSON.stringify(priceOf(prices, fullA, vtA.Hatchback.id))}`);

// ─── Catalog services at a branch ────────────────────────────────────────────

r = await call(OA, 'PATCH', `/services/${fullA}`, { name: 'Renamed' });
check('A branch can’t rename a catalog service', r.status === 409 && r.body?.error === 'catalog_managed', show(r));
r = await call(OA, 'DELETE', `/services/${underA}`);
let names = ((await call(OA, 'GET', '/services')).body ?? []).map((s) => s.name);
check('Removing a catalog service hides it at this branch', r.status === 200 && !names.includes('Underbody'), show(r));
check('…and the combo no longer lists it', ((await call(OA, 'GET', '/services')).body ?? []).find((s) => s.name === 'Full + Underbody')?.includes?.length === 1);
r = await call(OA, 'GET', '/services/network');
check('…it shows as hidden, to bring back', r.body?.hidden?.some((h) => h.id === underA), show(r));
r = await call(OA, 'PUT', `/services/${underA}/hidden`, { hidden: false });
names = ((await call(OA, 'GET', '/services')).body ?? []).map((s) => s.name);
check('Bringing it back', r.status === 200 && names.includes('Underbody'), show(r));
await call(OA, 'PATCH', '/business/policy', { branchCanHideServices: false });
r = await call(OA, 'DELETE', `/services/${underA}`);
check('When the business forbids it, a branch can’t remove catalog services', r.status === 400, show(r));
await call(OA, 'PATCH', '/business/policy', { branchCanHideServices: true });

r = await call(OA, 'PATCH', `/business/services/${UNDER}`, { name: 'Underbody Wash' });
names = ((await call(OB, 'GET', '/services')).body ?? []).map((s) => s.name);
check('Renaming in the catalog renames it at every branch', r.status === 200 && names.includes('Underbody Wash') && !names.includes('Underbody'), names.join(', '));
r = await call(OA, 'PATCH', `/business/services/${UNDER}`, { active: false });
names = ((await call(OB, 'GET', '/services')).body ?? []).map((s) => s.name);
check('Retiring it takes it off every branch', r.status === 200 && !names.includes('Underbody Wash'));
await call(OA, 'PATCH', `/business/services/${UNDER}`, { active: true });

// ─── Zones and price books ───────────────────────────────────────────────────

r = await call(OA, 'POST', '/business/zones', { name: 'Town centre', percentBp: 1000 });
const ZONE = r.body?.id;
r = await call(OA, 'PATCH', `/business/branches/${B}`, { priceZoneId: ZONE });
pricesB = (await call(OB, 'GET', '/services/prices')).body ?? [];
check('A branch in a +10% zone charges ₹460 for ₹420 (₹462, rounded to ₹10)', r.status === 200 && priceOf(pricesB, svcB['Full Wash']?.id, vtB.Hatchback?.id)?.price === 46000, JSON.stringify(priceOf(pricesB, svcB['Full Wash']?.id, vtB.Hatchback?.id)));
r = await call(OA, 'PATCH', `/business/zones/${ZONE}`, { active: false });
pricesB = (await call(OB, 'GET', '/services/prices')).body ?? [];
check('Switching the zone off goes back to ₹420', priceOf(pricesB, svcB['Full Wash']?.id, vtB.Hatchback?.id)?.price === 42000);
r = await call(OA, 'POST', '/business/price-books', { name: 'Premium', copyFrom: book });
const PREMIUM = r.body?.id;
await call(OA, 'PUT', '/business/prices', { priceBookId: PREMIUM, entries: [{ serviceId: FULL, sizeId: size('car', 'S'), price: 55000 }] });
await call(OA, 'PATCH', `/business/branches/${B}`, { priceBookId: PREMIUM });
pricesB = (await call(OB, 'GET', '/services/prices')).body ?? [];
check('A branch on another price book uses its prices', priceOf(pricesB, svcB['Full Wash']?.id, vtB.Hatchback?.id)?.price === 55000);
r = await call(OA, 'DELETE', `/business/price-books/${PREMIUM}`);
check('A price book in use can’t be deleted', r.status === 409, show(r));
r = await call(OA, 'DELETE', `/business/price-books/${book}`);
check('The default price book can’t be deleted', r.status === 409, show(r));
await call(OA, 'PATCH', `/business/branches/${B}`, { priceBookId: null });

// ─── Washes: hub and doorstep ────────────────────────────────────────────────

const start = (extra) =>
  call(OA, 'POST', '/jobs/start', {
    id: `job_cc_${run}_${rand(6)}`,
    customer: { phone: `98${rand(8)}`, name: 'Door Customer' },
    registrationNumber: `AP${rand(2)}CC${rand(4)}`,
    vehicleTypeId: vtA.Hatchback.id,
    services: [{ serviceId: fullA, quantity: 1 }],
    ...extra,
  });
r = await start({ mode: 'doorstep' });
check('A doorstep wash is charged the doorstep price (₹420 + 15% = ₹483 → ₹480)', r.status === 201 && r.body?.total === 48000 && r.body?.deliveryMode === 'doorstep', show(r));
r = await start({});
check('A wash with no mode is a hub wash at the hub price', r.status === 201 && r.body?.total === 42000 && r.body?.deliveryMode === 'hub', show(r));
r = await start({ mode: 'doorstep', services: [{ serviceId: underA, quantity: 1 }] });
check('A hub-only service can’t be done at the door', r.status === 400 && r.body?.error === 'price_not_set', show(r));
r = await call(OB, 'POST', '/jobs/start', {
  id: `job_cc_${run}_${rand(6)}`,
  customer: { phone: `98${rand(8)}`, name: 'Door Customer' },
  registrationNumber: `AP${rand(2)}CC${rand(4)}`,
  vehicleTypeId: vtB.Hatchback?.id,
  services: [{ serviceId: svcB['Full Wash']?.id, quantity: 1 }],
  mode: 'doorstep',
});
check('A branch without a doorstep team can’t take doorstep washes', r.status === 400 && r.body?.error === 'mode_not_offered', show(r));

// ─── Customer app ────────────────────────────────────────────────────────────

d1Run(`UPDATE shops SET in_customer_app = 1 WHERE id = '${A}';`);
await call(OA, 'PATCH', '/business/plan-rules', { homeWash: false });
r = await call(null, 'GET', '/c/branches');
check('With washing at homes off, the app offers no wash at home', (r.body?.branches ?? []).find((b) => b.id === A)?.modes?.join() === 'hub', show(r));
await call(OA, 'PATCH', '/business/plan-rules', { homeWash: true });
r = await call(null, 'GET', '/c/branches');
const listed = (r.body?.branches ?? []).find((b) => b.id === A);
const fullListed = listed?.services?.find((s) => s.name === 'Full Wash');
const hatchListed = listed?.vehicleTypes?.find((v) => v.name === 'Hatchback');
check('The customer app lists how the branch washes', listed?.modes?.join() === 'hub,doorstep', show(r));
check('…with hub and doorstep prices', fullListed?.prices?.some((p) => p.vehicleTypeId === hatchListed?.id && p.price === 42000) && fullListed?.doorstepPrices?.some((p) => p.vehicleTypeId === hatchListed?.id && p.price === 48000), JSON.stringify(fullListed));
check('…and each vehicle type’s body type for its picture', hatchListed?.bodyKey === 'hatch', JSON.stringify(hatchListed));
r = await call(null, 'POST', '/c/service-area/check', { location: { latitude: 15.7, longitude: 80.06 } });
check('A place only the doorstep team reaches is served', r.status === 200 && r.body?.served === true && r.body?.branch?.name === 'Catalog Hub', show(r));
d1Run(`UPDATE shops SET in_customer_app = 0 WHERE id = '${A}';`);

// ─── Switching a point off ───────────────────────────────────────────────────

const hubId = (await call(OA, 'GET', '/branch/points')).body?.points?.find((p) => p.kind === 'hub')?.id;
r = await call(OA, 'PATCH', `/branch/points/${hubId}`, { active: false });
prices = (await call(OA, 'GET', '/services/prices')).body ?? [];
check('Closing the hub leaves doorstep prices only', r.status === 200 && !prices.some((p) => p.mode === 'hub' && p.source !== 'manual') && prices.some((p) => p.mode === 'doorstep'), show(r));
r = await call(OA, 'PATCH', `/branch/points/${VAN}`, { active: false });
check('The last working point can’t be switched off', r.status === 400, show(r));
await call(OA, 'PATCH', `/branch/points/${hubId}`, { active: true });

// ─── Import and adoption ─────────────────────────────────────────────────────

r = await call(OA, 'POST', '/business/import', { shopId: C });
check('Admin imports a branch’s own menu into the catalog', r.status === 200 && r.body?.created === 1, show(r));
const view = (await call(OA, 'GET', '/business/catalog')).body;
const foam = view?.services?.find((s) => s.name === 'Foam Wash');
check('…its services and prices become the catalog’s', !!foam && view.prices.some((p) => p.serviceId === foam.id && p.sizeId === size('car', 'S') && p.price === 30000));
let rowsC = d1Rows(`SELECT catalog_service_id FROM services WHERE id = 'svc_ccc_foam_${run}'`);
check('…and the branch’s service is linked, keeping its id', rowsC[0]?.catalog_service_id === foam?.id, JSON.stringify(rowsC));

await call(OA, 'POST', '/business/publish');
const rowsD = d1Rows(
  `SELECT s.catalog_service_id, p.price, p.source, p.list_price FROM services s JOIN service_prices p ON p.service_id = s.id WHERE s.id = 'svc_ccd_full_${run}' AND p.mode = 'hub'`,
);
check('A branch’s hand-made "Full Wash" is adopted by the catalog’s, keeping its id', rowsD[0]?.catalog_service_id === FULL, JSON.stringify(rowsD));
const ownD = rowsD.filter((p) => p.source === 'override');
check('…and its own price (₹390 against ₹420) stays as its branch price', ownD.length === 1 && ownD[0].price === 39000 && ownD[0].list_price === 42000, JSON.stringify(rowsD));
const dupes = d1Rows(`SELECT count(*) AS n FROM services WHERE shop_id = '${D}' AND name = 'Full Wash'`);
check('…with no second "Full Wash"', dupes[0]?.n === 1, JSON.stringify(dupes));
const commission = d1Rows(`SELECT amount FROM commission_rates WHERE service_id = 'svc_ccd_full_${run}'`);
check('…and its commission kept', commission[0]?.amount === 2000);

const stale = d1Rows(
  `SELECT count(*) AS n FROM shops s JOIN businesses b ON b.id = s.business_id WHERE s.business_id = '${BIZ}' AND s.menu_version < b.catalog_version`,
);
check('Every branch’s menu is up to date', stale[0]?.n === 0, JSON.stringify(stale));
check('Classes the admin can pick for points come from the catalog', classesA.length === 6);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
