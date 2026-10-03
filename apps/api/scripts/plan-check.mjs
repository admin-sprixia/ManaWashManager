// Proves the Free / Pro rules hold on the server, whatever the phone does. Run against the local API:
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:plans                         (in another)
// Adds a fresh Free shop each run (owner + two staff), then checks the Pro-only features, the
// staff seat lock, the monthly wash limit and the report window — before and after Pro, through
// payment grace, and after a cancelled plan runs out. The webhook signature is always checked;
// set RAZORPAY_WEBHOOK_SECRET in this shell (same value as .dev.vars) to also check a signed event.
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { API, apiFetch, d1Run } from './lib/target.mjs';

const DEV_CODE = process.env.DEV_CODE ?? '000000';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';
const PIN = '2580';
const FREE_WASHES = 300;
const OFFLINE_GRACE = 25;

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}

async function call(token, method, path, body, extraHeaders = {}) {
  const headers = { ...extraHeaders, ...(token ? { authorization: `Bearer ${token}` } : {}) };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (typeof body === 'string') payload = body;
  else if (body !== undefined) {
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

// ─── Stand-in Razorpay ─────────────────────────────────────────────────────
// The checkout checks need Razorpay's API. Start the local API with a test key pointed here:
//   npx wrangler dev --var RAZORPAY_KEY_ID:rzp_test_standin --var RAZORPAY_KEY_SECRET:standin \
//     --var RAZORPAY_API_BASE:http://127.0.0.1:8799/v1
// Every call waits a little, like a real network round trip, so races have room to happen.

const standin = { subs: new Map(), refunds: new Set(), n: 0 };
const standinServer = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const send = (status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const missing = () => send(400, { error: { description: 'The id provided does not exist' } });
  await new Promise((r) => setTimeout(r, 40));
  const url = req.url ?? '';
  let m;
  if (req.method === 'POST' && url === '/v1/plans') return send(200, { id: `plan_standin${++standin.n}` });
  if (req.method === 'POST' && url === '/v1/subscriptions') {
    const id = `sub_standin${++standin.n}`;
    const sub = {
      id,
      plan_id: body.plan_id,
      status: 'created',
      paid_count: 0,
      current_start: null,
      current_end: null,
      start_at: body.start_at ?? null,
      charge_at: body.start_at ?? null,
      short_url: `https://rzp.io/standin/${id}`,
      notes: body.notes,
    };
    standin.subs.set(id, sub);
    return send(200, sub);
  }
  if (req.method === 'POST' && (m = url.match(/^\/v1\/subscriptions\/([^/]+)\/cancel$/))) {
    const sub = standin.subs.get(decodeURIComponent(m[1]));
    if (!sub) return missing();
    sub.status = 'cancelled';
    return send(200, sub);
  }
  if (req.method === 'GET' && (m = url.match(/^\/v1\/subscriptions\/([^/]+)$/))) {
    const sub = standin.subs.get(decodeURIComponent(m[1]));
    return sub ? send(200, sub) : missing();
  }
  if (req.method === 'POST' && (m = url.match(/^\/v1\/payments\/([^/]+)\/refund$/))) {
    standin.refunds.add(decodeURIComponent(m[1]));
    return send(200, { id: `rfnd_${m[1]}` });
  }
  return send(404, { error: { description: 'not handled by the stand-in' } });
});
await new Promise((resolve, reject) => {
  standinServer.once('error', reject);
  standinServer.listen(8799, '127.0.0.1', resolve);
});

/** Delivers a webhook signed like Razorpay does, with a fresh event id. */
function signedWebhook(eventObj) {
  const body = JSON.stringify(eventObj);
  return call(null, 'POST', '/billing/webhook', body, {
    'content-type': 'application/json',
    'x-razorpay-signature': createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex'),
    'x-razorpay-event-id': `evt_${Math.random().toString(36).slice(2, 14)}`,
  });
}

const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`;
const rand = (digits) => String(Math.floor(10 ** (digits - 1) + Math.random() * 9 * 10 ** (digits - 1)));
const id = (p) => `${p}${Math.random().toString(36).slice(2, 12)}`;
const isoIn = (days) => `strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now', '${days >= 0 ? '+' : ''}${days} days')`;
const proBlocked = (r, feature) => r.status === 402 && r.body?.error === 'plan_required' && r.body?.feature === feature;

// ─── Setup: a Free shop with an owner and two staff ───────────────────────

const run = rand(6);
const SHOP = `shop_plan_${run}`;
const ownerPhone = `93${rand(8)}`;
const staff1Phone = `93${rand(8)}`;
const staff2Phone = `93${rand(8)}`;
const OWNER = `user_plan_owner_${run}`;
const STAFF1 = `user_plan_s1_${run}`;
const STAFF2 = `user_plan_s2_${run}`;

function setPlan(plan, { trialDays = null, paidDays = null } = {}) {
  sql(
    `UPDATE shops SET plan = '${plan}', ` +
      `trial_ends_at = ${trialDays == null ? 'NULL' : isoIn(trialDays)}, ` +
      `paid_until = ${paidDays == null ? 'NULL' : isoIn(paidDays)} WHERE id = '${SHOP}';`,
  );
}

sql(
  `INSERT INTO shops (id, code, name, plan) VALUES ('${SHOP}', '${rand(6)}', 'Plan Check Wash', 'free');` +
    // Fixed join dates so seat order is certain: owner, then staff 1, then staff 2.
    `INSERT INTO users (id, shop_id, name, phone, role, created_at) VALUES ('${OWNER}', '${SHOP}', 'Plan Owner', '${ownerPhone}', 'owner', '2026-01-01T00:00:00.000+00:00');` +
    `INSERT INTO users (id, shop_id, name, phone, role, created_at) VALUES ('${STAFF1}', '${SHOP}', 'First Staff', '${staff1Phone}', 'staff', '2026-01-02T00:00:00.000+00:00');` +
    `INSERT INTO users (id, shop_id, name, phone, role, created_at) VALUES ('${STAFF2}', '${SHOP}', 'Second Staff', '${staff2Phone}', 'staff', '2026-01-03T00:00:00.000+00:00');` +
    `INSERT INTO vehicle_types (id, shop_id, name, category, sort_order) VALUES ('vt_plan_${run}', '${SHOP}', 'Sedan', 'car', 0);` +
    `INSERT INTO services (id, shop_id, name, applies_to, sort_order) VALUES ('svc_plan_${run}', '${SHOP}', 'Basic Wash', 'car', 0);` +
    `INSERT INTO service_prices (id, shop_id, service_id, vehicle_type_id, price) VALUES ('sp_plan_${run}', '${SHOP}', 'svc_plan_${run}', 'vt_plan_${run}', 30000);`,
);

await call(null, 'POST', '/auth/code/request', { phone: ownerPhone });
const verified = await call(null, 'POST', '/auth/code/verify', { phone: ownerPhone, code: DEV_CODE });
const withPin = verified.body?.token ? await call(verified.body.token, 'PUT', '/auth/pin', { pin: PIN }) : verified;
const O = withPin.body?.token;
check('Owner signs in to the Free shop', !!O && withPin.body?.user?.shopId === SHOP, show(withPin));
if (!O) process.exit(1);

let r = await call(O, 'PUT', `/team/${STAFF1}/pin`, { pin: '4826' });
check('Owner can set staff 1’s PIN', r.status === 200, show(r));
r = await call(O, 'PUT', `/team/${STAFF2}/pin`, { pin: '7351' });
check('Owner can set staff 2’s PIN', r.status === 200, show(r));

const startWash = (token, extra = {}) =>
  call(token, 'POST', '/jobs/start', {
    id: id('job'),
    customer: { phone: `98${rand(8)}`, name: 'Plan Customer' },
    registrationNumber: `TS09PC${rand(4)}`,
    vehicleTypeId: `vt_plan_${run}`,
    services: [{ serviceId: `svc_plan_${run}`, quantity: 1 }],
    discount: 0,
    ...extra,
  });

// ─── Free: what the plan says ─────────────────────────────────────────────

r = await call(O, 'GET', '/billing/plan');
check(
  'Plan reads Free with 1 staff, 300 washes and 7 days of reports',
  r.status === 200 &&
    r.body.tier === 'free' &&
    r.body.limits?.staff === 1 &&
    r.body.limits?.washesPerMonth === FREE_WASHES &&
    r.body.limits?.reportDays === 7,
  show(r),
);
r = await call(O, 'GET', '/billing');
check(
  'Owner’s plan screen offers Pro with founder price while slots last',
  r.status === 200 && typeof r.body.offer?.monthlyPaise === 'number' && Array.isArray(r.body.payments),
  show(r),
);

// ─── Free: Pro features are refused with 402 ──────────────────────────────

const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const gated = [
  ['GET', '/reminders', 'reminders'],
  ['GET', '/expenses', 'expenses'],
  ['GET', `/cash/day?date=${today}`, 'cashDrawer'],
  ['GET', `/attendance?date=${today}`, 'attendance'],
  ['GET', '/stock', 'inventory'],
  ['GET', '/coupons/usable?registrationNumber=TS09AA0001&phone=9800000000', 'coupons'],
  ['GET', '/reports/staff', 'staffReport'],
  ['GET', '/reports/audit', 'auditTrail'],
  ['GET', '/jobs/stats/export', 'pdfExport'],
  ['GET', '/shop/me/earnings?range=today', 'commission'],
  ['GET', '/rewards/settings', 'rewards'],
];
for (const [method, path, feature] of gated) {
  r = await call(O, method, path);
  check(`Free: ${path.split('?')[0]} needs Pro (${feature})`, proBlocked(r, feature), show(r));
}
r = await call(O, 'PUT', '/services/commissions', {
  serviceId: `svc_plan_${run}`,
  vehicleTypeId: `vt_plan_${run}`,
  amount: 5000,
});
check('Free: setting a staff commission needs Pro', proBlocked(r, 'commission'), show(r));

r = await call(O, 'GET', '/jobs/stats?range=week');
check('Free: last 7 days report works', r.status === 200, show(r));
const monthAgo = new Date(Date.now() + 5.5 * 3600 * 1000 - 30 * 86400000).toISOString().slice(0, 10);
r = await call(O, 'GET', `/jobs/stats?range=custom&from=${monthAgo}&to=${today}`);
check('Free: a 30-day report needs Pro', proBlocked(r, 'fullReports'), show(r));

const firstWash = await startWash(O);
check('Free: owner starts a wash', firstWash.status === 200 || firstWash.status === 201, show(firstWash));
const photo = new FormData();
photo.append('id', id('pho'));
photo.append('jobId', firstWash.body?.id ?? '');
photo.append('kind', 'before');
photo.append('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'p.jpg');
r = await call(O, 'POST', '/photos', photo);
check('Free: wash photos need Pro', proBlocked(r, 'photos'), show(r));

// ─── Free: one staff seat ─────────────────────────────────────────────────

r = await call(O, 'GET', '/team');
const members = Array.isArray(r.body) ? r.body : (r.body?.members ?? []);
const lockFlag = (uid) => members.find((m) => m.id === uid)?.seatLocked;
check(
  'Team list marks only the newest staff as locked',
  lockFlag(OWNER) === false && lockFlag(STAFF1) === false && lockFlag(STAFF2) === true,
  JSON.stringify(members.map((m) => [m.name, m.seatLocked])),
);
r = await call(null, 'POST', '/auth/pin/login', { phone: staff1Phone, pin: '4826' });
check('Free: the longest-serving staff still signs in', r.status === 200 && !!r.body?.token, show(r));
const S1 = r.body?.token;
r = await call(null, 'POST', '/auth/pin/login', { phone: staff2Phone, pin: '7351' });
check('Free: staff past the seat limit can’t sign in', r.status === 403 && r.body?.error === 'plan_seat_locked', show(r));
r = await call(O, 'POST', '/team', { name: 'One Too Many', phone: `93${rand(8)}`, role: 'staff' });
check('Free: adding another person is refused', r.status === 402 && r.body?.error === 'plan_staff_limit', show(r));
r = await call(O, 'PATCH', `/team/${STAFF2}`, { role: 'owner' });
check('Free: can’t dodge the limit by making locked staff an owner', r.status === 402, show(r));
r = await call(S1, 'GET', '/billing');
check('Staff can’t open the owner’s billing screen', r.status === 403, show(r));
r = await call(S1, 'GET', '/billing/plan');
check('Staff can read the plan (for the right screens)', r.status === 200 && r.body?.tier === 'free', show(r));

// ─── Free: 300 washes a month ─────────────────────────────────────────────

const job = await call(O, 'GET', `/jobs/${firstWash.body?.id}`);
const customerId = job.body?.customer?.id ?? job.body?.customerId;
const vehicleId = job.body?.vehicleId ?? job.body?.vehicle?.id;
// One wash is already in; fill the month up to the limit directly in the database.
sql(
  `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${FREE_WASHES - 1}) ` +
    `INSERT INTO jobs (id, shop_id, customer_id, vehicle_id, created_by_user_id, status, subtotal, discount, total) ` +
    `SELECT 'job_fill_${run}_' || i, '${SHOP}', '${customerId}', '${vehicleId}', '${OWNER}', 'paid', 30000, 0, 30000 FROM n;`,
);
r = await call(O, 'GET', '/billing/plan');
check('Usage counts this month’s washes', r.body?.usage?.washesThisMonth === FREE_WASHES, show(r));
r = await startWash(O);
check('Free: wash #301 entered live is refused', r.status === 402 && r.body?.error === 'plan_wash_limit', show(r));
r = await startWash(S1);
check('…for staff too', r.status === 402 && r.body?.error === 'plan_wash_limit', show(r));
const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
r = await startWash(S1, { occurredAt: tenMinAgo });
check('Free: a wash done offline before the phone knew still syncs', r.status === 200 || r.status === 201, show(r));
sql(
  `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${OFFLINE_GRACE}) ` +
    `INSERT INTO jobs (id, shop_id, customer_id, vehicle_id, created_by_user_id, status, subtotal, discount, total) ` +
    `SELECT 'job_grace_${run}_' || i, '${SHOP}', '${customerId}', '${vehicleId}', '${OWNER}', 'paid', 30000, 0, 30000 FROM n;`,
);
r = await startWash(S1, { occurredAt: tenMinAgo });
check('…but only up to a small cushion', r.status === 402 && r.body?.error === 'plan_wash_limit', show(r));
r = await call(O, 'PATCH', `/jobs/${firstWash.body?.id}/status`, { status: 'washing' });
check('Free at the limit: washes already started can still be finished', r.status === 200, show(r));

// ─── Pro: everything opens up ─────────────────────────────────────────────

setPlan('active', { paidDays: 30 });
r = await call(O, 'GET', '/billing/plan');
check('Paid shop reads Pro with 5 staff and unlimited washes', r.body?.tier === 'pro' && r.body?.limits?.staff === 5 && r.body?.limits?.washesPerMonth === null, show(r));
r = await call(null, 'POST', '/auth/pin/login', { phone: staff2Phone, pin: '7351' });
check('Pro: the locked staff signs in again', r.status === 200 && !!r.body?.token, show(r));
const S2 = r.body?.token;
r = await startWash(O);
check('Pro: washes past 300 are fine', r.status === 200 || r.status === 201, show(r));
for (const [method, path, feature] of gated) {
  r = await call(O, method, path);
  check(`Pro: ${path.split('?')[0]} opens (${feature})`, r.status === 200, show(r));
}
r = await call(O, 'GET', `/jobs/stats?range=custom&from=${monthAgo}&to=${today}`);
check('Pro: a 30-day report works', r.status === 200, show(r));

// ─── Payment failed: 3 days of grace, then Free ───────────────────────────

setPlan('past_due', { paidDays: -1 });
r = await call(O, 'GET', '/billing/plan');
check('Renewal failing: still Pro during grace', r.body?.tier === 'pro' && r.body?.state === 'grace', show(r));
r = await call(S2, 'GET', '/jobs/today');
check('…and every staff keeps working', r.status === 200, show(r));
setPlan('past_due', { paidDays: -4 });
r = await call(O, 'GET', '/billing/plan');
check('Grace over: back to Free', r.body?.tier === 'free', show(r));
r = await call(S2, 'GET', '/jobs/today');
check('Back on Free: the newest staff’s open session ends', r.status === 403 && r.body?.error === 'plan_seat_locked', show(r));
r = await call(S1, 'GET', '/jobs/today');
check('…while the longest-serving staff carries on', r.status === 200, show(r));

// ─── Cancelled: Pro until the paid period ends, no grace after ────────────

setPlan('cancelled', { paidDays: 5 });
r = await call(O, 'GET', '/billing/plan');
check('Cancelled: Pro until the paid days run out', r.body?.tier === 'pro', show(r));
setPlan('cancelled', { paidDays: -1 });
r = await call(O, 'GET', '/billing/plan');
check('Cancelled and run out: Free straight away (no grace)', r.body?.tier === 'free', show(r));

// ─── Trial ────────────────────────────────────────────────────────────────

setPlan('trial', { trialDays: 3 });
r = await call(O, 'GET', '/billing/plan');
check('Trial: Pro with days left', r.body?.tier === 'pro' && r.body?.state === 'trial' && r.body?.daysLeft === 3, show(r));
setPlan('trial', { trialDays: -1 });
r = await call(O, 'GET', '/billing/plan');
check('Trial ended without paying: Free', r.body?.tier === 'free', show(r));

// ─── Another branch: paid Pro only, and no second trial ───────────────────

r = await call(O, 'POST', '/auth/shops', { shopName: 'Plan Check Branch' });
check('Free: opening another branch needs Pro', proBlocked(r, 'branches'), show(r));
setPlan('trial', { trialDays: 5 });
r = await call(O, 'POST', '/auth/shops', { shopName: 'Plan Check Branch' });
check('Trial: opening another branch still needs paid Pro', proBlocked(r, 'branches'), show(r));
setPlan('active', { paidDays: 30 });
r = await call(O, 'POST', '/auth/shops', { shopName: 'Plan Check Branch' });
check('Paid Pro: the owner opens another branch', r.status === 201 && !!r.body?.token, show(r));
const B = r.body?.token;
const branch = B ? await call(B, 'GET', '/billing/plan') : r;
check('…which starts on Free, with no new trial', branch.body?.tier === 'free' && branch.body?.state === 'free', show(branch));

// ─── Branch price: ₹349 while another of the owner's shops is on paid Pro ──

r = B ? await call(B, 'GET', '/billing') : r;
check(
  'Branch is offered the branch price (₹349 / ₹3,490)',
  r.status === 200 && r.body.offer?.kind === 'branch' && r.body.offer?.monthlyPaise === 34900 && r.body.offer?.yearlyPaise === 349000,
  show(r),
);
r = await call(O, 'GET', '/billing');
check('…but the paid shop itself isn’t (its other shop is on Free)', r.status === 200 && r.body.offer?.kind !== 'branch', show(r));
setPlan('trial', { trialDays: 5 });
r = B ? await call(B, 'GET', '/billing') : r;
check('Other shop only on a trial: no branch price', r.status === 200 && r.body.offer?.kind !== 'branch', show(r));
setPlan('free');
r = B ? await call(B, 'GET', '/billing') : r;
check('Other shop back on Free: no branch price', r.status === 200 && r.body.offer?.kind !== 'branch', show(r));

// ─── Founder price: ₹399 for the first 50, then ₹499 — held slots count ───
// The branch (B) is a plain Free shop now, so it shows what a new owner would be offered.

const FOUNDER_SLOTS = 50;
const fillers = Array.from({ length: FOUNDER_SLOTS }, (_, i) => `shop_fdr_${run}_${i}`);
const offerFor = async (token) => (await call(token, 'GET', '/billing')).body?.offer;
const clearFillers = () => sql(`DELETE FROM shops WHERE id LIKE 'shop_fdr_${run}_%';`);

let offer = B ? await offerFor(B) : null;
const slotsAtStart = offer?.founderSlotsLeft ?? 0;
if (slotsAtStart === FOUNDER_SLOTS) {
  check('Founder price while slots last (₹399 / ₹3,990)', offer?.kind === 'founder' && offer?.monthlyPaise === 39900 && offer?.yearlyPaise === 399000, JSON.stringify(offer));

  sql(fillers.map((f) => `INSERT INTO shops (id, code, name, plan, founder_at) VALUES ('${f}', '${rand(6)}', 'Founder Filler', 'active', ${isoIn(-1)});`).join(''));
  offer = await offerFor(B);
  check('Shop 51 gets the regular price automatically (₹499 / ₹4,999)', offer?.kind === 'regular' && offer?.monthlyPaise === 49900 && offer?.yearlyPaise === 499900 && offer?.founderSlotsLeft === 0, JSON.stringify(offer));

  sql(`UPDATE shops SET founder_at = NULL, founder_hold_until = ${isoIn(-1)} WHERE id = '${fillers[0]}';`);
  offer = await offerFor(B);
  check('An expired hold frees its slot', offer?.kind === 'founder' && offer?.founderSlotsLeft === 1, JSON.stringify(offer));

  sql(`UPDATE shops SET founder_hold_until = ${isoIn(1)} WHERE id = '${fillers[0]}';`);
  offer = await offerFor(B);
  check('A slot held for a pending payment counts as taken', offer?.kind === 'regular', JSON.stringify(offer));

  sql(`UPDATE shops SET founder_hold_until = ${isoIn(1)} WHERE id = '${SHOP}';`);
  r = await call(O, 'GET', '/billing');
  check('…while the shop holding it is still offered the founder price', r.body?.offer?.kind === 'founder', show(r));
  sql(`UPDATE shops SET founder_hold_until = NULL WHERE id = '${SHOP}';`);

  if (WEBHOOK_SECRET) {
    // 49 taken; the main shop approves founder AutoPay with its first charge 10 days away.
    sql(`DELETE FROM shops WHERE id = '${fillers[0]}';`);
    const subId = `sub_fdrcheck${run}`;
    const founderSub = (status) => ({
      id: subId,
      plan_id: 'plan_check',
      status,
      paid_count: 0,
      total_count: 120,
      current_start: null,
      current_end: null,
      charge_at: Math.floor(Date.now() / 1000) + 10 * 86400,
      notes: { shop_id: SHOP, founder: '1', interval: 'monthly', amount_paise: '39900' },
    });
    r = await signedWebhook({ event: 'subscription.authenticated', payload: { subscription: { entity: founderSub('authenticated') } } });
    offer = await offerFor(B);
    check('AutoPay approved, first charge at trial end: slot held until then', r.status === 200 && offer?.kind === 'regular', `${show(r)} ${JSON.stringify(offer)}`);
    r = await signedWebhook({ event: 'subscription.cancelled', payload: { subscription: { entity: founderSub('cancelled') } } });
    offer = await offerFor(B);
    check('Cancelled before paying: the slot is given back', r.status === 200 && offer?.kind === 'founder', `${show(r)} ${JSON.stringify(offer)}`);
  } else {
    console.log('SKIP  Founder slot held by AutoPay webhook (set RAZORPAY_WEBHOOK_SECRET)');
  }
  clearFillers();
} else {
  console.log(`SKIP  Founder slot checks (this database already has ${FOUNDER_SLOTS - slotsAtStart} founders; run on a fresh one)`);
}

// ─── Checkout worst cases (against the stand-in Razorpay) ─────────────────

/** A new Free shop with a signed-in owner. */
async function newOwnerShop(label) {
  const shopId = `shop_${label}_${run}`;
  const phone = `94${rand(8)}`;
  sql(
    `INSERT INTO shops (id, code, name, plan) VALUES ('${shopId}', '${rand(6)}', 'Checkout ${label}', 'free');` +
      `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('user_${label}_${run}', '${shopId}', 'Owner ${label}', '${phone}', 'owner');`,
  );
  await call(null, 'POST', '/auth/code/request', { phone });
  const v = await call(null, 'POST', '/auth/code/verify', { phone, code: DEV_CODE });
  const p = v.body?.token ? await call(v.body.token, 'PUT', '/auth/pin', { pin: PIN }) : v;
  return { shopId, token: p.body?.token };
}
const openLinks = (shopId) => [...standin.subs.values()].filter((s) => s.notes?.shop_id === shopId && s.status !== 'cancelled');
const subscribe = (token, interval = 'monthly') => call(token, 'POST', '/billing/subscribe', { interval });

const probe = await newOwnerShop('probe');
let probeBilling = probe.token ? (await call(probe.token, 'GET', '/billing')).body : null;
const takenNow = probeBilling ? FOUNDER_SLOTS - probeBilling.offer.founderSlotsLeft : FOUNDER_SLOTS;
if (!probeBilling?.configured) {
  console.log('SKIP  Checkout worst cases (start the API with the stand-in Razorpay — see the top of this file)');
} else if (takenNow > FOUNDER_SLOTS - 1) {
  console.log('SKIP  Checkout worst cases (no founder spot left in this database; run on a fresh one)');
} else {
  // 49 spots taken; two owners tap Upgrade for the 50th at the same moment.
  sql(
    fillers
      .slice(0, FOUNDER_SLOTS - 1 - takenNow)
      .map((f) => `INSERT INTO shops (id, code, name, plan, founder_at) VALUES ('${f}', '${rand(6)}', 'Founder Filler', 'active', ${isoIn(-1)});`)
      .join('') || 'SELECT 1;',
  );
  // A crowd for the last spot: eight owners tap Upgrade at the same moment. Exactly one may get
  // it — never two (oversold), never none (lost).
  const crowd = [];
  for (let i = 0; i < 8; i++) crowd.push(await newOwnerShop(`crowd${i}`));
  const crowdRes = await Promise.all(crowd.map((s) => subscribe(s.token)));
  const crowdFounders = crowdRes.filter((x) => x.status === 200 && x.body?.kind === 'founder').length;
  check(
    'Eight owners take the last founder spot at once: exactly one gets it, the rest ₹499',
    crowdFounders === 1 && crowdRes.every((x) => x.status === 200 && (x.body?.kind === 'founder' || x.body?.amountPaise === 49900)),
    crowdRes.map((x) => `${x.status}:${x.body?.kind ?? x.body?.error}`).join(' '),
  );
  // Give the spot back so the two-owner case below starts from 49 again.
  sql(`UPDATE shops SET founder_hold_until = NULL, founder_hold_at = NULL WHERE id IN (${crowd.map((s) => `'${s.shopId}'`).join(',')});`);

  const a = await newOwnerShop('racea');
  const b = await newOwnerShop('raceb');
  const [ra, rb] = await Promise.all([subscribe(a.token), subscribe(b.token)]);
  const kinds = [ra.body?.kind, rb.body?.kind].sort();
  const amounts = [ra.body?.amountPaise, rb.body?.amountPaise].sort();
  check(
    'Two owners take the last founder spot at the same moment: exactly one gets it',
    ra.status === 200 && rb.status === 200 && kinds[0] === 'founder' && kinds[1] === 'regular',
    `${show(ra)} | ${show(rb)}`,
  );
  check('…₹399 for the one who got it, ₹499 for the other', amounts[0] === 39900 && amounts[1] === 49900, JSON.stringify(amounts));
  probeBilling = (await call(probe.token, 'GET', '/billing')).body;
  check('After that, the next shop is offered ₹499', probeBilling?.offer?.kind === 'regular' && probeBilling?.offer?.founderSlotsLeft === 0, JSON.stringify(probeBilling?.offer));

  const [t1, t2] = await Promise.all([subscribe(probe.token, 'monthly'), subscribe(probe.token, 'yearly')]);
  const statuses = [t1.status, t2.status].sort();
  check('Upgrade tapped twice at once: one checkout starts, the other is refused', statuses[0] === 200 && statuses[1] === 409, `${show(t1)} | ${show(t2)}`);
  check('…leaving exactly one payment link open, so the owner can’t pay twice', openLinks(probe.shopId).length === 1, JSON.stringify(openLinks(probe.shopId)));
  r = await subscribe(probe.token, 'yearly');
  const links = openLinks(probe.shopId);
  check(
    'Starting the upgrade again later replaces the old link (still one open)',
    r.status === 200 && links.length === 1 && r.body?.checkoutUrl?.endsWith(links[0]?.id),
    `${show(r)} ${JSON.stringify(links)}`,
  );

  if (WEBHOOK_SECRET) {
    const winner = ra.body?.kind === 'founder' ? a : b;
    const own = openLinks(winner.shopId)[0];
    const nowS = Math.floor(Date.now() / 1000);
    Object.assign(own, { status: 'active', paid_count: 1, current_start: nowS, current_end: nowS + 30 * 86400 });
    const charged = (sub, payId) =>
      signedWebhook({
        event: 'subscription.charged',
        payload: {
          subscription: { entity: sub },
          payment: { entity: { id: payId, amount: 39900, status: 'captured', method: 'upi', created_at: nowS } },
        },
      });
    r = await charged(own, `pay_own${run}`);
    let wb = (await call(winner.token, 'GET', '/billing')).body;
    check('The founder pays: Pro is on at the founder price', r.status === 200 && wb?.tier === 'pro' && wb?.subscription?.priceKind === 'founder', `${show(r)} ${JSON.stringify(wb?.subscription)}`);

    const dupId = `sub_standindup${run}`;
    standin.subs.set(dupId, { ...own, id: dupId });
    r = await charged(standin.subs.get(dupId), `pay_dup${run}`);
    wb = (await call(winner.token, 'GET', '/billing')).body;
    check(
      'A second subscription paid for the same shop is cancelled and its payment refunded',
      r.status === 200 && standin.subs.get(dupId).status === 'cancelled' && standin.refunds.has(`pay_dup${run}`),
      show(r),
    );
    check(
      '…the shop stays on its own subscription, and the refunded charge isn’t in its history',
      own.status === 'active' && wb?.payments?.some((p) => p.id === `pay_own${run}`) && !wb?.payments?.some((p) => p.id === `pay_dup${run}`),
      JSON.stringify(wb?.payments),
    );
  } else {
    console.log('SKIP  Duplicate paid subscription (set RAZORPAY_WEBHOOK_SECRET)');
  }
  // Leave the founder count as it was, so the next run starts the same way.
  clearFillers();
  sql(
    `UPDATE shops SET founder_at = NULL, founder_hold_until = NULL, founder_hold_at = NULL ` +
      `WHERE id IN ('${a.shopId}', '${b.shopId}', '${probe.shopId}');`,
  );
}

// ─── Webhook ──────────────────────────────────────────────────────────────

const event = JSON.stringify({
  event: 'subscription.charged',
  payload: {
    subscription: {
      entity: {
        id: `sub_plancheck${run}`,
        plan_id: 'plan_check',
        status: 'active',
        paid_count: 1,
        total_count: 120,
        current_start: Math.floor(Date.now() / 1000),
        current_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        notes: { shop_id: SHOP, founder: '0', interval: 'monthly', amount_paise: '49900' },
      },
    },
  },
});
r = await call(null, 'POST', '/billing/webhook', event, {
  'content-type': 'application/json',
  'x-razorpay-signature': 'f'.repeat(64),
});
check('Webhook with a forged signature is refused', r.status === 400 || r.status === 503, show(r));
r = await call(null, 'POST', '/billing/webhook', event, { 'content-type': 'application/json' });
check('Webhook with no signature is refused', r.status === 400 || r.status === 503, show(r));
r = await call(O, 'GET', '/billing/plan');
check('…and the forged payment didn’t turn on Pro', r.body?.tier === 'free', show(r));

if (WEBHOOK_SECRET) {
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(event).digest('hex');
  const headers = {
    'content-type': 'application/json',
    'x-razorpay-signature': signature,
    'x-razorpay-event-id': `evt_plancheck${run}`,
  };
  r = await call(null, 'POST', '/billing/webhook', event, headers);
  check('Signed webhook is accepted', r.status === 200, show(r));
  r = await call(O, 'GET', '/billing/plan');
  check('…and turns on Pro for about a month', r.body?.tier === 'pro' && r.body?.daysLeft >= 29, show(r));
  r = await call(null, 'POST', '/billing/webhook', event, headers);
  check('Same event delivered twice is answered and ignored', r.status === 200, show(r));
} else {
  console.log('SKIP  Signed webhook (set RAZORPAY_WEBHOOK_SECRET in this shell to include it)');
}

console.log(`\n${passed} passed, ${failed} failed`);
standinServer.close();
process.exit(failed ? 1 : 0);
