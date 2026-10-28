// The cash drawer with doorstep cash end to end: shop cash goes straight into the box, doorstep
// cash stays with the team member who collected it until it's handed in (all, part now and the
// rest later, or short with a reason), closing while cash is still out needs saying so and
// freezes the amount, the owner undoes a mistaken handover, two people taking the same cash at
// once record it once, expenses paid from doorstep cash come off what that person holds (never
// more than they hold) instead of the box, and another branch never sees any of it. Run against the local API:
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:cash                          (in another)
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

const BIZ = `biz_cash_${run}`;
const SHOP = `shop_cash_${run}`;
const OTHER = `shop_cash2_${run}`;
const OWNER = `user_cash_o_${run}`;
const RAVI = `user_cash_r_${run}`;
const SITA = `user_cash_s_${run}`;
const OTHER_OWNER = `user_cash_x_${run}`;
const phone = { owner: `95${rand(8)}`, ravi: `95${rand(8)}`, sita: `95${rand(8)}`, other: `95${rand(8)}` };
const VT = `vt_cash_${run}`;
const CUST = `cust_cash_${run}`;
const VEH = `veh_cash_${run}`;

d1Run(
  `INSERT INTO businesses (id, name) VALUES ('${BIZ}', 'Cash Check Co');` +
    `INSERT INTO shops (id, code, name, business_id, menu_version) VALUES ('${SHOP}', '${rand(6)}', 'Cash Hub', '${BIZ}', 1), ('${OTHER}', '${rand(6)}', 'Cash Other', '${BIZ}', 1);` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('${OWNER}', '${SHOP}', 'Owner', '${phone.owner}', 'owner'), ('${RAVI}', '${SHOP}', 'Ravi', '${phone.ravi}', 'staff'), ('${SITA}', '${SHOP}', 'Sita', '${phone.sita}', 'staff'), ('${OTHER_OWNER}', '${OTHER}', 'Other Owner', '${phone.other}', 'owner');` +
    `INSERT INTO vehicle_types (id, shop_id, name, category, sort_order) VALUES ('${VT}', '${SHOP}', 'Hatchback', 'car', 0);` +
    `INSERT INTO customers (id, shop_id, name, phone) VALUES ('${CUST}', '${SHOP}', 'Door Customer', '98${rand(8)}');` +
    `INSERT INTO vehicles (id, shop_id, customer_id, registration_number, vehicle_type_id) VALUES ('${VEH}', '${SHOP}', '${CUST}', 'AP39CC${rand(4)}', '${VT}');`,
);

/** A wash ready to pay: made here so the money is exact, then paid through the API like the app does. */
function readyJob(mode, total) {
  const id = `job_cash_${run}_${rand(8)}`;
  d1Run(
    `INSERT INTO jobs (id, shop_id, customer_id, vehicle_id, created_by_user_id, status, subtotal, total, delivery_mode) VALUES ('${id}', '${SHOP}', '${CUST}', '${VEH}', '${OWNER}', 'ready', ${total}, ${total}, '${mode}');`,
  );
  return id;
}

const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
async function addExpense(token, data) {
  const form = new FormData();
  form.append('data', JSON.stringify({ id: `exp_cash_${run}_${rand(8)}`, category: 'other', itemName: 'Petrol', paymentMethod: 'cash', ...data }));
  form.append('billPhoto', jpeg, 'bill.jpg');
  form.append('itemPhoto', jpeg, 'item.jpg');
  const res = await apiFetch(`${API}/expenses`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const T = {};
for (const [who, p] of Object.entries(phone)) {
  const r = await signInWith(p, PIN);
  T[who] = r.body?.token;
  if (!T[who]) console.log(`      (sign-in for ${who} failed: ${show(r)})`);
}
check('Owner, two staff and another branch’s owner sign in', Object.values(T).every(Boolean));
if (!Object.values(T).every(Boolean)) process.exit(1);

const day = async (token = T.owner) => (await call(token, 'GET', '/cash/day')).body;
const take = (token, body) => call(token, 'POST', '/cash/handover', body);
const ravi = (d) => d?.doorstep?.people?.find((p) => p.userId === RAVI);

// ─── Before the day starts ───────────────────────────────────────────────────

let d = await day();
check('A fresh day has no doorstep cash', d?.status === 'not_started' && d?.doorstep?.collected === 0 && d?.doorstep?.held === 0 && d?.doorstep?.people?.length === 0, JSON.stringify(d?.doorstep));

let r = await call(T.ravi, 'POST', `/jobs/${readyJob('doorstep', 48000)}/pay`, { paymentMethod: 'cash' });
check('Ravi takes ₹480 cash at a customer’s door', r.status === 200, show(r));
d = await day();
check('…it shows as collected today and held by Ravi', d.doorstep.collected === 48000 && d.doorstep.jobs === 1 && d.doorstep.held === 48000 && ravi(d)?.held === 48000 && ravi(d)?.name === 'Ravi', JSON.stringify(d.doorstep));
check('…and isn’t in the box', d.cashIn === 0 && d.expected === 0, `${d.cashIn} ${d.expected}`);
r = await take(T.sita, { collectorId: RAVI, due: 48000, received: 48000 });
check('Cash can’t be handed in before the day starts', r.status === 409 && r.body?.error === 'no_float', show(r));

// ─── Shop cash and doorstep cash apart ───────────────────────────────────────

r = await call(T.sita, 'PUT', '/cash/day/float', { date: d.date, amount: 50000 });
check('Sita starts the day with ₹500', r.status === 200, show(r));
r = await call(T.sita, 'POST', `/jobs/${readyJob('hub', 42000)}/pay`, { paymentMethod: 'cash' });
d = await day();
check('A ₹420 cash wash at the shop goes straight into the box', r.status === 200 && d.cashIn === 42000 && d.cashJobs === 1 && d.expected === 92000, `${show(r)} ${d.cashIn} ${d.expected}`);
check('…and the doorstep ₹480 still doesn’t', d.doorstep.handedIn === 0 && d.doorstep.held === 48000);

r = await call(T.sita, 'POST', '/cash/day/close', { date: d.date, counted: 92000 });
check('Closing while Ravi holds cash asks for it first', r.status === 409 && r.body?.error === 'cash_held' && r.body?.held === 48000 && r.body?.holders?.[0]?.name === 'Ravi', show(r));

// ─── Handovers ───────────────────────────────────────────────────────────────

r = await take(T.sita, { collectorId: RAVI, due: 40000, received: 40000 });
check('A handover for an out-of-date amount is refused with the real one', r.status === 409 && r.body?.error === 'held_changed' && r.body?.held === 48000, show(r));
r = await take(T.sita, { collectorId: RAVI, due: 48000, received: 40000 });
check('Handing in less with no word on the rest needs a note', r.status === 400 && r.body?.error === 'note_required', show(r));
r = await take(T.sita, { collectorId: RAVI, due: 48000, received: 0, rest: 'still_held' });
check('…and nothing handed in can’t be "the rest later"', r.status === 400 && r.body?.error === 'note_required', show(r));
r = await take(T.sita, { collectorId: RAVI, due: 48000, received: 30000, rest: 'still_held' });
check('Ravi hands in ₹300 now, the rest later: no note needed', r.status === 201 && r.body?.doorstep?.handedIn === 30000 && r.body?.doorstep?.held === 18000, show(r));
check('…the ₹300 is in the box', r.body?.expected === 122000, String(r.body?.expected));
const first = r.body?.doorstep?.handovers?.[0];
check('…recorded with who took it and no difference', first?.collector === 'Ravi' && first?.receivedBy === 'Sita' && first?.received === 30000 && first?.due === 30000 && first?.difference === 0, JSON.stringify(first));

// Sita and the owner both take Ravi's last ₹180 at the same moment.
const [a, b] = await Promise.all([
  take(T.sita, { collectorId: RAVI, due: 18000, received: 18000 }),
  take(T.owner, { collectorId: RAVI, due: 18000, received: 18000 }),
]);
const statuses = [a.status, b.status].sort().join(',');
check('Two people taking the same cash at once: it is recorded once', statuses === '201,409', `${show(a)} | ${show(b)}`);
d = await day();
check('…Ravi holds nothing and the box has all ₹480', d.doorstep.held === 0 && d.doorstep.handedIn === 48000 && d.expected === 140000, JSON.stringify(d.doorstep));
const live = d1Rows(`SELECT COUNT(*) AS n FROM cash_handovers WHERE shop_id = '${SHOP}' AND voided_at IS NULL`)[0]?.n;
check('…two handovers on record, not three', live === 2, String(live));
r = await take(T.sita, { collectorId: RAVI, due: 0, received: 0 });
check('Nothing left to hand in', r.status === 409 && r.body?.error === 'nothing_held', show(r));
r = await take(T.sita, { collectorId: `user_nobody_${run}`, due: 100, received: 100 });
check('Someone not on the team can’t hand in cash', r.status === 404 && r.body?.error === 'not_on_team', show(r));
r = await take(T.sita, { collectorId: OTHER_OWNER, due: 100, received: 100 });
check('…nor someone from another branch', r.status === 404 && r.body?.error === 'not_on_team', show(r));

r = await call(T.ravi, 'POST', `/jobs/${readyJob('doorstep', 30000)}/pay`, { paymentMethod: 'cash' });
r = await take(T.sita, { collectorId: RAVI, due: 30000, received: 25000, rest: 'missing' });
check('Short with no reason is refused', r.status === 400 && r.body?.error === 'note_required', show(r));
r = await take(T.sita, { collectorId: RAVI, due: 30000, received: 25000, rest: 'missing', note: 'Spent on fuel' });
const short = r.body?.doorstep?.handovers?.[0];
check('Ravi is ₹50 short on a ₹300 wash: settled, with the reason and the shortfall kept', r.status === 201 && r.body?.doorstep?.held === 0 && short?.difference === -5000 && short?.note === 'Spent on fuel', show(r));
check('…only the ₹250 received is in the box', r.body?.expected === 165000, String(r.body?.expected));

// ─── Undo ────────────────────────────────────────────────────────────────────

r = await call(T.sita, 'POST', `/cash/handover/${encodeURIComponent(short.id)}/void`, { reason: 'Entered the wrong amount' });
check('Staff can’t undo a handover', r.status === 403, show(r));
r = await call(T.owner, 'POST', `/cash/handover/${encodeURIComponent(short.id)}/void`, { reason: 'Entered the wrong amount' });
check('The owner undoes it: Ravi holds the ₹300 again and the box loses the ₹250', r.status === 200 && r.body?.doorstep?.held === 30000 && r.body?.expected === 140000, show(r));
check('…kept on record as undone, with who and why', r.body?.doorstep?.handovers?.find((h) => h.id === short.id)?.voided?.reason === 'Entered the wrong amount', JSON.stringify(r.body?.doorstep?.handovers?.[0]));
r = await call(T.owner, 'POST', `/cash/handover/${encodeURIComponent(short.id)}/void`, { reason: 'Entered the wrong amount' });
check('…and can’t be undone twice', r.status === 409 && r.body?.error === 'already_voided', show(r));

// ─── Closing with cash still out ─────────────────────────────────────────────

r = await call(T.sita, 'POST', '/cash/day/close', { date: d.date, counted: 140000, leaveHeld: true });
check('Sita closes anyway, saying the ₹300 carries over', r.status === 200 && r.body?.status === 'closed' && r.body?.difference === 0, show(r));
check('…the ₹300 still with Ravi is frozen with the close', r.body?.heldAtClose === 30000 && r.body?.doorstep?.held === 30000, show(r));
r = await take(T.sita, { collectorId: RAVI, due: 30000, received: 30000 });
check('Nothing goes into a closed box', r.status === 409 && r.body?.error === 'day_closed', show(r));
const firstLive = d1Rows(`SELECT id FROM cash_handovers WHERE shop_id = '${SHOP}' AND voided_at IS NULL LIMIT 1`)[0]?.id;
r = await call(T.owner, 'POST', `/cash/handover/${encodeURIComponent(firstLive)}/void`, { reason: 'Recorded twice' });
check('…and a closed day’s handovers can’t be undone', r.status === 409 && r.body?.error === 'day_closed', show(r));
r = await call(T.owner, 'GET', '/cash/history?range=week');
check('History shows the cash still with the team at close', r.body?.days?.find((x) => x.date === d.date)?.heldAtClose === 30000, show(r));

r = await call(T.owner, 'POST', '/cash/day/reopen', { date: d.date, reason: 'Ravi came back with the cash' });
check('The owner reopens: the earlier close keeps its held amount', r.status === 200 && r.body?.status === 'open' && r.body?.heldAtClose === null && r.body?.earlierCloses?.[0]?.heldAtClose === 30000, show(r));
r = await take(T.sita, { collectorId: RAVI, due: 30000, received: 30000 });
check('Ravi hands in the ₹300', r.status === 201 && r.body?.doorstep?.held === 0 && r.body?.expected === 170000, show(r));
r = await call(T.sita, 'POST', '/cash/day/close', { date: d.date, counted: 170000 });
check('…and the day closes with nothing out', r.status === 200 && r.body?.heldAtClose === 0 && r.body?.difference === 0, show(r));

// ─── Expenses paid from doorstep cash ────────────────────────────────────────

r = await call(T.owner, 'POST', '/cash/day/reopen', { date: d.date, reason: 'Ravi spent some on fuel' });
check('(The owner reopens the day once more)', r.status === 200, show(r));
await call(T.ravi, 'POST', `/jobs/${readyJob('doorstep', 50000)}/pay`, { paymentMethod: 'cash' });
r = await call(T.ravi, 'GET', '/cash/held');
const sitaHeld = (await call(T.sita, 'GET', '/cash/held')).body?.held;
check('Each person sees what they hold: Ravi ₹500, Sita nothing', r.body?.held === 50000 && sitaHeld === 0, `${show(r)} ${sitaHeld}`);

r = await addExpense(T.ravi, { amount: 60000, cashSource: 'held' });
check('Ravi can’t pay ₹600 from the ₹500 he holds', r.status === 409 && r.body?.error === 'more_than_held' && r.body?.held === 50000, show(r));
r = await addExpense(T.ravi, { amount: 20000, cashSource: 'held', paymentMethod: 'upi' });
check('Doorstep cash is only for cash payments', r.status === 400, show(r));
r = await addExpense(T.sita, { amount: 10000, cashSource: 'held' });
check('Someone holding nothing can’t pay from it', r.status === 409 && r.body?.error === 'more_than_held', show(r));

const before = (await day()).expected;
r = await addExpense(T.ravi, { amount: 20000, cashSource: 'held' });
const fuel = r.body?.id;
d = await day();
check('Ravi pays ₹200 petrol from his doorstep cash', r.status === 201 && !!fuel, show(r));
check('…it comes off what he holds, not the box', d.doorstep.held === 30000 && d.expected === before && d.cashExpenses === 0, `${d.doorstep.held} ${d.expected} ${before} ${d.cashExpenses}`);
check('…and shows as spent today', d.doorstep.spent === 20000 && ravi(d)?.spentToday === 20000, JSON.stringify(ravi(d)));
r = await call(T.owner, 'GET', '/expenses?range=week');
check('…still an expense in the books, marked as doorstep cash', r.body?.items?.find((e) => e.id === fuel)?.cashSource === 'held' && r.body?.total >= 20000, show(r));
r = await addExpense(T.ravi, { amount: 10000 });
check('A cash expense from the box still comes off the drawer', r.status === 201 && (await day()).expected === before - 10000, show(r));

const [e2, e3] = await Promise.all([
  addExpense(T.ravi, { amount: 20000, cashSource: 'held', itemName: 'Shampoo' }),
  addExpense(T.ravi, { amount: 20000, cashSource: 'held', itemName: 'Cloth' }),
]);
const won = [e2, e3].find((x) => x.status === 201);
check('Two ₹200 spends at once from ₹300 held: only one goes through', [e2.status, e3.status].sort().join(',') === '201,409', `${show(e2)} | ${show(e3)}`);
check('…Ravi holds ₹100', (await day()).doorstep.held === 10000);

r = await call(T.owner, 'PATCH', `/expenses/${fuel}`, { amount: 25000, reason: 'Wrong amount' });
check('The owner corrects the petrol to ₹250: within what Ravi held', r.status === 200 && (await day()).doorstep.held === 5000, show(r));
r = await call(T.owner, 'PATCH', `/expenses/${fuel}`, { amount: 40000, reason: 'Wrong amount' });
check('…but not to ₹400, more than he had', r.status === 409 && r.body?.error === 'more_than_held' && r.body?.held === 30000, show(r));
r = await call(T.owner, 'PATCH', `/expenses/${fuel}`, { paymentMethod: 'upi', reason: 'Paid by UPI' });
check('Changed to UPI, it goes back to the box side and Ravi holds the ₹250 again', r.status === 200 && r.body?.changes?.some((x) => x.field === 'cashSource' && x.to === 'drawer') && (await day()).doorstep.held === 30000, show(r));
r = await call(T.owner, 'POST', `/expenses/${won.body.id}/void`, { reason: 'Entered twice' });
d = await day();
check('Deleting a doorstep-cash expense gives the cash back to him', r.status === 200 && d.doorstep.held === 50000 && d.doorstep.spent === 0, `${show(r)} ${d.doorstep.held}`);

r = await take(T.sita, { collectorId: RAVI, due: 50000, received: 50000 });
check('Ravi hands in the ₹500 he holds', r.status === 201 && r.body?.doorstep?.held === 0 && r.body?.expected === before - 10000 + 50000, show(r));
r = await call(T.sita, 'POST', '/cash/day/close', { date: d.date, counted: before - 10000 + 50000 });
check('…and the day closes matching', r.status === 200 && r.body?.difference === 0, show(r));

// ─── Another branch ──────────────────────────────────────────────────────────

d = await day(T.other);
check('Another branch sees none of it', d?.doorstep?.collected === 0 && d?.doorstep?.held === 0 && d?.doorstep?.handovers?.length === 0 && d?.cashIn === 0, JSON.stringify(d?.doorstep));

// ─── Clean up ────────────────────────────────────────────────────────────────

try {
  const tables = ['stock_moves', 'expense_edits', 'expenses', 'cash_handovers', 'cash_day_closes', 'cash_days', 'job_events', 'jobs', 'vehicles', 'customers', 'vehicle_types', 'login_codes', 'users'];
  d1Run(
    `PRAGMA foreign_keys = OFF; ${[SHOP, OTHER].flatMap((s) => tables.map((t) => `DELETE FROM ${t} WHERE shop_id = '${s}';`)).join(' ')} DELETE FROM shops WHERE business_id = '${BIZ}'; DELETE FROM businesses WHERE id = '${BIZ}';`,
  );
} catch {
  // Left behind for the next db:reset:local.
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
