// Reports, the staff report, attendance and the team, by the numbers: money counts on the day it
// was paid in Reports, the staff report and the cash drawer alike (a car started last night and
// paid this morning is this morning's), so the staff report's cash adds up to Reports' cash;
// doorstep washes and their money are shown apart; each person's doorstep cash held and handed in
// short is on the staff report; undone handovers, reopened cash days and expense "Paid from"
// changes are in the corrections feed; nobody leaves the team holding doorstep cash; attendance
// follows who may mark whom and when. Run against the local API:
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:reports                       (in another)
import { API, apiFetch, d1Run, signIn as signInWith } from './lib/target.mjs';

const PIN = '258025';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 500)}`;

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
const istDay = (daysAgo) => new Date(Date.now() + 5.5 * 3600_000 - daysAgo * 86400_000).toISOString().slice(0, 10);
const TODAY = istDay(0);
const YESTERDAY = istDay(1);
/** An IST wall-clock time on a day, stored the way the API stores times. */
const at = (day, hhmm) => new Date(`${day}T${hhmm}:00+05:30`).toISOString().replace('Z', '+00:00');

const SHOP = `shop_rep_${run}`;
const U = { owner: `user_rep_o_${run}`, manager: `user_rep_m_${run}`, ravi: `user_rep_r_${run}`, sita: `user_rep_s_${run}` };
const phone = { owner: `92${rand(8)}`, manager: `92${rand(8)}`, ravi: `92${rand(8)}`, sita: `92${rand(8)}` };
const VT = `vt_rep_${run}`;
const SVC = `svc_rep_${run}`;
const CUST = `cust_rep_${run}`;
const VEH = `veh_rep_${run}`;
const job = (name) => `job_rep_${name}_${run}`;

function jobRow(id, f) {
  const cols = {
    id: `'${id}'`,
    shop_id: `'${SHOP}'`,
    customer_id: `'${CUST}'`,
    vehicle_id: `'${VEH}'`,
    created_by_user_id: `'${f.by}'`,
    status: `'${f.status}'`,
    subtotal: f.total,
    total: f.total,
    delivery_mode: `'${f.mode ?? 'hub'}'`,
    created_at: `'${f.created}'`,
    ...(f.status === 'paid'
      ? { payment_method: `'${f.method}'`, payment_status: `'paid'`, paid_by_user_id: `'${f.paidBy}'`, completed_at: `'${f.paid}'` }
      : {}),
    ...(f.status === 'void' ? { voided_by_user_id: `'${f.voidedBy}'`, void_reason: `'Entered by mistake'` } : {}),
  };
  return `INSERT INTO jobs (${Object.keys(cols).join(', ')}) VALUES (${Object.values(cols).join(', ')});`;
}

d1Run(
  `INSERT INTO shops (id, code, name, menu_version) VALUES ('${SHOP}', '${rand(6)}', 'Reports Check Wash', 1);` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('${U.owner}', '${SHOP}', 'Owner', '${phone.owner}', 'owner'), ('${U.manager}', '${SHOP}', 'Manager', '${phone.manager}', 'manager'), ('${U.ravi}', '${SHOP}', 'Ravi', '${phone.ravi}', 'staff'), ('${U.sita}', '${SHOP}', 'Sita', '${phone.sita}', 'staff');` +
    `INSERT INTO vehicle_types (id, shop_id, name, category, sort_order) VALUES ('${VT}', '${SHOP}', 'Hatchback', 'car', 0);` +
    `INSERT INTO services (id, shop_id, name, applies_to, sort_order) VALUES ('${SVC}', '${SHOP}', 'Rust coat', 'car', 0);` +
    `INSERT INTO customers (id, shop_id, name, phone) VALUES ('${CUST}', '${SHOP}', 'Customer', '98${rand(8)}');` +
    `INSERT INTO vehicles (id, shop_id, customer_id, registration_number, vehicle_type_id) VALUES ('${VEH}', '${SHOP}', '${CUST}', 'AP39RC${rand(4)}', '${VT}');` +
    // A: started last night by Sita, paid just after midnight today in cash, with a commission line she sold; Ravi washed it.
    jobRow(job('a'), { by: U.sita, status: 'paid', total: 40000, created: at(YESTERDAY, '23:50'), paid: at(TODAY, '00:30'), method: 'cash', paidBy: U.sita }) +
    `INSERT INTO job_services (shop_id, job_id, service_id, price_at_time, commission_at_time, quantity) VALUES ('${SHOP}', '${job('a')}', '${SVC}', 40000, 2000, 1);` +
    `INSERT INTO job_sellers (shop_id, job_id, user_id, assigned_by_user_id) VALUES ('${SHOP}', '${job('a')}', '${U.sita}', '${U.sita}');` +
    `INSERT INTO job_washers (shop_id, job_id, user_id, assigned_by_user_id) VALUES ('${SHOP}', '${job('a')}', '${U.ravi}', '${U.sita}');` +
    // B: Ravi at a customer's home today, paid in cash.
    jobRow(job('b'), { by: U.ravi, status: 'paid', total: 48000, mode: 'doorstep', created: at(TODAY, '00:35'), paid: at(TODAY, '00:40'), method: 'cash', paidBy: U.ravi }) +
    // C: started today, not paid yet. D: yesterday, paid yesterday by UPI. E: today, voided by the owner.
    jobRow(job('c'), { by: U.sita, status: 'waiting', total: 30000, created: at(TODAY, '00:45') }) +
    jobRow(job('d'), { by: U.sita, status: 'paid', total: 30000, created: at(YESTERDAY, '10:00'), paid: at(YESTERDAY, '10:30'), method: 'upi', paidBy: U.sita }) +
    jobRow(job('e'), { by: U.owner, status: 'void', total: 30000, created: at(TODAY, '00:50'), voidedBy: U.owner }) +
    `INSERT INTO job_events (id, shop_id, job_id, user_id, action, from_value, to_value, reason, created_at) VALUES ('ev_rep_${run}', '${SHOP}', '${job('e')}', '${U.owner}', 'voided', 'waiting', 'void', 'Entered by mistake', '${at(TODAY, '00:55')}');`,
);

const T = {};
for (const [who, p] of Object.entries(phone)) T[who] = (await signInWith(p, PIN)).body?.token;
check('Owner, manager and two staff sign in', Object.values(T).every(Boolean));
if (!Object.values(T).every(Boolean)) process.exit(1);

const day = (d) => `range=custom&from=${d}&to=${d}`;
const person = (r, id) => r.body?.rows?.find((x) => x.userId === id);

// ─── Reports ─────────────────────────────────────────────────────────────────

let r = await call(T.owner, 'GET', '/jobs/stats?range=today');
const today = r.body;
check('Today: the car started last night and paid this morning counts today', r.status === 200 && today?.carsWashed === 2 && today?.revenue === 88000 && today?.cash === 88000, show(r));
check('…doorstep washes and their money are shown apart', today?.doorstepWashes === 1 && today?.doorstepRevenue === 48000, show(r));
check('…with the void and the car still waiting', today?.voided === 1 && today?.pendingNow === 1, show(r));
r = await call(T.owner, 'GET', `/jobs/stats?${day(YESTERDAY)}`);
check('Yesterday: only the wash paid yesterday', r.status === 200 && r.body?.carsWashed === 1 && r.body?.revenue === 30000 && r.body?.upi === 30000 && r.body?.doorstepWashes === 0, show(r));
r = await call(T.manager, 'GET', '/jobs/stats?range=today');
check('Reports are the owner’s', r.status === 403, show(r));

// ─── Staff report ────────────────────────────────────────────────────────────

r = await call(T.owner, 'GET', '/reports/staff?range=today');
const staffToday = r;
check('Sita collected ₹400 today — the overnight car, paid today', person(r, U.sita)?.collected === 40000 && person(r, U.sita)?.cash === 40000 && person(r, U.sita)?.jobsCollected === 1, show(r));
check('…and earned its ₹20 commission today, when it was paid', person(r, U.sita)?.commission === 2000 && person(r, U.sita)?.servicesSold === 1, JSON.stringify(person(r, U.sita)));
check('Ravi collected ₹480 at the door and washed the overnight car', person(r, U.ravi)?.collected === 48000 && person(r, U.ravi)?.washesDone === 1, JSON.stringify(person(r, U.ravi)));
check('Started counts by when a wash was started (Sita 1, Ravi 1 today)', person(r, U.sita)?.washesStarted === 1 && person(r, U.ravi)?.washesStarted === 1, JSON.stringify(r.body?.rows));
check('The owner’s void is on the owner', person(r, U.owner)?.voids === 1, JSON.stringify(person(r, U.owner)));
const staffCash = (r.body?.rows ?? []).reduce((s, x) => s + x.cash, 0);
check('The staff report’s cash adds up to Reports’ cash for the same day', staffCash === today?.cash, `${staffCash} vs ${today?.cash}`);
r = await call(T.owner, 'GET', `/reports/staff?${day(YESTERDAY)}`);
check('Yesterday: Sita started two washes but collected only the one paid yesterday', person(r, U.sita)?.washesStarted === 2 && person(r, U.sita)?.collected === 30000 && person(r, U.sita)?.commission === 0, JSON.stringify(person(r, U.sita)));
check('Ravi holds the ₹480 doorstep cash', person(staffToday, U.ravi)?.doorstepHeld === 48000 && person(staffToday, U.ravi)?.doorstepShort === 0, JSON.stringify(person(staffToday, U.ravi)));

// ─── Nobody leaves holding cash ──────────────────────────────────────────────

r = await call(T.owner, 'DELETE', `/team/${U.ravi}`);
check('Ravi can’t be removed while he holds doorstep cash', r.status === 409 && r.body?.error === 'cash_held' && r.body?.held === 48000, show(r));
r = await call(T.manager, 'PATCH', `/team/${U.ravi}`, { active: false });
check('…nor switched off', r.status === 409 && r.body?.error === 'cash_held', show(r));
r = await call(T.manager, 'PATCH', `/team/${U.ravi}`, { name: 'Ravi K' });
check('…but his name can still be changed', r.status === 200, show(r));

// ─── Handovers and the corrections feed ──────────────────────────────────────

await call(T.owner, 'PUT', '/cash/day/float', { date: TODAY, amount: 10000 });
r = await call(T.sita, 'POST', '/cash/handover', { collectorId: U.ravi, due: 48000, received: 40000, rest: 'missing', note: 'Lost' });
check('Ravi hands in ₹400 of ₹480, ₹80 lost', r.status === 201, show(r));
const handoverId = r.body?.doorstep?.handovers?.[0]?.id;
r = await call(T.owner, 'GET', '/reports/staff?range=today');
check('The staff report shows Ravi ₹80 short, holding nothing', person(r, U.ravi)?.doorstepShort === 8000 && person(r, U.ravi)?.doorstepHeld === 0, JSON.stringify(person(r, U.ravi)));
r = await call(T.owner, 'POST', `/cash/handover/${encodeURIComponent(handoverId)}/void`, { reason: 'Recounted: it was all there' });
r = await call(T.sita, 'POST', '/cash/handover', { collectorId: U.ravi, due: 48000, received: 48000 });
r = await call(T.sita, 'POST', '/cash/day/close', { date: TODAY, counted: 10000 + 40000 + 48000 });
check('The drawer closes matching: float + shop cash + doorstep cash handed in', r.status === 200 && r.body?.difference === 0, show(r));
await call(T.owner, 'POST', '/cash/day/reopen', { date: TODAY, reason: 'Late expense to add' });

const EXP = `exp_rep_${run}`;
d1Run(
  `INSERT INTO expenses (id, shop_id, category, amount, item_name, payment_method, cash_source, date, created_by_user_id) VALUES ('${EXP}', '${SHOP}', 'other', 20000, 'Petrol', 'cash', 'held', '${at(TODAY, '00:00')}', '${U.ravi}');` +
    `INSERT INTO expense_edits (id, shop_id, expense_id, edited_by_user_id, reason, changes) VALUES ('edit_rep_${run}', '${SHOP}', '${EXP}', '${U.owner}', 'Paid from his doorstep cash', '[{"field":"cashSource","from":"drawer","to":"held"}]');`,
);
r = await call(T.owner, 'GET', '/reports/audit?range=today');
const items = r.body?.items ?? [];
const undo = items.find((x) => x.kind === 'handover_undo');
check('The corrections feed has the undone handover, with who and why', undo?.amount === 40000 && undo?.by?.name === 'Owner' && undo?.reason === 'Recounted: it was all there' && /Ravi/.test(undo?.title ?? ''), JSON.stringify(undo));
const reopen = items.find((x) => x.kind === 'drawer_reopen');
check('…the reopened cash day, with what the close had counted', reopen?.amount === 98000 && reopen?.reason === 'Late expense to add' && reopen?.subtitle === 'Was closed matching', JSON.stringify(reopen));
const edit = items.find((x) => x.kind === 'expense_edit');
check('…and an expense moved to doorstep cash, in words', edit?.fromValue === 'Paid from: Shop cash box' && edit?.toValue === 'Paid from: Doorstep cash', JSON.stringify(edit));
check('…along with the void', items.some((x) => x.kind === 'job_void' && x.jobId === job('e')), JSON.stringify(items.map((x) => x.kind)));

r = await call(T.manager, 'DELETE', `/team/${U.ravi}`);
check('With his cash in (and his petrol spent from it), Ravi can leave the team', r.status === 200, show(r));

// ─── Attendance ──────────────────────────────────────────────────────────────

r = await call(T.manager, 'PUT', '/attendance', { userId: U.sita, date: TODAY, status: 'present' });
check('The manager marks Sita present today', r.status === 200, show(r));
r = await call(T.manager, 'PUT', '/attendance', { userId: U.owner, date: TODAY, status: 'present' });
check('…but not the owner', r.status === 403, show(r));
r = await call(T.manager, 'PUT', '/attendance', { userId: U.manager, date: TODAY, status: 'present' });
check('…nor themselves', r.status === 403, show(r));
r = await call(T.manager, 'PUT', '/attendance', { userId: U.sita, date: istDay(3), status: 'present' });
check('…nor a day older than yesterday', r.status === 400 && r.body?.error === 'date_not_allowed', show(r));
r = await call(T.owner, 'PUT', '/attendance', { userId: U.sita, date: istDay(-1), status: 'present' });
check('Nobody marks a future day', r.status === 400 && r.body?.error === 'future_date', show(r));
r = await call(T.owner, 'PUT', '/attendance', { userId: U.owner, date: TODAY, status: 'present' });
check('An owner marks their own day (nobody above them does)', r.status === 200, show(r));
r = await call(T.owner, 'GET', `/attendance?date=${TODAY}`);
check('…and is on their own sheet', (r.body?.rows ?? []).some((row) => row.userId === U.owner && row.canMark && row.status === 'present'), show(r));
r = await call(T.owner, 'PUT', '/attendance', { userId: U.owner, date: TODAY, status: null });
r = await call(T.owner, 'PUT', '/attendance', { userId: U.sita, date: YESTERDAY, status: 'half' });
check('The owner marks Sita half a day yesterday', r.status === 200, show(r));
r = await call(T.owner, 'PUT', '/attendance', { userId: U.ravi, date: TODAY, status: 'present' });
check('Someone removed from the team can’t be marked', r.status === 404, show(r));
r = await call(T.owner, 'GET', `/reports/staff?range=custom&from=${YESTERDAY}&to=${TODAY}`);
check('The staff report counts 1.5 days worked for Sita', person(r, U.sita)?.attendance?.daysWorked === 1.5 && person(r, U.sita)?.attendance?.half === 1, JSON.stringify(person(r, U.sita)?.attendance));
r = await call(T.sita, 'GET', `/shop/me/earnings?range=custom&from=${YESTERDAY}&to=${TODAY}`);
check('Sita sees her own commission and days', r.status === 200 && r.body?.commission === 2000 && r.body?.attendance?.daysWorked === 1.5, show(r));
r = await call(T.sita, 'GET', '/reports/staff?range=today');
check('Staff can’t open the staff report', r.status === 403, show(r));

// ─── Clean up ────────────────────────────────────────────────────────────────

try {
  const tables = ['attendance', 'expense_edits', 'expenses', 'cash_handovers', 'cash_day_closes', 'cash_days', 'job_events', 'job_washers', 'job_sellers', 'job_services', 'jobs', 'vehicles', 'customers', 'services', 'vehicle_types', 'login_codes', 'users'];
  d1Run(`PRAGMA foreign_keys = OFF; ${tables.map((t) => `DELETE FROM ${t} WHERE shop_id = '${SHOP}';`).join(' ')} DELETE FROM shops WHERE id = '${SHOP}';`);
} catch {
  // Left behind for the next db:reset:local.
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
