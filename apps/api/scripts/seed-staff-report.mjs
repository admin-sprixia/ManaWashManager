// Demo data for the Staff report at one branch on the local server: 5 staff, a week of washes
// (cash, UPI, other) started and paid by each through the API, commission on Anti-Rust and
// Premium Wash, two weeks of attendance, and a few voided washes for the Corrections tab.
//
//   cd apps/api && node scripts/seed-staff-report.mjs [--shop=KVR-001]
//
// Local only. Adds data; removes nothing. Staff sign in with their number and PIN 258025.
// Running it again adds another week of washes for the same 5 staff.
import { randomUUID } from 'node:crypto';
import { API, TARGET, apiFetch, d1Rows, d1Run, signIn } from './lib/target.mjs';

if (TARGET !== 'local') throw new Error('This script only seeds the local database.');

const SHOP_CODE = (process.argv.find((a) => a.startsWith('--shop=')) ?? '--shop=KVR-001').slice(7);
const PIN = '258025';
const STAFF = [
  { id: 'user_demo_ravi', name: 'Ravi Kumar', phone: '9390000101', pace: 5 },
  { id: 'user_demo_suresh', name: 'Suresh Babu', phone: '9390000102', pace: 4 },
  { id: 'user_demo_kiran', name: 'Kiran Teja', phone: '9390000103', pace: 4 },
  { id: 'user_demo_mahesh', name: 'Mahesh Reddy', phone: '9390000104', pace: 3 },
  { id: 'user_demo_anil', name: 'Anil Varma', phone: '9390000105', pace: 2 },
];
const CUSTOMERS = ['Srinivas', 'Lakshmi', 'Venkatesh', 'Padma', 'Rajesh', 'Kavya', 'Naveen', 'Sujatha', 'Prasad', 'Divya', 'Ramesh', 'Swathi'];
const COMMISSION = { 'Anti-Rust Protection': 10000, 'Premium Wash': 3000 };
const DAY_MS = 86_400_000;
const IST_MS = 330 * 60_000;

const sql = (v) => `'${String(v).replace(/'/g, "''")}'`;
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const chance = (p) => Math.random() < p;

async function call(token, method, path, body) {
  const res = await apiFetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
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

/** 9:30 IST on the day `daysAgo` before today, plus `minutes`. */
function istTime(daysAgo, minutes) {
  const now = Date.now();
  const istMidnight = Math.floor((now + IST_MS) / DAY_MS) * DAY_MS - IST_MS;
  return new Date(istMidnight - daysAgo * DAY_MS + (9 * 60 + 30 + minutes) * 60_000);
}

const shop = d1Rows(`SELECT id, name FROM shops WHERE code = ${sql(SHOP_CODE)}`)[0];
if (!shop) throw new Error(`No branch with code ${SHOP_CODE}.`);
const owner = d1Rows(`SELECT id FROM users WHERE shop_id = ${sql(shop.id)} AND role = 'owner' AND active = 1 ORDER BY created_at LIMIT 1`)[0];
if (!owner) throw new Error('The branch needs an owner to mark attendance.');
console.log(`Seeding the Staff report at ${shop.name} (${SHOP_CODE})…`);

// 1 · The team: staff rows as Team › Add makes them (no PIN yet), then each signs in.
for (const s of STAFF) {
  const known = d1Rows(`SELECT id FROM users WHERE shop_id = ${sql(shop.id)} AND phone = ${sql(s.phone)}`)[0];
  if (known) s.id = known.id;
  else d1Run(`INSERT INTO users (id, shop_id, name, phone, role) VALUES (${sql(s.id)}, ${sql(shop.id)}, ${sql(s.name)}, ${sql(s.phone)}, 'staff')`);
}
for (const s of STAFF) {
  const r = await signIn(s.phone, PIN);
  if (!r.body?.token) throw new Error(`${s.name} couldn’t sign in: ${JSON.stringify(r.body)}`);
  s.token = r.body.token;
}
console.log(`  5 staff signed in (PIN ${PIN})`);

// 2 · Commission on two services, before any wash (commission is copied onto each wash).
const services = (await call(STAFF[0].token, 'GET', '/services')).body ?? [];
const types = ((await call(STAFF[0].token, 'GET', '/services/vehicle-types')).body ?? []).filter((t) => t.category === 'car');
const prices = (await call(STAFF[0].token, 'GET', '/services/prices?mode=hub')).body ?? [];
const byName = new Map(services.map((x) => [x.name, x]));
const statements = [];
for (const [name, amount] of Object.entries(COMMISSION)) {
  const service = byName.get(name);
  if (!service) continue;
  for (const t of types) {
    statements.push(
      `INSERT INTO commission_rates (shop_id, service_id, vehicle_type_id, amount) VALUES (${sql(shop.id)}, ${sql(service.id)}, ${sql(t.id)}, ${amount}) ON CONFLICT (service_id, vehicle_type_id) DO UPDATE SET amount = excluded.amount`,
    );
  }
}
if (statements.length) d1Run(statements.join(';\n'));
console.log('  Commission: Anti-Rust Protection ₹100, Premium Wash ₹30 a car');

const priced = (serviceId, typeId) => prices.some((p) => p.serviceId === serviceId && p.vehicleTypeId === typeId && p.price > 0);
const washes = ['Express Wash', 'Basic Wash', 'Premium Wash'].map((n) => byName.get(n)).filter(Boolean);
const antiRust = byName.get('Anti-Rust Protection');
if (!washes.length || !types.length) throw new Error('The branch needs car washes and car vehicle types first.');

// 3 · Two weeks of attendance, marked by the owner (a half day here and there, a day off).
const attendance = new Map();
const rows = [];
for (const s of STAFF) {
  for (let d = 0; d < 14; d++) {
    const date = new Date(istTime(d, 0).getTime() + IST_MS).toISOString().slice(0, 10);
    const status = d === 0 ? 'present' : chance(0.08) ? 'absent' : chance(0.1) ? 'half' : 'present';
    attendance.set(`${s.id}|${d}`, status);
    rows.push(`(${sql(shop.id)}, ${sql(s.id)}, ${sql(date)}, ${sql(status)}, ${sql(owner.id)})`);
  }
}
d1Run(
  `INSERT INTO attendance (shop_id, user_id, date, status, marked_by_user_id) VALUES ${rows.join(', ')} ON CONFLICT (user_id, date) DO UPDATE SET status = excluded.status`,
);
console.log('  Attendance: 14 days for each');

// 4 · A week of washes, each started, washed and paid by the staff member through the API.
let paid = 0;
let voided = 0;
let open = 0;
for (let d = 6; d >= 0; d--) {
  for (const s of STAFF) {
    const status = attendance.get(`${s.id}|${d}`);
    if (status === 'absent') continue;
    const count = Math.max(1, Math.round(s.pace * (status === 'half' ? 0.5 : 1) * (0.7 + Math.random() * 0.6)));
    for (let i = 0; i < count; i++) {
      const start = istTime(d, Math.floor(Math.random() * 600));
      if (start.getTime() > Date.now() - 30 * 60_000) continue;
      const type = pick(types);
      const wash = pick(washes.filter((w) => priced(w.id, type.id)));
      if (!wash) continue;
      const lines = [{ serviceId: wash.id, quantity: 1 }];
      const sellsRust = antiRust && priced(antiRust.id, type.id) && chance(0.18);
      if (sellsRust) lines.push({ serviceId: antiRust.id, quantity: 1 });
      const commission = sellsRust || wash.name === 'Premium Wash';
      const helper = chance(0.25) ? pick(STAFF.filter((x) => x.id !== s.id)) : null;
      const id = randomUUID();
      const r = await call(s.token, 'POST', '/jobs/start', {
        id,
        occurredAt: start.toISOString(),
        customer: { phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, name: pick(CUSTOMERS) },
        registrationNumber: `AP${String(10 + Math.floor(Math.random() * 30))}${pick(['AB', 'CD', 'EF', 'GK', 'MN'])}${1000 + Math.floor(Math.random() * 8999)}`,
        vehicleTypeId: type.id,
        services: lines,
        ...(commission ? { sellerIds: helper ? [s.id, helper.id] : [s.id] } : {}),
      });
      if (r.status !== 201 && r.status !== 200) {
        console.warn(`  skipped a wash: ${JSON.stringify(r.body)}`);
        continue;
      }
      const at = (min) => new Date(start.getTime() + min * 60_000).toISOString();
      // Today's last ones are still in the shop.
      if (d === 0 && chance(0.15)) {
        open += 1;
        continue;
      }
      if (chance(0.04)) {
        await call(s.token, 'POST', `/jobs/${id}/void`, { reason: pick(['Customer left before the wash', 'Started twice by mistake', 'Wrong vehicle picked']), occurredAt: at(5) });
        voided += 1;
        continue;
      }
      await call(s.token, 'PATCH', `/jobs/${id}/status`, { status: 'washing', occurredAt: at(8), washerIds: helper ? [s.id, helper.id] : [s.id] });
      await call(s.token, 'PATCH', `/jobs/${id}/status`, { status: 'ready', occurredAt: at(35) });
      const method = chance(0.55) ? 'cash' : chance(0.9) ? 'upi' : 'other';
      const pay = await call(s.token, 'POST', `/jobs/${id}/pay`, { paymentMethod: method, occurredAt: at(42) });
      if (pay.status < 300) paid += 1;
    }
  }
}
console.log(`  Washes: ${paid} paid, ${voided} voided, ${open} still in the shop today`);
console.log('Done. Open More › Staff report (Today, Last 7 days or This month).');
