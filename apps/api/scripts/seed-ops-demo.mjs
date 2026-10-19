// Demo data for the Cash drawer, Expenses and Inventory at one branch on the local server,
// entered by the demo staff from seed-staff-report.mjs (run that first):
//   · Inventory: supplies bought through Expenses with "add to stock", then used day by day,
//     with low-stock warnings (a couple of items are running low).
//   · Expenses: ten days of chemicals, wages, electricity, water, a repair and tea, with photos.
//   · Cash drawer: the last week counted and closed (one day ₹50 short, one ₹20 over, with notes),
//     yesterday closed and today's float set by staff through the API, today left open.
//
//   cd apps/api && node scripts/seed-ops-demo.mjs [--shop=KVR-001]
//
// Local only. Adds data; days that already have a cash count are left alone.
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { API, TARGET, apiFetch, d1Rows, d1Run, signIn } from './lib/target.mjs';

if (TARGET !== 'local') throw new Error('This script only seeds the local database.');

const SHOP_CODE = (process.argv.find((a) => a.startsWith('--shop=')) ?? '--shop=KVR-001').slice(7);
const PIN = '258025';
const STAFF_PHONES = ['9390000101', '9390000102', '9390000103', '9390000104', '9390000105'];
const FLOAT = 200000; // ₹2,000 left in the box each morning
const DAY_MS = 86_400_000;
const IST_MS = 330 * 60_000;

const sql = (v) => `'${String(v).replace(/'/g, "''")}'`;

async function call(token, method, path, body, form) {
  const res = await apiFetch(API + path, {
    method,
    headers: { ...(form ? {} : { 'content-type': 'application/json' }), authorization: `Bearer ${token}` },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

/** IST midnight `daysAgo` days back, as a Date. */
function istMidnight(daysAgo) {
  return new Date(Math.floor((Date.now() + IST_MS) / DAY_MS) * DAY_MS - IST_MS - daysAgo * DAY_MS);
}
const istDate = (daysAgo) => new Date(istMidnight(daysAgo).getTime() + IST_MS).toISOString().slice(0, 10);
const at = (daysAgo, hour, minute = 0) => new Date(istMidnight(daysAgo).getTime() + (hour * 60 + minute) * 60_000);

// ─── A small solid-colour PNG for the bill and item photos ──────────────────
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png([r, g, b], size = 96) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const BILL = png([245, 241, 230]);
const ITEM = png([90, 140, 220]);

// ─── Who's entering it ───────────────────────────────────────────────────────
const shop = d1Rows(`SELECT id, name FROM shops WHERE code = ${sql(SHOP_CODE)}`)[0];
if (!shop) throw new Error(`No branch with code ${SHOP_CODE}.`);
const staff = d1Rows(
  `SELECT id, name, phone FROM users WHERE shop_id = ${sql(shop.id)} AND phone IN (${STAFF_PHONES.map(sql).join(', ')}) AND active = 1 ORDER BY phone`,
);
if (staff.length < 3) throw new Error('Run seed-staff-report.mjs first: it adds the demo staff.');
for (const s of staff) {
  const r = await signIn(s.phone, PIN);
  if (!r.body?.token) throw new Error(`${s.name} couldn’t sign in: ${JSON.stringify(r.body)}`);
  s.token = r.body.token;
}
const [ravi, suresh, kiran, mahesh, anil] = [...staff, ...staff];
console.log(`Seeding the cash drawer, expenses and inventory at ${shop.name} (${SHOP_CODE})…`);

// ─── Expenses (supplies go into stock) and stock used, in the order they happened ──
const EXPENSES = [
  { d: 9, h: 10, by: ravi, category: 'chemicals', itemName: 'Foam shampoo', quantity: 10, unit: 'l', amount: 2400, method: 'cash', stock: true, description: 'Foam wash' },
  { d: 9, h: 11, by: suresh, category: 'chemicals', itemName: 'Microfibre cloth', quantity: 30, unit: 'pcs', amount: 1500, method: 'upi', stock: true, description: 'Interior cleaning' },
  { d: 8, h: 10, by: kiran, category: 'chemicals', itemName: 'Car wax', quantity: 3, unit: 'l', amount: 1800, method: 'cash', stock: true, description: 'Polishing' },
  { d: 8, h: 18, by: ravi, category: 'labour', itemName: 'Daily wages – helper', quantity: 1, unit: 'days', amount: 500, method: 'cash' },
  { d: 7, h: 10, by: ravi, category: 'chemicals', itemName: 'Tyre shine', quantity: 5, unit: 'l', amount: 1250, method: 'cash', stock: true, description: 'Tyres' },
  { d: 6, h: 10, by: mahesh, category: 'chemicals', itemName: 'Glass cleaner', quantity: 4, unit: 'l', amount: 640, method: 'cash', stock: true, description: 'Glass' },
  { d: 6, h: 12, by: suresh, category: 'electricity', itemName: 'Electricity bill', quantity: 420, unit: 'kwh', amount: 3360, method: 'upi', description: 'September bill' },
  { d: 5, h: 10, by: anil, category: 'chemicals', itemName: 'Dashboard polish', quantity: 2, unit: 'l', amount: 900, method: 'upi', stock: true, description: 'Interior cleaning' },
  { d: 5, h: 15, by: mahesh, category: 'water', itemName: 'Water tanker', quantity: 2, unit: 'tankers', amount: 1400, method: 'cash' },
  { d: 4, h: 10, by: suresh, category: 'chemicals', itemName: 'Sponge', quantity: 12, unit: 'pcs', amount: 360, method: 'cash', stock: true, description: 'Bikes' },
  { d: 4, h: 11, by: ravi, category: 'chemicals', itemName: 'Brush', quantity: 4, unit: 'pcs', amount: 480, method: 'cash', stock: true, description: 'Tyres' },
  { d: 3, h: 16, by: anil, category: 'maintenance', itemName: 'Pressure washer nozzle', quantity: 1, unit: 'pcs', amount: 850, method: 'cash', description: 'Old one cracked' },
  { d: 3, h: 18, by: kiran, category: 'labour', itemName: 'Daily wages – helper', quantity: 1, unit: 'days', amount: 500, method: 'cash' },
  { d: 2, h: 14, by: kiran, category: 'water', itemName: 'Water tanker', quantity: 1, unit: 'tankers', amount: 700, method: 'cash' },
  { d: 1, h: 10, by: mahesh, category: 'chemicals', itemName: 'Foam shampoo', quantity: 5, unit: 'l', amount: 1200, method: 'cash', stock: true, description: 'Foam wash' },
  { d: 1, h: 17, by: ravi, category: 'other', itemName: 'Tea and snacks', amount: 180, method: 'cash' },
  { d: 0, h: 11, by: suresh, category: 'other', itemName: 'Garbage bags', amount: 120, method: 'cash' },
];
/** What the team takes off the shelf on a working day, per item (in its unit). */
const DAILY_USE = { 'Foam shampoo': 1.1, 'Microfibre cloth': 2, 'Car wax': 0.25, 'Tyre shine': 0.35, 'Glass cleaner': 0.45, 'Dashboard polish': 0.15, Sponge: 1, Brush: 0 };
const LOW_AT = { 'Foam shampoo': 3, 'Microfibre cloth': 10, 'Car wax': 1, 'Tyre shine': 1, 'Glass cleaner': 1.5, 'Dashboard polish': 0.5, Sponge: 4, Brush: 1 };
const UNITS = { 'Microfibre cloth': 'pcs', Sponge: 'pcs', Brush: 'pcs' };

const backdate = []; // [table, id, when]
let expenses = 0;
let uses = 0;
for (let d = 9; d >= 0; d--) {
  for (const e of EXPENSES.filter((x) => x.d === d)) {
    const id = `exp_demo_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const data = {
      id,
      category: e.category,
      amount: e.amount * 100,
      itemName: e.itemName,
      ...(e.quantity != null ? { quantity: e.quantity, unit: e.unit } : {}),
      ...(e.description ? { description: e.description } : {}),
      paymentMethod: e.method,
      cashSource: 'drawer',
      date: istDate(d),
      ...(e.stock ? { addToStock: true } : {}),
    };
    const form = new FormData();
    form.set('data', JSON.stringify(data));
    form.set('billPhoto', new File([BILL], 'bill.png', { type: 'image/png' }));
    form.set('itemPhoto', new File([ITEM], 'item.png', { type: 'image/png' }));
    const r = await call(e.by.token, 'POST', '/expenses', null, form);
    if (r.status >= 300) {
      console.warn(`  skipped an expense (${e.itemName}): ${JSON.stringify(r.body)}`);
      continue;
    }
    expenses += 1;
    for (const m of d1Rows(`SELECT id FROM stock_moves WHERE expense_id = ${sql(id)}`)) backdate.push(['stock_moves', m.id, at(d, e.h)]);
  }
  // The day's use, logged by whoever was on shift, once the morning's purchases are in.
  const items = (await call(ravi.token, 'GET', '/stock')).body?.items ?? [];
  for (const item of items) {
    const per = DAILY_USE[item.name];
    if (!per || item.balance <= 0) continue;
    const qty = UNITS[item.name] ? Math.max(1, Math.round(per * (0.5 + Math.random()))) : Math.round(per * (0.7 + Math.random() * 0.6) * 100) / 100;
    const id = `mv_demo_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const by = staff[(d + uses) % staff.length];
    const r = await call(by.token, 'POST', '/stock/moves', { id, itemId: item.id, kind: 'use', quantity: qty, unit: UNITS[item.name] ?? 'l', note: 'Daily use' });
    if (r.status < 300) {
      uses += 1;
      backdate.push(['stock_moves', id, at(d, 18, 30)]);
    }
  }
}
// The moves happened on their days, not all today.
for (const [table, id, when] of backdate) d1Run(`UPDATE ${table} SET created_at = ${sql(when.toISOString())} WHERE id = ${sql(id)}`);
// Warn-when-low levels, as the owner would set them.
for (const [name, lowAt] of Object.entries(LOW_AT)) {
  d1Run(`UPDATE stock_items SET low_at = ${lowAt} WHERE shop_id = ${sql(shop.id)} AND name = ${sql(name)} AND active = 1`);
}
console.log(`  Expenses: ${expenses} entered · Inventory: ${uses} uses logged, low-stock levels set`);

// ─── Cash drawer ─────────────────────────────────────────────────────────────
/** What the drawer should hold at the end of a day, the way the app works it out. */
function expectedFor(d) {
  const from = istMidnight(d).toISOString();
  const to = istMidnight(d - 1).toISOString();
  const cashIn =
    d1Rows(
      `SELECT COALESCE(SUM(total), 0) AS t FROM jobs WHERE shop_id = ${sql(shop.id)} AND status = 'paid' AND payment_method = 'cash' AND delivery_mode = 'hub' AND julianday(completed_at) >= julianday(${sql(from)}) AND julianday(completed_at) < julianday(${sql(to)})`,
    )[0]?.t ?? 0;
  const cashOut =
    d1Rows(
      `SELECT COALESCE(SUM(amount), 0) AS t FROM expenses WHERE shop_id = ${sql(shop.id)} AND voided_at IS NULL AND payment_method = 'cash' AND cash_source = 'drawer' AND julianday(date) >= julianday(${sql(from)}) AND julianday(date) < julianday(${sql(to)})`,
    )[0]?.t ?? 0;
  return FLOAT + cashIn - cashOut;
}
const DIFF = { 5: { by: -5000, note: '₹50 short: gave wrong change to a customer' }, 3: { by: 2000, note: '₹20 over: a customer said keep the change' } };
let closedDays = 0;
for (let d = 7; d >= 2; d--) {
  const date = istDate(d);
  if (d1Rows(`SELECT 1 AS x FROM cash_days WHERE shop_id = ${sql(shop.id)} AND date = ${sql(date)}`).length) continue;
  const expected = expectedFor(d);
  const diff = DIFF[d];
  const counted = Math.max(0, expected + (diff?.by ?? 0));
  const opener = staff[d % staff.length];
  const closer = staff[(d + 2) % staff.length];
  d1Run(
    `INSERT INTO cash_days (shop_id, date, opening_float, float_set_by_user_id, float_set_at, expected, counted, note, closed_by_user_id, closed_at, held_at_close)
     VALUES (${sql(shop.id)}, ${sql(date)}, ${FLOAT}, ${sql(opener.id)}, ${sql(at(d, 9).toISOString())}, ${expected}, ${counted}, ${diff ? sql(diff.note) : 'NULL'}, ${sql(closer.id)}, ${sql(at(d, 21).toISOString())}, 0)`,
  );
  closedDays += 1;
}
// Yesterday through the API, as staff close it; today's float, left open.
const yesterday = istDate(1);
let y = (await call(kiran.token, 'GET', `/cash/day?date=${yesterday}`)).body;
if (y?.status === 'not_started') {
  await call(kiran.token, 'PUT', '/cash/day/float', { date: yesterday, amount: FLOAT });
  y = (await call(kiran.token, 'GET', `/cash/day?date=${yesterday}`)).body;
}
if (y?.status === 'open') {
  const r = await call(ravi.token, 'POST', '/cash/day/close', { date: yesterday, counted: y.expected });
  if (r.status < 300) closedDays += 1;
  else console.warn(`  couldn’t close yesterday: ${JSON.stringify(r.body)}`);
}
const today = istDate(0);
const t = (await call(suresh.token, 'GET', `/cash/day?date=${today}`)).body;
if (t?.status === 'not_started') await call(suresh.token, 'PUT', '/cash/day/float', { date: today, amount: FLOAT });
console.log(`  Cash drawer: ${closedDays} days counted and closed, today open with a ₹${FLOAT / 100} float`);
console.log('Done. Open More › Cash drawer, Expenses and Inventory.');
