// Worst cases outside billing: two people (or a double tap, or a lost reply) doing the same
// thing at once. Run against the local API:
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:races                         (in another)
// Local `wrangler dev` handles requests one at a time, so a parallel pair here can't land in the
// exact same instant the way it can in production. These checks prove every guard is in place
// and that the second request is answered cleanly; the guards themselves are single statements
// (or a per-number lock) so they also hold when requests truly overlap.
import { execSync } from 'node:child_process';

const API = process.env.API_URL ?? 'http://localhost:8787';
const DEV_CODE = process.env.DEV_CODE ?? '000000';
const PIN = '2580';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;

async function call(token, method, path, body, extraHeaders = {}) {
  const headers = { ...extraHeaders, ...(token ? { authorization: `Bearer ${token}` } : {}) };
  let payload;
  if (body !== undefined) {
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

const wrangler = (command, json) =>
  execSync(
    `npx wrangler d1 execute mana_db --local ${json ? '--json ' : ''}--command "${command.replace(/"/g, '\\"')}"`,
    { stdio: json ? ['ignore', 'pipe', 'ignore'] : 'ignore' },
  );
const sql = (command) => wrangler(command, false);
const rows = (query) => JSON.parse(String(wrangler(query, true)))[0]?.results ?? [];

const run = Date.now().toString(36);
const rand = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const id = (p) => `${p}_${run}_${rand(6)}`;
const isoIn = (days) => `'${new Date(Date.now() + days * 86400000).toISOString()}'`;

const SHOP = `shop_race_${run}`;
const SHOP_CODE = rand(6);
const O1 = `user_race_o1_${run}`;
const O2 = `user_race_o2_${run}`;
const o1Phone = `95${rand(8)}`;
const o2Phone = `95${rand(8)}`;
const VT = `vt_race_${run}`;
const SVC = `svc_race_${run}`;

sql(
  `INSERT INTO shops (id, code, name, plan, paid_until) VALUES ('${SHOP}', '${SHOP_CODE}', 'Race Check Wash', 'active', ${isoIn(30)});` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('${O1}', '${SHOP}', 'Owner One', '${o1Phone}', 'owner');` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('${O2}', '${SHOP}', 'Owner Two', '${o2Phone}', 'owner');` +
    `INSERT INTO vehicle_types (id, shop_id, name, category, sort_order) VALUES ('${VT}', '${SHOP}', 'Sedan', 'car', 0);` +
    `INSERT INTO services (id, shop_id, name, applies_to, sort_order) VALUES ('${SVC}', '${SHOP}', 'Basic Wash', 'car', 0);` +
    `INSERT INTO service_prices (id, shop_id, service_id, vehicle_type_id, price) VALUES ('sp_race_${run}', '${SHOP}', '${SVC}', '${VT}', 30000);`,
);

async function signIn(phone) {
  await call(null, 'POST', '/auth/code/request', { phone });
  const v = await call(null, 'POST', '/auth/code/verify', { phone, code: DEV_CODE });
  const p = v.body?.token ? await call(v.body.token, 'PUT', '/auth/pin', { pin: PIN }) : v;
  return p.body?.token;
}
async function pinLogin(phone) {
  const r = await call(null, 'POST', '/auth/pin/login', { phone, pin: PIN });
  if (!r.body?.token) console.log(`      (sign-in for ${phone} failed: ${show(r)})`);
  return r.body?.token;
}
const T1 = await signIn(o1Phone);
const T2 = await signIn(o2Phone);
check('Both owners sign in', !!T1 && !!T2);
if (!T1 || !T2) process.exit(1);

const activeOwners = () =>
  rows(`SELECT COUNT(*) AS n FROM users WHERE shop_id = '${SHOP}' AND role = 'owner' AND active = 1`)[0]?.n;
// Removal also clears the PIN; both owners use the same PIN, so the other's hash puts it back.
const restoreOwners = () =>
  sql(
    `UPDATE users SET role = 'owner', active = 1, removed_at = NULL WHERE id IN ('${O1}', '${O2}');` +
      `UPDATE users SET pin_hash = (SELECT pin_hash FROM users WHERE id = '${O2}') WHERE id = '${O1}' AND pin_hash IS NULL;` +
      `UPDATE users SET pin_hash = (SELECT pin_hash FROM users WHERE id = '${O1}') WHERE id = '${O2}' AND pin_hash IS NULL;`,
  );

// ─── Team: the shop always keeps an owner ─────────────────────────────────

let pair = await Promise.all([
  call(T1, 'PATCH', `/team/${O2}`, { role: 'staff' }),
  call(T2, 'PATCH', `/team/${O1}`, { role: 'staff' }),
]);
check(
  'Two owners make each other staff at once: one wins, the other is told the shop needs an owner',
  activeOwners() === 1 &&
    pair.filter((r) => r.status === 200).length === 1 &&
    // The loser is either told the shop needs an owner, or is already staff and may not.
    pair.some((r) => r.body?.error === 'last_owner' || r.status === 403),
  `${pair.map(show).join(' | ')} owners=${activeOwners()}`,
);
restoreOwners();
const T1b = await pinLogin(o1Phone);
const T2b = await pinLogin(o2Phone);

pair = await Promise.all([
  call(T1b, 'PATCH', `/team/${O2}`, { active: false }),
  call(T2b, 'PATCH', `/team/${O1}`, { active: false }),
]);
check('Two owners switch each other off at once: one owner is always left', activeOwners() === 1, pair.map(show).join(' | '));
restoreOwners();
const T1c = await pinLogin(o1Phone);
const T2c = await pinLogin(o2Phone);

pair = await Promise.all([call(T1c, 'DELETE', `/team/${O2}`), call(T2c, 'DELETE', `/team/${O1}`)]);
check('Two owners remove each other at once: one owner is always left', activeOwners() === 1, pair.map(show).join(' | '));
restoreOwners();
const A = await pinLogin(o1Phone);
const B = await pinLogin(o2Phone);

// ─── One number, one person ───────────────────────────────────────────────

const newPhone = `96${rand(8)}`;
pair = await Promise.all([
  call(A, 'POST', '/team', { name: 'Same Person', phone: newPhone, role: 'staff' }),
  call(B, 'POST', '/team', { name: 'Same Person', phone: newPhone, role: 'staff' }),
]);
const withNumber = (phone) => rows(`SELECT COUNT(*) AS n FROM users WHERE phone = '${phone}' AND removed_at IS NULL`)[0]?.n;
check(
  'Both owners add the same number at once: it’s added once',
  withNumber(newPhone) === 1 && pair.filter((r) => r.status === 201).length === 1,
  `${pair.map(show).join(' | ')} rows=${withNumber(newPhone)}`,
);

// Double tap on "Create shop" (same ticket, two requests).
const founderPhone = `97${rand(8)}`;
await call(null, 'POST', '/signup/code', { phone: founderPhone, purpose: 'signup' });
const ticket = (await call(null, 'POST', '/signup/verify', { phone: founderPhone, purpose: 'signup', code: DEV_CODE })).body?.ticket;
pair = await Promise.all(
  [0, 1].map(() => call(null, 'POST', '/signup/shop', { ticket, pin: PIN, name: 'Double Tap', shopName: 'Double Tap Wash' })),
);
check(
  'Double tap on Create shop: one shop, the other tap is told the number is registered',
  withNumber(founderPhone) === 1 && pair.filter((r) => r.status === 201).length === 1 && pair.some((r) => r.status === 409),
  `${pair.map(show).join(' | ')} rows=${withNumber(founderPhone)}`,
);

// Two owners approve the same join request at once.
const joinPhone = `98${rand(8)}`;
await call(null, 'POST', '/signup/code', { phone: joinPhone, purpose: 'join' });
const joinTicket = (await call(null, 'POST', '/signup/verify', { phone: joinPhone, purpose: 'join', code: DEV_CODE })).body?.ticket;
let r = await call(null, 'POST', '/signup/join', { ticket: joinTicket, shopCode: SHOP_CODE, name: 'New Joiner' });
check('A new person asks to join', r.status === 201, show(r));
const requestId = (await call(A, 'GET', '/team/requests')).body?.find?.((x) => x.phone === joinPhone)?.id;
pair = await Promise.all([
  call(A, 'POST', `/team/requests/${requestId}/approve`),
  call(B, 'POST', `/team/requests/${requestId}/approve`),
]);
check(
  'Two owners approve the same request at once: one teammate, both owners get a clean answer',
  withNumber(joinPhone) === 1 && pair.every((x) => x.status === 200) && pair[0].body?.id === pair[1].body?.id,
  `${pair.map(show).join(' | ')} rows=${withNumber(joinPhone)}`,
);

// A stray owner row on this number (not made by "open another shop", so a different PIN) can't
// be reached by switching. The database already refuses a stray staff row.
const STRAY = `shop_stray_${run}`;
sql(
  `INSERT INTO shops (id, code, name, plan) VALUES ('${STRAY}', '${rand(6)}', 'Stray Shop', 'free');` +
    `INSERT INTO users (id, shop_id, name, phone, role, pin_hash) VALUES ('user_stray_${run}', '${STRAY}', 'Stray', '${o1Phone}', 'owner', 'not-their-pin');`,
);
r = await call(A, 'POST', '/auth/switch', { shopId: STRAY });
check('Switching to a shop where the number isn’t the same owner is refused', r.status === 404, show(r));
r = await call(A, 'GET', '/auth/shops');
check('…and that shop isn’t listed as theirs', r.status === 200 && !r.body?.shops?.some((s) => s.shopId === STRAY), show(r));
sql(`DELETE FROM users WHERE id = 'user_stray_${run}'; DELETE FROM shops WHERE id = '${STRAY}';`);

// ─── Washes ───────────────────────────────────────────────────────────────

const washBody = (extra = {}) => ({
  id: id('job'),
  customer: { phone: `99${rand(8)}`, name: 'Race Customer' },
  registrationNumber: `TS09RC${rand(4)}`,
  vehicleTypeId: VT,
  services: [{ serviceId: SVC, quantity: 1 }],
  discount: 0,
  ...extra,
});

r = await call(A, 'POST', '/jobs/start', washBody({ services: [{ serviceId: SVC, quantity: 1 }, { serviceId: SVC, quantity: 2 }] }));
check(
  'The same service sent twice is one line with the quantities added (₹900)',
  r.status === 201 && r.body?.jobServices?.length === 1 && r.body.jobServices[0].quantity === 3 && r.body.subtotal === 90000,
  show(r),
);
r = await call(A, 'POST', '/jobs/start', washBody({ services: [{ serviceId: SVC, quantity: 21 }] }));
check('More than 20 of one service is refused', r.status === 400, show(r));

// A crash left only the wash's own row (no lines, no audit event); the phone's retry finishes it.
const first = await call(A, 'POST', '/jobs/start', washBody());
const half = washBody({
  customer: { phone: first.body?.customer?.phone, name: 'Race Customer' },
  registrationNumber: first.body?.vehicle?.registrationNumber,
});
sql(
  `INSERT INTO jobs (id, shop_id, customer_id, vehicle_id, created_by_user_id, status, subtotal, discount, total) ` +
    `VALUES ('${half.id}', '${SHOP}', '${first.body?.customerId}', '${first.body?.vehicleId}', '${O1}', 'waiting', 30000, 0, 30000);`,
);
r = await call(A, 'POST', '/jobs/start', half);
const events = rows(`SELECT COUNT(*) AS n FROM job_events WHERE job_id = '${half.id}' AND action = 'created'`)[0]?.n;
check(
  'A half-written wash is completed by the retry, not shown empty',
  first.status === 201 && r.status === 200 && r.body?.jobServices?.length === 1 && events === 1,
  `${show(r)} events=${events}`,
);
r = await call(A, 'POST', '/jobs/start', half);
check('…and a further retry changes nothing', r.status === 200 && r.body?.jobServices?.length === 1, show(r));

// A phone whose clock is a day and 3 hours ahead sends a wash that waited 40 minutes offline.
const skew = 27 * 3600 * 1000;
const sentOnPhone = new Date(Date.now() + skew);
const occurredOnPhone = new Date(sentOnPhone.getTime() - 40 * 60 * 1000);
r = await call(A, 'POST', '/jobs/start', washBody({ occurredAt: occurredOnPhone.toISOString() }), {
  'x-client-time': sentOnPhone.toISOString(),
});
const off = Math.abs(new Date(r.body?.createdAt).getTime() - (Date.now() - 40 * 60 * 1000));
check('A phone set to the wrong day still files the wash 40 minutes ago, today', r.status === 201 && off < 2 * 60 * 1000, `${show(r)} off=${off}ms`);

// Paid, but the server stopped before settling the referral; the phone's retry settles it.
const referrer = await call(A, 'POST', '/jobs/start', washBody());
const referred = await call(A, 'POST', '/jobs/start', washBody());
const refId = id('ref');
sql(
  `INSERT INTO referrals (id, shop_id, referred_customer_id, referrer_customer_id, job_id, percent, created_by_user_id) ` +
    `VALUES ('${refId}', '${SHOP}', '${referred.body?.customerId}', '${referrer.body?.customerId}', '${referred.body?.id}', 5, '${O1}');` +
    `UPDATE jobs SET status = 'paid', payment_method = 'cash', payment_status = 'paid', paid_by_user_id = '${O1}', completed_at = ${isoIn(0)} WHERE id = '${referred.body?.id}';`,
);
r = await call(A, 'POST', `/jobs/${referred.body?.id}/pay`, { paymentMethod: 'cash' });
const refStatus = rows(`SELECT status FROM referrals WHERE id = '${refId}'`)[0]?.status;
check('A retried payment settles the referral the first attempt didn’t get to', r.status === 200 && refStatus !== 'pending', `${show(r)} referral=${refStatus}`);

// ─── Cash drawer ──────────────────────────────────────────────────────────

const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
pair = await Promise.all([
  call(A, 'PUT', '/cash/day/float', { date: today, amount: 50000 }),
  call(B, 'PUT', '/cash/day/float', { date: today, amount: 70000 }),
]);
const floatRows = rows(`SELECT COUNT(*) AS n FROM cash_days WHERE shop_id = '${SHOP}' AND date = '${today}'`)[0]?.n;
check('Two owners set the first float of the day at once: one day, no error', floatRows === 1 && pair.every((x) => x.status === 200), `${pair.map(show).join(' | ')} rows=${floatRows}`);

r = await call(A, 'POST', '/cash/day/close', { date: today, counted: 50000, note: 'first count' });
const reopened = await call(A, 'POST', '/cash/day/reopen', { date: today, reason: 'Recount the drawer' });
r = await call(A, 'GET', `/cash/day?date=${today}`);
const earlier = r.body?.earlierCloses ?? [];
check(
  'Reopening a closed day keeps the earlier count, who reopened it and why',
  reopened.status === 200 && r.body?.status === 'open' && earlier.length === 1 && earlier[0].counted === 50000 &&
    earlier[0].note === 'first count' && earlier[0].reopenReason === 'Recount the drawer' && !!earlier[0].reopenedBy,
  show(r),
);
pair = await Promise.all([
  call(A, 'POST', '/cash/day/close', { date: today, counted: 52000, note: 'A counted' }),
  call(B, 'POST', '/cash/day/close', { date: today, counted: 53000, note: 'B counted' }),
]);
check(
  'Two owners close the reopened day at once: one close wins, the other is told',
  pair.filter((x) => x.status === 200).length === 1 && pair.some((x) => x.body?.error === 'day_closed'),
  pair.map(show).join(' | '),
);
pair = await Promise.all([
  call(A, 'POST', '/cash/day/reopen', { date: today, reason: 'Second recount' }),
  call(B, 'POST', '/cash/day/reopen', { date: today, reason: 'Second recount' }),
]);
r = await call(A, 'GET', `/cash/day?date=${today}`);
check(
  'Two owners reopen at once: both closes are still on record, once each',
  r.body?.earlierCloses?.length === 2 && pair.some((x) => x.status === 200),
  `${pair.map(show).join(' | ')} ${show(r)}`,
);

// ─── Stock ────────────────────────────────────────────────────────────────

pair = await Promise.all([
  call(A, 'POST', '/stock', { name: 'Race Shampoo', unit: 'l', opening: 2 }),
  call(B, 'POST', '/stock', { name: 'race shampoo', unit: 'l', opening: 2 }),
]);
const shampoo = pair.find((x) => x.status === 201)?.body;
const items = rows(`SELECT COUNT(*) AS n FROM stock_items WHERE shop_id = '${SHOP}' AND active = 1`)[0]?.n;
check(
  'Two owners add the same stock item at once: one item, the other is told it exists',
  items === 1 && pair.filter((x) => x.status === 201).length === 1 && pair.some((x) => x.body?.error === 'duplicate'),
  `${pair.map(show).join(' | ')} items=${items}`,
);
r = await call(A, 'POST', '/stock/moves', { id: id('move'), itemId: shampoo?.id, kind: 'use', quantity: 3, unit: 'l' });
const move = rows(`SELECT note FROM stock_moves WHERE item_id = '${shampoo?.id}' AND kind = 'use'`)[0];
check(
  'Using more than the books show empties the item (never below zero) and notes the shortfall',
  r.status === 201 && r.body?.item?.balance === 0 && /only/i.test(move?.note ?? ''),
  `${show(r)} note=${move?.note}`,
);
await call(A, 'POST', '/stock/moves', { id: id('move'), itemId: shampoo?.id, kind: 'in', quantity: 1, unit: 'l' });
pair = await Promise.all([
  call(A, 'POST', '/stock/moves', { id: id('move'), itemId: shampoo?.id, kind: 'use', quantity: 0.8, unit: 'l' }),
  call(B, 'POST', '/stock/moves', { id: id('move'), itemId: shampoo?.id, kind: 'use', quantity: 0.8, unit: 'l' }),
]);
const balance = rows(`SELECT balance FROM stock_items WHERE id = '${shampoo?.id}'`)[0]?.balance;
check('Two people use the last litre at once: the shelf ends at zero, not minus', pair.every((x) => x.status === 201) && balance === 0, `${pair.map(show).join(' | ')} balance=${balance}`);

// ─── Saves that create a row the first time ───────────────────────────────

pair = await Promise.all([
  call(A, 'PUT', '/attendance', { userId: O1, date: today, status: 'present' }),
  call(B, 'PUT', '/attendance', { userId: O1, date: today, status: 'half' }),
]);
const marks = rows(`SELECT COUNT(*) AS n FROM attendance WHERE user_id = '${O1}' AND date = '${today}'`)[0]?.n;
check('Two owners mark the same person at once: one mark, no error', marks === 1 && pair.every((x) => x.status === 200), `${pair.map(show).join(' | ')} rows=${marks}`);

pair = await Promise.all([
  call(A, 'PUT', '/shop/settings', { googleReviewUrl: 'https://g.page/a' }),
  call(B, 'PUT', '/shop/settings', { googleReviewUrl: 'https://g.page/b' }),
]);
check('Two owners save settings at once: both saves are answered cleanly', pair.every((x) => x.status === 200), pair.map(show).join(' | '));

pair = await Promise.all([
  call(A, 'PUT', '/services/prices', { serviceId: SVC, vehicleTypeId: VT, price: 32000 }),
  call(B, 'PUT', '/services/prices', { serviceId: SVC, vehicleTypeId: VT, price: 33000 }),
]);
check('Two owners change the same price at once: both answered cleanly', pair.every((x) => x.status === 200), pair.map(show).join(' | '));
r = await call(A, 'PUT', '/services/prices', { serviceId: SVC, vehicleTypeId: VT, price: 1_00_000 * 100 + 1 });
check('A price over ₹1,00,000 is refused (a slip of extra zeros)', r.status === 400, show(r));

// ─── Photos ───────────────────────────────────────────────────────────────

const photoJob = (await call(A, 'POST', '/jobs/start', washBody())).body?.id;
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
async function upload(token, photoId) {
  const form = new FormData();
  form.set('id', photoId);
  form.set('jobId', photoJob);
  form.set('kind', 'before');
  form.set('file', new Blob([jpeg], { type: 'image/jpeg' }), 'p.jpg');
  const res = await fetch(`${API}/photos`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  return { status: res.status, body: await res.json().catch(() => null) };
}
for (let i = 0; i < 9; i++) await upload(A, id('photo'));
const burst = await Promise.all([upload(A, id('photo')), upload(B, id('photo')), upload(A, id('photo'))]);
const photos = rows(`SELECT COUNT(*) AS n FROM job_photos WHERE job_id = '${photoJob}' AND kind = 'before'`)[0]?.n;
check(
  'Three phones upload the 10th photo at once: the job stops at 10',
  photos === 10 && burst.filter((x) => x.status === 201).length === 1 && burst.every((x) => x.status === 201 || x.status === 409),
  `${burst.map(show).join(' | ')} photos=${photos}`,
);

// ─── Changing your number ─────────────────────────────────────────────────

const movedPhone = `93${rand(8)}`;
r = await call(B, 'POST', '/auth/me/phone', { phone: movedPhone, pin: PIN });
check('Changing your number without a code from the new number is refused', r.status === 400, show(r));
r = await call(B, 'POST', '/auth/me/phone/code', { phone: movedPhone });
check('A code is sent to the new number', r.status === 200, show(r));
r = await call(B, 'POST', '/auth/me/phone', { phone: movedPhone, pin: PIN, code: DEV_CODE === '000000' ? '111111' : '000000' });
check('…a wrong code is refused', r.status === 401 && r.body?.error === 'invalid_code', show(r));
r = await call(B, 'POST', '/auth/me/phone', { phone: movedPhone, pin: PIN, code: DEV_CODE });
const nowOn = rows(`SELECT phone FROM users WHERE id = '${O2}'`)[0]?.phone;
check('…and the right code with the PIN moves the number', r.status === 200 && nowOn === movedPhone, `${show(r)} phone=${nowOn}`);

// ─── Dates ────────────────────────────────────────────────────────────────

r = await call(A, 'GET', '/jobs/stats?range=custom&from=2026-02-31&to=2026-03-05');
check('31 February is refused, not read as 3 March', r.status === 400, show(r));

// ─── Clean up ─────────────────────────────────────────────────────────────

const founderShop = rows(`SELECT shop_id FROM users WHERE phone = '${founderPhone}'`)[0]?.shop_id;
const tables = [
  'job_photos', 'stock_moves', 'stock_items', 'cash_day_closes', 'cash_days', 'attendance', 'app_settings',
  'referrals', 'coupons', 'job_events', 'job_services', 'job_sellers', 'job_washers', 'jobs', 'vehicles',
  'customers', 'join_requests', 'login_codes', 'service_prices', 'services', 'vehicle_types', 'users',
];
for (const shop of [SHOP, founderShop].filter(Boolean)) {
  try {
    sql(`PRAGMA foreign_keys = OFF; ${tables.map((t) => `DELETE FROM ${t} WHERE shop_id = '${shop}';`).join(' ')} DELETE FROM shops WHERE id = '${shop}';`);
  } catch {
    // Left behind for the next db:reset:local.
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
