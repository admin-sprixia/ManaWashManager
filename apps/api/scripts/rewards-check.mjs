// Rewards end to end: stamp cards (paid washes stamp, combos count, free washes, races, voids,
// the six-month reset) and welcome gifts (first paid visit, out of stock → owed, hand over
// later, void puts stock back). Run against the local API:
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:rewards                       (in another)
import { API, apiFetch, d1Rows, d1Run } from './lib/target.mjs';

const DEV_CODE = process.env.DEV_CODE ?? '000000';
const PIN = '2580';

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

const sql = d1Run;
const rows = d1Rows;

const run = Date.now().toString(36);
const rand = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const id = (p) => `${p}_${run}_${rand(6)}`;
const isoIn = (days) => `'${new Date(Date.now() + days * 86400000).toISOString()}'`;
/** Stored timestamp format, `days` from now (negative = past). */
const stamp = (days) => new Date(Date.now() + days * 86400000).toISOString().replace('Z', '+00:00');

const SHOP = `shop_rw_${run}`;
const FREE_SHOP = `shop_rwf_${run}`;
const OWNER = `user_rw_o_${run}`;
const STAFF = `user_rw_s_${run}`;
const FREE_OWNER = `user_rwf_o_${run}`;
const ownerPhone = `94${rand(8)}`;
const staffPhone = `94${rand(8)}`;
const freePhone = `94${rand(8)}`;
const HATCH = `vt_rw_h_${run}`;
const SUV = `vt_rw_s_${run}`;
const FW = `svc_rw_fw_${run}`;
const PL = `svc_rw_pl_${run}`;
const CB = `svc_rw_cb_${run}`;
const CLOTH = `stk_rw_cloth_${run}`;
const FRESH = `stk_rw_fresh_${run}`;
const price = { [FW]: { [HATCH]: 30000, [SUV]: 50000 }, [PL]: { [HATCH]: 20000, [SUV]: 25000 }, [CB]: { [HATCH]: 45000, [SUV]: 65000 } };

sql(
  `INSERT INTO shops (id, code, name, plan, paid_until) VALUES ('${SHOP}', '${rand(6)}', 'Rewards Check Wash', 'active', ${isoIn(30)});` +
    `INSERT INTO shops (id, code, name, plan) VALUES ('${FREE_SHOP}', '${rand(6)}', 'Rewards Free Wash', 'free');` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('${OWNER}', '${SHOP}', 'Reward Owner', '${ownerPhone}', 'owner');` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('${STAFF}', '${SHOP}', 'Reward Staff', '${staffPhone}', 'staff');` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('${FREE_OWNER}', '${FREE_SHOP}', 'Free Owner', '${freePhone}', 'owner');` +
    `INSERT INTO vehicle_types (id, shop_id, name, category, sort_order) VALUES ('${HATCH}', '${SHOP}', 'Hatchback', 'car', 0);` +
    `INSERT INTO vehicle_types (id, shop_id, name, category, sort_order) VALUES ('${SUV}', '${SHOP}', 'SUV', 'car', 1);` +
    `INSERT INTO services (id, shop_id, name, applies_to, sort_order) VALUES ('${FW}', '${SHOP}', 'Full Wash', 'car', 0);` +
    `INSERT INTO services (id, shop_id, name, applies_to, sort_order) VALUES ('${PL}', '${SHOP}', 'Polish', 'car', 1);` +
    `INSERT INTO services (id, shop_id, name, applies_to, sort_order) VALUES ('${CB}', '${SHOP}', 'Wash + Polish', 'car', 2);` +
    `INSERT INTO service_combo_items (shop_id, combo_id, service_id) VALUES ('${SHOP}', '${CB}', '${FW}'), ('${SHOP}', '${CB}', '${PL}');` +
    Object.entries(price)
      .flatMap(([svc, byType]) =>
        Object.entries(byType).map(
          ([vt, p]) =>
            `INSERT INTO service_prices (id, shop_id, service_id, vehicle_type_id, price) VALUES ('sp_${svc}_${vt}', '${SHOP}', '${svc}', '${vt}', ${p});`,
        ),
      )
      .join('') +
    `INSERT INTO commission_rates (shop_id, service_id, vehicle_type_id, amount) VALUES ('${SHOP}', '${FW}', '${SUV}', 2000);` +
    `INSERT INTO stock_items (id, shop_id, name, name_key, unit, balance, created_by_user_id) VALUES ('${CLOTH}', '${SHOP}', 'Microfibre cloth', 'microfibre cloth', 'pcs', 1, '${OWNER}');` +
    `INSERT INTO stock_items (id, shop_id, name, name_key, unit, balance, created_by_user_id) VALUES ('${FRESH}', '${SHOP}', 'Air freshener', 'air freshener', 'pcs', 0, '${OWNER}');`,
);

async function signIn(phone) {
  await call(null, 'POST', '/auth/code/request', { phone });
  const v = await call(null, 'POST', '/auth/code/verify', { phone, code: DEV_CODE });
  const p = v.body?.token ? await call(v.body.token, 'PUT', '/auth/pin', { pin: PIN }) : v;
  if (!p.body?.token) console.log(`      (sign-in for ${phone} failed: ${show(p)})`);
  return p.body?.token;
}
const O = await signIn(ownerPhone);
const F = await signIn(freePhone);
// WhatsApp codes are owner-only; staff get the owner's PIN (same hash) and sign in with it.
sql(`UPDATE users SET pin_hash = (SELECT pin_hash FROM users WHERE id = '${OWNER}') WHERE id = '${STAFF}';`);
const staffLogin = await call(null, 'POST', '/auth/pin/login', { phone: staffPhone, pin: PIN });
if (!staffLogin.body?.token) console.log(`      (staff sign-in failed: ${show(staffLogin)})`);
const S = staffLogin.body?.token;
check('Owner, staff and a Free-plan owner sign in', !!O && !!S && !!F);
if (!O || !S || !F) process.exit(1);

let plateN = 0;
const plate = () => `KA${String(10 + (plateN++ % 89)).padStart(2, '0')}RW${rand(4)}`;
let phoneN = 0;
const customerPhone = () => `98${String(phoneN++).padStart(2, '0')}${rand(6)}`;

/** Starts a wash via New Wash's one-call endpoint. */
async function start(token, { reg, phone, vt = SUV, services = [FW], ...extra }) {
  return call(token, 'POST', '/jobs/start', {
    id: id('job'),
    customer: { phone, name: 'Reward Customer' },
    registrationNumber: reg,
    vehicleTypeId: vt,
    services: services.map((serviceId) => ({ serviceId, quantity: 1 })),
    ...extra,
  });
}
/** Waiting → washing → ready → paid (a repeat of a finished step is answered as-is). */
async function pay(token, jobId, method = 'cash') {
  const now = await call(token, 'GET', `/jobs/${jobId}`);
  if (now.body?.status === 'waiting') await call(token, 'PATCH', `/jobs/${jobId}/status`, { status: 'washing' });
  if (now.body?.status === 'waiting' || now.body?.status === 'washing') {
    await call(token, 'PATCH', `/jobs/${jobId}/status`, { status: 'ready' });
  }
  return call(token, 'POST', `/jobs/${jobId}/pay`, { paymentMethod: method });
}
const voidJob = (token, jobId) => call(token, 'POST', `/jobs/${jobId}/void`, { reason: 'Entered by mistake' });
async function paidWash(car, opts = {}) {
  const s = await start(O, { ...car, ...opts });
  if (s.status !== 201 && s.status !== 200) return s;
  return pay(O, s.body.id);
}
const lookup = (reg, token = O) => call(token, 'GET', `/rewards/vehicle?registrationNumber=${encodeURIComponent(reg)}`);
const card = (r, serviceId = FW) => r.body?.cards?.find((cd) => cd.serviceId === serviceId) ?? { stamps: 0, free: 0 };
const balance = (itemId) => rows(`SELECT balance FROM stock_items WHERE id = '${itemId}'`)[0]?.balance;

// ─── Pro gate ─────────────────────────────────────────────────────────────

let r = await call(F, 'GET', '/rewards/settings');
check('Free plan: rewards need Pro', r.status === 402 && r.body?.feature === 'rewards', show(r));
r = await call(F, 'POST', '/jobs/start', {
  id: id('job'),
  customer: { phone: customerPhone(), name: 'X' },
  registrationNumber: plate(),
  vehicleTypeId: HATCH,
  services: [{ serviceId: FW, quantity: 1 }],
  rewardServiceIds: [FW],
});
check('Free plan: a free wash can’t be used', r.status === 402 && r.body?.feature === 'rewards', show(r));

// ─── Setting up ───────────────────────────────────────────────────────────

r = await call(S, 'PUT', `/rewards/rules/${FW}`, { every: 3 });
check('Staff can’t set up stamp cards', r.status === 403, show(r));
r = await call(O, 'PUT', `/rewards/rules/${FW}`, { every: 1 });
check('A card needs at least 2 washes', r.status === 400, show(r));
r = await call(O, 'PUT', `/rewards/rules/svc_missing_${run}`, { every: 5 });
check('A card needs a real service', r.status === 404, show(r));
r = await call(O, 'PUT', `/rewards/rules/${FW}`, { every: 3 });
check('Owner turns on a Full Wash card: every 3 → 1 free', r.status === 200 && r.body.rules?.some((x) => x.serviceId === FW && x.every === 3), show(r));

r = await call(O, 'PUT', '/rewards/gift', { items: [{ stockItemId: CLOTH, quantity: 1.5 }] });
check('Pieces must be whole numbers', r.status === 400 && r.body?.error === 'invalid_quantity', show(r));
r = await call(O, 'PUT', '/rewards/gift', { items: [{ stockItemId: `stk_missing_${run}`, quantity: 1 }] });
check('Gift items must be in Inventory', r.status === 400 && r.body?.error === 'item_not_found', show(r));
r = await call(S, 'PUT', '/rewards/gift', { items: [{ stockItemId: CLOTH, quantity: 1 }] });
check('Staff can’t change the welcome gift', r.status === 403, show(r));
r = await call(O, 'PUT', '/rewards/gift', {
  items: [
    { stockItemId: CLOTH, quantity: 1 },
    { stockItemId: FRESH, quantity: 1 },
  ],
});
check('Owner sets a two-item welcome gift', r.status === 200 && r.body.gift?.length === 2, show(r));
r = await call(S, 'GET', '/rewards/settings');
check('Staff see the cards and the gift', r.status === 200 && r.body.rules?.length === 1 && r.body.gift?.length === 2, show(r));

// ─── First visit: welcome gift ────────────────────────────────────────────

const A = { reg: plate(), phone: customerPhone() };
r = await lookup(A.reg);
check('A plate never seen is new (gets the gift)', r.status === 200 && r.body.isNew === true && r.body.vehicleId === null, show(r));

const a1 = await start(O, A);
check('First wash for car A starts', a1.status === 201, show(a1));
r = await lookup(A.reg);
check('Once a wash is started the car is no longer new', r.body.isNew === false, show(r));
check('…and unpaid, it has no stamp yet', card(r).stamps === 0, show(r));
r = await pay(O, a1.body.id);
const gifts = r.body?.gifts ?? [];
check(
  'Paying the first wash gives what’s in stock and keeps the rest owed',
  r.status === 200 &&
    gifts.find((g) => g.stockItemId === CLOTH)?.status === 'given' &&
    gifts.find((g) => g.stockItemId === FRESH)?.status === 'owed',
  show(r),
);
check('…the cloth came off the shelf', balance(CLOTH) === 0, `cloth=${balance(CLOTH)}`);
check(
  '…as a "gift" stock move',
  rows(`SELECT COUNT(*) AS n FROM stock_moves WHERE item_id = '${CLOTH}' AND kind = 'gift' AND quantity = -1`)[0]?.n === 1,
);
r = await pay(O, a1.body.id);
check('A retried payment doesn’t give twice', r.status === 200 && balance(CLOTH) === 0 && rows(`SELECT COUNT(*) AS n FROM reward_gifts WHERE job_id = '${a1.body.id}'`)[0]?.n === 2, show(r));
r = await call(O, 'GET', '/stock');
check('Inventory shows 1 customer waiting for air freshener', r.body?.items?.find((i) => i.id === FRESH)?.giftsOwed === 1, show(r));

r = await lookup(A.reg);
check('One paid Full Wash = 1 stamp', card(r).stamps === 1 && card(r).free === 0, show(r));
check('Owed gift shows on the card lookup', r.body.giftsOwed?.length === 1 && r.body.giftsOwed[0].stockItemId === FRESH, show(r));

// ─── Stamps: combos count, unpaid doesn't ─────────────────────────────────

r = await paidWash(A, { services: [CB] });
check('Second visit (combo) is paid — no second welcome gift', r.status === 200 && (r.body?.gifts ?? []).length === 0, show(r));
r = await lookup(A.reg);
check('A combo with Full Wash stamps the card', card(r).stamps === 2, show(r));
const a3 = await start(O, A);
r = await lookup(A.reg);
check('An unpaid wash doesn’t stamp yet', card(r).stamps === 2, show(r));
await pay(O, a3.body.id);
r = await lookup(A.reg);
check('Third paid visit fills the card: 1 free wash, back to 0', card(r).free === 1 && card(r).stamps === 0, show(r));
check('The card says when it resets', typeof card(r).expiresAt === 'string', show(r));

// ─── Using the free wash ──────────────────────────────────────────────────

r = await start(O, { ...A, services: [FW, PL], rewardServiceIds: [FW], discount: 1000, discountReason: 'extra' });
check('A free wash can’t be combined with a manual discount', r.status === 400, show(r));
r = await start(O, { ...A, services: [PL], rewardServiceIds: [FW] });
check('The free service must be on the bill', r.status === 409 && r.body?.error === 'reward_invalid', show(r));
const free = await start(S, { ...A, services: [FW, PL], rewardServiceIds: [FW] });
const fwLine = free.body?.jobServices?.find((l) => l.serviceId === FW);
check(
  'Staff use the free Full Wash: priced at the SUV size, 100% off that line',
  free.status === 201 &&
    free.body.subtotal === 75000 &&
    free.body.discount === 50000 &&
    free.body.total === 25000 &&
    free.body.discountReason?.startsWith('Loyalty reward'),
  show(free),
);
check('The washer still earns commission on the free line', fwLine?.commissionAtTime === 2000, show(free));
check('The job marks Full Wash as the free service', free.body?.freeServiceIds?.includes(FW), show(free));
r = await lookup(A.reg);
check('Using it takes the free wash off the card', card(r).free === 0 && card(r).stamps === 0, show(r));
await pay(O, free.body.id);
r = await lookup(A.reg);
check('A free wash earns no stamp, even once paid', card(r).stamps === 0 && card(r).free === 0, show(r));
r = await start(O, { ...A, services: [FW], rewardServiceIds: [FW] });
check('No free wash left → refused', r.status === 409 && r.body?.error === 'reward_invalid', show(r));

// ─── Two phones, one free wash ────────────────────────────────────────────

const B = { reg: plate(), phone: customerPhone() };
for (let i = 0; i < 3; i++) await paidWash(B);
r = await lookup(B.reg);
check('Car B fills its card', card(r).free === 1, show(r));
const pair = await Promise.all([
  start(O, { ...B, services: [FW], rewardServiceIds: [FW] }),
  start(S, { ...B, services: [FW], rewardServiceIds: [FW] }),
]);
check(
  'Two phones use the same free wash at once: exactly one gets it',
  pair.filter((p) => p.status === 201).length === 1 && pair.some((p) => p.status === 409 && p.body?.error === 'reward_invalid'),
  pair.map(show).join(' | '),
);
check(
  'Only one claim was written',
  rows(`SELECT COUNT(*) AS n FROM reward_claims WHERE vehicle_id = (SELECT id FROM vehicles WHERE registration_number = '${B.reg}')`)[0]?.n === 1,
);
const winner = pair.find((p) => p.status === 201);
if (!winner) {
  console.log('\nNeither phone got the free wash, so the rest of the run can’t continue.');
  process.exit(1);
}
r = await call(O, 'POST', '/jobs/start', {
  id: winner.body.id,
  customer: { phone: B.phone, name: 'Reward Customer' },
  registrationNumber: B.reg,
  vehicleTypeId: SUV,
  services: [{ serviceId: FW, quantity: 1 }],
  rewardServiceIds: [FW],
});
check('A replayed free-wash request returns the same job', r.status === 200 && r.body.id === winner.body.id, show(r));
await voidJob(O, winner.body.id);
r = await lookup(B.reg);
check('Voiding the free wash gives it back', card(r).free === 1, show(r));
const bPaid = (await call(O, 'GET', '/jobs/today')).body.filter((j) => j.vehicle?.registrationNumber === B.reg && j.status === 'paid');
await voidJob(O, bPaid[0].id);
r = await lookup(B.reg);
check('Voiding a paid wash takes its stamp off (the free wash goes with it)', card(r).free === 0 && card(r).stamps === 2, show(r));

// ─── Six months without the service ───────────────────────────────────────

const C = { reg: plate(), phone: customerPhone() };
for (let i = 0; i < 3; i++) await paidWash(C);
const cVehicle = `(SELECT id FROM vehicles WHERE registration_number = '${C.reg}')`;
sql(`UPDATE jobs SET created_at = '${stamp(-200)}' WHERE vehicle_id = ${cVehicle};`);
r = await lookup(C.reg);
check('Six months without Full Wash: the card resets, saved free wash included', card(r).free === 0 && card(r).stamps === 0, show(r));
r = await start(O, { ...C, services: [FW], rewardServiceIds: [FW] });
check('…so it can’t be used', r.status === 409, show(r));

const E = { reg: plate(), phone: customerPhone() };
await paidWash(E);
sql(`UPDATE jobs SET created_at = '${stamp(-176)}' WHERE vehicle_id = (SELECT id FROM vehicles WHERE registration_number = '${E.reg}');`);
r = await lookup(E.reg);
const daysLeft = (new Date(card(r).expiresAt).getTime() - Date.now()) / 86400000;
check('A card near six months says it resets within days', card(r).stamps === 1 && daysLeft > 0 && daysLeft <= 10, show(r));
r = await call(O, 'GET', '/reminders');
const eItem = [...(r.body?.due ?? []), ...(r.body?.comeback ?? [])].find((i) => i.registrationNumber === E.reg);
check('Reminders show the card that is about to reset', eItem?.rewards?.[0]?.serviceId === FW, show(r));

// ─── Walk-ins ─────────────────────────────────────────────────────────────

const walkIn = `WALK-IN-${rand(6)}`;
r = await paidWash({ reg: walkIn, phone: customerPhone() });
check('A walk-in gets no welcome gift', r.status === 200 && (r.body?.gifts ?? []).length === 0, show(r));
r = await lookup(walkIn);
check('…and has no stamp card', r.body?.eligible === false, show(r));

// ─── Owed gifts: hand over later ──────────────────────────────────────────

r = await call(S, 'GET', '/rewards/gifts/owed');
const owedFresh = r.body?.gifts?.find((g) => g.registrationNumber === A.reg && g.stockItemId === FRESH);
check('The owed list shows car A waiting for air freshener', !!owedFresh && owedFresh.customerPhone === A.phone, show(r));
r = await call(S, 'POST', `/rewards/gifts/${encodeURIComponent(owedFresh.id)}/give`);
check('Can’t hand it over while out of stock', r.status === 409 && r.body?.error === 'out_of_stock', show(r));
r = await call(O, 'POST', '/stock/moves', { id: id('mov'), itemId: FRESH, kind: 'in', quantity: 2, unit: 'pcs' });
check('Owner restocks air freshener', r.status === 201, show(r));
r = await call(S, 'POST', `/rewards/gifts/${encodeURIComponent(owedFresh.id)}/give`);
check('Staff hand it over from the customer page — no wash needed', r.status === 200 && r.body.gift?.status === 'given' && r.body.gift?.givenBy?.id === STAFF, show(r));
check('…stock goes down by one', balance(FRESH) === 1, `fresh=${balance(FRESH)}`);
r = await call(S, 'POST', `/rewards/gifts/${encodeURIComponent(owedFresh.id)}/give`);
check('Handing it over twice is harmless', r.status === 200 && balance(FRESH) === 1, show(r));

// ─── Void the first wash: gifts come back ─────────────────────────────────

r = await voidJob(O, a1.body.id);
check('Owner voids car A’s first (paid) wash', r.status === 200, show(r));
check('Both gifts went back on the shelf', balance(CLOTH) === 1 && balance(FRESH) === 2, `cloth=${balance(CLOTH)} fresh=${balance(FRESH)}`);
check(
  '…and are cancelled',
  rows(`SELECT COUNT(*) AS n FROM reward_gifts WHERE job_id = '${a1.body.id}' AND status = 'cancelled'`)[0]?.n === 2,
);
r = await voidJob(O, a1.body.id);
check('A repeated void doesn’t return stock twice', r.status === 200 && balance(CLOTH) === 1 && balance(FRESH) === 2, show(r));

// ─── Two first washes for one car ─────────────────────────────────────────

const G = { reg: plate(), phone: customerPhone() };
const g1 = await start(O, G);
const g2 = await start(O, G);
r = await pay(O, g2.body.id);
check('The later of two waiting washes isn’t the first visit', r.status === 200 && (r.body?.gifts ?? []).length === 0, show(r));
r = await pay(O, g1.body.id);
check('The earlier one gets the gift when paid', (r.body?.gifts ?? []).length === 2, show(r));
check(
  'The car holds one live gift per item',
  rows(`SELECT COUNT(*) AS n FROM reward_gifts WHERE vehicle_id = (SELECT id FROM vehicles WHERE registration_number = '${G.reg}') AND status != 'cancelled'`)[0]?.n === 2,
);

// ─── Customer page, directory, report ─────────────────────────────────────

const aCustomer = rows(`SELECT customer_id AS id FROM vehicles WHERE registration_number = '${A.reg}'`)[0]?.id;
r = await call(S, 'GET', `/rewards/customer/${aCustomer}`);
check('Customer page lists the car and its gifts', r.status === 200 && r.body.vehicles?.[0]?.registrationNumber === A.reg, show(r));

r = await call(O, 'GET', '/customers/directory?limit=80');
const bEntry = r.body?.entries?.find((e) => e.registrationNumber === B.reg);
check('The offline directory carries each car’s cards', bEntry?.rewardCards?.[0]?.stamps === 2, show(r));
const gEntry = r.body?.entries?.find((e) => e.registrationNumber === G.reg);
check('…and how many gifts it’s owed', gEntry?.giftsOwed === 0, JSON.stringify(gEntry));

r = await call(O, 'GET', '/rewards/report?range=today');
check(
  'Report: free washes used and what they were worth, gifts handed over',
  // The first car's two gifts were taken back with its voided wash; only car G's count.
  r.status === 200 &&
    r.body.freeWashes === 1 &&
    r.body.freeValue === 50000 &&
    r.body.giftsGiven === 2 &&
    r.body.gifts?.length === 2 &&
    r.body.giftsOwedNow >= 1,
  show(r),
);
r = await call(S, 'GET', '/rewards/report?range=today');
check('Staff can’t see the rewards report', r.status === 403, show(r));

// ─── Switching a card off ─────────────────────────────────────────────────

r = await call(O, 'DELETE', `/rewards/rules/${FW}`);
check('Owner switches the Full Wash card off', r.status === 200 && r.body.rules?.length === 0, show(r));
r = await lookup(B.reg);
check('…cards disappear', r.body?.cards?.length === 0, show(r));
r = await call(O, 'PUT', `/rewards/rules/${FW}`, { every: 3 });
r = await lookup(B.reg);
check('Switching it back on picks up where the car was', card(r).stamps === 2, show(r));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
