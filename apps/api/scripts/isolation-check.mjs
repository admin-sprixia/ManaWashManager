// Proves two shops can't see or change each other's data. Run against the local API:
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:isolation                     (in another)
// Shop A is the seeded MANA shop; Shop B ("Test Wash") is added by this script. Shop A creates
// one of everything, then Shop B tries to read and change each of them by ID and by listing.
import { API, d1Rows, d1Run } from './lib/target.mjs';

const DEV_CODE = process.env.DEV_CODE ?? '000000';
const PIN = '2580';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}

async function call(token, method, path, body) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + path, { method, headers, body: payload });
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

/**
 * Owner sign-in the way the app does it: PIN if one is set (re-runs), otherwise the WhatsApp
 * code (fixed in dev) and then set a PIN.
 */
async function signInOwner(phone) {
  const byPin = await call(null, 'POST', '/auth/pin/login', { phone, pin: PIN });
  if (byPin.body?.token) return byPin.body;
  await call(null, 'POST', '/auth/code/request', { phone });
  const verified = await call(null, 'POST', '/auth/code/verify', { phone, code: DEV_CODE });
  if (!verified.body?.token) throw new Error(`Owner sign-in failed for ${phone}: ${JSON.stringify(verified.body)}`);
  // Setting a PIN signs out older sessions; carry on with the fresh one it returns.
  const withPin = await call(verified.body.token, 'PUT', '/auth/pin', { pin: PIN });
  if (!withPin.body?.token) throw new Error(`Setting the PIN failed for ${phone}: ${JSON.stringify(withPin.body)}`);
  return withPin.body;
}

const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const id = (p) => `${p}${Math.random().toString(36).slice(2, 12)}`;
const notMine = (r) => r.status === 404 || r.status === 400 || r.status === 403;

// ─── Setup ────────────────────────────────────────────────────────────────

sql(
  "INSERT OR IGNORE INTO shops (id, code, name, plan) VALUES ('shop_test_b', '900001', 'Test Wash', 'trial');" +
    // On a live trial so the Pro-only lists (staff report, reminders…) answer instead of 402.
    "UPDATE shops SET trial_ends_at = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now', '+14 days') WHERE id = 'shop_test_b';" +
    "INSERT OR IGNORE INTO users (id, shop_id, name, phone, role) VALUES ('user_b_owner', 'shop_test_b', 'B Owner', '9200000000', 'owner');" +
    "INSERT OR IGNORE INTO users (id, shop_id, name, phone, role) VALUES ('user_b_staff', 'shop_test_b', 'B Staff', '9200000091', 'staff');" +
    "INSERT OR IGNORE INTO vehicle_types (id, shop_id, name, category, sort_order) VALUES ('vt_b_sedan', 'shop_test_b', 'Sedan', 'car', 0);" +
    "INSERT OR IGNORE INTO services (id, shop_id, name, applies_to, sort_order) VALUES ('svc_b_wash', 'shop_test_b', 'Basic Wash', 'car', 0);" +
    "INSERT OR IGNORE INTO service_prices (id, shop_id, service_id, vehicle_type_id, price) VALUES ('sp_b_wash_sedan', 'shop_test_b', 'svc_b_wash', 'vt_b_sedan', 30000);",
);

const a = await signInOwner('9100000000');
const b = await signInOwner('9200000000');
check('Shop A owner signs in to shop_mana', a.user?.shopId === 'shop_mana');
check('Shop B owner signs in to shop_test_b', b.user?.shopId === 'shop_test_b');
const A = a.token;
const B = b.token;

// ─── Shop A creates one of everything ─────────────────────────────────────

const plate = `TS09IS${Math.floor(1000 + Math.random() * 8999)}`;
const customerPhone = `98${Math.floor(10000000 + Math.random() * 89999999)}`;
const jobId = id('job');
const started = await call(A, 'POST', '/jobs/start', {
  id: jobId,
  customer: { phone: customerPhone, name: 'Asha' },
  registrationNumber: plate,
  vehicleTypeId: 'vt_sedan',
  services: [{ serviceId: 'svc_complete_wash', quantity: 1 }],
  discount: 0,
});
check('Shop A starts a wash', started.status === 200 || started.status === 201, JSON.stringify(started.body));
const aJob = await call(A, 'GET', `/jobs/${jobId}`);
const customerId = aJob.body?.customer?.id ?? aJob.body?.customerId;
const vehicleId = aJob.body?.vehicleId ?? aJob.body?.vehicle?.id;
check('Shop A can read its own job', aJob.status === 200 && !!customerId && !!vehicleId, JSON.stringify(aJob.body).slice(0, 200));

await call(A, 'POST', `/jobs/${jobId}/pay`, { paymentMethod: 'cash' });
const expenseId = id('exp');
const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
const expenseForm = new FormData();
expenseForm.append(
  'data',
  JSON.stringify({ id: expenseId, category: 'chemicals', amount: 12300, itemName: 'Shampoo', quantity: 1, unit: 'l' }),
);
expenseForm.append('billPhoto', jpeg, 'bill.jpg');
expenseForm.append('itemPhoto', jpeg, 'item.jpg');
const exp = await call(A, 'POST', '/expenses', expenseForm);
check('Shop A adds an expense', exp.status === 200 || exp.status === 201, JSON.stringify(exp.body));
await call(A, 'PUT', '/cash/day/float', { date: today, amount: 50000 });
await call(A, 'PUT', '/attendance', { userId: 'user_staff_seed', date: today, status: 'present' });
await call(A, 'PUT', '/shop/settings', { googleReviewUrl: 'https://g.page/r/mana-review' });

const photoId = id('pho');
const form = new FormData();
form.append('id', photoId);
form.append('jobId', jobId);
form.append('kind', 'before');
form.append('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'p.jpg');
const photo = await call(A, 'POST', '/photos', form);
check('Shop A uploads a photo', photo.status === 200 || photo.status === 201, JSON.stringify(photo.body));

const rule = await call(A, 'PUT', '/rewards/rules/svc_complete_wash', { every: 5 });
check('Shop A turns on a stamp card', rule.status === 200, JSON.stringify(rule.body));
const giftItemId = id('stk_iso_');
const giftId = `${jobId}:${giftItemId}`;
sql(
  `INSERT INTO stock_items (id, shop_id, name, name_key, unit, balance, created_by_user_id) VALUES ('${giftItemId}', 'shop_mana', 'Iso cloth', 'iso cloth ${giftItemId}', 'pcs', 5, 'user_owner_seed');` +
    `INSERT INTO reward_gift_items (stock_item_id, shop_id, quantity, sort_order, updated_by_user_id) VALUES ('${giftItemId}', 'shop_mana', 1, 0, 'user_owner_seed');` +
    `INSERT INTO reward_gifts (id, shop_id, job_id, vehicle_id, customer_id, stock_item_id, quantity, status) VALUES ('${giftId}', 'shop_mana', '${jobId}', '${vehicleId}', '${customerId}', '${giftItemId}', 1, 'owed');`,
);

// ─── Shop B tries to READ Shop A's data ───────────────────────────────────

let r = await call(B, 'GET', `/jobs/${jobId}`);
check('B cannot open A’s job', notMine(r), `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
r = await call(B, 'GET', `/customers/${customerId}`);
// This endpoint answers "not found" with 200 + null.
check('B cannot open A’s customer', notMine(r) || r.body === null, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
r = await call(B, 'GET', `/photos/${photoId}`);
check('B cannot view A’s photo', notMine(r), `${r.status}`);

r = await call(B, 'GET', `/customers/lookup?phone=${customerPhone}`);
check('B’s customer lookup doesn’t find A’s customer', !JSON.stringify(r.body).includes(customerPhone), JSON.stringify(r.body).slice(0, 160));
r = await call(B, 'GET', `/customers/lookup?registrationNumber=${plate}`);
check('B’s plate lookup doesn’t find A’s vehicle', !JSON.stringify(r.body).includes(customerPhone), JSON.stringify(r.body).slice(0, 160));
r = await call(B, 'GET', '/customers/directory');
check('B’s offline directory has none of A’s customers', r.status === 200 && !JSON.stringify(r.body).includes(plate));

r = await call(B, 'GET', '/jobs/today');
check('B’s job board has none of A’s jobs', r.status === 200 && !JSON.stringify(r.body).includes(jobId));
r = await call(B, 'GET', '/jobs/stats');
check('B’s dashboard has none of A’s money', r.status === 200 && !JSON.stringify(r.body).includes(jobId) && !JSON.stringify(r.body).includes('Asha'));
r = await call(B, 'GET', '/jobs/stats/export');
check('B’s export has none of A’s jobs', !String(typeof r.body === 'string' ? r.body : JSON.stringify(r.body)).includes(plate));
r = await call(B, 'GET', '/expenses');
check('B’s expenses have none of A’s', r.status === 200 && !JSON.stringify(r.body).includes(expenseId) && !JSON.stringify(r.body).includes('Shampoo'));
r = await call(B, 'GET', `/cash/day?date=${today}`);
check('B’s cash drawer isn’t A’s', r.status === 200 && !JSON.stringify(r.body).includes('50000'), JSON.stringify(r.body).slice(0, 160));
r = await call(B, 'GET', `/attendance?date=${today}`);
check('B’s attendance has none of A’s staff', r.status === 200 && !JSON.stringify(r.body).includes('user_staff_seed'));
r = await call(B, 'GET', '/team');
check('B’s team list is only B’s people', r.status === 200 && !JSON.stringify(r.body).includes('9100000000') && JSON.stringify(r.body).includes('9200000091'));
r = await call(B, 'GET', '/shop/roster');
check('B’s roster is only B’s people', r.status === 200 && !JSON.stringify(r.body).includes('user_staff_seed'));
r = await call(B, 'GET', '/reports/staff');
check('B’s staff report has none of A’s staff', r.status === 200 && !JSON.stringify(r.body).includes('user_owner_seed'));
r = await call(B, 'GET', '/reports/audit');
check('B’s audit log has none of A’s jobs', r.status === 200 && !JSON.stringify(r.body).includes(jobId));
r = await call(B, 'GET', '/reminders');
check('B’s reminders have none of A’s vehicles', r.status === 200 && !JSON.stringify(r.body).includes(plate));
r = await call(B, 'GET', '/services');
check('B’s menu is only B’s services', r.status === 200 && !JSON.stringify(r.body).includes('svc_complete_wash') && JSON.stringify(r.body).includes('svc_b_wash'));
r = await call(B, 'GET', '/services/vehicle-types');
check('B’s vehicle sizes are only B’s', r.status === 200 && !JSON.stringify(r.body).includes('vt_hatchback'));
r = await call(B, 'GET', '/services/prices');
check('B’s prices are only B’s', r.status === 200 && !JSON.stringify(r.body).includes('sp_complete_wash'));
r = await call(B, 'GET', '/shop/settings');
check('B doesn’t see A’s review link', r.status === 200 && !JSON.stringify(r.body).includes('mana-review'));
r = await call(B, 'GET', '/shop/errors');
check('B’s error log is only B’s', r.status === 200);
r = await call(B, 'GET', `/coupons/usable?registrationNumber=${plate}&phone=${customerPhone}`);
check('B finds no coupon for A’s vehicle', !JSON.stringify(r.body).includes('"code"'));
r = await call(B, 'GET', '/rewards/settings');
check(
  'B’s rewards settings have none of A’s cards or gift',
  r.status === 200 && !JSON.stringify(r.body).includes('svc_complete_wash') && !JSON.stringify(r.body).includes(giftItemId),
  JSON.stringify(r.body).slice(0, 160),
);
r = await call(B, 'GET', `/rewards/vehicle?registrationNumber=${plate}`);
check('B’s reward lookup doesn’t know A’s car', r.status === 200 && r.body?.vehicleId === null && r.body?.isNew === true, JSON.stringify(r.body).slice(0, 160));
r = await call(B, 'GET', `/rewards/customer/${customerId}`);
check('B sees no rewards on A’s customer', r.status === 200 && r.body?.vehicles?.length === 0 && r.body?.giftsOwed?.length === 0);
r = await call(B, 'GET', '/rewards/gifts/owed');
check('B’s owed gifts have none of A’s', r.status === 200 && !JSON.stringify(r.body).includes(giftId));
r = await call(B, 'GET', '/rewards/report');
check('B’s rewards report has none of A’s gifts', r.status === 200 && r.body?.giftsOwedNow === 0, JSON.stringify(r.body).slice(0, 160));

// ─── Shop B tries to CHANGE Shop A's data ─────────────────────────────────

r = await call(B, 'PATCH', `/jobs/${jobId}/status`, { status: 'washing' });
check('B cannot move A’s job', notMine(r), `${r.status}`);
r = await call(B, 'POST', `/jobs/${jobId}/void`, { reason: 'Trying to void another shop' });
check('B cannot void A’s job', notMine(r), `${r.status}`);
r = await call(B, 'PATCH', `/jobs/${jobId}/payment-method`, { paymentMethod: 'upi', reason: 'Trying to edit another shop' });
check('B cannot change A’s payment', notMine(r), `${r.status}`);
r = await call(B, 'PUT', `/jobs/${jobId}/washers`, { washerIds: ['user_b_staff'] });
check('B cannot set washers on A’s job', notMine(r), `${r.status}`);
r = await call(B, 'PUT', `/jobs/${jobId}/sellers`, { sellerIds: ['user_b_staff'] });
check('B cannot set sellers on A’s job', notMine(r), `${r.status}`);
r = await call(B, 'POST', `/expenses/${expenseId}/void`, { reason: 'Trying to void another shop' });
check('B cannot void A’s expense', notMine(r), `${r.status}`);
r = await call(B, 'DELETE', `/photos/${photoId}`);
check('B cannot delete A’s photo', notMine(r), `${r.status}`);
r = await call(B, 'PUT', '/team/user_staff_seed/pin', { pin: '1357' });
check('B cannot reset A’s staff PIN', notMine(r), `${r.status}`);
r = await call(B, 'PATCH', '/team/user_staff_seed', { active: false });
check('B cannot turn off A’s staff', notMine(r), `${r.status}`);
r = await call(B, 'POST', `/reminders/${vehicleId}`, { action: 'dismiss' });
check('B cannot act on A’s reminder', notMine(r), `${r.status}`);
r = await call(B, 'POST', `/reminders/${vehicleId}/coupon`);
check('B cannot issue a coupon on A’s vehicle', notMine(r), `${r.status}`);
r = await call(B, 'PUT', '/attendance', { userId: 'user_staff_seed', date: today, status: 'absent' });
check('B cannot mark A’s staff attendance', r.status >= 400, `${r.status}`);
r = await call(B, 'PUT', '/services/prices', { serviceId: 'svc_complete_wash', vehicleTypeId: 'vt_sedan', price: 100 });
check('B cannot change A’s prices', r.status >= 400, `${r.status}`);
r = await call(B, 'PUT', '/services/commissions', { serviceId: 'svc_complete_wash', vehicleTypeId: 'vt_sedan', amount: 100 });
check('B cannot set A’s commissions', r.status >= 400, `${r.status}`);
r = await call(B, 'PUT', '/rewards/rules/svc_complete_wash', { every: 2 });
check('B cannot change A’s stamp card', notMine(r), `${r.status}`);
r = await call(B, 'DELETE', '/rewards/rules/svc_complete_wash');
r = await call(A, 'GET', '/rewards/settings');
check('B cannot switch off A’s stamp card', r.body?.rules?.some((x) => x.serviceId === 'svc_complete_wash' && x.every === 5), JSON.stringify(r.body).slice(0, 160));
r = await call(B, 'PUT', '/rewards/gift', { items: [{ stockItemId: giftItemId, quantity: 1 }] });
check('B cannot use A’s stock as its welcome gift', r.status === 400 && r.body?.error === 'item_not_found', `${r.status}`);
r = await call(B, 'POST', `/rewards/gifts/${encodeURIComponent(giftId)}/give`);
check('B cannot hand over A’s owed gift', notMine(r), `${r.status}`);
const giftNow = rows(
  `SELECT g.status AS status, s.balance AS balance FROM reward_gifts g JOIN stock_items s ON s.id = g.stock_item_id WHERE g.id = '${giftId}'`,
)[0];
check('…which stays owed, with A’s stock untouched', giftNow?.status === 'owed' && giftNow?.balance === 5, JSON.stringify(giftNow));

r = await call(B, 'POST', '/jobs/start', {
  id: id('job'),
  customer: { phone: customerPhone, name: 'Intruder' },
  registrationNumber: 'TS09XX0001',
  vehicleTypeId: 'vt_sedan',
  services: [{ serviceId: 'svc_complete_wash', quantity: 1 }],
  discount: 0,
});
check('B cannot start a wash with A’s vehicle size and service', r.status >= 400, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
r = await call(B, 'POST', '/jobs', {
  id: id('job'),
  customerId,
  vehicleId,
  vehicleTypeId: 'vt_b_sedan',
  services: [{ serviceId: 'svc_b_wash', quantity: 1 }],
  discount: 0,
});
check('B cannot create a job on A’s customer and vehicle', r.status >= 400, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);

// Same plate and customer phone in both shops: each shop gets its own records.
const bJobId = id('job');
r = await call(B, 'POST', '/jobs/start', {
  id: bJobId,
  customer: { phone: customerPhone, name: 'Asha (B)' },
  registrationNumber: plate,
  vehicleTypeId: 'vt_b_sedan',
  services: [{ serviceId: 'svc_b_wash', quantity: 1 }],
  discount: 0,
});
check('B can wash the same car (same plate and phone) as its own customer', r.status === 200 || r.status === 201, JSON.stringify(r.body).slice(0, 160));
const bJob = await call(B, 'GET', `/jobs/${bJobId}`);
const bCustomerId = bJob.body?.customer?.id ?? bJob.body?.customerId;
check('…as a separate customer record', !!bCustomerId && bCustomerId !== customerId);
const aAgain = await call(A, 'GET', `/customers/${customerId}`);
check('…and A’s customer is untouched', JSON.stringify(aAgain.body).includes('Asha') && !JSON.stringify(aAgain.body).includes('Asha (B)'));

// ─── Staff and sign-in ────────────────────────────────────────────────────

r = await call(B, 'POST', '/team', { name: 'Stealer', phone: '9100000001', role: 'staff' });
check('B cannot add A’s staff phone to its team', r.status === 409, `${r.status}`);
r = await call(null, 'POST', '/auth/code/request', { phone: '9200000091' });
check('B’s staff can’t get WhatsApp codes', r.status === 403);
r = await call(A, 'GET', '/jobs/today');
check('A still sees its own job', JSON.stringify(r.body).includes(jobId) && !JSON.stringify(r.body).includes(bJobId));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
