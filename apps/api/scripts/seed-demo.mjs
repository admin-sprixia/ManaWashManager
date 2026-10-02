#!/usr/bin/env node
// Wipes the LOCAL database and fills it with a realistic shop, so every screen has something to
// show and every feature can be tried end to end.
//
//   cd apps/api && npm run dev          (in one terminal — the seed talks to the running API)
//   cd apps/api && npm run db:seed:demo (in another)
//
// What it makes (all PINs 2580; the owner can also sign in with the dev code 000000):
//   MANA Car Wash, Nellore — owner Hrushikesh 9888626111; staff Ravi 9300000011,
//   Suresh 9300000012, Kiran 9300000013; Mahesh 9300000019 waiting to join.
//   ~75 days of washes, customers and vehicles; reminders (due and comeback), coupons and
//   referrals; expenses with bill photos; stock; attendance; cash drawer days; an error report.
//   A second branch, MANA Car Wash Kavali, with its own menu, staff (Venkat 9300000021) and washes.
//
// Washes older than a week are written straight into the database (the API only accepts a week
// of backdating); everything newer goes through the real API, as the app would send it.
// Photos are drawn on macOS with QuickLook + sips; elsewhere the vehicle pictures are used.
// Local only — it never touches the remote database.
import { execFileSync } from 'node:child_process';
import { randomUUID, webcrypto } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_URL ?? 'http://localhost:8787';
const PIN = '2580';
const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const VEHICLE_ART = join(API_DIR, '..', 'mobile', 'src', 'assets', 'vehicles');
const TMP = mkdtempSync(join(tmpdir(), 'mana-seed-'));
const SHOP = 'shop_mana';

// ─── Plumbing ─────────────────────────────────────────────────────────────

function d1(args) {
  return execFileSync('npx', ['wrangler', 'd1', 'execute', 'mana_db', '--local', ...args], {
    cwd: API_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}
const query = (sql) => JSON.parse(d1(['--json', '--command', sql]))[0].results;
function runSql(statements, label) {
  const file = join(TMP, `${label}.sql`);
  writeFileSync(file, statements.join('\n'));
  d1([`--file=${file}`]);
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
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (res.status >= 400) {
    throw new Error(`${method} ${path} → ${res.status} ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  }
  return json;
}

// Same seed, same shop: re-running gives the same customers and numbers.
let seed = 20261002;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;
const cid = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
/** Dates are stored the way Prisma's D1 adapter writes them, so text comparisons line up. */
const ts = (d) => d.toISOString().replace('Z', '+00:00');
const insert = (table, row) =>
  `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')});`;

// ─── IST calendar ─────────────────────────────────────────────────────────

const IST_MS = 5.5 * 3600 * 1000;
const NOW = new Date();
const istToday = new Date(NOW.getTime() + IST_MS);
const [Y, M, D] = [istToday.getUTCFullYear(), istToday.getUTCMonth(), istToday.getUTCDate()];
const at = (daysAgo, hour, minute = 0) => new Date(Date.UTC(Y, M, D - daysAgo, hour, minute) - IST_MS);
const day = (daysAgo) => new Date(Date.UTC(Y, M, D - daysAgo)).toISOString().slice(0, 10);
const weekday = (daysAgo) => new Date(Date.UTC(Y, M, D - daysAgo)).getUTCDay();
const addMin = (d, minutes) => new Date(d.getTime() + minutes * 60_000);
const minutesIntoToday = (NOW.getTime() - at(0, 0).getTime()) / 60_000;
/** A time earlier today, `minutesAgo` before now but never before 7 am (or midnight, early on). */
function todayAt(minutesAgo) {
  const floor = at(0, 0).getTime() + Math.min(7 * 60, Math.max(0, minutesIntoToday - 120)) * 60_000;
  return new Date(Math.max(floor, NOW.getTime() - minutesAgo * 60_000));
}

// ─── Images ───────────────────────────────────────────────────────────────

const canDraw = process.platform === 'darwin' && existsSync('/usr/bin/qlmanage') && existsSync('/usr/bin/sips');
let drawn = 0;
function render(svg) {
  const name = `img${drawn++}`;
  const svgPath = join(TMP, `${name}.svg`);
  writeFileSync(svgPath, svg);
  execFileSync('/usr/bin/qlmanage', ['-t', '-s', '800', '-o', TMP, svgPath], { stdio: 'ignore' });
  const jpg = join(TMP, `${name}.jpg`);
  execFileSync('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72', `${svgPath}.png`, '--out', jpg], {
    stdio: 'ignore',
  });
  return new File([readFileSync(jpg)], `${name}.jpg`, { type: 'image/jpeg' });
}
const ART = {
  vt_hatchback: 'vehicle-hatchback.jpg',
  vt_sedan: 'vehicle-sedan.jpg',
  vt_mini_suv: 'vehicle-suv-mini.jpg',
  vt_large_suv: 'vehicle-suv-large.jpg',
  vt_bike: 'vehicle-bike.jpg',
  vt_scooter: 'vehicle-scooter.jpg',
};
const artFile = (vt) => join(VEHICLE_ART, ART[vt] ?? 'vehicle-sedan.jpg');
const rawArt = (vt) => new File([readFileSync(artFile(vt))], 'vehicle.jpg', { type: 'image/jpeg' });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function vehiclePhoto(vt, plate, kind) {
  if (!canDraw) return rawArt(vt);
  const b64 = readFileSync(artFile(vt)).toString('base64');
  const dirt =
    kind === 'before'
      ? `<rect width="800" height="800" fill="#6b4f2a" opacity="0.38"/>
         <circle cx="230" cy="520" r="90" fill="#4a3519" opacity="0.35"/>
         <circle cx="560" cy="560" r="120" fill="#4a3519" opacity="0.3"/>
         <circle cx="420" cy="430" r="60" fill="#4a3519" opacity="0.25"/>`
      : `<rect width="800" height="800" fill="#e0f7ff" opacity="0.08"/>`;
  return render(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="800" height="800" viewBox="0 0 800 800">
    <image x="0" y="0" width="800" height="800" preserveAspectRatio="xMidYMid slice" xlink:href="data:image/jpeg;base64,${b64}"/>
    ${dirt}
    <rect x="0" y="720" width="800" height="80" fill="#000" opacity="0.45"/>
    <text x="28" y="772" font-family="Helvetica" font-size="30" fill="#fff">${kind === 'before' ? 'BEFORE' : 'AFTER'} · ${esc(plate)}</text>
  </svg>`);
}

function billPhoto(e) {
  if (!canDraw) return rawArt('vt_sedan');
  const lines = [
    `<text x="400" y="100" font-family="Courier New" font-size="34" font-weight="bold" text-anchor="middle">${esc(e.vendor)}</text>`,
    `<text x="400" y="140" font-family="Courier New" font-size="20" text-anchor="middle">Nellore · Ph 0861-2345678</text>`,
    `<line x1="90" y1="170" x2="710" y2="170" stroke="#333" stroke-dasharray="8,5"/>`,
    `<text x="90" y="210" font-family="Courier New" font-size="22" xml:space="preserve">Bill No: ${int(1000, 9999)}       Date: ${e.date.split('-').reverse().join('/')}</text>`,
    `<line x1="90" y1="235" x2="710" y2="235" stroke="#333" stroke-dasharray="8,5"/>`,
    `<text x="90" y="290" font-family="Courier New" font-size="24">${esc(e.itemName)}</text>`,
    `<text x="710" y="290" font-family="Courier New" font-size="24" text-anchor="end">${e.quantity ?? 1} ${e.unit ?? ''}</text>`,
    `<line x1="90" y1="340" x2="710" y2="340" stroke="#333" stroke-dasharray="8,5"/>`,
    `<text x="90" y="400" font-family="Courier New" font-size="32" font-weight="bold">TOTAL</text>`,
    `<text x="710" y="400" font-family="Courier New" font-size="32" font-weight="bold" text-anchor="end">Rs ${(e.amount / 100).toFixed(2)}</text>`,
    `<text x="90" y="450" font-family="Courier New" font-size="22">Paid: ${e.paymentMethod.toUpperCase()}</text>`,
    `<text x="400" y="560" font-family="Courier New" font-size="22" text-anchor="middle">Thank you · Visit again</text>`,
  ];
  return render(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
    <rect width="800" height="800" fill="#d9d4c7"/>
    <rect x="60" y="30" width="680" height="760" fill="#fffdf8" stroke="#cfc8b6" transform="rotate(-1.5 400 400)"/>
    <g transform="rotate(-1.5 400 400)">${lines.join('')}</g>
  </svg>`);
}

const ITEM_COLOURS = {
  chemicals: ['#0b7fab', '#e3f4fb'],
  labour: ['#6d4c41', '#efe7e3'],
  electricity: ['#f9a825', '#fff8e1'],
  water: ['#0288d1', '#e1f5fe'],
  maintenance: ['#546e7a', '#eceff1'],
  other: ['#7b1fa2', '#f3e5f5'],
};
function itemPhoto(e) {
  if (!canDraw) return rawArt('vt_hatchback');
  const [ink, bg] = ITEM_COLOURS[e.category];
  return render(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
    <rect width="800" height="800" fill="${bg}"/>
    <ellipse cx="400" cy="700" rx="230" ry="30" fill="#000" opacity="0.12"/>
    <rect x="310" y="120" width="180" height="70" rx="14" fill="${ink}" opacity="0.85"/>
    <rect x="230" y="180" width="340" height="520" rx="48" fill="${ink}"/>
    <rect x="260" y="330" width="280" height="200" rx="18" fill="#fff"/>
    <text x="400" y="410" font-family="Helvetica" font-size="34" font-weight="bold" text-anchor="middle" fill="${ink}">${esc(e.itemName.slice(0, 14))}</text>
    <text x="400" y="460" font-family="Helvetica" font-size="26" text-anchor="middle" fill="#555">${e.quantity ?? ''} ${e.unit ?? ''}</text>
  </svg>`);
}

// ─── People ───────────────────────────────────────────────────────────────

const OWNER = { id: 'user_owner_seed', name: 'Hrushikesh', phone: '9888626111' };
const STAFF = [
  { id: 'user_staff_seed', name: 'Ravi Kumar', phone: '9300000011', joinedDaysAgo: 85 },
  { id: 'user_staff_suresh', name: 'Suresh Babu', phone: '9300000012', joinedDaysAgo: 80 },
  { id: 'user_staff_kiran', name: 'Kiran Teja', phone: '9300000013', joinedDaysAgo: 40 },
];
const HISTORY_DAYS = 75;
const API_DAYS = 6; // days 1..6 go through the API; 7+ straight into the database

async function hashPin(pin) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
  return `100000$${Buffer.from(salt).toString('base64')}$${Buffer.from(bits).toString('base64')}`;
}

// Attendance decides who washes on a given day. Today: Ravi and Suresh marked, Kiran not yet.
const attendance = {};
for (let d = 0; d <= 60; d++) {
  attendance[d] = {};
  for (const s of STAFF) {
    if (s.joinedDaysAgo < d) continue;
    if (d === 0) {
      if (s.id !== 'user_staff_kiran') attendance[d][s.id] = 'present';
      continue;
    }
    const r = rand();
    attendance[d][s.id] = r < 0.84 ? 'present' : r < 0.93 ? 'half' : 'absent';
  }
  if (d > 0) attendance[d][OWNER.id] = chance(0.92) ? 'present' : 'half';
}
function workingStaff(d) {
  const joined = STAFF.filter((s) => s.joinedDaysAgo >= d);
  if (d > 60) return joined;
  const working = joined.filter((s) => attendance[d][s.id] !== 'absent');
  return working.length ? working : joined;
}

// ─── Menu ─────────────────────────────────────────────────────────────────

const CAR_TYPES = ['vt_hatchback', 'vt_sedan', 'vt_mini_suv', 'vt_large_suv'];
const COMMISSIONS = {
  svc_mana_combo: { vt_hatchback: 3000, vt_sedan: 4000, vt_mini_suv: 5000, vt_large_suv: 6000 },
  svc_ac_hygiene: { vt_hatchback: 20000, vt_sedan: 20000, vt_mini_suv: 20000, vt_large_suv: 20000 },
  svc_underbody: { vt_hatchback: 5000, vt_sedan: 5000, vt_mini_suv: 5000, vt_large_suv: 5000 },
  svc_bike_polish: { vt_bike: 2000, vt_scooter: 2000 },
};
const commissionFor = (serviceId, vt) => COMMISSIONS[serviceId]?.[vt] ?? 0;

function pickServices(vt) {
  const r = rand();
  let ids;
  if (CAR_TYPES.includes(vt)) {
    if (r < 0.45) ids = ['svc_complete_wash'];
    else if (r < 0.68) ids = ['svc_exterior_wash'];
    else if (r < 0.83) ids = ['svc_mana_combo'];
    else if (r < 0.88) ids = ['svc_interior_cleaning'];
    else if (r < 0.92) ids = ['svc_complete_wash', 'svc_ac_hygiene'];
    else if (r < 0.96) ids = ['svc_exterior_wash', 'svc_underbody'];
    else ids = ['svc_complete_wash', 'svc_fragrance'];
    if (!ids.includes('svc_mana_combo')) {
      if (chance(0.2)) ids.push('svc_tyre_dressing');
      if (chance(0.1)) ids.push('svc_dashboard_dressing');
    }
  } else {
    if (r < 0.5) ids = ['svc_bike_complete'];
    else if (r < 0.75) ids = ['svc_bike_exterior'];
    else if (r < 0.88) ids = ['svc_bike_complete', 'svc_bike_chain'];
    else if (r < 0.95) ids = ['svc_bike_exterior', 'svc_bike_polish'];
    else ids = ['svc_bike_complete', 'svc_bike_engine'];
    if (chance(0.15)) ids.push('svc_bike_tyre');
  }
  return ids;
}

// ─── Customers and vehicles ───────────────────────────────────────────────

const FIRST = [
  'Srinivas', 'Venkatesh', 'Lakshmi', 'Ramesh', 'Anil', 'Sai Teja', 'Praveen', 'Harish', 'Divya', 'Naresh',
  'Kalyan', 'Swathi', 'Raghu', 'Bhaskar', 'Chaitanya', 'Pavan', 'Sravani', 'Gopi', 'Murali', 'Ajay',
  'Vamsi', 'Sandeep', 'Madhavi', 'Prasad', 'Satish', 'Rajesh', 'Haritha', 'Nagendra', 'Sudheer', 'Krishna',
  'Deepak', 'Arjun', 'Manoj', 'Revathi', 'Tejaswi', 'Kishore', 'Uday', 'Yashwanth', 'Anusha', 'Rohit',
];
const LAST = ['Reddy', 'Naidu', 'Chowdary', 'Rao', 'Varma', 'Sharma', 'Goud', 'Shaik', 'Yadav', 'Raju', 'Setty', 'Prasad'];
const MODELS = {
  vt_hatchback: [['Maruti', 'Swift'], ['Hyundai', 'i20'], ['Tata', 'Tiago'], ['Maruti', 'Baleno']],
  vt_sedan: [['Honda', 'City'], ['Maruti', 'Dzire'], ['Hyundai', 'Verna'], ['Toyota', 'Etios']],
  vt_mini_suv: [['Hyundai', 'Creta'], ['Kia', 'Sonet'], ['Maruti', 'Brezza'], ['Tata', 'Nexon']],
  vt_large_suv: [['Toyota', 'Innova Crysta'], ['Mahindra', 'XUV700'], ['Toyota', 'Fortuner'], ['Mahindra', 'Scorpio-N']],
  vt_bike: [['Royal Enfield', 'Classic 350'], ['Bajaj', 'Pulsar 150'], ['Yamaha', 'R15'], ['Hero', 'Splendor']],
  vt_scooter: [['Honda', 'Activa'], ['TVS', 'Jupiter'], ['Suzuki', 'Access'], ['Ather', '450X']],
};
const usedPhones = new Set([OWNER.phone, ...STAFF.map((s) => s.phone), '9300000019', '9300000021']);
const usedPlates = new Set();
function newPhone() {
  for (;;) {
    const p = `${pick(['9', '8', '7', '6'])}${String(int(0, 999_999_999)).padStart(9, '0')}`;
    if (!usedPhones.has(p)) return usedPhones.add(p), p;
  }
}
function newPlate(bike) {
  for (;;) {
    const letters = String.fromCharCode(65 + int(0, 25)) + String.fromCharCode(65 + int(0, 25));
    const p = `${chance(0.8) ? 'AP39' : 'AP26'}${bike && chance(0.5) ? letters[0] : letters}${String(int(1, 9999)).padStart(4, '0')}`;
    if (!usedPlates.has(p)) return usedPlates.add(p), p;
  }
}
function newVehicleType() {
  const r = rand();
  return r < 0.25 ? 'vt_hatchback' : r < 0.45 ? 'vt_sedan' : r < 0.65 ? 'vt_mini_suv' : r < 0.77 ? 'vt_large_suv' : r < 0.9 ? 'vt_bike' : 'vt_scooter';
}

const customers = [];
const vehicles = [];
for (let i = 0; i < 150; i++) {
  const customer = {
    id: `cust_${String(i + 1).padStart(3, '0')}`,
    name: `${pick(FIRST)} ${pick(LAST)}`,
    phone: newPhone(),
    source: pick(['google', 'friend', 'board', 'instagram', null, null]),
    vehicles: [],
  };
  const r = rand();
  // Most come back within ~10 days; some are due a reminder; some haven't been in for a month+.
  customer.lastOffset = r < 0.8 ? int(1, 9) : r < 0.91 ? int(10, 29) : int(30, 60);
  customers.push(customer);
  const count = chance(0.06) ? 2 : 1;
  for (let v = 0; v < count; v++) {
    const vt = newVehicleType();
    const [make, model] = pick(MODELS[vt]);
    const vehicle = {
      id: `veh_${String(vehicles.length + 1).padStart(3, '0')}`,
      customer,
      vt,
      plate: newPlate(!CAR_TYPES.includes(vt)),
      make,
      model,
    };
    vehicles.push(vehicle);
    customer.vehicles.push(vehicle);
  }
}

// Visits, newest first per customer: every 7–20 days back from their last visit.
const visits = [];
for (const c of customers) {
  let offset = c.lastOffset;
  while (offset <= HISTORY_DAYS) {
    const vehicle = pick(c.vehicles);
    const cadence = CAR_TYPES.includes(vehicle.vt) ? int(10, 20) : int(7, 15);
    visits.push({ customer: c, vehicle, daysAgo: offset });
    offset += cadence + int(-2, 3);
  }
}
for (const v of visits) {
  const busy = weekday(v.daysAgo) === 0 || weekday(v.daysAgo) === 6;
  v.time = at(v.daysAgo, int(busy ? 7 : 8, 18), int(0, 59));
  const crew = workingStaff(v.daysAgo);
  v.creator = chance(0.2) ? OWNER : pick(crew);
  v.services = pickServices(v.vehicle.vt);
  v.washers = [pick(crew)];
  if (chance(0.35) && crew.length > 1) v.washers.push(pick(crew.filter((s) => s !== v.washers[0])));
  const hasCommission = v.services.some((s) => commissionFor(s, v.vehicle.vt) > 0);
  v.sellers = hasCommission ? [v.creator.id === OWNER.id ? pick(crew) : v.creator] : [];
  v.void = chance(0.025);
  v.method = chance(0.55) ? 'cash' : chance(0.9) ? 'upi' : 'other';
  v.payer = chance(0.25) ? OWNER : pick(crew);
  if (chance(0.07)) {
    v.discount = pick([5000, 10000]);
    v.discountReason = pick(['Regular customer', 'Festival offer', 'Owner’s friend', 'Took longer than promised']);
  }
}
for (const c of customers) {
  const mine = visits.filter((v) => v.customer === c);
  c.createdAt = mine.reduce((min, v) => (v.time < min ? v.time : min), NOW);
}

// ─── Run ──────────────────────────────────────────────────────────────────

const step = (msg) => console.log(`\n▸ ${msg}`);

try {
  await fetch(`${API}/health`);
} catch {
  console.error(`The API isn't running at ${API}. Start it first:  cd apps/api && npm run dev`);
  process.exit(1);
}

step('Resetting the local database (migrations + seed.sql)');
execFileSync('node', [join(API_DIR, 'scripts', 'db-reset-local.mjs')], { cwd: API_DIR, stdio: 'ignore' });

const PRICES = {};
for (const row of query('SELECT service_id, vehicle_type_id, price FROM service_prices')) {
  (PRICES[row.service_id] ??= {})[row.vehicle_type_id] = row.price;
}
step(`Writing the team and ${visits.filter((v) => v.daysAgo > API_DAYS).length} older washes straight into the database`);
{
  const sql = [];
  sql.push(`UPDATE shops SET name = 'MANA Car Wash', city = 'Nellore', created_at = ${q(ts(at(90, 9)))} WHERE id = '${SHOP}';`);
  sql.push(
    `UPDATE users SET name = ${q(OWNER.name)}, phone = ${q(OWNER.phone)}, pin_hash = ${q(await hashPin(PIN))}, created_at = ${q(ts(at(90, 9)))} WHERE id = '${OWNER.id}';`,
  );
  const [ravi, ...others] = STAFF;
  sql.push(
    `UPDATE users SET name = ${q(ravi.name)}, phone = ${q(ravi.phone)}, pin_hash = ${q(await hashPin(PIN))}, created_at = ${q(ts(at(ravi.joinedDaysAgo, 9)))} WHERE id = '${ravi.id}';`,
  );
  for (const s of others) {
    sql.push(
      insert('users', {
        id: s.id,
        shop_id: SHOP,
        name: s.name,
        phone: s.phone,
        role: 'staff',
        pin_hash: await hashPin(PIN),
        created_at: ts(at(s.joinedDaysAgo, 9)),
      }),
    );
  }
  sql.push(
    insert('join_requests', {
      id: 'jr_seed_mahesh',
      shop_id: SHOP,
      phone: '9300000019',
      name: 'Mahesh',
      status: 'pending',
      created_at: ts(todayAt(45)),
    }),
  );

  for (const c of customers) {
    sql.push(
      insert('customers', {
        id: c.id,
        shop_id: SHOP,
        name: c.name,
        phone: c.phone,
        source: c.source,
        created_at: ts(c.createdAt),
      }),
    );
    for (const v of c.vehicles) {
      sql.push(
        insert('vehicles', {
          id: v.id,
          shop_id: SHOP,
          customer_id: c.id,
          registration_number: v.plate,
          make: v.make,
          model: v.model,
          vehicle_type_id: v.vt,
          updated_at: ts(NOW),
        }),
      );
    }
  }

  for (const v of visits.filter((x) => x.daysAgo > API_DAYS)) {
    const id = cid('job');
    const lines = v.services.map((s) => ({ s, price: PRICES[s][v.vehicle.vt], commission: commissionFor(s, v.vehicle.vt) }));
    const subtotal = lines.reduce((sum, l) => sum + l.price, 0);
    const discount = v.discount && v.discount < subtotal ? v.discount : 0;
    const tWash = addMin(v.time, int(5, 30));
    const tReady = addMin(tWash, int(25, 55));
    const tPaid = addMin(tReady, int(3, 25));
    const voidBy = v.creator;
    sql.push(
      insert('jobs', {
        id,
        shop_id: SHOP,
        customer_id: v.customer.id,
        vehicle_id: v.vehicle.id,
        created_by_user_id: v.creator.id,
        status: v.void ? 'void' : 'paid',
        subtotal,
        discount,
        discount_reason: discount ? v.discountReason : null,
        total: subtotal - discount,
        payment_method: v.void ? null : v.method,
        payment_status: v.void ? 'pending' : 'paid',
        paid_by_user_id: v.void ? null : v.payer.id,
        voided_by_user_id: v.void ? voidBy.id : null,
        void_reason: v.void ? 'Customer left without the wash' : null,
        created_at: ts(v.time),
        completed_at: v.void ? null : ts(tPaid),
      }),
    );
    for (const l of lines) {
      sql.push(
        insert('job_services', {
          shop_id: SHOP,
          job_id: id,
          service_id: l.s,
          price_at_time: l.price,
          commission_at_time: l.commission,
          quantity: 1,
        }),
      );
    }
    const ev = (user, action, when, from, to, reason = null) =>
      sql.push(
        insert('job_events', {
          id: randomUUID(),
          shop_id: SHOP,
          job_id: id,
          user_id: user.id,
          action,
          from_value: from,
          to_value: to,
          reason,
          created_at: ts(when),
        }),
      );
    ev(v.creator, 'created', v.time, null, 'waiting', discount ? v.discountReason : null);
    for (const s of v.sellers) {
      sql.push(insert('job_sellers', { shop_id: SHOP, job_id: id, user_id: s.id, assigned_by_user_id: v.creator.id, assigned_at: ts(v.time) }));
    }
    if (v.void) {
      ev(voidBy, 'voided', addMin(v.time, int(5, 20)), 'waiting', 'void', 'Customer left without the wash');
      continue;
    }
    for (const w of v.washers) {
      sql.push(insert('job_washers', { shop_id: SHOP, job_id: id, user_id: w.id, assigned_by_user_id: v.creator.id, assigned_at: ts(tWash) }));
    }
    ev(v.creator, 'status_changed', tWash, 'waiting', 'washing');
    ev(v.washers[0], 'status_changed', tReady, 'washing', 'ready');
    ev(v.payer, 'paid', tPaid, 'ready', v.method);
  }
  runSql(sql, 'history');
}

step('Signing everyone in with their PIN');
const tokens = {};
for (const person of [OWNER, ...STAFF]) {
  const session = await call(null, 'POST', '/auth/pin/login', { phone: person.phone, pin: PIN });
  tokens[person.id] = session.token;
}
const OWN = tokens[OWNER.id];
const tokenOf = (person) => tokens[person.id];

step('Shop setup: name, combo contents, staff commissions, Google review link');
await call(OWN, 'PUT', '/shop/info', { name: 'MANA Car Wash', city: 'Nellore' });
await call(OWN, 'PATCH', '/services/svc_mana_combo', {
  includes: ['svc_complete_wash', 'svc_tyre_dressing', 'svc_dashboard_dressing'],
});
for (const [serviceId, byType] of Object.entries(COMMISSIONS)) {
  for (const [vehicleTypeId, amount] of Object.entries(byType)) {
    await call(OWN, 'PUT', '/services/commissions', { serviceId, vehicleTypeId, amount });
  }
}
await call(OWN, 'PUT', '/shop/settings', { googleReviewUrl: 'https://g.page/r/mana-car-wash-nellore/review' });

step('Attendance for the last 60 days');
for (let d = 60; d >= 0; d--) {
  for (const [userId, status] of Object.entries(attendance[d])) {
    await call(OWN, 'PUT', '/attendance', { userId, date: day(d), status });
  }
}

/** One wash the way the app sends it: start → washing (with washers) → ready → paid. */
async function runWash(v, { stopAt = 'paid', photos = false } = {}) {
  const id = v.id ?? cid('job');
  const t0 = v.time;
  const tWash = v.tWash ?? addMin(t0, int(5, 25));
  const tReady = v.tReady ?? addMin(tWash, int(25, 50));
  const tPaid = v.tPaid ?? addMin(tReady, int(3, 20));
  const discount = v.discount && v.discount < v.services.reduce((s, x) => s + PRICES[x][v.vehicle.vt], 0) ? v.discount : 0;
  await call(tokenOf(v.creator), 'POST', '/jobs/start', {
    id,
    occurredAt: t0.toISOString(),
    customer: { phone: v.customer.phone, name: v.customer.name },
    registrationNumber: v.vehicle.plate,
    vehicleTypeId: v.vehicle.vt,
    services: v.services.map((serviceId) => ({ serviceId, quantity: 1 })),
    discount: v.couponCode || v.referralToken ? 0 : discount,
    ...(discount && !v.couponCode && !v.referralToken ? { discountReason: v.discountReason } : {}),
    ...(v.couponCode ? { couponCode: v.couponCode } : {}),
    ...(v.referralToken ? { referralToken: v.referralToken } : {}),
    ...(v.sellers?.length ? { sellerIds: v.sellers.map((s) => s.id) } : {}),
  });
  const upload = async (kind, when, by) => {
    const form = new FormData();
    form.set('id', cid('pho'));
    form.set('jobId', id);
    form.set('kind', kind);
    form.set('occurredAt', when.toISOString());
    form.set('file', vehiclePhoto(v.vehicle.vt, v.vehicle.plate, kind));
    await call(tokenOf(by), 'POST', '/photos', form);
  };
  if (photos) await upload('before', addMin(t0, 1), v.creator);
  if (stopAt === 'waiting') return id;
  await call(tokenOf(v.creator), 'PATCH', `/jobs/${id}/status`, {
    status: 'washing',
    occurredAt: tWash.toISOString(),
    washerIds: v.washers.map((w) => w.id),
  });
  if (stopAt === 'washing') return id;
  await call(tokenOf(v.washers[0]), 'PATCH', `/jobs/${id}/status`, { status: 'ready', occurredAt: tReady.toISOString() });
  if (photos) await upload('after', addMin(tReady, -1), v.washers[0]);
  if (stopAt === 'ready') return id;
  await call(tokenOf(v.payer), 'POST', `/jobs/${id}/pay`, { paymentMethod: v.method, occurredAt: tPaid.toISOString() });
  return id;
}

const recent = visits.filter((v) => v.daysAgo >= 1 && v.daysAgo <= API_DAYS).sort((a, b) => a.time - b.time);
step(`Last ${API_DAYS} days: ${recent.length} washes through the API`);
const recentIds = [];
for (const v of recent) {
  if (v.void) {
    const id = await runWash(v, { stopAt: 'waiting' });
    await call(tokenOf(v.creator), 'POST', `/jobs/${id}/void`, {
      reason: 'Customer left without the wash',
      occurredAt: addMin(v.time, 10).toISOString(),
    });
    continue;
  }
  recentIds.push({ id: await runWash(v, { photos: v.daysAgo === 1 && chance(0.4) }), v });
}

step('Corrections: a paid wash voided, a payment fixed from cash to UPI');
{
  const twoDays = recentIds.find((r) => r.v.daysAgo === 2);
  if (twoDays) {
    await call(OWN, 'POST', `/jobs/${twoDays.id}/void`, {
      reason: 'Entered twice by mistake',
      occurredAt: addMin(twoDays.v.time, 90).toISOString(),
    });
  }
  const yesterdayCash = recentIds.find((r) => r.v.daysAgo === 1 && r.v.method === 'cash');
  if (yesterdayCash) {
    await call(OWN, 'PATCH', `/jobs/${yesterdayCash.id}/payment-method`, {
      paymentMethod: 'upi',
      reason: 'Customer actually paid by UPI',
    });
  }
}

// ─── Stock and expenses ───────────────────────────────────────────────────

const VENDORS = {
  chemicals: 'SRI SAI CAR CARE',
  labour: 'MANA CAR WASH',
  electricity: 'APSPDCL',
  water: 'BALAJI WATER SUPPLY',
  maintenance: 'KRISHNA HARDWARE',
  other: 'LAKSHMI STORES',
};
const STOCK = [
  { name: 'Foam shampoo', unit: 'l', lowAt: 5, opening: 15, target: 9, use: [1, 'l'], buys: [[40, 5, 145000], [25, 5, 145000], [12, 5, 150000], [3, 5, 150000]] },
  { name: 'Car wax', unit: 'kg', lowAt: 1, opening: 2, target: 1.5, use: [250, 'g'], buys: [[35, 1, 90000], [10, 1, 95000]] },
  { name: 'Tyre shine', unit: 'l', lowAt: 2, opening: 3, target: 1.2, use: [500, 'ml'], buys: [[30, 2, 65000], [14, 2, 65000]] },
  { name: 'Microfibre cloth', unit: 'pcs', lowAt: 10, opening: 30, target: 34, use: [4, 'pcs'], buys: [[28, 20, 80000], [6, 20, 85000]] },
  { name: 'Glass cleaner', unit: 'l', lowAt: 1, opening: 2, target: 1.5, use: [250, 'ml'], buys: [[20, 1, 32000]] },
  { name: 'Dashboard polish', unit: 'l', lowAt: 1, opening: 1, target: 1.25, use: [250, 'ml'], buys: [[18, 1, 50000]] },
  { name: 'Bill book', unit: 'pcs', lowAt: 2, opening: 4, target: 0, use: [1, 'pcs'], buys: [[33, 10, 30000]], category: 'other' },
  { name: 'Car fragrance', unit: 'pcs', lowAt: 5, opening: 24, target: 16, use: [2, 'pcs'] },
];
const toBase = (qty, unit) => (unit === 'ml' || unit === 'g' ? qty / 1000 : qty);

const expenses = [];
const stockTimeline = []; // purchases and uses in date order, so balances build up correctly
for (const item of STOCK) {
  item.buys ??= [];
  for (const [daysAgo, quantity, amount] of item.buys) {
    expenses.push({
      daysAgo,
      category: item.category ?? 'chemicals',
      itemName: item.name,
      quantity,
      unit: item.unit,
      amount,
      description: item.category === 'other' ? 'Customer bills' : pick(['Foam wash', 'Polishing', 'Tyres', 'Glass', 'Interior cleaning']),
      addToStock: true,
    });
  }
  // Uses spread over 45 days, sized so the shelf ends at `target`.
  const totalUse = item.opening + item.buys.reduce((s, b) => s + b[1], 0) - item.target;
  const each = toBase(item.use[0], item.use[1]);
  let count = Math.round(totalUse / each);
  const days = [];
  for (let i = 0; i < count; i++) days.push(int(0, 44));
  days.sort((a, b) => b - a);
  for (const d of days) stockTimeline.push({ kind: 'use', item, daysAgo: d, time: at(d, int(8, 18), int(0, 59)) });
}
expenses.push(
  { daysAgo: 32, category: 'electricity', itemName: 'Monthly bill', quantity: 410, unit: 'kwh', amount: 336000, description: 'September bill', paymentMethod: 'upi' },
  { daysAgo: 2, category: 'electricity', itemName: 'Monthly bill', quantity: 445, unit: 'kwh', amount: 362000, description: 'October bill', paymentMethod: 'upi' },
  { daysAgo: 9, category: 'maintenance', itemName: 'Pressure washer repair', quantity: 1, unit: 'pcs', amount: 250000, description: 'Bay 2 machine' },
  { daysAgo: 4, category: 'maintenance', itemName: 'Nozzle', quantity: 2, unit: 'pcs', amount: 40000, description: 'Foam gun' },
  { daysAgo: 21, category: 'labour', itemName: 'Helper', quantity: 1, unit: 'days', amount: 60000, description: 'Extra hand for the rush' },
  { daysAgo: 7, category: 'labour', itemName: 'Helper', quantity: 1, unit: 'days', amount: 60000, description: 'Extra hand for the rush' },
  { daysAgo: 3, category: 'labour', itemName: 'Overtime', quantity: 3, unit: 'hours', amount: 45000, description: 'Late finish' },
  { daysAgo: 45, category: 'other', itemName: 'Rent', amount: 1500000, description: 'September rent', paymentMethod: 'upi' },
  { daysAgo: 15, category: 'other', itemName: 'Rent', amount: 1500000, description: 'October rent', paymentMethod: 'upi' },
  { daysAgo: 11, category: 'other', itemName: 'Stationery', amount: 12000 },
);
for (const d of [29, 22, 15, 8, 1, 0]) {
  expenses.push({ daysAgo: d, category: 'water', itemName: 'Water tanker', quantity: 2, unit: 'tankers', amount: 120000, description: '5000 L tankers' });
}
for (const d of [26, 19, 13, 6, 5, 2, 1, 0]) {
  expenses.push({ daysAgo: d, category: 'other', itemName: 'Tea & snacks', amount: int(8, 20) * 1000 });
}
for (const e of expenses) {
  e.date = day(e.daysAgo);
  e.time = e.daysAgo === 0 ? todayAt(int(30, 200)) : at(e.daysAgo, int(9, 17), int(0, 59));
  e.paymentMethod ??= chance(0.8) ? 'cash' : 'upi';
  e.vendor = VENDORS[e.category];
  // Staff can only enter the last 31 days; rent and bills are the owner's.
  e.by = e.daysAgo > 30 || ['electricity'].includes(e.category) || e.itemName === 'Rent' ? OWNER : pick(workingStaff(e.daysAgo));
  if (e.addToStock) stockTimeline.push({ kind: 'buy', expense: e, daysAgo: e.daysAgo, time: e.time });
}
stockTimeline.sort((a, b) => a.time - b.time);

step(`Stock: ${STOCK.length} items, then ${stockTimeline.length} purchases and uses in date order`);
const moveTimes = []; // [moveId or expenseId, time]
const openingAt = at(45, 9);
for (const item of STOCK) {
  const created = await call(OWN, 'POST', '/stock', { name: item.name, unit: item.unit, lowAt: item.lowAt, opening: item.opening });
  item.id = created.id;
  item.balance = item.opening;
}
async function postExpense(e) {
  e.id = cid('exp');
  const form = new FormData();
  form.set(
    'data',
    JSON.stringify({
      id: e.id,
      category: e.category,
      amount: e.amount,
      description: e.description,
      itemName: e.itemName,
      ...(e.quantity != null ? { quantity: e.quantity, unit: e.unit } : {}),
      paymentMethod: e.paymentMethod,
      date: e.date,
      ...(e.addToStock ? { addToStock: true } : {}),
    }),
  );
  form.set('billPhoto', billPhoto(e));
  form.set('itemPhoto', itemPhoto(e));
  await call(tokenOf(e.by), 'POST', '/expenses', form);
}
for (const entry of stockTimeline) {
  if (entry.kind === 'buy') {
    await postExpense(entry.expense);
    const item = STOCK.find((i) => i.name === entry.expense.itemName);
    item.balance += entry.expense.quantity;
    moveTimes.push(['expense', entry.expense.id, entry.time]);
    continue;
  }
  const { item } = entry;
  const [qty, unit] = item.use;
  const base = toBase(qty, unit);
  if (item.balance - base < -1e-9) continue;
  const id = cid('mov');
  const by = pick(workingStaff(entry.daysAgo));
  await call(tokenOf(by), 'POST', '/stock/moves', {
    id,
    itemId: item.id,
    kind: 'use',
    quantity: qty,
    unit,
    note: pick(['Morning shift', 'Foam wash', 'Weekend rush', null, null]) ?? undefined,
  });
  item.balance = Math.round((item.balance - base) * 1000) / 1000;
  moveTimes.push(['move', id, entry.time]);
}
// The owner counts whatever's left so every shelf lands exactly on its target.
for (const item of STOCK) {
  if (Math.abs(item.balance - item.target) < 1e-9) continue;
  const id = cid('mov');
  await call(OWN, 'POST', '/stock/moves', { id, itemId: item.id, kind: 'count', quantity: item.target, unit: item.unit, note: 'Weekly count' });
  moveTimes.push(['move', id, at(1, 20, 0)]);
}

const otherExpenses = expenses.filter((e) => !e.addToStock).sort((a, b) => a.time - b.time);
step(`Expenses: ${otherExpenses.length} more with bill and item photos`);
for (const e of otherExpenses) await postExpense(e);
{
  const dup = otherExpenses.find((e) => e.itemName === 'Tea & snacks' && e.daysAgo === 5);
  if (dup) await call(OWN, 'POST', `/expenses/${dup.id}/void`, { reason: 'Entered twice by mistake' });
}

// ─── Reminders, coupons and referrals ─────────────────────────────────────

step('Reminders: comeback coupons, a reminded and a snoozed customer');
// A random recent wash can land on a "lapsed" customer, so trust the API's own buckets.
const reminderList = await call(OWN, 'GET', '/reminders');
const inBucket = (rows) => {
  const ids = new Set(rows.map((r) => r.vehicleId));
  return customers.filter((c) => c.vehicles.length === 1 && ids.has(c.vehicles[0].id));
};
const comeback = inBucket(reminderList.comeback);
const due = inBucket(reminderList.due);
const couponFor = comeback[0];
const unusedCouponFor = comeback[1];
const coupon = await call(OWN, 'POST', `/reminders/${couponFor.vehicles[0].id}/coupon`);
await call(OWN, 'POST', `/reminders/${unusedCouponFor.vehicles[0].id}/coupon`);
await call(tokens.user_staff_suresh, 'POST', `/reminders/${due[0].vehicles[0].id}`, { action: 'reminded' });
await call(OWN, 'POST', `/reminders/${due[1].vehicles[0].id}`, { action: 'snooze' });

// ─── Today ────────────────────────────────────────────────────────────────

step('Today: washes in every state, photos, a coupon and two referrals');
const [ravi, suresh, kiran] = STAFF;
const todayCrew = [ravi, suresh, kiran];
const walkIn = (vt, name) => {
  const c = { name: name ?? `${pick(FIRST)} ${pick(LAST)}`, phone: newPhone() };
  const [make, model] = pick(MODELS[vt]);
  return { customer: c, vehicle: { vt, plate: newPlate(!CAR_TYPES.includes(vt)), make, model } };
};
const regular = customers.filter((c) => c.lastOffset >= 5 && c.lastOffset <= 9 && c.vehicles.length === 1);
const fromRegular = (c) => ({ customer: c, vehicle: c.vehicles[0] });
const wash = (who, minutesAgo, extra = {}) => {
  const time = todayAt(minutesAgo);
  return {
    ...who,
    time,
    creator: extra.creator ?? pick(todayCrew),
    services: extra.services ?? pickServices(who.vehicle.vt),
    washers: extra.washers ?? [pick(todayCrew)],
    sellers: extra.sellers,
    method: extra.method ?? 'cash',
    payer: extra.payer ?? pick([OWNER, ravi, suresh]),
    tWash: addMin(time, 8),
    tReady: addMin(time, 40),
    tPaid: addMin(time, 50),
    ...extra,
  };
};
const minutesBack = (n) => Math.max(12, Math.min(n, minutesIntoToday - 60));

const paidToday = [
  wash(fromRegular(regular[0]), minutesBack(380), { method: 'cash' }),
  wash(walkIn('vt_sedan'), minutesBack(340), { method: 'upi', services: ['svc_mana_combo'], sellers: [suresh] }),
  wash(fromRegular(regular[1]), minutesBack(300), { method: 'upi' }),
  wash(walkIn('vt_bike'), minutesBack(260), { method: 'cash', services: ['svc_bike_complete', 'svc_bike_chain'] }),
  wash(walkIn('vt_large_suv'), minutesBack(230), {
    method: 'cash',
    services: ['svc_complete_wash', 'svc_ac_hygiene'],
    sellers: [kiran],
    discount: 10000,
    discountReason: 'Regular customer',
  }),
];
for (const [i, w] of paidToday.entries()) await runWash(w, { photos: i === 1 || i === 4 });

// Comeback coupon redeemed on today's visit.
await runWash(
  wash(fromRegular(couponFor), minutesBack(200), { couponCode: coupon.code, method: 'upi', creator: OWNER, payer: OWNER }),
  { photos: true },
);

// A regular sends a friend: the friend gets a discount now, the regular a reward coupon once it's paid.
const referrer = regular[2];
const friend = walkIn('vt_mini_suv', 'Sravya Reddy');
const quote = await call(tokenOf(ravi), 'POST', '/referrals/quote', {
  referrerPhone: referrer.phone,
  phone: friend.customer.phone,
  registrationNumber: friend.vehicle.plate,
});
await runWash(wash(friend, minutesBack(170), { referralToken: quote.token, services: ['svc_complete_wash'], creator: ravi, method: 'upi' }));

// Still in the shop.
await runWash(wash(walkIn('vt_hatchback'), minutesBack(95), { washers: [ravi, kiran] }), { stopAt: 'ready', photos: true });
await runWash(wash(walkIn('vt_sedan'), minutesBack(70), { washers: [suresh] }), { stopAt: 'washing', photos: true });
await runWash(wash(fromRegular(regular[3]), minutesBack(55), { washers: [kiran] }), { stopAt: 'washing' });
await runWash(wash(walkIn('vt_scooter'), minutesBack(30), { services: ['svc_bike_exterior'] }), { stopAt: 'waiting' });
const friend2 = walkIn('vt_hatchback', 'Rahul Varma');
const quote2 = await call(tokenOf(suresh), 'POST', '/referrals/quote', {
  referrerPhone: regular[4].phone,
  phone: friend2.customer.phone,
  registrationNumber: friend2.vehicle.plate,
});
await runWash(wash(friend2, minutesBack(20), { referralToken: quote2.token, services: ['svc_exterior_wash'], creator: suresh }), {
  stopAt: 'waiting',
});
{
  const leftJob = await runWash(wash(walkIn('vt_sedan'), minutesBack(140), { creator: kiran }), { stopAt: 'waiting' });
  await call(tokenOf(kiran), 'POST', `/jobs/${leftJob}/void`, {
    reason: 'Customer left — queue too long',
    occurredAt: todayAt(minutesBack(125)).toISOString(),
  });
}

// ─── Cash drawer ──────────────────────────────────────────────────────────

step('Cash drawer: the last 30 days counted and closed, today open');
const cashDays = [];
for (let d = 30; d >= 1; d--) {
  if (d === 17) continue; // a day nobody opened the drawer
  const date = day(d);
  const float = pick([150000, 200000, 200000, 250000]);
  await call(OWN, 'PUT', '/cash/day/float', { date, amount: float });
  if (d === 5) continue; // opened but never closed
  const summary = await call(OWN, 'GET', `/cash/day?date=${date}`);
  let counted = summary.expected;
  let note;
  if (d === 12) (counted -= 20000), (note = '₹200 advance given to Ravi');
  else if (d === 8) (counted += 10000), (note = 'Customer left ₹100 extra, will return');
  else if (d === 3) (counted -= 5000), (note = 'Change mismatch at closing');
  const closer = d === 1 ? ravi : OWNER;
  await call(tokenOf(closer), 'POST', '/cash/day/close', { date, counted, ...(note ? { note } : {}) });
  if (d === 9) {
    await call(OWN, 'POST', '/cash/day/reopen', { date, reason: 'Recounting after a late UPI fix' });
    const again = await call(OWN, 'GET', `/cash/day?date=${date}`);
    await call(OWN, 'POST', '/cash/day/close', { date, counted: again.expected });
  }
  cashDays.push(date);
}
await call(tokenOf(ravi), 'PUT', '/cash/day/float', { date: day(0), amount: 200000 });

step('Error log: one crash report from a staff phone');
await call(tokenOf(kiran), 'POST', '/shop/errors', {
  message: "TypeError: Cannot read property 'total' of undefined",
  stack: 'at JobDetailScreen (JobDetailScreen.tsx:212)\nat renderWithHooks',
  context: 'JobDetail · opening a voided job',
  appVersion: JSON.parse(readFileSync(join(API_DIR, '../mobile/package.json'), 'utf8')).version,
});

// ─── Second branch ────────────────────────────────────────────────────────

step('Second branch: MANA Car Wash Kavali');
// Opening a branch needs paid Pro, and a new branch starts on Free: show both as paying shops.
const paidPro = (shopId) =>
  `UPDATE shops SET plan = 'active', paid_until = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now', '+30 days') WHERE id = '${shopId}';`;
runSql([paidPro(SHOP)], 'paid-pro-main');
const kavali = await call(OWN, 'POST', '/auth/shops', { shopName: 'MANA Car Wash Kavali', city: 'Kavali' });
runSql([paidPro(kavali.user.shopId)], 'paid-pro-kavali');
const KAV = kavali.token;
const kvTypes = {};
for (const [key, name, category] of [
  ['hatch', 'Hatchback', 'car'],
  ['sedan', 'Sedan', 'car'],
  ['suv', 'SUV', 'car'],
  ['bike', 'Bike', 'bike'],
]) {
  kvTypes[key] = (await call(KAV, 'POST', '/services/vehicle-types', { name, category })).id;
}
const kvComplete = await call(KAV, 'POST', '/services', {
  name: 'Complete Car Wash',
  description: 'Foam wash + interior vacuum + tyres',
  vehicles: [
    { vehicleTypeId: kvTypes.hatch, price: 35000 },
    { vehicleTypeId: kvTypes.sedan, price: 45000 },
    { vehicleTypeId: kvTypes.suv, price: 55000 },
  ],
});
await call(KAV, 'POST', '/services', {
  name: 'Exterior Wash',
  vehicles: [
    { vehicleTypeId: kvTypes.hatch, price: 20000 },
    { vehicleTypeId: kvTypes.sedan, price: 25000 },
    { vehicleTypeId: kvTypes.suv, price: 30000 },
  ],
});
const kvBike = await call(KAV, 'POST', '/services', { name: 'Bike Wash', vehicles: [{ vehicleTypeId: kvTypes.bike, price: 12000 }] });
const venkat = await call(KAV, 'POST', '/team', { name: 'Venkat', phone: '9300000021', role: 'staff', pin: PIN });
const venkatToken = (await call(null, 'POST', '/auth/pin/login', { phone: '9300000021', pin: PIN })).token;
const kvWash = async (minutesAgo, vt, serviceId, stopAt) => {
  const who = walkIn('vt_sedan');
  const id = cid('job');
  const t = todayAt(minutesBack(minutesAgo));
  await call(venkatToken, 'POST', '/jobs/start', {
    id,
    occurredAt: t.toISOString(),
    customer: { phone: who.customer.phone, name: who.customer.name },
    registrationNumber: who.vehicle.plate,
    vehicleTypeId: vt,
    services: [{ serviceId, quantity: 1 }],
  });
  if (stopAt === 'waiting') return;
  await call(venkatToken, 'PATCH', `/jobs/${id}/status`, { status: 'washing', occurredAt: addMin(t, 5).toISOString(), washerIds: [venkat.id] });
  if (stopAt === 'washing') return;
  await call(venkatToken, 'PATCH', `/jobs/${id}/status`, { status: 'ready', occurredAt: addMin(t, 35).toISOString() });
  await call(KAV, 'POST', `/jobs/${id}/pay`, { paymentMethod: 'cash', occurredAt: addMin(t, 45).toISOString() });
};
await call(venkatToken, 'PUT', '/cash/day/float', { date: day(0), amount: 100000 });
await kvWash(240, kvTypes.sedan, kvComplete.id, 'paid');
await kvWash(150, kvTypes.suv, kvComplete.id, 'paid');
await kvWash(60, kvTypes.bike, kvBike.id, 'washing');
await kvWash(15, kvTypes.hatch, kvComplete.id, 'waiting');
await call(KAV, 'PUT', '/attendance', { userId: venkat.id, date: day(0), status: 'present' });

// ─── Timestamps the API sets to "now" ─────────────────────────────────────

step('Back-dating records the API stamps with the current time');
{
  const sql = [];
  sql.push(`UPDATE stock_items SET created_at = ${q(ts(openingAt))} WHERE shop_id = '${SHOP}';`);
  sql.push(`UPDATE stock_moves SET created_at = ${q(ts(openingAt))} WHERE shop_id = '${SHOP}' AND note = 'Opening stock';`);
  for (const [kind, id, time] of moveTimes) {
    sql.push(
      kind === 'expense'
        ? `UPDATE stock_moves SET created_at = ${q(ts(time))} WHERE expense_id = ${q(id)};`
        : `UPDATE stock_moves SET created_at = ${q(ts(time))} WHERE id = ${q(id)};`,
    );
  }
  for (const e of expenses) sql.push(`UPDATE expenses SET created_at = ${q(ts(e.time))} WHERE id = ${q(e.id)};`);
  for (const date of cashDays) {
    const d = Math.round((Date.UTC(Y, M, D) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
    sql.push(
      `UPDATE cash_days SET float_set_at = ${q(ts(at(d, 8, 30)))}, closed_at = CASE WHEN closed_at IS NULL THEN NULL ELSE ${q(ts(at(d, 20, 45)))} END, reopened_at = CASE WHEN reopened_at IS NULL THEN NULL ELSE ${q(ts(at(d, 20, 30)))} END WHERE shop_id = '${SHOP}' AND date = ${q(date)};`,
    );
  }
  sql.push(`UPDATE cash_days SET float_set_at = ${q(ts(at(5, 8, 30)))} WHERE shop_id = '${SHOP}' AND date = ${q(day(5))};`);
  sql.push(
    `UPDATE attendance SET marked_at = date || 'T04:00:00.000+00:00' WHERE shop_id = '${SHOP}' AND date < ${q(day(0))};`,
  );
  runSql(sql, 'backdate');
}

// ─── Summary ──────────────────────────────────────────────────────────────

const [counts] = query(`SELECT
  (SELECT COUNT(*) FROM customers WHERE shop_id = '${SHOP}') AS customers,
  (SELECT COUNT(*) FROM vehicles WHERE shop_id = '${SHOP}') AS vehicles,
  (SELECT COUNT(*) FROM jobs WHERE shop_id = '${SHOP}') AS jobs,
  (SELECT COUNT(*) FROM expenses WHERE shop_id = '${SHOP}') AS expenses,
  (SELECT COUNT(*) FROM job_photos WHERE shop_id = '${SHOP}') AS photos,
  (SELECT COUNT(*) FROM coupons WHERE shop_id = '${SHOP}') AS coupons,
  (SELECT COUNT(*) FROM cash_days WHERE shop_id = '${SHOP}') AS cash_days`);
console.log(`
Done. MANA Car Wash (Nellore), shop ID 482193:
  ${counts.customers} customers · ${counts.vehicles} vehicles · ${counts.jobs} washes · ${counts.expenses} expenses
  ${counts.photos} wash photos · ${counts.coupons} coupons · ${counts.cash_days} cash drawer days
  ${canDraw ? '' : '(photos are vehicle pictures — bills are only drawn on macOS)\n  '}
Sign in (PIN ${PIN} for everyone):
  Owner   Hrushikesh   ${OWNER.phone}   (both branches — switch from the shop name on Home)
  Staff   Ravi Kumar   ${ravi.phone}
  Staff   Suresh Babu  ${suresh.phone}
  Staff   Kiran Teja   ${kiran.phone}
  Kavali  Venkat       9300000021
  Waiting to join: Mahesh 9300000019 (approve or reject from Team)`);
