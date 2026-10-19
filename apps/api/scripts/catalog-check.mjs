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

// Only someone already on a team in the business can be made HQ: never a mistyped or unknown number.
r = await call(OA, 'POST', '/business/admins', { phone: `95${rand(8)}` });
check('A number that isn’t on any team can’t be made HQ', r.status === 409 && r.body?.error === 'not_on_team', show(r));
r = await call(OA, 'POST', '/business/admins', { phone: phoneB });
check('…but another branch’s owner can', r.status === 201, show(r));
r = await call(OA, 'DELETE', `/business/admins/${phoneB}`);
check('…and stop being HQ again', r.status === 200, show(r));

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
check('A new service reaches no branch by itself', r.status === 200 && !(r.body ?? []).some((s) => s.name === 'Full Wash'), show(r));
const liveIds = ((await call(OA, 'GET', '/business/catalog')).body?.services ?? []).filter((s) => s.active).map((s) => s.id);
for (const shop of [A, B, D]) {
  r = await call(OA, 'PUT', `/business/branches/${shop}/menu`, { serviceIds: liveIds });
  if (r.status !== 200) check(`HQ switches the services on at ${shop}`, false, show(r));
}
r = await call(OB, 'PUT', `/business/branches/${A}/menu`, { serviceIds: liveIds });
check('Only HQ switches services on for a branch', r.status === 403, show(r));

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
check('…the van takes what the branch washes, bikes too, with at least ₹50 extra (₹150 → ₹200+)', (priceOf(prices, fullA, vtA.Scooter.id, 'doorstep')?.price ?? 0) >= (priceOf(prices, fullA, vtA.Scooter.id)?.price ?? Infinity) + 5000, JSON.stringify(priceOf(prices, fullA, vtA.Scooter.id, 'doorstep')));
check('A hub-only service gets no doorstep price', !priceOf(prices, underA, vtA.Hatchback.id, 'doorstep'));

r = await call(OA, 'PUT', '/business/prices', { priceBookId: book, entries: [{ serviceId: FULL, sizeId: size('farm', 'L'), price: 150000 }] });
let vts = (await call(OA, 'GET', '/services/vehicle-types')).body ?? [];
const tractor = vts.find((v) => v.name === 'Tractor');
check('Pricing farm vehicles adds a Tractor type to the branch with a farm doorstep team', !!tractor, vts.map((v) => v.name).join(', '));
prices = (await call(OA, 'GET', '/services/prices')).body ?? [];
check('…priced at the door (₹1,500 + 15% = ₹1,725, to the rupee)', priceOf(prices, fullA, tractor?.id, 'doorstep')?.price === 172500, JSON.stringify(priceOf(prices, fullA, tractor?.id, 'doorstep')));
check('…and the hub price, which home washes are charged (plus the visit charge)', priceOf(prices, fullA, tractor?.id, 'hub')?.price === 150000, JSON.stringify(priceOf(prices, fullA, tractor?.id, 'hub')));
r = await call(OA, 'GET', '/services/network');
check('…and the shop takes them too: every place washes what the branch washes', !r.body?.homeOnlyTypes?.includes(tractor?.id), show(r));
r = await call(OB, 'GET', '/services/vehicle-types');
check('A branch that washes every kind gets a Tractor type too', (r.body ?? []).some((v) => v.name === 'Tractor'), show(r));

// ─── The vehicles each branch washes ─────────────────────────────────────────

const kindsOf = (classKey) => cat.bodyTypes.filter((b) => b.classId === cls[classKey].id).map((b) => b.id);
const tractorBody = cat.bodyTypes.find((b) => b.key === 'tractor');
r = await call(OA, 'GET', '/business/catalog');
check('A branch with no list of vehicles washes every kind', r.body?.branches?.find((b) => b.id === A)?.vehicles?.length === cat.bodyTypes.length, show(r));
r = await call(OA, 'PUT', `/business/branches/${A}/vehicles`, { bodyTypeIds: [] });
check('A branch washes at least one kind of vehicle', r.status === 400, show(r));
r = await call(OB, 'PUT', `/business/branches/${A}/vehicles`, { bodyTypeIds: kindsOf('car') });
check('Only HQ sets the vehicles a branch washes', r.status === 403, show(r));
r = await call(OA, 'PUT', `/business/branches/${A}/vehicles`, { bodyTypeIds: [...kindsOf('car'), ...kindsOf('twoWheeler')] });
vts = (await call(OA, 'GET', '/services/vehicle-types')).body ?? [];
check('HQ takes tractors off the branch: its Tractor type goes away', r.status === 200 && !vts.some((v) => v.name === 'Tractor'), vts.map((v) => v.name).join(', '));
r = await call(OA, 'GET', '/services/vehicle-sizes');
check('…and its size guide says it doesn’t wash them', r.body?.bodyTypes?.find((b) => b.key === 'tractor')?.active === false && r.body?.bodyTypes?.find((b) => b.key === 'hatch')?.active === true, show(r));
r = await call(OA, 'GET', '/business/catalog');
check('The branch’s page shows what it washes', r.body?.branches?.find((b) => b.id === A)?.vehicles?.length === kindsOf('car').length + kindsOf('twoWheeler').length);
r = await call(OA, 'PUT', `/business/branches/${A}/vehicles`, { bodyTypeIds: [...kindsOf('car'), ...kindsOf('twoWheeler'), tractorBody.id] });
vts = (await call(OA, 'GET', '/services/vehicle-types')).body ?? [];
check('Putting tractors back brings its Tractor type back', r.status === 200 && vts.some((v) => v.name === 'Tractor'), vts.map((v) => v.name).join(', '));
r = await call(OB, 'GET', '/services/vehicle-types');
check('…and the other branch, washing every kind, is unaffected', (r.body ?? []).some((v) => v.name === 'Tractor'));
r = await call(OA, 'PATCH', `/business/body-types/${tractorBody.id}`, { active: false });
check('There’s no switch for the whole business any more', r.status === 200 && (await call(OA, 'GET', '/business/catalog')).body?.bodyTypes?.find((b) => b.id === tractorBody.id)?.active === true, show(r));

// The owner's Vehicles and HQ's page for the branch are one list.
const hatchBody = cat.bodyTypes.find((b) => b.key === 'hatch');
const hqListOf = async (id) => (await call(OA, 'GET', '/business/catalog')).body?.branches?.find((b) => b.id === id)?.vehicles ?? [];
r = await call(OB, 'GET', '/branch/vehicles');
const bOn = r.body?.vehicles ?? [];
check('The owner sees the kinds the branch washes, as HQ does', r.status === 200 && bOn.length > 0 && bOn.length === (await hqListOf(B)).length, show(r));
r = await call(OB, 'PUT', '/branch/vehicles', { bodyTypeIds: bOn.filter((id) => id !== hatchBody.id) });
vts = (await call(OB, 'GET', '/services/vehicle-types')).body ?? [];
check('The owner switches hatchbacks off: gone from New Wash…', r.status === 200 && !vts.some((v) => v.name === 'Hatchback'), vts.map((v) => v.name).join(', '));
check('…and off on HQ’s page for the branch', !(await hqListOf(B)).includes(hatchBody.id));
r = await call(OA, 'PUT', `/business/branches/${B}/vehicles`, { bodyTypeIds: [...(await hqListOf(B)), hatchBody.id] });
vts = (await call(OB, 'GET', '/services/vehicle-types')).body ?? [];
check('HQ switches them back on: back in New Wash…', r.status === 200 && vts.some((v) => v.name === 'Hatchback'), vts.map((v) => v.name).join(', '));
check('…and on in the owner’s Vehicles', ((await call(OB, 'GET', '/branch/vehicles')).body?.vehicles ?? []).includes(hatchBody.id));
r = await call(SA, 'PUT', '/branch/vehicles', { bodyTypeIds: bOn });
check('Staff can’t change the vehicles', r.status === 403, show(r));
r = await call(OB, 'PUT', '/branch/vehicles', { bodyTypeIds: [] });
check('The owner can’t switch every kind off', r.status === 400, show(r));
const bikeKinds = kindsOf('twoWheeler');
r = await call(OB, 'PUT', '/branch/vehicles', { bodyTypeIds: bOn.filter((id) => !bikeKinds.includes(id)) });
let pts = (await call(OB, 'GET', '/branch/points')).body;
check(
  'Two-wheelers switched off: the hub and teams stop taking them',
  r.status === 200 && pts?.points?.length > 0 && pts.points.every((p) => !p.classIds.includes(cls.twoWheeler.id)) && !pts.washedClassIds.includes(cls.twoWheeler.id),
  JSON.stringify(pts?.points?.map((p) => p.classIds)),
);
r = await call(OB, 'PATCH', `/branch/points/${pts.points[0].id}`, { classIds: [cls.car.id, cls.twoWheeler.id] });
check('…and a place can’t take a group the branch doesn’t wash', r.status === 400 && r.body?.error === 'not_washed', show(r));
await call(OB, 'PUT', '/branch/vehicles', { bodyTypeIds: bOn });
pts = (await call(OB, 'GET', '/branch/points')).body;
check('Switched back on: a place takes them again', pts?.points?.some((p) => p.classIds.includes(cls.twoWheeler.id)), JSON.stringify(pts?.points?.map((p) => p.classIds)));

// ─── Companies and models (the vehicle size guide) ───────────────────────────

r = await call(SA, 'GET', '/services/vehicle-sizes');
check('Staff see the size guide but can’t edit it', r.status === 200 && r.body?.canEdit === false && Array.isArray(r.body?.models), show(r));
r = await call(OA, 'GET', '/services/vehicle-sizes');
check('HQ can edit it', r.body?.canEdit === true, show(r));
const guideModels = async () => (await call(OA, 'GET', '/services/vehicle-sizes')).body?.models ?? [];
const modelIn = (list, make, model) => list.find((m) => m.make.toLowerCase() === make.toLowerCase() && m.model.toLowerCase() === model.toLowerCase());
r = await call(SA, 'PUT', '/business/vehicle-models', { make: 'Maruti Suzuki', model: 'Kovur K1', category: 'car', bodyKey: 'suvMini' });
check('Staff can’t change the list of models', r.status === 403, show(r));
r = await call(OB, 'PUT', '/business/vehicle-models', { make: 'Maruti Suzuki', model: 'Kovur K1', category: 'car', bodyKey: 'suvMini' });
check('…nor a branch owner who isn’t HQ', r.status === 403, show(r));
r = await call(OA, 'PUT', '/business/vehicle-models', { make: 'Maruti Suzuki', model: 'Kovur K1', category: 'car', bodyKey: 'suvMini' });
check('HQ adds a new launch as a Compact SUV', r.status === 200 && modelIn(await guideModels(), 'Maruti Suzuki', 'Kovur K1')?.bodyKey === 'suvMini', show(r));
r = await call(OA, 'PUT', '/business/vehicle-models', { make: 'maruti suzuki', model: 'KOVUR K1', category: 'car', bodyKey: 'sedan' });
check('…and can’t add it twice (whatever the case)', r.status === 400, show(r));
r = await call(OA, 'PUT', '/business/vehicle-models', { make: 'Maruti Suzuki', model: 'Kovur K1', category: 'car', bodyKey: 'scooter' });
check('A car can’t be filed as a scooter', r.status === 400, show(r));
r = await call(OA, 'PUT', '/business/vehicle-models', { make: 'Maruti Suzuki', model: 'Swift', category: 'car', bodyKey: 'sedan', from: { make: 'Maruti Suzuki', model: 'Swift' } });
check('HQ moves a listed model to another kind (Swift → Sedan)', r.status === 200 && modelIn(await guideModels(), 'Maruti Suzuki', 'Swift')?.bodyKey === 'sedan', show(r));
r = await call(OA, 'PUT', '/business/vehicle-models', { make: 'Maruti Suzuki', model: 'Swift', category: 'car', bodyKey: 'hatch', from: { make: 'Maruti Suzuki', model: 'Swift' } });
check('…and moving it back to how it ships leaves no change', r.status === 200 && !modelIn(await guideModels(), 'Maruti Suzuki', 'Swift'), show(r));
r = await call(OA, 'PUT', '/business/vehicle-models', { make: 'Maruti Suzuki', model: 'Kovur K2', category: 'car', bodyKey: 'suvMini', from: { make: 'Maruti Suzuki', model: 'Kovur K1' } });
let models = await guideModels();
check('HQ renames an added model', r.status === 200 && !modelIn(models, 'Maruti Suzuki', 'Kovur K1') && modelIn(models, 'Maruti Suzuki', 'Kovur K2')?.bodyKey === 'suvMini', JSON.stringify(models));
r = await call(OA, 'DELETE', '/business/vehicle-models', { make: 'Maruti Suzuki', model: 'Alto 800', category: 'car' });
r = await call(OA, 'GET', '/services/vehicle-sizes');
check('HQ takes a listed model off the list (and can see it to put back)', modelIn(r.body?.models ?? [], 'Maruti Suzuki', 'Alto 800')?.bodyKey === null && r.body?.removed?.some((m) => m.model === 'Alto 800'), show(r));
r = await call(OA, 'POST', '/business/vehicle-models/reset', { make: 'Maruti Suzuki', model: 'Alto 800' });
check('…and puts it back', r.status === 200 && !modelIn(await guideModels(), 'Maruti Suzuki', 'Alto 800'), show(r));
r = await call(OA, 'POST', '/business/vehicle-models/reset', { make: 'Maruti Suzuki', model: 'Kovur K2' });
check('Only a model from the original list can be put back', r.status === 400, show(r));
d1Run(`UPDATE shops SET in_customer_app = 1 WHERE id = '${A}';`);
r = await call(null, 'GET', '/c/branches');
check('The customer app gets the changes for “add your vehicle”', modelIn(r.body?.vehicleModels ?? [], 'Maruti Suzuki', 'Kovur K2')?.bodyKey === 'suvMini', JSON.stringify(r.body?.vehicleModels));
d1Run(`UPDATE shops SET in_customer_app = 0 WHERE id = '${A}';`);
r = await call(OA, 'DELETE', '/business/vehicle-models', { make: 'Maruti Suzuki', model: 'Kovur K2', category: 'car' });
check('Taking an added model off deletes it', r.status === 200 && !modelIn(await guideModels(), 'Maruti Suzuki', 'Kovur K2'), show(r));

r = await call(OA, 'GET', '/services/network');
check('With washing at homes off, the doorstep team only goes to communities: New Wash is at the shop', r.status === 200 && r.body?.homeWash === false && r.body?.modes?.join() === 'hub', show(r));
r = await call(OA, 'GET', '/branch/points');
check('…and the branch’s setup knows it', r.body?.homeWash === false, show(r));
r = await call(OA, 'PUT', '/branch/types', { hub: true, community: true, doorstep: true });
check('The owner switches washing at homes on for the branch', r.status === 200 && r.body?.services?.live?.doorstep === true, show(r));
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
const communityRow = prices.find((p) => p.serviceId === fullA && p.vehicleTypeId === vtA.Hatchback.id && p.mode === 'doorstep');
check('Its community price follows the branch’s shop price by the rule', !communityRow || (communityRow.source === 'override' && communityRow.price !== communityRow.listPrice), JSON.stringify(communityRow));
r = await call(OA, 'PUT', '/services/prices', { serviceId: fullA, vehicleTypeId: vtA.Hatchback.id, mode: 'doorstep', price: 30000 });
check('…so a community price can’t be typed on its own', r.status === 400, show(r));

r = await call(OA, 'GET', '/services/branch-prices');
const carS = r.body?.services?.find((s) => s.id === fullA)?.cells?.find((c) => c.classKey === 'car' && c.sizeKey === 'S');
check('The owner’s price sheet: by group and size, from the branch’s price book', r.status === 200 && !!r.body?.bookName && carS?.hub?.price === 44000 && carS?.hub?.own === true && r.body?.groups?.some((g) => g.key === 'car'), JSON.stringify(carS));
r = await call(OA, 'PUT', '/services/branch-prices/size', { serviceId: fullA, classKey: 'car', sizeKey: 'S', price: 43000, commission: 2000 });
prices = (await call(OA, 'GET', '/services/prices')).body ?? [];
const rates = (await call(OA, 'GET', '/services/commissions')).body ?? [];
check('One price for a size sets every vehicle of it, with its commission', r.status === 200 && r.body?.vehicles >= 1 && priceOf(prices, fullA, vtA.Hatchback.id)?.price === 43000 && rates.some((x) => x.serviceId === fullA && x.vehicleTypeId === vtA.Hatchback.id && x.amount === 2000), show(r));
r = await call(OA, 'PUT', '/services/branch-prices/size', { serviceId: fullA, classKey: 'car', sizeKey: 'S', price: 1000 });
check('…but not outside what HQ allows', r.status === 400, show(r));
r = await call(OA, 'PUT', '/services/branch-prices/shift', { classKey: 'car', percent: 30 });
check('Moving every price by more than HQ allows is refused', r.status === 400, show(r));
r = await call(OA, 'PUT', '/services/branch-prices/shift', { classKey: 'car', percent: 10 });
prices = (await call(OA, 'GET', '/services/prices')).body ?? [];
const hatch = priceOf(prices, fullA, vtA.Hatchback.id);
check('Every car price moves 10% up from HQ’s price, rounded to ₹1', r.status === 200 && r.body?.prices > 0 && hatch?.price === Math.round((hatch?.listPrice * 1.1) / 100) * 100 && hatch?.source === 'override', `${show(r)} ${JSON.stringify(hatch)}`);
r = await call(OA, 'PUT', '/services/branch-prices/shift', { classKey: 'car', percent: null });
prices = (await call(OA, 'GET', '/services/prices')).body ?? [];
check('…and all back to HQ’s prices', r.status === 200 && prices.filter((p) => p.mode === 'hub' && p.vehicleTypeId === vtA.Hatchback.id).every((p) => p.source !== 'override'), show(r));
r = await call(OA, 'PUT', '/services/prices', { serviceId: fullA, vehicleTypeId: vtA.Hatchback.id, mode: 'hub', price: 44000 });

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

// ─── What a branch changes shows on HQ's page for it ─────────────────────────

const hqBranch = async (id) => (await call(OA, 'GET', '/business/catalog')).body?.branches?.find((b) => b.id === id);
await call(OA, 'DELETE', `/services/${underA}`);
check('A branch stops selling a service: HQ’s page for it says so', (await hqBranch(A))?.stopped?.includes(UNDER));
await call(OA, 'PUT', `/services/${underA}/hidden`, { hidden: false });
check('…and stops saying so once it’s back', !(await hqBranch(A))?.stopped?.includes(UNDER));
const ownBefore = (await hqBranch(A))?.ownPrices ?? 0;
r = await call(OA, 'PUT', '/services/branch-prices/size', { serviceId: fullA, classKey: 'car', sizeKey: 'M', price: 52000 });
const ownAfter = (await hqBranch(A))?.ownPrices ?? 0;
check('A branch sets its own price: HQ’s page counts it', r.status === 200 && ownAfter > ownBefore, `${ownBefore} → ${ownAfter} ${show(r)}`);
await call(OA, 'PUT', '/services/branch-prices/size', { serviceId: fullA, classKey: 'car', sizeKey: 'M', price: null });
check('…and not once it’s back to HQ’s price', ((await hqBranch(A))?.ownPrices ?? 0) === ownBefore);
const nameB = (await hqBranch(B))?.name;
r = await call(OB, 'PUT', '/shop/info', { name: 'Kovur Main Road', city: 'Kovur' });
check('A branch renames itself: HQ’s list shows the new name', r.status === 200 && (await hqBranch(B))?.name === 'Kovur Main Road', show(r));
await call(OB, 'PUT', '/shop/info', { name: nameB, city: null });

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
check('A branch in a +10% zone charges ₹462 for ₹420', r.status === 200 && priceOf(pricesB, svcB['Full Wash']?.id, vtB.Hatchback?.id)?.price === 46200, JSON.stringify(priceOf(pricesB, svcB['Full Wash']?.id, vtB.Hatchback?.id)));
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

// The owner picks a price book, when HQ allows it.
r = await call(OB, 'GET', '/services/branch-prices');
check('The owner sees HQ’s price books and which one the branch uses', r.body?.books?.length >= 2 && r.body?.bookId === book && r.body?.policy?.branchPicksBook === false, show(r));
r = await call(OB, 'PUT', '/services/branch-prices/book', { priceBookId: PREMIUM });
check('…but can’t switch while HQ picks the book', r.status === 400, show(r));
await call(OA, 'PATCH', '/business/policy', { branchPicksBook: true });
await call(OB, 'PUT', '/services/branch-prices/size', { serviceId: svcB['Full Wash']?.id, classKey: 'car', sizeKey: 'S', price: 44000 });
check('An own price shows on HQ’s list for the branch', ((await hqBranch(B))?.ownPrices ?? 0) > 0);
r = await call(OB, 'PUT', '/services/branch-prices/book', { priceBookId: PREMIUM });
pricesB = (await call(OB, 'GET', '/services/prices')).body ?? [];
const onPremium = priceOf(pricesB, svcB['Full Wash']?.id, vtB.Hatchback?.id);
check('Allowed: the owner moves to Premium, its prices apply…', r.status === 200 && r.body?.cleared > 0 && onPremium?.price === 55000 && onPremium?.source === 'template', `${show(r)} ${JSON.stringify(onPremium)}`);
const hqB = await hqBranch(B);
check('…their own prices are cleared, and HQ sees Premium', hqB?.priceBookId === PREMIUM && hqB?.ownPrices === 0, JSON.stringify({ book: hqB?.priceBookId, own: hqB?.ownPrices }));
r = await call(OB, 'PUT', '/services/branch-prices/book', { priceBookId: 'pb_nope' });
check('An unknown book is refused', r.status === 404, show(r));
await call(OB, 'PUT', '/services/branch-prices/book', { priceBookId: book });
await call(OA, 'PATCH', '/business/policy', { branchPicksBook: false });

// ─── Washes: hub and doorstep ────────────────────────────────────────────────

const start = (extra) =>
  call(OA, 'POST', '/jobs/start', {
    id: `job_cc_${run}_${rand(6)}`,
    customer: { phone: `98${rand(8)}`, name: 'Door Customer' },
    registrationNumber: `AP${rand(2)}CC${rand(4)}`,
    vehicleTypeId: vtA.Hatchback.id,
    services: [{ serviceId: fullA, quantity: 1 }],
    // The phone at the home (here: next to the branch, inside the free distance).
    visitPoint: { latitude: 15.5, longitude: 80.05 },
    ...extra,
  });
r = await start({ mode: 'doorstep' });
check('A doorstep wash is the hub price plus the visit charge (₹420 + ₹49)', r.status === 201 && r.body?.total === 46900 && r.body?.deliveryMode === 'doorstep', show(r));
check('…with the visit charge on its own line', r.body?.jobServices?.some((l) => l.service?.name === 'Visit charge' && l.priceAtTime === 4900), JSON.stringify(r.body?.jobServices));
r = await start({});
check('A wash with no mode is a hub wash at the hub price', r.status === 201 && r.body?.total === 42000 && r.body?.deliveryMode === 'hub', show(r));
r = await start({ mode: 'doorstep', services: [{ serviceId: underA, quantity: 1 }] });
check('A hub-only service can’t be done at the door', r.status === 400 && r.body?.error === 'not_at_homes', show(r));
r = await start({ vehicleTypeId: tractor?.id });
check('A tractor can be washed at the shop too, since the branch washes tractors', r.status === 201, show(r));
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
await call(OA, 'PUT', '/branch/types', { hub: true, community: true, doorstep: false });
r = await call(null, 'GET', '/c/branches');
check('With washing at homes off, the app offers no wash at home', (r.body?.branches ?? []).find((b) => b.id === A)?.modes?.join() === 'hub', show(r));
await call(OA, 'PUT', '/branch/types', { hub: true, community: true, doorstep: true });
r = await call(null, 'GET', '/c/branches');
const listed = (r.body?.branches ?? []).find((b) => b.id === A);
const fullListed = listed?.services?.find((s) => s.name === 'Full Wash');
const hatchListed = listed?.vehicleTypes?.find((v) => v.name === 'Hatchback');
check('The customer app lists how the branch washes', listed?.modes?.join() === 'hub,doorstep', show(r));
check('…with hub prices, the same at the door', fullListed?.prices?.some((p) => p.vehicleTypeId === hatchListed?.id && p.price === 42000) && fullListed?.doorstepPrices?.some((p) => p.vehicleTypeId === hatchListed?.id && p.price === 42000), JSON.stringify(fullListed));
check('…plus the visit charge rules for a wash at home', listed?.visit?.visitFeePaise === 4900 && listed?.visit?.maxKm === 15, JSON.stringify(listed?.visit));
check('…and a tractor is on the shop’s list and at the door', fullListed?.prices?.some((p) => p.vehicleTypeId === tractor?.id) && fullListed?.doorstepPrices?.some((p) => p.vehicleTypeId === tractor?.id), JSON.stringify(fullListed));
check('…and each vehicle type’s body type for its picture', hatchListed?.bodyKey === 'hatch', JSON.stringify(hatchListed));
r = await call(null, 'POST', '/c/service-area/check', { location: { latitude: 15.7, longitude: 80.06 } });
check('A place only the doorstep team reaches is served', r.status === 200 && r.body?.served === true && r.body?.branch?.name === 'Catalog Hub', show(r));
d1Run(`UPDATE shops SET in_customer_app = 0 WHERE id = '${A}';`);

// ─── Switching a point off ───────────────────────────────────────────────────

const hubId = (await call(OA, 'GET', '/branch/points')).body?.points?.find((p) => p.kind === 'hub')?.id;
r = await call(OA, 'PATCH', `/branch/points/${hubId}`, { active: false });
prices = (await call(OA, 'GET', '/services/prices')).body ?? [];
check('Closing the hub keeps hub prices for home washes', r.status === 200 && prices.some((p) => p.mode === 'hub' && p.serviceId === fullA) && prices.some((p) => p.mode === 'doorstep'), show(r));
check('…but not for a service done at the shop only', !prices.some((p) => p.serviceId === underA), JSON.stringify(prices.filter((p) => p.serviceId === underA)));
r = await call(OA, 'GET', '/services/network');
check('…and New Wash is at homes only', r.body?.modes?.join() === 'doorstep', show(r));
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

// One distance for the branch: Branch details sets how far its hub and team go.
r = await call(OA, 'PUT', '/service-area', { latitude: 15.7, longitude: 80.05, radiusKm: 12 });
const ptsA = (await call(OA, 'GET', '/branch/points')).body?.points ?? [];
check(
  'Setting how far the branch serves sets its team’s reach too',
  r.status === 200 && ptsA.filter((p) => p.latitude != null).every((p) => p.radiusKm === 12) && ptsA.some((p) => p.kind === 'doorstep'),
  JSON.stringify(ptsA.map((p) => [p.kind, p.radiusKm])),
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
