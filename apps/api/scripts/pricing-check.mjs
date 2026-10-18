// Pricing away from the shop, end to end: the community rule (hub price less a %), community
// volume discounts, and home washes (the hub price plus one visit charge per visit: a visit
// fee, a charge per km beyond the free distance, the furthest the team goes, ending in 9 and
// busy-time extras). Run against the local API:
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:pricing                       (in another)
import { API, apiFetch, d1Rows, d1Run, signIn as signInWith } from './lib/target.mjs';

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

const BIZ = `biz_pc_${run}`;
const A = `shop_pca_${run}`;
const B = `shop_pcb_${run}`;
const phoneA = `95${rand(8)}`;
const phoneB = `95${rand(8)}`;
const OWNER_A = `user_pca_${run}`;
const LAT = 15.5;
const LNG = 80.05;

d1Run(
  `INSERT INTO businesses (id, name) VALUES ('${BIZ}', 'Pricing Check Co');` +
    `INSERT INTO shops (id, code, name, business_id, latitude, longitude) VALUES ('${A}', '${rand(6)}', 'Pricing Hub', '${BIZ}', ${LAT}, ${LNG});` +
    `INSERT INTO shops (id, code, name, business_id) VALUES ('${B}', '${rand(6)}', 'Pricing Town', '${BIZ}');` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('${OWNER_A}', '${A}', 'Hub Owner', '${phoneA}', 'owner');` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('user_pcb_${run}', '${B}', 'Town Owner', '${phoneB}', 'owner');` +
    `INSERT INTO business_admins (business_id, phone) VALUES ('${BIZ}', '${phoneA}');`,
);

const OA = (await signInWith(phoneA, PIN)).body?.token;
const OB = (await signInWith(phoneB, PIN)).body?.token;
check('HQ owner and another branch’s owner sign in', !!OA && !!OB);
if (!OA || !OB) process.exit(1);

// ─── Setup: services, base prices, a branch with a doorstep team ─────────────

let r = await call(OA, 'GET', '/business/catalog');
const cat = r.body;
const cls = Object.fromEntries(cat.classes.map((c) => [c.key, c]));
const size = (classKey, key) => cls[classKey].sizes.find((s) => s.key === key).id;
const book = cat.priceBooks.find((b) => b.isDefault).id;
check(
  'HQ starts with the visit charge we decided: ₹49 visit, 3 km free, ₹10/km, up to 15 km, ending in 9',
  cat.away?.doorstep?.visitFeePaise === 4900 &&
    cat.away.doorstep.freeKm === 3 &&
    cat.away.doorstep.perKmPaise === 1000 &&
    cat.away.doorstep.maxKm === 15 &&
    cat.away.doorstep.roundTo9 === true &&
    cat.away.doorstep.busy.length === 0,
  JSON.stringify(cat.away),
);
check('…and no volume discount', Array.isArray(cat.away?.communityTiers) && cat.away.communityTiers.length === 0);

const make = async (name, places) => (await call(OA, 'POST', '/business/services', { name, classIds: [cls.car.id], places })).body?.id;
const BASIC = await make('Basic Wash', { shop: true, community: true, doorstep: true });
const POLISH = await make('Shop Polish', { shop: true, community: false, doorstep: false });
const DETAIL = await make('Home Detail', { shop: false, community: false, doorstep: true });
const DAYWASH = await make('Day Wash', { shop: false, community: true, doorstep: false });
check('HQ adds services done everywhere, at the shop only, at homes only and at communities only', !!BASIC && !!POLISH && !!DETAIL && !!DAYWASH);
r = await call(OA, 'PUT', '/business/prices', {
  priceBookId: book,
  entries: [
    { serviceId: BASIC, sizeId: size('car', 'S'), price: 49900 },
    { serviceId: BASIC, sizeId: size('car', 'M'), price: 59900 },
    { serviceId: POLISH, sizeId: size('car', 'S'), price: 79900 },
    { serviceId: DETAIL, sizeId: size('car', 'S'), price: 99900 },
    { serviceId: DAYWASH, sizeId: size('car', 'S'), price: 29900 },
  ],
});
check('…with hub prices', r.status === 200, show(r));
r = await call(OA, 'PUT', '/business/prices', { priceBookId: book, entries: [{ serviceId: BASIC, sizeId: size('car', 'M'), price: 59900, doorstepPrice: 53900 }] });
check('A size can’t be given its own community price: communities follow the rule', r.status === 400, show(r));
check('Prices round to the rupee, so ₹499 stays ₹499', cat.policy?.roundToPaise === 100, JSON.stringify(cat.policy));
r = await call(OA, 'PUT', '/business/adjustments', { mode: 'hub', classId: null, percentBp: 500, fixedPaise: 0, minExtraPaise: 0 });
check('There’s no extra on shop prices: they are the hub prices', r.status === 400, show(r));
const liveIds = [BASIC, POLISH, DETAIL, DAYWASH];
r = await call(OA, 'PUT', `/business/branches/${A}/menu`, { serviceIds: liveIds });
check('HQ switches them on at the branch', r.status === 200, show(r));
r = await call(OA, 'POST', '/branch/points', { kind: 'doorstep', name: 'Van 1', latitude: LAT, longitude: LNG, radiusKm: 15, classIds: [cls.car.id] });
check('The branch adds a doorstep team for cars', r.status === 201, show(r));
r = await call(OA, 'PUT', '/branch/types', { hub: true, community: true, doorstep: true });
check('…and washes at communities and homes', r.status === 200, show(r));

const svc = Object.fromEntries(((await call(OA, 'GET', '/services')).body ?? []).map((s) => [s.name, s]));
const vt = Object.fromEntries(((await call(OA, 'GET', '/services/vehicle-types')).body ?? []).map((v) => [v.name, v]));
const hatch = vt.Hatchback?.id;
const sedan = vt.Sedan?.id;
const priceOf = (rows, serviceId, vehicleTypeId, mode) =>
  rows.find((p) => p.serviceId === serviceId && p.vehicleTypeId === vehicleTypeId && p.mode === mode)?.price;
let prices = (await call(OA, 'GET', '/services/prices')).body ?? [];

// ─── Community prices ────────────────────────────────────────────────────────

check('With no community rule, a community pays the hub price', priceOf(prices, svc['Basic Wash']?.id, hatch, 'doorstep') === 49900);
r = await call(OA, 'PUT', '/business/adjustments', { mode: 'doorstep', classId: null, percentBp: -1000, fixedPaise: 0, minExtraPaise: 0 });
check('HQ sets the community rule: 10% less than the hub', r.status === 200, show(r));
prices = (await call(OA, 'GET', '/services/prices')).body ?? [];
check('…so a ₹499 hub wash is ₹449 at a community (₹449.10 rounded)', priceOf(prices, svc['Basic Wash']?.id, hatch, 'doorstep') === 44900, JSON.stringify(prices.filter((p) => p.serviceId === svc['Basic Wash']?.id)));
check('…and ₹599 is ₹539 (₹539.10 rounded)', priceOf(prices, svc['Basic Wash']?.id, sedan, 'doorstep') === 53900);
check('A shop-only service has no community price', priceOf(prices, svc['Shop Polish']?.id, hatch, 'doorstep') == null);
check('A home-only service has a hub price, which home washes are charged', priceOf(prices, svc['Home Detail']?.id, hatch, 'hub') === 99900);

// ─── Visit-charge rules ──────────────────────────────────────────────────────

const rules = { visitFeePaise: 4900, freeKm: 3, perKmPaise: 1000, maxKm: 15, roundTo9: true, busy: [] };
r = await call(OA, 'PUT', '/business/doorstep-rules', { ...rules, maxKm: 2 });
check('The furthest distance can’t be less than the free distance', r.status === 400 && r.body?.error === 'invalid_rules', show(r));
r = await call(OA, 'PUT', '/business/doorstep-rules', { ...rules, busy: [{ days: [0], from: '11:00', to: '07:00', extraPaise: 3000 }] });
check('A busy time has to end after it starts', r.status === 400, show(r));
r = await call(OA, 'PUT', '/business/doorstep-rules', { ...rules, visitFeePaise: -100 });
check('A negative visit fee is refused', r.status === 400, show(r));
r = await call(OB, 'PUT', '/business/doorstep-rules', rules);
check('Only HQ changes the visit charge', r.status === 403, show(r));
r = await call(OA, 'PUT', '/business/doorstep-rules', rules);
check('HQ saves the visit charge', r.status === 200 && r.body?.rules?.maxKm === 15, show(r));

r = await call(OA, 'GET', '/services/network');
check('The branch gets the visit charge and its map pin, for New Wash', r.body?.visit?.visitFeePaise === 4900 && r.body?.location?.latitude === LAT, show(r));

// ─── Home washes ─────────────────────────────────────────────────────────────

const start = (extra = {}) =>
  call(OA, 'POST', '/jobs/start', {
    id: `job_pc_${run}_${rand(6)}`,
    customer: { phone: `98${rand(8)}`, name: 'Home Customer' },
    registrationNumber: `AP${rand(2)}PC${rand(4)}`,
    vehicleTypeId: hatch,
    services: [{ serviceId: svc['Basic Wash']?.id, quantity: 1 }],
    ...extra,
  });
const visitLine = (job) => job?.jobServices?.find((l) => l.service?.name === 'Visit charge');
// A home this many km from the branch in a straight line, due north (roads ≈ 1.3 × that).
const away = (km) => ({ latitude: LAT + km / 111.195, longitude: LNG });

r = await start({ mode: 'doorstep', visitPoint: away(6) });
const firstHome = r.body;
check('A home 6 km away (7.8 km by road): hub price ₹499 + visit ₹49 + 5 km × ₹10 = ₹598', r.status === 201 && r.body?.total === 59800 && r.body?.subtotal === 59800, show(r));
check('…the visit charge is its own line on the bill (₹99)', visitLine(firstHome)?.priceAtTime === 9900, JSON.stringify(firstHome?.jobServices));
const stored = d1Rows(
  `SELECT j.visit_km, j.visit_latitude, c.home_latitude FROM jobs j JOIN customers c ON c.id = j.customer_id WHERE j.id = '${firstHome?.id}'`,
)[0];
check('…the distance and the home are kept on the wash, measured by the server', stored?.visit_km === 7.8 && Math.abs(stored?.visit_latitude - away(6).latitude) < 1e-9, JSON.stringify(stored));
check('…and the home is saved on the customer for next time', Math.abs(stored?.home_latitude - away(6).latitude) < 1e-9, JSON.stringify(stored));

const phone = `98${rand(8)}`;
r = await start({ mode: 'doorstep', visitPoint: away(2), customer: { phone, name: 'Two Cars' } });
check('A home within 3 km by road pays just the visit fee (₹499 + ₹49)', r.status === 201 && r.body?.total === 54800, show(r));
r = await start({ mode: 'doorstep', visitPoint: away(2), customer: { phone, name: 'Two Cars' } });
check('Their second car the same day is the same visit: no second visit charge', r.status === 201 && r.body?.total === 49900 && !visitLine(r.body), show(r));

r = await start({ mode: 'doorstep', visitPoint: away(20) });
check('A home 26 km away by road is further than the team goes', r.status === 400 && r.body?.error === 'too_far', show(r));
r = await start({ mode: 'doorstep', visitKm: 1 });
check('A typed distance counts for nothing: a new customer needs the phone’s location', r.status === 400 && r.body?.error === 'location_needed', show(r));
r = await start({ mode: 'doorstep', customer: { phone, name: 'Two Cars' } });
check('A known customer without the phone’s location is measured from their saved home (same visit: no charge)', r.status === 201 && r.body?.total === 49900, show(r));
r = await start({ mode: 'doorstep', visitPoint: away(6), discount: 50000, discountReason: 'Too much' });
check('A discount can’t take off more than the services (the visit charge isn’t discounted)', r.status === 400 && r.body?.error === 'invalid_discount', show(r));
r = await start({ mode: 'doorstep', visitPoint: away(6), discount: 4900, discountReason: 'Regular' });
check('…a smaller one comes off the services, the visit charge stays', r.status === 201 && r.body?.total === 59800 - 4900, show(r));

r = await start({ mode: 'doorstep', visitPoint: away(0.5), services: [{ serviceId: svc['Home Detail']?.id, quantity: 1 }] });
check('A home-only service at a home: ₹999 + ₹49', r.status === 201 && r.body?.total === 104800, show(r));
r = await start({ services: [{ serviceId: svc['Home Detail']?.id, quantity: 1 }] });
check('…isn’t sold at the shop', r.status === 400 && r.body?.error === 'not_at_shop', show(r));
r = await start({ mode: 'doorstep', services: [{ serviceId: svc['Shop Polish']?.id, quantity: 1 }] });
check('A shop-only service isn’t sold at homes', r.status === 400 && r.body?.error === 'not_at_homes', show(r));
r = await start({ mode: 'doorstep', services: [{ serviceId: svc['Day Wash']?.id, quantity: 1 }] });
check('…nor one done only at communities', r.status === 400 && r.body?.error === 'not_at_homes', show(r));
r = await start({});
check('A wash at the shop has no visit charge', r.status === 201 && r.body?.total === 49900 && !visitLine(r.body), show(r));

const allDay = [{ days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59', extraPaise: 3000 }];
r = await call(OA, 'PUT', '/business/doorstep-rules', { ...rules, busy: allDay });
check('HQ adds a busy-time extra (+₹30)', r.status === 200 && r.body?.rules?.busy?.length === 1, show(r));
r = await start({ mode: 'doorstep', visitPoint: away(2) });
check('…a visit then costs ₹49 + ₹30 = ₹79', r.status === 201 && visitLine(r.body)?.priceAtTime === 7900, show(r));
r = await call(OA, 'PUT', '/business/doorstep-rules', { ...rules, visitFeePaise: 5000, roundTo9: false });
r = await start({ mode: 'doorstep', visitPoint: away(3.4582) });
check('Without “ends in 9”: 4.5 km by road → ₹50 + 2 started km × ₹10 = ₹70 exactly', r.status === 201 && visitLine(r.body)?.priceAtTime === 7000, show(r));
await call(OA, 'PUT', '/business/doorstep-rules', rules);

// ─── Community volume discount ───────────────────────────────────────────────

r = await call(OA, 'PUT', '/business/community-tiers', { tiers: [{ minCars: 5, discountBp: 1000 }, { minCars: 10, discountBp: 500 }] });
check('More cars must get a bigger discount', r.status === 400 && r.body?.error === 'invalid_tiers', show(r));
r = await call(OA, 'PUT', '/business/community-tiers', { tiers: [{ minCars: 50, discountBp: 1500 }] });
check('A volume discount stops at 10%, however many cars', r.status === 400, show(r));
r = await call(OA, 'PUT', '/business/community-tiers', { tiers: [{ minCars: 1, discountBp: 500 }] });
check('A step starts at 2 cars or more', r.status === 400, show(r));
r = await call(OB, 'PUT', '/business/community-tiers', { tiers: [] });
check('Only HQ sets the volume discount', r.status === 403, show(r));
r = await call(OA, 'PUT', '/business/community-tiers', { tiers: [{ minCars: 10, discountBp: 1000 }, { minCars: 5, discountBp: 500 }] });
check('HQ sets 5+ cars → 5% off and 10+ → 10% off (kept in order)', r.status === 200 && r.body?.tiers?.[0]?.minCars === 5, show(r));

r = await call(OA, 'POST', '/places', { type: 'colony', label: 'Pricing Colony gate', latitude: LAT + 0.01, longitude: LNG });
const PLACE = r.body?.id;
check('The branch adds a community', r.status === 201 && !!PLACE, show(r));
const basicIn = (menu) => menu?.services?.find((s) => s.name === 'Basic Wash')?.prices?.find((p) => p.vehicleTypeId === hatch)?.price;
const plain = (await call(OA, 'GET', '/places/menu')).body?.menu;
let menu = (await call(OA, 'GET', `/places/menu?placeId=${PLACE}`)).body?.menu;
check('A community with no cars yet has no volume discount', menu?.volume === null && basicIn(menu) === basicIn(plain), JSON.stringify(menu?.volume));

const addCars = (n) => {
  let sql = '';
  for (let i = 0; i < n; i++) {
    const id = `${run}_${rand(6)}_${i}`;
    sql +=
      `INSERT INTO customers (id, shop_id, phone, name) VALUES ('cu_${id}', '${A}', '97${rand(8)}', 'Member');` +
      `INSERT INTO place_members (id, shop_id, place_id, customer_id, unit_text, status, joined_via) VALUES ('pm_${id}', '${A}', '${PLACE}', 'cu_${id}', 'H${i}', 'active', 'staff');` +
      `INSERT INTO member_vehicles (id, shop_id, member_id, customer_id, vehicle_type_id) VALUES ('mv_${id}', '${A}', 'pm_${id}', 'cu_${id}', '${hatch}');`;
  }
  d1Run(sql);
};
addCars(6);
menu = (await call(OA, 'GET', `/places/menu?placeId=${PLACE}`)).body?.menu;
const less = (paise, bp) => Math.round((paise * (10000 - bp)) / 10000 / 100) * 100;
check('6 cars: 5% off every price there', menu?.volume?.cars === 6 && menu.volume.discountBp === 500 && basicIn(menu) === less(basicIn(plain), 500), `${JSON.stringify(menu?.volume)} ${basicIn(menu)} vs ${basicIn(plain)}`);
addCars(5);
menu = (await call(OA, 'GET', `/places/menu?placeId=${PLACE}`)).body?.menu;
check('11 cars: 10% off', menu?.volume?.cars === 11 && menu.volume.discountBp === 1000 && basicIn(menu) === less(basicIn(plain), 1000), JSON.stringify(menu?.volume));
const planIn = (m) => m?.plans?.[0]?.prices?.find((p) => p.vehicleTypeId === hatch)?.total;
if (planIn(plain) != null) check('…plans there are cheaper too', planIn(menu) < planIn(plain), `${planIn(menu)} vs ${planIn(plain)}`);
r = await call(OA, 'PUT', '/business/community-tiers', { tiers: [] });
menu = (await call(OA, 'GET', `/places/menu?placeId=${PLACE}`)).body?.menu;
check('Turning the volume discount off brings back the community price', r.status === 200 && menu?.volume === null && basicIn(menu) === basicIn(plain), JSON.stringify(menu?.volume));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
