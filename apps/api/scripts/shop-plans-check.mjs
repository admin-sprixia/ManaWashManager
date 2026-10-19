// Wash plans at the shop, end to end: where a plan is sold (communities, the shop or both), selling
// one at the counter (a paid bill that counts as money, not a wash), using it in New Wash (this
// vehicle only, this branch, one wash a day, until it ends), voids giving washes back, and a sale
// that can't be voided once a wash is used. Run against the local API:
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:shop-plans                    (in another)
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
const BIZ = `biz_sp_${run}`;
const A = `shop_spa_${run}`;
const B = `shop_spb_${run}`;
const phoneA = `95${rand(8)}`;
const phoneB = `95${rand(8)}`;

d1Run(
  `INSERT INTO businesses (id, name) VALUES ('${BIZ}', 'Shop Plans Co');` +
    `INSERT INTO shops (id, code, name, business_id, latitude, longitude) VALUES ('${A}', '${rand(6)}', 'Plan Hub', '${BIZ}', 15.5, 80.05);` +
    `INSERT INTO shops (id, code, name, business_id, latitude, longitude) VALUES ('${B}', '${rand(6)}', 'Plan Town', '${BIZ}', 15.6, 80.05);` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('user_spa_${run}', '${A}', 'Hub Owner', '${phoneA}', 'owner');` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('user_spb_${run}', '${B}', 'Town Owner', '${phoneB}', 'owner');` +
    `INSERT INTO business_admins (business_id, phone) VALUES ('${BIZ}', '${phoneA}');`,
);
const OA = (await signInWith(phoneA, PIN)).body?.token;
const OB = (await signInWith(phoneB, PIN)).body?.token;
check('HQ owner and another branch’s owner sign in', !!OA && !!OB);
if (!OA || !OB) process.exit(1);

let r = await call(OA, 'GET', '/business/catalog');
const cat = r.body;
const car = cat.classes.find((c) => c.key === 'car');
const S = car.sizes.find((z) => z.key === 'S').id;
const book = cat.priceBooks.find((b) => b.isDefault).id;
const make = async (name, places) => (await call(OA, 'POST', '/business/services', { name, classIds: [car.id], places })).body?.id;
const BASIC = await make('Basic Wash', { shop: true, community: true, doorstep: false });
const PREMIUM = await make('Premium Wash', { shop: true, community: true, doorstep: false });
const DAY = await make('Day Wash', { shop: false, community: true, doorstep: false });
await call(OA, 'PATCH', '/business/policy', { branchOverrides: true });
await call(OA, 'PUT', '/business/prices', {
  priceBookId: book,
  entries: [
    { serviceId: BASIC, sizeId: S, price: 49900 },
    { serviceId: PREMIUM, sizeId: S, price: 89900 },
    { serviceId: DAY, sizeId: S, price: 29900 },
  ],
});
for (const shop of [A, B]) await call(OA, 'PUT', `/business/branches/${shop}/menu`, { serviceIds: [BASIC, PREMIUM, DAY] });
// Branch A also washes at communities (its community list has prices).
await call(OA, 'POST', '/branch/points', { kind: 'doorstep', name: 'Team 1', latitude: 15.5, longitude: 80.05, radiusKm: 10, classIds: [car.id] });
await call(OA, 'PUT', '/branch/types', { hub: true, community: true, doorstep: false });

// ─── Where a plan is sold ────────────────────────────────────────────────────

r = await call(OA, 'POST', '/business/plans', { name: 'Day Pack', washes: 4, months: 1, catalogServiceId: DAY, soldAt: 'shop' });
check('A plan sold at the shop needs a wash done at the shop', r.status === 400, show(r));
r = await call(OA, 'POST', '/business/plans', { name: 'Shop Basic', washes: 4, months: 1, catalogServiceId: BASIC, discountBp: 1000, soldAt: 'shop' });
const SHOP_PLAN = r.body?.id;
check('HQ adds a plan sold at the shop', r.status === 201 && !!SHOP_PLAN, show(r));
r = await call(OA, 'POST', '/business/plans', { name: 'Everywhere Basic', washes: 8, months: 3, catalogServiceId: BASIC, soldAt: 'both' });
const BOTH_PLAN = r.body?.id;
r = await call(OA, 'POST', '/business/plans', { name: 'Community Day', washes: 4, months: 1, catalogServiceId: DAY, soldAt: 'community', shopUse: false });
const COMMUNITY_PLAN = r.body?.id;
check('…one sold everywhere, and one for communities only', !!BOTH_PLAN && !!COMMUNITY_PLAN, show(r));
r = await call(OA, 'GET', '/business/plans');
const listed = Object.fromEntries((r.body?.plans ?? []).map((p) => [p.id, p]));
check('Plans keep where they’re sold and whether a community plan works at the shop', listed[SHOP_PLAN]?.soldAt === 'shop' && listed[BOTH_PLAN]?.soldAt === 'both' && listed[COMMUNITY_PLAN]?.shopUse === false, JSON.stringify(Object.values(listed).map((p) => [p.name, p.soldAt, p.shopUse])));

const vt = Object.fromEntries(((await call(OA, 'GET', '/services/vehicle-types')).body ?? []).map((v) => [v.name, v]));
const hatch = vt.Hatchback?.id;
r = await call(OA, 'GET', `/shop-plans/for-sale?vehicleTypeId=${hatch}`);
const forSale = r.body?.plans ?? [];
const shopOffer = forSale.find((p) => p.planId === SHOP_PLAN);
check('The counter sells shop plans and plans sold everywhere, not community-only ones', forSale.some((p) => p.planId === BOTH_PLAN) && !!shopOffer && !forSale.some((p) => p.planId === COMMUNITY_PLAN), JSON.stringify(forSale));
check('…priced at the hub: 4 × ₹499 less 10% = ₹1,796', shopOffer?.total === 179600 && shopOffer?.listTotal === 199600, JSON.stringify(shopOffer));
r = await call(OA, 'GET', '/places/menu');
check('A community’s list has community plans only', !(r.body?.menu?.plans ?? []).some((p) => p.id === SHOP_PLAN) && (r.body?.menu?.plans ?? []).some((p) => p.id === BOTH_PLAN), JSON.stringify((r.body?.menu?.plans ?? []).map((p) => p.name)));

// ─── Selling one at the counter ──────────────────────────────────────────────

const svc = Object.fromEntries(((await call(OA, 'GET', '/services')).body ?? []).map((s) => [s.name, s]));
const phone = `98${rand(8)}`;
const plate = `AP39SP${rand(4)}`;
const saleId = `sale_${run}_${rand(6)}`;
const sell = (extra = {}) =>
  call(OA, 'POST', '/shop-plans/sell', {
    id: saleId,
    customer: { phone, name: 'Plan Customer' },
    registrationNumber: plate,
    vehicleTypeId: hatch,
    planId: SHOP_PLAN,
    paymentMethod: 'upi',
    ...extra,
  });
r = await sell();
check('The counter sells a plan: a paid bill for its price', r.status === 201 && r.body?.job?.status === 'paid' && r.body?.job?.total === 179600 && r.body?.job?.paymentMethod === 'upi', show(r));
const saleJob = r.body?.job?.id;
r = await sell();
check('…sent again (a retry) it’s sold once', r.status === 200 && r.body?.job?.id === saleJob && d1Rows(`SELECT count(*) AS n FROM shop_plan_orders WHERE sale_job_id = '${saleId}'`)[0]?.n === 1, show(r));
r = await call(OA, 'GET', '/jobs/stats?range=today');
check('Reports count the sale as money, not as a car washed', r.body?.carsWashed === 0 && r.body?.shopPlansSold === 1 && r.body?.revenue === 179600, show(r));
r = await call(OA, 'GET', '/reports/staff?range=today');
const seller = (r.body?.rows ?? []).find((row) => row.plansSold > 0);
check('Staff report: a plan sold, not a wash started, and its money collected', seller?.plansSold === 1 && seller?.washesStarted === 0 && seller?.washesDone === 0 && seller?.collected === 179600, JSON.stringify(r.body?.rows));
r = await call(OA, 'GET', '/jobs/stats/export?range=today');
const saleRow = (r.body?.jobs ?? []).find((j) => j.id === saleJob);
check('The PDF data marks the bill as a plan sale and has the plan money apart', saleRow?.planSale === true && r.body?.stats?.shopPlanRevenue === 179600, show(r));
r = await call(OA, 'POST', '/shop-plans/sell', { id: `sale_${run}_${rand(6)}`, customer: { phone, name: 'X' }, registrationNumber: plate, vehicleTypeId: hatch, planId: COMMUNITY_PLAN, paymentMethod: 'cash' });
check('A community-only plan can’t be sold at the counter', r.status === 400, show(r));

r = await call(OA, 'GET', `/shop-plans/vehicle?registrationNumber=${plate}`);
const mine = r.body?.plans?.[0];
check('New Wash sees the vehicle’s plan: 0 of 4 used, ends in a month', mine?.washesUsed === 0 && mine?.washesTotal === 4 && /^\d{4}-\d{2}-\d{2}$/.test(mine?.endsOn ?? '') && mine?.problem === null && mine?.service?.name === 'Basic Wash', show(r));

// ─── Using it ────────────────────────────────────────────────────────────────

const wash = (extra = {}) =>
  call(OA, 'POST', '/jobs/start', {
    id: `job_sp_${run}_${rand(6)}`,
    customer: { phone, name: 'Plan Customer' },
    registrationNumber: plate,
    vehicleTypeId: hatch,
    services: [{ serviceId: svc['Basic Wash']?.id, quantity: 1 }],
    shopPlanId: mine?.orderId,
    ...extra,
  });
r = await wash();
const firstWash = r.body;
check('A plan wash at the shop: the wash is free', r.status === 201 && r.body?.total === 0 && /Plan wash · Shop Basic · 1 of 4/.test(r.body?.discountReason ?? ''), show(r));
r = await call(OA, 'GET', `/shop-plans/vehicle?registrationNumber=${plate}`);
check('…and one of its washes is used', r.body?.plans?.[0]?.washesUsed === 1 && /one wash a day/.test(r.body?.plans?.[0]?.problem ?? ''), show(r));
r = await wash();
check('A second plan wash the same day is refused: one a day', r.status === 409 && /one wash a day/.test(r.body?.message ?? ''), show(r));
r = await wash({ services: [{ serviceId: svc['Premium Wash']?.id, quantity: 1 }] });
check('A wash the plan doesn’t cover can’t use it', r.status === 409, show(r));
r = await wash({ registrationNumber: `AP39SQ${rand(4)}` });
check('The same owner’s other vehicle can’t use it', r.status === 409, show(r));
r = await call(OB, 'POST', '/jobs/start', {
  id: `job_sp_${run}_${rand(6)}`,
  customer: { phone, name: 'Plan Customer' },
  registrationNumber: plate,
  vehicleTypeId: Object.values(Object.fromEntries(((await call(OB, 'GET', '/services/vehicle-types')).body ?? []).map((v) => [v.name, v]))).find((v) => v.name === 'Hatchback')?.id,
  services: [{ serviceId: ((await call(OB, 'GET', '/services')).body ?? []).find((s) => s.name === 'Basic Wash')?.id, quantity: 1 }],
  shopPlanId: mine?.orderId,
});
check('Another branch can’t use it (only where it was sold)', r.status === 409, show(r));

r = await call(OA, 'POST', `/jobs/${firstWash?.id}/void`, { reason: 'Wrong car entered' });
r = await call(OA, 'GET', `/shop-plans/vehicle?registrationNumber=${plate}`);
check('Voiding the wash gives its plan wash back', r.body?.plans?.[0]?.washesUsed === 0 && r.body?.plans?.[0]?.problem === null, show(r));
r = await wash();
check('…so it can be used again today', r.status === 201 && r.body?.total === 0, show(r));

r = await call(OA, 'POST', `/jobs/${saleJob}/void`, { reason: 'Customer changed mind' });
check('A plan’s sale can’t be voided once a wash on it is used', r.status === 409 && r.body?.error === 'plan_in_use', show(r));

// A second plan, not used yet: voiding its sale cancels it.
const sale2 = `sale_${run}_${rand(6)}`;
const plate2 = `AP39SR${rand(4)}`;
r = await call(OA, 'POST', '/shop-plans/sell', { id: sale2, customer: { phone, name: 'Plan Customer' }, registrationNumber: plate2, vehicleTypeId: hatch, planId: BOTH_PLAN, paymentMethod: 'cash' });
check('A plan sold everywhere can be sold at the counter too', r.status === 201, show(r));
r = await call(OA, 'POST', `/jobs/${sale2}/void`, { reason: 'Sold by mistake' });
check('Voiding an unused plan’s sale cancels the plan', r.status === 200 && r.body?.status === 'void' && d1Rows(`SELECT status FROM shop_plan_orders WHERE sale_job_id = '${sale2}'`)[0]?.status === 'void', show(r));
r = await call(OA, 'GET', `/shop-plans/vehicle?registrationNumber=${plate2}`);
check('…and it’s gone from New Wash', (r.body?.plans ?? []).length === 0, show(r));

// ─── Running out and ending ──────────────────────────────────────────────────

const orderId = mine?.orderId;
d1Run(`UPDATE shop_plan_orders SET washes_used = 4, status = 'ended' WHERE id = '${orderId}';`);
r = await call(OA, 'GET', `/shop-plans/vehicle?registrationNumber=${plate}`);
check('A plan with every wash used no longer shows', (r.body?.plans ?? []).length === 0, show(r));
d1Run(`UPDATE shop_plan_orders SET washes_used = 1, status = 'active', ends_on = '2020-01-01' WHERE id = '${orderId}';`);
r = await call(OA, 'GET', `/shop-plans/vehicle?registrationNumber=${plate}`);
check('A plan past its last day says it has ended', /ended/.test(r.body?.plans?.[0]?.problem ?? ''), show(r));
r = await wash();
check('…and can’t pay for a wash', r.status === 409, show(r));

// From a customer's profile: a plan for another vehicle they're adding now.
const extraPlate = `AP${rand(2)}PL${rand(4)}`;
r = await call(OA, 'POST', '/shop-plans/sell', {
  id: `sale_${run}_${rand(6)}`,
  customer: { phone, name: 'Plan Customer' },
  registrationNumber: extraPlate,
  vehicleTypeId: hatch,
  make: 'Maruti Suzuki',
  model: 'Swift',
  planId: SHOP_PLAN,
  paymentMethod: 'cash',
});
const added = d1Rows(`SELECT v.make, v.model, c.phone FROM vehicles v JOIN customers c ON c.id = v.customer_id WHERE v.registration_number = '${extraPlate}'`)[0];
check(
  'A plan sold for a new vehicle adds it to the customer, with its company and model',
  r.status === 201 && added?.phone === phone && added?.make === 'Maruti Suzuki' && added?.model === 'Swift',
  `${show(r)} ${JSON.stringify(added)}`,
);

// ─── A second car in the same home: 10% off its plan ─────────────────────────

const secondPlate = `AP39SC${rand(4)}`;
r = await call(OA, 'GET', `/shop-plans/for-sale?vehicleTypeId=${hatch}&phone=${phone}&registrationNumber=${secondPlate}`);
const second = (r.body?.plans ?? []).find((p) => p.planId === SHOP_PLAN);
check('A customer with a plan running sees their second car’s plan at 10% off', r.body?.secondCar === true && second?.total === 161600 && second?.secondCar?.fullTotal === 179600, JSON.stringify(second));
r = await call(OA, 'GET', `/shop-plans/for-sale?vehicleTypeId=${hatch}&phone=98${rand(8)}`);
check('…a new customer pays the usual price', r.body?.secondCar === false && (r.body?.plans ?? []).find((p) => p.planId === SHOP_PLAN)?.total === 179600, show(r));
r = await call(OA, 'POST', '/shop-plans/sell', {
  id: `sale_${run}_${rand(6)}`,
  customer: { phone, name: 'Plan Customer' },
  registrationNumber: secondPlate,
  vehicleTypeId: hatch,
  planId: SHOP_PLAN,
  paymentMethod: 'cash',
});
check('…and is billed 10% off, shown as a discount on the bill', r.status === 201 && r.body?.job?.total === 161600 && r.body?.job?.subtotal === 179600 && r.body?.job?.discount === 18000, show(r));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
