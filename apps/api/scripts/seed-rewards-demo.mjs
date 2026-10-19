// Demo data for Rewards at one branch on the local server (run seed-staff-report.mjs first):
//   · Stamp cards: Basic Wash every 5 → 1 free, Premium Wash every 4 → 1 free.
//   · Welcome gift: a microfibre cloth and an air freshener (only 3 in stock, so later new cars
//     are owed one: the "To hand over" tab).
//   · Regulars washed by the demo staff through the API: cards part-way, one free wash ready,
//     one free wash used, and one old regular whose card resets in a few days.
//
//   cd apps/api && node scripts/seed-rewards-demo.mjs [--shop=KVR-001]
//
// Local only. Adds data; the stamp-card and gift settings are set (or updated) for the branch.
import { randomUUID } from 'node:crypto';
import { API, TARGET, apiFetch, d1Rows, d1Run, signIn } from './lib/target.mjs';

if (TARGET !== 'local') throw new Error('This script only seeds the local database.');

const SHOP_CODE = (process.argv.find((a) => a.startsWith('--shop=')) ?? '--shop=KVR-001').slice(7);
const PIN = '258025';
const STAFF_PHONES = ['9390000101', '9390000102', '9390000103', '9390000104', '9390000105'];
const DAY_MS = 86_400_000;
const IST_MS = 330 * 60_000;
const sql = (v) => `'${String(v).replace(/'/g, "''")}'`;
const pick = (list) => list[Math.floor(Math.random() * list.length)];

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
const istMidnight = (daysAgo) => new Date(Math.floor((Date.now() + IST_MS) / DAY_MS) * DAY_MS - IST_MS - daysAgo * DAY_MS);
const at = (daysAgo, hour, minute = 0) => new Date(istMidnight(daysAgo).getTime() + (hour * 60 + minute) * 60_000);

const shop = d1Rows(`SELECT id, name FROM shops WHERE code = ${sql(SHOP_CODE)}`)[0];
if (!shop) throw new Error(`No branch with code ${SHOP_CODE}.`);
const owner = d1Rows(`SELECT id FROM users WHERE shop_id = ${sql(shop.id)} AND role = 'owner' AND active = 1 ORDER BY created_at LIMIT 1`)[0];
const staff = d1Rows(`SELECT id, name, phone FROM users WHERE shop_id = ${sql(shop.id)} AND phone IN (${STAFF_PHONES.map(sql).join(', ')}) AND active = 1 ORDER BY phone`);
if (staff.length < 3) throw new Error('Run seed-staff-report.mjs first: it adds the demo staff.');
for (const s of staff) {
  const r = await signIn(s.phone, PIN);
  if (!r.body?.token) throw new Error(`${s.name} couldn’t sign in: ${JSON.stringify(r.body)}`);
  s.token = r.body.token;
}
console.log(`Seeding Rewards at ${shop.name} (${SHOP_CODE})…`);

const services = (await call(staff[0].token, 'GET', '/services')).body ?? [];
const types = ((await call(staff[0].token, 'GET', '/services/vehicle-types')).body ?? []).filter((t) => t.category === 'car');
const prices = (await call(staff[0].token, 'GET', '/services/prices?mode=hub')).body ?? [];
const basic = services.find((s) => s.name === 'Basic Wash');
const premium = services.find((s) => s.name === 'Premium Wash');
if (!basic || !premium) throw new Error('The branch needs Basic Wash and Premium Wash.');
const typeFor = (serviceId, name) =>
  types.find((t) => t.name === name && prices.some((p) => p.serviceId === serviceId && p.vehicleTypeId === t.id)) ??
  types.find((t) => prices.some((p) => p.serviceId === serviceId && p.vehicleTypeId === t.id));

// 1 · Stamp cards and the welcome gift, as the owner sets them in Rewards.
d1Run(
  [basic, premium]
    .map(
      (s, i) =>
        `INSERT INTO reward_rules (service_id, shop_id, every, active, updated_by_user_id) VALUES (${sql(s.id)}, ${sql(shop.id)}, ${i === 0 ? 5 : 4}, 1, ${sql(owner.id)}) ON CONFLICT (service_id) DO UPDATE SET every = excluded.every, active = 1`,
    )
    .join(';\n'),
);
let freshener = d1Rows(`SELECT id FROM stock_items WHERE shop_id = ${sql(shop.id)} AND name_key = 'air freshener' AND active = 1`)[0];
if (!freshener) {
  const id = `stk_demo_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  d1Run(
    `INSERT INTO stock_items (id, shop_id, name, name_key, unit, balance, low_at, created_by_user_id) VALUES (${sql(id)}, ${sql(shop.id)}, 'Air freshener', 'air freshener', 'pcs', 3, 5, ${sql(owner.id)});
     INSERT INTO stock_moves (id, shop_id, item_id, kind, quantity, balance_after, note, created_by_user_id) VALUES (${sql(`mv_demo_${id}`)}, ${sql(shop.id)}, ${sql(id)}, 'in', 3, 3, 'Opening stock', ${sql(owner.id)})`,
  );
  freshener = { id };
}
const cloth = d1Rows(`SELECT id FROM stock_items WHERE shop_id = ${sql(shop.id)} AND name_key = 'microfibre cloth' AND active = 1`)[0];
d1Run(
  [freshener, cloth]
    .filter(Boolean)
    .map(
      (item, i) =>
        `INSERT INTO reward_gift_items (stock_item_id, shop_id, quantity, sort_order, updated_by_user_id) VALUES (${sql(item.id)}, ${sql(shop.id)}, 1, ${i}, ${sql(owner.id)}) ON CONFLICT (stock_item_id) DO UPDATE SET quantity = 1`,
    )
    .join(';\n'),
);
console.log('  Stamp cards: Basic Wash every 5 → 1 free, Premium Wash every 4 → 1 free');
console.log('  Welcome gift: 1 air freshener (3 in stock) + 1 microfibre cloth');

// 2 · Regulars: the same car and phone, visit after visit.
const REGULARS = [
  { name: 'Srinivas Rao', phone: '9440011201', plate: 'AP39BW4521', service: basic, type: 'Hatchback', visits: 5 }, // free wash ready
  { name: 'Lakshmi Devi', phone: '9440011202', plate: 'AP39CK7710', service: basic, type: 'Sedan', visits: 5, useFree: true }, // used it
  { name: 'Venkatesh Naidu', phone: '9440011203', plate: 'AP26DM3308', service: premium, type: 'SUV', visits: 4 }, // free wash ready
  { name: 'Padma Priya', phone: '9440011204', plate: 'AP39EF9012', service: basic, type: 'Hatchback', visits: 4 }, // 1 to go
  { name: 'Rajesh Kumar', phone: '9440011205', plate: 'AP27GH5566', service: premium, type: 'Sedan', visits: 2 },
  { name: 'Kavya Sri', phone: '9440011206', plate: 'AP39JK1203', service: basic, type: 'Hatchback', visits: 3, old: true }, // resets soon
];
async function wash(by, r, daysAgo, hour, free = false) {
  const type = typeFor(r.service.id, r.type);
  const id = randomUUID();
  const start = at(daysAgo, hour, Math.floor(Math.random() * 40));
  const res = await call(by.token, 'POST', '/jobs/start', {
    id,
    occurredAt: start.toISOString(),
    customer: { phone: r.phone, name: r.name },
    registrationNumber: r.plate,
    vehicleTypeId: type.id,
    services: [{ serviceId: r.service.id, quantity: 1 }],
    ...(free ? { rewardServiceIds: [r.service.id] } : {}),
  });
  if (res.status >= 300) return console.warn(`  skipped a wash for ${r.name}: ${JSON.stringify(res.body)}`), null;
  const t = (min) => new Date(start.getTime() + min * 60_000).toISOString();
  await call(by.token, 'PATCH', `/jobs/${id}/status`, { status: 'washing', occurredAt: t(6), washerIds: [by.id] });
  await call(by.token, 'PATCH', `/jobs/${id}/status`, { status: 'ready', occurredAt: t(30) });
  await call(by.token, 'POST', `/jobs/${id}/pay`, { paymentMethod: pick(['cash', 'cash', 'upi']), occurredAt: t(36) });
  return id;
}
let visits = 0;
let freeUsed = 0;
const jobsOf = (plate) =>
  d1Rows(
    `SELECT j.id FROM jobs j JOIN vehicles v ON v.id = j.vehicle_id WHERE j.shop_id = ${sql(shop.id)} AND v.registration_number = ${sql(plate)} ORDER BY j.created_at`,
  ).map((x) => x.id);
for (const r of REGULARS) {
  // Already seeded (a re-run): leave their visits as they are.
  if (!jobsOf(r.plate).length) {
    for (let v = 0; v < r.visits; v++) {
      if (await wash(pick(staff), r, 6 - v, 10 + v)) visits += 1;
    }
    if (r.useFree && (await wash(pick(staff), r, 0, 16, true))) freeUsed += 1;
  }
  // An old regular: their washes were months ago, so the card is about to reset.
  if (r.old) {
    jobsOf(r.plate).forEach((id, i) => {
      const when = new Date(Date.now() - (178 - i * 2) * DAY_MS);
      d1Run(
        `UPDATE jobs SET created_at = ${sql(when.toISOString())}, completed_at = ${sql(new Date(when.getTime() + 36 * 60_000).toISOString())} WHERE id = ${sql(id)}`,
      );
    });
  }
}
// 3 · A few first-time cars today: each gets the welcome gift (the air fresheners run out).
for (let i = 0; i < 5; i++) {
  if (jobsOf(`AP39MN${2200 + i}`).length) continue;
  const r = {
    name: pick(['Naveen', 'Sujatha', 'Prasad', 'Divya', 'Ramesh', 'Swathi']),
    phone: `9440022${String(300 + i)}`,
    plate: `AP39MN${2200 + i}`,
    service: basic,
    type: 'Hatchback',
  };
  const id = await wash(pick(staff), r, 0, 9 + i);
  if (id) visits += 1;
}
const owed = d1Rows(`SELECT COUNT(*) AS n FROM reward_gifts WHERE shop_id = ${sql(shop.id)} AND status = 'owed'`)[0]?.n ?? 0;
console.log(`  Washes: ${visits} for regulars and new cars, ${freeUsed} free wash used, ${owed} welcome gift item(s) owed`);
console.log('Done. Open More › Rewards (and a regular’s plate in New Wash, e.g. AP39BW4521).');
