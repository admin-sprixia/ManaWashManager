// What changes on a wash after it's entered, end to end: a bill paid partly by UPI and partly in
// cash (and cash handed over without change), the customer switching services halfway (anyone
// before payment, the owner after, never on a split, voided or home-wash bill), another vehicle
// for a customer with no number joining their profile, the owner moving a vehicle to the right
// customer, and the owner's look back at one day. Run against the local API:
//   cd apps/api && npm run db:reset:local && npm run dev        (in one terminal)
//   cd apps/api && npm run test:wash-changes                    (in another)
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

const BIZ = `biz_wc_${run}`;
const SHOP = `shop_wc_${run}`;
const OTHER = `shop_wc2_${run}`;
const OWNER = `user_wc_o_${run}`;
const MANAGER = `user_wc_m_${run}`;
const STAFF = `user_wc_s_${run}`;
const OTHER_OWNER = `user_wc_x_${run}`;
const phone = { owner: `94${rand(8)}`, manager: `94${rand(8)}`, staff: `94${rand(8)}`, other: `94${rand(8)}` };
const VT = `vt_wc_${run}`;
const EXPRESS = `svc_wc_express_${run}`;
const BASIC = `svc_wc_basic_${run}`;
const WAX = `svc_wc_wax_${run}`;
const CERAMIC = `svc_wc_ceramic_${run}`;
const OTHER_CUST = `cust_wc_x_${run}`;

d1Run(
  `INSERT INTO businesses (id, name) VALUES ('${BIZ}', 'Wash Changes Co');` +
    `INSERT INTO shops (id, code, name, business_id, menu_version) VALUES ('${SHOP}', '${rand(6)}', 'Changes Hub', '${BIZ}', 1), ('${OTHER}', '${rand(6)}', 'Changes Other', '${BIZ}', 1);` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('${OWNER}', '${SHOP}', 'Owner', '${phone.owner}', 'owner'), ('${MANAGER}', '${SHOP}', 'Rakesh', '${phone.manager}', 'manager'), ('${STAFF}', '${SHOP}', 'Ravi', '${phone.staff}', 'staff'), ('${OTHER_OWNER}', '${OTHER}', 'Other Owner', '${phone.other}', 'owner');` +
    `INSERT INTO vehicle_types (id, shop_id, name, category, sort_order) VALUES ('${VT}', '${SHOP}', 'Hatchback', 'car', 0);` +
    `INSERT INTO services (id, shop_id, name, applies_to, sort_order, kind) VALUES ('${EXPRESS}', '${SHOP}', 'Express Wash', 'car', 0, 'wash'), ('${BASIC}', '${SHOP}', 'Basic Wash', 'car', 1, 'wash'), ('${WAX}', '${SHOP}', 'Tyre Polish', 'car', 2, 'addon'), ('${CERAMIC}', '${SHOP}', 'Ceramic Coat', 'car', 3, 'protection');` +
    `INSERT INTO service_prices (id, shop_id, service_id, vehicle_type_id, price) VALUES ('sp_wc_e_${run}', '${SHOP}', '${EXPRESS}', '${VT}', 14900), ('sp_wc_b_${run}', '${SHOP}', '${BASIC}', '${VT}', 9900), ('sp_wc_w_${run}', '${SHOP}', '${WAX}', '${VT}', 5000), ('sp_wc_c_${run}', '${SHOP}', '${CERAMIC}', '${VT}', 79900);` +
    `INSERT INTO customers (id, shop_id, name, number_key, phone) VALUES ('${OTHER_CUST}', '${OTHER}', 'Other Branch Customer', '${OTHER_CUST}', NULL);`,
);

const T = {};
for (const [who, p] of Object.entries(phone)) {
  const r = await signInWith(p, PIN);
  T[who] = r.body?.token;
  if (!T[who]) console.log(`      (sign-in for ${who} failed: ${show(r)})`);
}
check('Owner, manager, staff and another branch’s owner sign in', Object.values(T).every(Boolean));
if (!Object.values(T).every(Boolean)) process.exit(1);

const plate = () => `AP39WC${rand(4)}`;
/** A wash entered like New Wash does it. */
async function start(token, { services, phoneNo = null, name = 'Walk Customer', reg = plate(), discount = 0, discountReason, customerId } = {}) {
  const id = `job_wc_${run}_${rand(8)}`;
  const r = await call(token, 'POST', '/jobs/start', {
    id,
    customer: { phone: phoneNo, name },
    registrationNumber: reg,
    vehicleTypeId: VT,
    services: services.map((serviceId) => ({ serviceId, quantity: 1 })),
    discount,
    ...(discountReason ? { discountReason } : {}),
    ...(customerId ? { customerId } : {}),
  });
  return { id, reg, r };
}
const detail = async (id, token = T.owner) => (await call(token, 'GET', `/jobs/${id}`)).body;
const lineIds = (job) => (job?.jobServices ?? []).map((l) => l.serviceId).sort().join(',');
const change = (token, id, body) => call(token, 'PUT', `/jobs/${id}/services`, body);
const advance = async (id) => {
  await call(T.staff, 'PATCH', `/jobs/${id}/status`, { status: 'washing' });
  return call(T.staff, 'PATCH', `/jobs/${id}/status`, { status: 'ready' });
};

// ─── Changing services before payment ────────────────────────────────────────

let a = await start(T.staff, { services: [EXPRESS] });
check('Staff start an Express wash (₹149)', a.r.status === 201 && a.r.body?.total === 14900, show(a.r));

let r = await change(T.staff, a.id, { services: [{ serviceId: BASIC, quantity: 1 }], reason: 'x' });
check('Changing services needs a reason', r.status === 400, show(r));
r = await change(T.staff, a.id, { services: [{ serviceId: BASIC, quantity: 1 }], reason: 'Customer changed to Basic' });
let job = await detail(a.id);
check('The customer switches to Basic: staff change it, the bill is ₹99 with only Basic on it', r.status === 200 && job.total === 9900 && job.subtotal === 9900 && lineIds(job) === BASIC, `${show(r)} ${job?.total} ${lineIds(job)}`);
let events = (job.events ?? []).filter((e) => e.action === 'services_changed');
check('…and the history keeps who, from what, to what and why', events.length === 1 && events[0].fromValue === 'Express Wash|14900' && events[0].toValue === 'Basic Wash|9900' && events[0].reason === 'Customer changed to Basic' && events[0].user?.name === 'Ravi', JSON.stringify(events));
r = await change(T.staff, a.id, { services: [{ serviceId: BASIC, quantity: 1 }], reason: 'Customer changed to Basic' });
job = await detail(a.id);
check('Sending the same change again (a retry) changes nothing and logs nothing', r.status === 200 && (job.events ?? []).filter((e) => e.action === 'services_changed').length === 1);

r = await change(T.staff, a.id, { services: [{ serviceId: BASIC, quantity: 1 }, { serviceId: WAX, quantity: 1 }], discount: 2000, discountReason: 'Regular', reason: 'Added tyre polish' });
job = await detail(a.id);
check('An add-on and a discount: ₹99 + ₹50 − ₹20 = ₹129', r.status === 200 && job.subtotal === 14900 && job.discount === 2000 && job.total === 12900 && job.discountReason === 'Regular', `${show(r)} ${job?.total}`);
r = await change(T.staff, a.id, { services: [{ serviceId: BASIC, quantity: 1 }], discount: 20000, discountReason: 'Too much', reason: 'Dropped the polish' });
check('A discount bigger than the new bill is refused', r.status === 400 && r.body?.error === 'invalid_discount', show(r));
r = await change(T.staff, a.id, { services: [{ serviceId: BASIC, quantity: 1 }], discount: 500, reason: 'Dropped the polish' });
check('A discount still needs its reason', r.status === 400, show(r));
r = await change(T.staff, a.id, { services: [{ serviceId: `svc_nope_${run}`, quantity: 1 }], reason: 'Unknown service' });
check('A service not on this branch’s menu is refused', r.status === 400 && r.body?.error === 'service_not_for_vehicle', show(r));

r = await advance(a.id);
r = await change(T.staff, a.id, { services: [{ serviceId: EXPRESS, quantity: 1 }], reason: 'Upgraded while ready' });
job = await detail(a.id);
check('A ready wash can still change (the bill is only made at payment)', r.status === 200 && job.status === 'ready' && job.total === 14900 && lineIds(job) === EXPRESS, `${show(r)} ${job?.status} ${job?.total}`);

// ─── Split payment and cash given without change ────────────────────────────

const date = (await call(T.owner, 'GET', '/cash/day')).body?.date;
r = await call(T.owner, 'PUT', '/cash/day/float', { date, amount: 0 });
check('The cash day starts', r.status === 200, show(r));
const cashIn = async () => (await call(T.owner, 'GET', '/cash/day')).body?.cashIn;
const before = await cashIn();

let s = await start(T.staff, { services: [CERAMIC] });
await advance(s.id);
r = await call(T.staff, 'POST', `/jobs/${s.id}/pay`, { paymentMethod: 'upi', cashAmount: 79900 });
check('A cash part as big as the bill is refused (that’s Cash)', r.status === 400 && r.body?.error === 'invalid_split', show(r));
r = await call(T.staff, 'POST', `/jobs/${s.id}/pay`, { paymentMethod: 'upi', cashAmount: 29900, cashReceived: 29000 });
check('Less cash received than the cash due is refused', r.status === 400 && r.body?.error === 'invalid_split', show(r));
r = await call(T.staff, 'POST', `/jobs/${s.id}/pay`, { paymentMethod: 'upi', cashAmount: 29900, cashReceived: 50000 });
check('More than ₹100 over is refused: give change instead', r.status === 400 && r.body?.error === 'invalid_split', show(r));
r = await call(T.staff, 'POST', `/jobs/${s.id}/pay`, { paymentMethod: 'upi', cashAmount: 29900, cashReceived: 30000 });
check('₹799 paid ₹500 by UPI and ₹300 cash for ₹299 (no change)', r.status === 200 && r.body?.status === 'paid' && r.body?.cashAmount === 29900 && r.body?.cashReceived === 30000, show(r));
check('…the box counts the ₹300 actually taken', (await cashIn()) - before === 30000, `${before} → ${await cashIn()}`);
const [row] = d1Rows(`SELECT payment_method AS m, cash_amount AS c, cash_received AS g FROM jobs WHERE id = '${s.id}'`);
check('…stored as UPI with a ₹299 cash part and ₹300 received', row?.m === 'upi' && row?.c === 29900 && row?.g === 30000, JSON.stringify(row));
job = await detail(s.id);
const paidEvent = (job.events ?? []).find((e) => e.action === 'paid');
check('…and the history says how it was paid', /₹299 cash \+ ₹500 UPI/.test(paidEvent?.reason ?? '') && /₹1 extra cash/.test(paidEvent?.reason ?? ''), paidEvent?.reason);
const staffJob = await detail(s.id, T.staff);
check('The paid split wash opens for staff too', staffJob?.status === 'paid');

r = await change(T.staff, s.id, { services: [{ serviceId: BASIC, quantity: 1 }], reason: 'Wrong service' });
check('After payment staff can’t change services', r.status === 403 && r.body?.error === 'owner_only', show(r));
r = await change(T.owner, s.id, { services: [{ serviceId: BASIC, quantity: 1 }], reason: 'Wrong service' });
check('…nor the owner on a split bill (fix the payment first)', r.status === 409 && r.body?.error === 'cannot_change_services', show(r));

let c = await start(T.staff, { services: [EXPRESS] });
await advance(c.id);
r = await call(T.staff, 'POST', `/jobs/${c.id}/pay`, { paymentMethod: 'cash', cashReceived: 15000 });
check('A ₹149 cash wash paid with ₹150 (₹1 kept)', r.status === 200 && r.body?.cashAmount == null && r.body?.cashReceived === 15000, show(r));
r = await change(T.owner, c.id, { services: [{ serviceId: BASIC, quantity: 1 }], reason: 'Billed the wrong wash' });
job = await detail(c.id);
check('The owner can change a paid (single-method) wash', r.status === 200 && job.total === 9900 && job.status === 'paid', `${show(r)} ${job?.total}`);
check('…and the ₹150 handed over for the old bill isn’t kept as ₹51 extra cash', job.cashReceived == null, String(job?.cashReceived));

const stats = (await call(T.owner, 'GET', '/jobs/stats?range=today')).body;
check('Reports count the cash and UPI parts and the round-off', stats && typeof stats.roundOff === 'number' && stats.roundOff >= 100, JSON.stringify(stats).slice(0, 300));

// ─── Washes that can't change ────────────────────────────────────────────────

let v = await start(T.staff, { services: [BASIC] });
await call(T.staff, 'POST', `/jobs/${v.id}/void`, { reason: 'Customer left' });
r = await change(T.owner, v.id, { services: [{ serviceId: EXPRESS, quantity: 1 }], reason: 'Too late' });
check('A voided wash can’t change', r.status === 409 && r.body?.error === 'cannot_change_services', show(r));
let h = await start(T.staff, { services: [BASIC] });
d1Run(`UPDATE jobs SET delivery_mode = 'doorstep' WHERE id = '${h.id}';`);
r = await change(T.staff, h.id, { services: [{ serviceId: EXPRESS, quantity: 1 }], reason: 'Upgrade at home' });
check('A home wash (visit charge) is voided and entered again instead', r.status === 409 && r.body?.error === 'cannot_change_services', show(r));
r = await change(T.other, a.id, { services: [{ serviceId: EXPRESS, quantity: 1 }], reason: 'Other branch' });
check('Another branch can’t touch this wash', r.status === 404, show(r));

// ─── Another vehicle for a customer with no number ──────────────────────────

const first = await start(T.staff, { services: [BASIC], name: 'Subbaiah' });
const firstCustomer = first.r.body?.customerId ?? first.r.body?.customer?.id;
check('A customer with no number gets a wash', first.r.status === 201 && firstCustomer, show(first.r));
const second = await start(T.staff, { services: [BASIC], name: 'Subbaiah', customerId: firstCustomer });
const secondCustomer = second.r.body?.customerId ?? second.r.body?.customer?.id;
check('In the evening, his second vehicle joins the same profile', second.r.status === 201 && secondCustomer === firstCustomer, `${show(second.r)} ${firstCustomer}`);
const vehicles = d1Rows(`SELECT COUNT(*) AS n FROM vehicles WHERE customer_id = '${firstCustomer}'`)[0]?.n;
check('…so the profile has both vehicles', vehicles === 2, String(vehicles));
const stray = await start(T.staff, { services: [BASIC], name: 'Subbaiah' });
const strayCustomer = stray.r.body?.customerId ?? stray.r.body?.customer?.id;
check('Without it (as yesterday) a second profile is made', stray.r.status === 201 && strayCustomer && strayCustomer !== firstCustomer, show(stray.r));

// ─── Moving a vehicle to the right customer ─────────────────────────────────

const strayVehicle = d1Rows(`SELECT id FROM vehicles WHERE customer_id = '${strayCustomer}'`)[0]?.id;
const move = (token, from, vehicleId, to) => call(token, 'POST', `/customers/${from}/vehicles/${vehicleId}/move`, { toCustomerId: to });
r = await move(T.manager, strayCustomer, strayVehicle, firstCustomer);
check('Only the owner can move a vehicle (not a manager)', r.status === 403, show(r));
r = await move(T.owner, strayCustomer, strayVehicle, strayCustomer);
check('Moving to the same customer is refused', r.status === 400, show(r));
r = await move(T.owner, strayCustomer, strayVehicle, OTHER_CUST);
check('…and to another branch’s customer', r.status === 404, show(r));
r = await move(T.owner, strayCustomer, strayVehicle, firstCustomer);
check('The owner moves the stray vehicle to Subbaiah, with its wash', r.status === 200 && r.body?.washes === 1, show(r));
const movedJob = d1Rows(`SELECT customer_id AS c FROM jobs WHERE id = '${stray.id}'`)[0]?.c;
const movedVehicle = d1Rows(`SELECT customer_id AS c FROM vehicles WHERE id = '${strayVehicle}'`)[0]?.c;
check('…the vehicle and its wash are his now', movedJob === firstCustomer && movedVehicle === firstCustomer, `${movedJob} ${movedVehicle}`);
const profile = (await call(T.owner, 'GET', `/customers/${firstCustomer}`)).body;
check('…and his profile shows three vehicles', (profile?.vehicles ?? profile?.customer?.vehicles ?? []).length === 3, JSON.stringify(profile).slice(0, 200));

// ─── The owner's look back at a day ─────────────────────────────────────────

r = await call(T.staff, 'GET', `/jobs/day?date=${date}`);
check('Staff can’t look back at past days', r.status === 403, show(r));
r = await call(T.manager, 'GET', `/jobs/day?date=${date}`);
check('…nor managers', r.status === 403, show(r));
r = await call(T.owner, 'GET', '/jobs/day?date=2026-02-31');
check('A date that doesn’t exist is refused', r.status === 400, show(r));
r = await call(T.owner, 'GET', `/jobs/day?date=${date}`);
const ids = new Set((r.body?.jobs ?? []).map((j) => j.id));
check('The owner sees the day’s washes, voided ones too', r.status === 200 && r.body?.date === date && [a.id, s.id, c.id, v.id, first.id].every((id) => ids.has(id)), show(r));
r = await call(T.owner, 'GET', '/jobs/day?date=2020-01-01');
check('…and a day with none is empty', r.status === 200 && r.body?.jobs?.length === 0, show(r));
r = await call(T.other, 'GET', `/jobs/day?date=${date}`);
check('Another branch never sees these washes', r.status === 200 && !(r.body?.jobs ?? []).some((j) => ids.has(j.id)), show(r));

// ─── Cancelling a paid wash entered wrong ───────────────────────────────────

const paidWash = async () => {
  const w = await start(T.staff, { services: [BASIC] });
  await advance(w.id);
  await call(T.staff, 'POST', `/jobs/${w.id}/pay`, { paymentMethod: 'cash' });
  return w.id;
};
let p1 = await paidWash();
r = await call(T.staff, 'POST', `/jobs/${p1}/void`, { reason: 'Entered again: Wrong vehicle number' });
check('Staff can’t cancel a paid wash', r.status === 403 && r.body?.error === 'owner_only', show(r));
r = await call(T.manager, 'POST', `/jobs/${p1}/void`, { reason: 'Entered again: Wrong vehicle number' });
check('A manager cancels a paid wash entered wrong, within 15 minutes', r.status === 200 && r.body?.status === 'void', show(r));
let p2 = await paidWash();
d1Run(`UPDATE jobs SET completed_at = '${new Date(Date.now() - 20 * 60_000).toISOString()}' WHERE id = '${p2}';`);
r = await call(T.manager, 'POST', `/jobs/${p2}/void`, { reason: 'Too late to cancel' });
check('…but not 20 minutes after it was paid', r.status === 403 && /owner/.test(r.body?.message ?? ''), show(r));
r = await call(T.owner, 'POST', `/jobs/${p2}/void`, { reason: 'Owner cancels it' });
check('…the owner still can', r.status === 200 && r.body?.status === 'void', show(r));
const dayAfter = (await call(T.owner, 'GET', `/jobs/day?date=${date}`)).body?.jobs ?? [];
check('Cancelled washes stay in the day’s list, marked void, with who and why', [p1, p2].every((id) => dayAfter.find((j) => j.id === id)?.status === 'void'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
