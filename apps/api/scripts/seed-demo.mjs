#!/usr/bin/env node
// Wipes the LOCAL database (or, with --staging, the STAGING one) and fills it with a realistic
// shop, so every screen has something to show and every feature can be tried end to end.
//
//   cd apps/api && npm run dev          (in one terminal — the seed talks to the running API)
//   cd apps/api && npm run db:seed:demo (in another)
//   cd apps/api && npm run db:seed:staging   (the deployed staging Worker and mana_db_staging)
//
// What it makes (all PINs 258025; a new phone confirms with the dev code 000000 first):
//   Mana Wash Nellore City (branch code NLR-01), the only branch — owner Hrushikesh 9888626111;
//   staff Ravi 9300000011,
//   Suresh 9300000012, Kiran 9300000013.
//   ~75 days of washes, customers and vehicles; reminders (due and comeback), coupons and
//   referrals; expenses with bill photos; stock; attendance; cash drawer days; an error report;
//   stamp cards (one free wash used today) and a welcome gift, some of it owed (out of stock).
//   Customer feedback: open problems, vehicle-add requests, and wash ratings.
//   A doorstep team for Nellore communities, beside the Kovur hub; the owner runs the business
//   catalog (services, base prices by size, the doorstep extra) that every branch's menu comes from.
//   Places the doorstep van serves: Lakshmi Towers (flats, members on plans, today's wash list with
//   paid and unpaid vehicles, GST receipts) and Sri Ram Nagar (a member waiting for the team), plus
//   "Call me back" requests nearby. Plans: Monthly, Quarterly (payable in parts), Bike Monthly.
//
// Washes older than a week are written straight into the database (the API only accepts a week
// of backdating); everything newer goes through the real API, as the app would send it.
// Photos are drawn on macOS with QuickLook + sips; elsewhere the vehicle pictures are used.
// It never touches the production database.
import { execFileSync } from 'node:child_process';
import { randomUUID, webcrypto } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API, API_DIR, STAGING, TARGET, apiFetch, d1Execute, d1Rows, DEV_CODE, signIn as signInWith } from './lib/target.mjs';

const PIN = '258025';
/** A plain drawn car, for wash photos when pictures can't be drawn. */
const SAMPLE_PHOTO = join(API_DIR, 'scripts', 'fixtures', 'sample-photo.jpg');
const TMP = mkdtempSync(join(tmpdir(), 'mana-seed-'));
const SHOP = 'shop_mana';

// ─── Plumbing ─────────────────────────────────────────────────────────────

const query = d1Rows;
function runSql(statements, label) {
  const file = join(TMP, `${label}.sql`);
  writeFileSync(file, statements.join('\n'));
  d1Execute([`--file=${file}`]);
}

async function call(token, method, path, body) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await apiFetch(API + path, { method, headers, body: payload });
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
/** The same sample picture for every vehicle type. */
const rawArt = () => new File([readFileSync(SAMPLE_PHOTO)], 'vehicle.jpg', { type: 'image/jpeg' });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function vehiclePhoto(vt, plate, kind) {
  if (!canDraw) return rawArt(vt);
  const b64 = readFileSync(SAMPLE_PHOTO).toString('base64');
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

const PLACE_SCENE = {
  gate: ['#475569', '#e2e8f0', 'GATE'],
  parking: ['#0f766e', '#ccfbf1', 'PARKING'],
  water: ['#0369a1', '#e0f2fe', 'WATER POINT'],
  building: ['#92400e', '#fef3c7', 'BUILDING'],
};
function placePhoto(kind, placeName) {
  if (!canDraw) return rawArt('vt_sedan');
  const [ink, paper, title] = PLACE_SCENE[kind] ?? PLACE_SCENE.building;
  return render(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
    <rect width="800" height="800" fill="${paper}"/>
    <rect x="120" y="180" width="560" height="420" rx="18" fill="${ink}" opacity="0.18"/>
    <rect x="180" y="240" width="140" height="120" rx="8" fill="${ink}" opacity="0.35"/>
    <rect x="480" y="240" width="140" height="120" rx="8" fill="${ink}" opacity="0.35"/>
    <rect x="330" y="420" width="140" height="180" rx="8" fill="${ink}" opacity="0.5"/>
    <rect x="0" y="700" width="800" height="100" fill="${ink}"/>
    <text x="40" y="762" font-family="Helvetica" font-size="34" font-weight="bold" fill="#fff">${title} · ${esc(placeName)}</text>
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
  // The demo leaves the owner's own days unmarked.
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
const usedPhones = new Set([OWNER.phone, ...STAFF.map((s) => s.phone)]);
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
  await apiFetch(`${API}/health`);
} catch {
  console.error(`The API isn't running at ${API}. Start it first:  cd apps/api && npm run dev`);
  process.exit(1);
}

step(`Resetting the ${TARGET} database (migrations + seed.sql)`);
execFileSync('node', [join(API_DIR, 'scripts', 'db-reset-local.mjs'), ...(STAGING ? ['--staging'] : [])], {
  cwd: API_DIR,
  stdio: 'ignore',
});

const PRICES = {};
for (const row of query("SELECT service_id, vehicle_type_id, price FROM service_prices WHERE mode = 'hub'")) {
  (PRICES[row.service_id] ??= {})[row.vehicle_type_id] = row.price;
}
step(`Writing the team and ${visits.filter((v) => v.daysAgo > API_DAYS).length} older washes straight into the database`);
{
  const sql = [];
  sql.push(`UPDATE shops SET name = 'Mana Wash Nellore City', city = 'Nellore', created_at = ${q(ts(at(90, 9)))} WHERE id = '${SHOP}';`);
  sql.push(
    `UPDATE users SET name = ${q(OWNER.name)}, phone = ${q(OWNER.phone)}, pin_hash = ${q(await hashPin(PIN))}, pin_digits = ${PIN.length}, created_at = ${q(ts(at(90, 9)))} WHERE id = '${OWNER.id}';`,
  );
  sql.push(`UPDATE business_admins SET phone = ${q(OWNER.phone)} WHERE business_id = 'biz_mana';`);
  const [ravi, ...others] = STAFF;
  sql.push(
    `UPDATE users SET name = ${q(ravi.name)}, phone = ${q(ravi.phone)}, pin_hash = ${q(await hashPin(PIN))}, pin_digits = ${PIN.length}, created_at = ${q(ts(at(ravi.joinedDaysAgo, 9)))} WHERE id = '${ravi.id}';`,
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
        pin_digits: PIN.length,
        created_at: ts(at(s.joinedDaysAgo, 9)),
      }),
    );
  }

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
// The running API can drop the first requests while it reopens the database rebuilt above;
// signing in is safe to repeat, so wait it out here rather than mid-seed.
async function pinLogin(phone) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await signInWith(phone, PIN);
    } catch (err) {
      if (attempt >= 10 || !(err instanceof TypeError)) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}
const tokens = {};
for (const person of [OWNER, ...STAFF]) {
  tokens[person.id] = (await pinLogin(person.phone)).body?.token;
}
const OWN = tokens[OWNER.id];
const tokenOf = (person) => tokens[person.id];

step('Shop setup: name, the menu from the business catalog, staff commissions, Google review link');
await call(OWN, 'PUT', '/shop/info', { name: 'Mana Wash Nellore City', city: 'Nellore' });
// The first menu read builds the branch's menu from the catalog: its own services (above) are
// adopted with their ids, and the combo's contents come from the catalog's combo.
await call(OWN, 'GET', '/services');
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
    ...(v.rewardServiceIds ? { rewardServiceIds: v.rewardServiceIds } : {}),
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
  labour: 'MANA WASH',
  electricity: 'APSPDCL',
  water: 'BALAJI WATER SUPPLY',
  maintenance: 'KRISHNA HARDWARE',
  other: 'LAKSHMI STORES',
};
const STOCK = [
  // Wash chemicals
  { name: 'Foam shampoo', unit: 'l', lowAt: 5, opening: 15, target: 9, use: [1, 'l'], buys: [[40, 5, 145000], [25, 5, 145000], [12, 5, 150000], [3, 5, 150000]] },
  { name: 'Pre-wash spray', unit: 'l', lowAt: 3, opening: 8, target: 4.5, use: [500, 'ml'], buys: [[38, 5, 110000], [16, 5, 115000]] },
  { name: 'Snow foam', unit: 'l', lowAt: 4, opening: 10, target: 6, use: [1, 'l'], buys: [[36, 5, 180000], [11, 5, 185000]] },
  { name: 'Wheel cleaner', unit: 'l', lowAt: 2, opening: 4, target: 2.5, use: [250, 'ml'], buys: [[34, 2, 70000], [13, 2, 72000]] },
  { name: 'Iron fallout remover', unit: 'l', lowAt: 1, opening: 2, target: 1.25, use: [200, 'ml'], buys: [[29, 1, 85000]] },
  { name: 'Engine degreaser', unit: 'l', lowAt: 1, opening: 3, target: 1.8, use: [300, 'ml'], buys: [[31, 2, 60000], [9, 1, 32000]] },
  { name: 'Glass cleaner', unit: 'l', lowAt: 1, opening: 2, target: 1.5, use: [250, 'ml'], buys: [[20, 1, 32000], [5, 2, 60000]] },
  { name: 'Interior cleaner', unit: 'l', lowAt: 2, opening: 4, target: 2.2, use: [300, 'ml'], buys: [[27, 2, 55000], [8, 2, 56000]] },
  { name: 'Upholstery shampoo', unit: 'l', lowAt: 1, opening: 2, target: 1.4, use: [250, 'ml'], buys: [[24, 1, 48000], [6, 1, 50000]] },
  { name: 'Fabric protectant', unit: 'l', lowAt: 1, opening: 1.5, target: 0.9, use: [150, 'ml'], buys: [[22, 1, 75000]] },
  // Finish and shine
  { name: 'Car wax', unit: 'kg', lowAt: 1, opening: 2, target: 1.5, use: [250, 'g'], buys: [[35, 1, 90000], [10, 1, 95000]] },
  { name: 'Quick detailer', unit: 'l', lowAt: 2, opening: 3, target: 1.8, use: [200, 'ml'], buys: [[33, 2, 80000], [12, 2, 82000]] },
  { name: 'Ceramic spray', unit: 'l', lowAt: 1, opening: 1.5, target: 0.8, use: [100, 'ml'], buys: [[26, 1, 220000]] },
  { name: 'Tyre shine', unit: 'l', lowAt: 2, opening: 3, target: 1.2, use: [500, 'ml'], buys: [[30, 2, 65000], [14, 2, 65000]] },
  { name: 'Dashboard polish', unit: 'l', lowAt: 1, opening: 1, target: 1.25, use: [250, 'ml'], buys: [[18, 1, 50000], [4, 1, 52000]] },
  { name: 'Plastic restorer', unit: 'l', lowAt: 1, opening: 1.5, target: 0.9, use: [150, 'ml'], buys: [[19, 1, 68000]] },
  { name: 'Chrome polish', unit: 'kg', lowAt: 0.5, opening: 1, target: 0.6, use: [50, 'g'], buys: [[21, 1, 45000]] },
  // Cloths, pads and tools
  { name: 'Microfibre cloth', unit: 'pcs', lowAt: 10, opening: 30, target: 34, use: [4, 'pcs'], buys: [[28, 20, 80000], [6, 20, 85000]] },
  { name: 'Drying towel', unit: 'pcs', lowAt: 4, opening: 8, target: 5, use: [1, 'pcs'], buys: [[32, 6, 120000], [7, 4, 85000]] },
  { name: 'Applicator pad', unit: 'pcs', lowAt: 6, opening: 15, target: 9, use: [2, 'pcs'], buys: [[25, 12, 36000], [5, 12, 38000]] },
  { name: 'Foam pad', unit: 'pcs', lowAt: 3, opening: 6, target: 4, use: [1, 'pcs'], buys: [[23, 4, 48000]] },
  { name: 'Clay bar', unit: 'pcs', lowAt: 2, opening: 4, target: 2, use: [1, 'pcs'], buys: [[17, 4, 60000]] },
  { name: 'Wheel brush', unit: 'pcs', lowAt: 2, opening: 5, target: 3, use: [1, 'pcs'], buys: [[15, 4, 40000]] },
  { name: 'Sponge', unit: 'pcs', lowAt: 5, opening: 12, target: 7, use: [2, 'pcs'], buys: [[20, 10, 25000], [3, 10, 26000]] },
  { name: 'Bucket', unit: 'pcs', lowAt: 2, opening: 4, target: 4, use: [1, 'pcs'], buys: [[41, 2, 30000]], category: 'maintenance' },
  // Consumables and counter
  { name: 'Car fragrance', unit: 'pcs', lowAt: 5, opening: 24, target: 16, use: [2, 'pcs'], buys: [[14, 24, 72000]] },
  { name: 'Seat cover (disposable)', unit: 'pcs', lowAt: 20, opening: 80, target: 42, use: [6, 'pcs'], buys: [[37, 100, 50000], [10, 100, 52000]], category: 'other' },
  { name: 'Floor mat (paper)', unit: 'pcs', lowAt: 30, opening: 100, target: 55, use: [8, 'pcs'], buys: [[39, 100, 35000], [8, 100, 36000]], category: 'other' },
  { name: 'Steering wheel cover', unit: 'pcs', lowAt: 15, opening: 50, target: 28, use: [4, 'pcs'], buys: [[30, 50, 40000]], category: 'other' },
  { name: 'Masking tape', unit: 'pcs', lowAt: 3, opening: 8, target: 4, use: [1, 'pcs'], buys: [[16, 6, 18000]], category: 'other' },
  { name: 'Bill book', unit: 'pcs', lowAt: 2, opening: 4, target: 0, use: [1, 'pcs'], buys: [[33, 10, 30000]], category: 'other' },
  { name: 'Thermal roll', unit: 'pcs', lowAt: 3, opening: 8, target: 3, use: [1, 'pcs'], buys: [[12, 10, 25000]], category: 'other' },
  // Equipment parts (maintenance)
  { name: 'Foam gun nozzle', unit: 'pcs', lowAt: 1, opening: 3, target: 2, use: [1, 'pcs'], buys: [[9, 2, 28000]], category: 'maintenance' },
  { name: 'Hose washer', unit: 'pcs', lowAt: 5, opening: 20, target: 12, use: [2, 'pcs'], buys: [[18, 20, 10000]], category: 'maintenance' },
  { name: 'Pressure washer oil', unit: 'l', lowAt: 0.5, opening: 1, target: 0.7, use: [100, 'ml'], buys: [[42, 1, 55000]] },
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

// ─── Rewards ──────────────────────────────────────────────────────────────

step('Rewards: stamp cards on Complete Wash and Bike Complete, a welcome gift for new cars');
// Cards are worked out from wash history, so regulars already have stamps the moment a card is on.
await call(OWN, 'PUT', '/rewards/rules/svc_complete_wash', { every: 5 });
await call(OWN, 'PUT', '/rewards/rules/svc_bike_complete', { every: 4 });
// One mitt on the shelf: the first new car today gets it, the rest are owed until the next delivery.
const washMitt = await call(OWN, 'POST', '/stock', { name: 'Wash mitt', unit: 'pcs', lowAt: 2, opening: 1 });
const fragrance = STOCK.find((i) => i.name === 'Car fragrance');
await call(OWN, 'PUT', '/rewards/gift', {
  items: [
    { stockItemId: fragrance.id, quantity: 1 },
    { stockItemId: washMitt.id, quantity: 1 },
  ],
});
// Today's washes come from these regulars (first five) and the reminder customers above.
const regular = customers.filter((c) => c.lastOffset >= 5 && c.lastOffset <= 9 && c.vehicles.length === 1);
// A regular with a full card, kept away from the customers today's other washes use.
const busyToday = new Set(
  [...regular.slice(0, 5), couponFor, unusedCouponFor, due[0], due[1]].map((c) => c.vehicles[0].id),
);
let freeFor = null;
for (const c of customers) {
  const v = c.vehicles[0];
  if (c.vehicles.length !== 1 || !CAR_TYPES.includes(v.vt) || busyToday.has(v.id)) continue;
  const card = await call(OWN, 'GET', `/rewards/vehicle?registrationNumber=${encodeURIComponent(v.plate)}`);
  if (card.cards.some((k) => k.serviceId === 'svc_complete_wash' && k.free > 0)) {
    freeFor = c;
    break;
  }
}

// ─── Today ────────────────────────────────────────────────────────────────

step('Today: washes in every state, photos, a coupon and two referrals');
const [ravi, suresh, kiran] = STAFF;
const todayCrew = [ravi, suresh, kiran];
const walkIn = (vt, name) => {
  const c = { name: name ?? `${pick(FIRST)} ${pick(LAST)}`, phone: newPhone() };
  const [make, model] = pick(MODELS[vt]);
  return { customer: c, vehicle: { vt, plate: newPlate(!CAR_TYPES.includes(vt)), make, model } };
};
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

// A regular cashes in a full stamp card: the wash is on the house, the washer still earns.
if (freeFor) {
  await runWash(
    wash(fromRegular(freeFor), minutesBack(150), { services: ['svc_complete_wash'], rewardServiceIds: ['svc_complete_wash'] }),
  );
}

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

// ─── Customer feedback (Mana Wash app → team inbox) ───────────────────────

step('Customer feedback: problems, ratings and vehicle-add requests');
{
  // Recent paid washes give us real customers and jobs to hang ratings and problems on.
  const jobs = query(`
    SELECT j.id AS job_id, j.customer_id, v.vehicle_type_id, v.registration_number
    FROM jobs j
    JOIN vehicles v ON v.id = j.vehicle_id AND v.shop_id = j.shop_id
    WHERE j.shop_id = '${SHOP}' AND j.status = 'paid' AND j.payment_status = 'paid'
    ORDER BY j.created_at DESC
    LIMIT 14
  `);
  const sql = [];
  const job = (i) => jobs[i];

  // Ratings — mix of stars so the 30-day summary looks real.
  const ratingRows = [
    [0, 5, 'Spotless — mats and dash too. Will come every week.'],
    [1, 5, null],
    [2, 4, 'Good wash, a bit slow at peak hour.'],
    [3, 5, 'Bike looks brand new.'],
    [4, 3, 'Exterior fine, interior still dusty near the seat belts.'],
    [5, 2, 'Water spots on the black panels after drying.'],
    [6, 5, null],
    [7, 4, 'Friendly staff. Foam wash smelled great.'],
    [8, 1, 'Scratch on the rear bumper we didn’t have before.'],
    [9, 5, 'Best in Nellore.'],
  ];
  for (const [i, stars, comment] of ratingRows) {
    const j = job(i);
    if (!j) continue;
    const when = ts(at(i === 0 || i === 1 ? 0 : Math.min(i, 12), 18, 10 + i));
    sql.push(
      insert('wash_ratings', {
        job_id: j.job_id,
        shop_id: SHOP,
        customer_id: j.customer_id,
        stars,
        comment,
        created_at: when,
        updated_at: when,
      }),
    );
  }

  // Problems — a few open for the team, one already resolved.
  const problems = [
    {
      i: 4,
      kind: 'not_clean',
      details: 'Seat belts and cup holders still had dust after the interior wash. Please check next time.',
      status: 'open',
      hoursAgo: 5,
    },
    {
      i: 5,
      kind: 'damage',
      details: 'Small scratch on the left rear door — wasn’t there when I dropped the car.',
      status: 'open',
      hoursAgo: 28,
    },
    {
      i: 2,
      kind: 'billing',
      details: 'App showed combo price but the bill charged AC hygiene separately. Can you check?',
      status: 'open',
      hoursAgo: 9,
    },
    {
      i: 8,
      kind: 'staff',
      details: 'Washer was on a phone call while drying. Felt rushed.',
      status: 'resolved',
      hoursAgo: 72,
      resolution: 'Spoke with the washer — apologised to the customer and offered a free exterior next visit.',
    },
    {
      i: null,
      kind: 'other',
      details: 'Hard to find parking near the gate on Sundays. Any overflow spot we can use?',
      status: 'open',
      hoursAgo: 40,
      customerId: job(6)?.customer_id,
    },
  ];
  for (const [n, p] of problems.entries()) {
    const j = p.i != null ? job(p.i) : null;
    const customerId = j?.customer_id ?? p.customerId;
    if (!customerId) continue;
    const created = ts(addMin(NOW, -p.hoursAgo * 60));
    sql.push(
      insert('wash_problems', {
        id: `prob_demo_${n + 1}`,
        shop_id: SHOP,
        customer_id: customerId,
        job_id: j?.job_id ?? null,
        kind: p.kind,
        details: p.details,
        status: p.status,
        resolution: p.resolution ?? null,
        resolved_by_user_id: p.status === 'resolved' ? OWNER.id : null,
        resolved_at: p.status === 'resolved' ? ts(addMin(NOW, -(p.hoursAgo - 20) * 60)) : null,
        created_at: created,
      }),
    );
  }

  // Vehicle-add requests — two waiting, one already added, one declined.
  const vtSedan = 'vt_sedan';
  const vtScooter = 'vt_scooter';
  const asker = job(0);
  const asker2 = job(3);
  const asker3 = job(7);
  if (asker) {
    sql.push(
      insert('vehicle_requests', {
        id: 'vreq_demo_1',
        shop_id: SHOP,
        customer_id: asker.customer_id,
        registration_number: 'AP39BM4410',
        vehicle_type_id: vtSedan,
        make: 'Hyundai',
        model: 'Venue',
        status: 'pending',
        created_at: ts(addMin(NOW, -3 * 60)),
      }),
    );
  }
  if (asker2) {
    sql.push(
      insert('vehicle_requests', {
        id: 'vreq_demo_2',
        shop_id: SHOP,
        customer_id: asker2.customer_id,
        registration_number: 'AP39SK2208',
        vehicle_type_id: vtScooter,
        make: 'Honda',
        model: 'Activa',
        status: 'pending',
        created_at: ts(addMin(NOW, -26 * 60)),
      }),
    );
  }
  if (asker3) {
    sql.push(
      insert('vehicle_requests', {
        id: 'vreq_demo_3',
        shop_id: SHOP,
        customer_id: asker3.customer_id,
        registration_number: 'AP39CK1199',
        vehicle_type_id: vtSedan,
        make: 'Maruti',
        model: 'Baleno',
        status: 'approved',
        handled_by_user_id: ravi.id,
        handled_at: ts(addMin(NOW, -48 * 60)),
        created_at: ts(addMin(NOW, -50 * 60)),
      }),
    );
    sql.push(
      insert('vehicle_requests', {
        id: 'vreq_demo_4',
        shop_id: SHOP,
        customer_id: asker3.customer_id,
        registration_number: 'AP39XX0001',
        vehicle_type_id: vtSedan,
        make: 'Tata',
        model: 'Nexon',
        status: 'rejected',
        reason: 'We haven’t washed this vehicle yet',
        handled_by_user_id: OWNER.id,
        handled_at: ts(addMin(NOW, -60 * 60)),
        created_at: ts(addMin(NOW, -70 * 60)),
      }),
    );
  }

  if (sql.length) runSql(sql, 'customer-feedback');
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
  // Extra stock buys can leave expected low; the drawer never counts below zero.
  let counted = Math.max(0, summary.expected);
  let note;
  if (d === 12 && counted >= 20000) (counted -= 20000), (note = '₹200 advance given to Ravi');
  else if (d === 8) (counted += 10000), (note = 'Customer left ₹100 extra, will return');
  else if (d === 3 && counted >= 5000) (counted -= 5000), (note = 'Change mismatch at closing');
  else if (counted !== summary.expected) note = 'Cash spent on stock; drawer emptied';
  const closer = d === 1 ? ravi : OWNER;
  await call(tokenOf(closer), 'POST', '/cash/day/close', { date, counted, ...(note ? { note } : {}) });
  if (d === 9) {
    await call(OWN, 'POST', '/cash/day/reopen', { date, reason: 'Recounting after a late UPI fix' });
    const again = await call(OWN, 'GET', `/cash/day?date=${date}`);
    const recounted = Math.max(0, again.expected);
    await call(OWN, 'POST', '/cash/day/close', {
      date,
      counted: recounted,
      ...(recounted !== again.expected ? { note: 'Cash spent on stock; drawer emptied' } : {}),
    });
  }
  cashDays.push(date);
}
await call(tokenOf(ravi), 'PUT', '/cash/day/float', { date: day(0), amount: 200000 });

step('Error log: one crash report from a staff phone');
await call(tokenOf(kiran), 'POST', '/shop/errors', {
  message: "TypeError: Cannot read property 'total' of undefined",
  stack: 'at JobDetailScreen (JobDetailScreen.tsx:212)\nat renderWithHooks',
  context: 'JobDetail · opening a voided job',
  appVersion: JSON.parse(readFileSync(join(API_DIR, '../manager/package.json'), 'utf8')).version,
});

// ─── Second branch ────────────────────────────────────────────────────────

step('Service network: a community team for Nellore');
{
  const { classes } = await call(OWN, 'GET', '/branch/points');
  await call(OWN, 'POST', '/branch/points', {
    kind: 'doorstep',
    name: 'Community team',
    latitude: 14.4426,
    longitude: 79.9865,
    radiusKm: 10,
    classIds: classes.map((c) => c.id),
  });
}

step('Communities: inspected by the team, approved by the owner, members on plans, today’s wash list');
// The plans (Weekly, Regular, Premium in parts, Bike Monthly) come from seed.sql. Each community is
// saved by staff after visiting it, sent for approval, and made live by the owner. Members are added
// the way the team adds someone at the gate; their payment links are paid on the test checkout.
const placesDemo = {};
{
  const DEV_CODE = '000000';
  const [ravi, suresh] = STAFF;
  const RAVI = tokenOf(ravi);
  await call(OWN, 'PATCH', '/business/plan-rules', { gstin: '37AAKCM4821Q1Z6', legalName: 'Mana Wash Pvt Ltd' });
  // Weekly plans wash on a place's first wash day of the week (weeks start Monday): make that
  // today, with the place's other wash days later in the week.
  const mondayIndex = (wd) => (wd + 6) % 7;
  const washDays = [0, 2, 4].map((n) => (weekday(0) + n) % 7).filter((wd) => mondayIndex(wd) >= mondayIndex(weekday(0)));

  /** Five choices of days and time residents want (the minimum a visit needs), starting from `days` at `time`. */
  const fiveChoices = (days, time) =>
    [0, 1, 2, 3, 4].map((n) => ({ days: n ? [(days[0] + n) % 7] : days, time: n % 2 ? '07:00' : time }));
  /** What a staff visit records: the place, what they saw, who to call, photos, days residents want. */
  async function inspect(token, place, photoKinds) {
    const created = await call(token, 'POST', '/places', place);
    for (const kind of photoKinds) {
      const form = new FormData();
      form.set('kind', kind);
      form.set('file', placePhoto(kind, place.name));
      await call(token, 'POST', `/places/${created.id}/photos`, form);
    }
    return created;
  }

  const towers = await inspect(
    RAVI,
    {
      type: 'building',
      name: 'Lakshmi Towers',
      label: 'Beside Apollo Pharmacy, Magunta Layout',
      latitude: 14.4441,
      longitude: 79.9872,
      notes: 'Watchman opens the basement gate at 6 am. Use the tap near the lift.',
      contactName: 'Srinivas (secretary)',
      contactPhone: '9440022001',
      inspection: { water: 'yes', power: 'yes', parking: 'basement', space: 'good', permission: 'yes', cars: 22, bikes: 14, bestTime: '06:30' },
      slots: fiveChoices(washDays, '06:30'),
    },
    ['gate', 'parking', 'space', 'water', 'power'],
  );
  await call(RAVI, 'POST', `/places/${towers.id}/submit`);
  // The flats go in first: members pick theirs when they join.
  await call(OWN, 'POST', `/places/${towers.id}/units`, { block: 'A', numbers: '101-104, 201-204, 301-304' });
  await call(OWN, 'POST', `/places/${towers.id}/units`, { block: 'B', numbers: '101-104, 201-204' });
  await call(OWN, 'POST', `/places/${towers.id}/go-live`, { washDays, washTime: '06:30', teamUserIds: [ravi.id, suresh.id] });

  const colonyDays = [weekday(1), weekday(3)].filter((d, i, all) => all.indexOf(d) === i);
  const colony = await inspect(
    tokenOf(suresh),
    {
      type: 'colony',
      name: 'Sri Ram Nagar',
      label: 'Main gate, near the water tank',
      latitude: 14.4382,
      longitude: 79.9811,
      notes: 'Cars park on both sides of the main road. Residents asked for early mornings.',
      contactName: 'Ramana (watchman)',
      contactPhone: '9440022002',
      inspection: { water: 'bring', power: 'no', parking: 'street', space: 'tight', permission: 'yes', cars: 12, bikes: 20, bestTime: '06:30' },
      slots: fiveChoices(colonyDays, '07:00'),
    },
    ['gate', 'parking', 'space', 'water'],
  );
  await call(tokenOf(suresh), 'POST', `/places/${colony.id}/submit`);
  await call(OWN, 'POST', `/places/${colony.id}/units`, { numbers: '1-24' });
  await call(OWN, 'POST', `/places/${colony.id}/go-live`, {
    washDays: colonyDays,
    washTime: '07:00',
    teamUserIds: [suresh.id],
    needsApproval: true,
  });

  // Waiting for the owner: Kiran visited Green Park Residency and sent it for approval.
  const greenPark = await inspect(
    tokenOf(STAFF[2]),
    {
      type: 'building',
      name: 'Green Park Residency',
      label: 'Opposite Narayana School, Vedayapalem',
      latitude: 14.4608,
      longitude: 79.9721,
      notes: '3 floors, 18 flats. Secretary wants a trial week first.',
      contactName: 'Lakshmi (secretary)',
      contactPhone: '9440022003',
      inspection: { water: 'yes', power: 'yes', parking: 'open', space: 'good', permission: 'yes', cars: 14, bikes: 9, bestTime: '06:30' },
      slots: fiveChoices([6, 0], '06:30'),
    },
    ['building', 'gate', 'parking', 'space', 'water', 'power'],
  );
  await call(tokenOf(STAFF[2]), 'POST', `/places/${greenPark.id}/submit`);

  // Still a draft: Ravi saved what he saw but hasn't talked to the society yet.
  await inspect(
    RAVI,
    {
      type: 'building',
      name: 'Sai Krupa Apartments',
      label: 'Behind the Ramalingeswara temple',
      latitude: 14.4498,
      longitude: 79.9902,
      notes: 'Narrow gate. Ask about the basement.',
      contactName: null,
      contactPhone: null,
      inspection: { water: 'yes', parking: 'basement', cars: 10 },
      slots: [],
    },
    ['gate'],
  );
  const towerUnits = Object.fromEntries((await call(OWN, 'GET', `/places/${towers.id}`)).units.map((u) => [`${u.block}-${u.number}`, u.id]));
  placesDemo.towers = { name: 'Lakshmi Towers', code: towers.code, units: Object.keys(towerUnits).length };
  placesDemo.colony = { name: 'Sri Ram Nagar', code: colony.code };

  const payOnTestCheckout = async (payment) => {
    if (!payment.url.includes('/pay/test/')) return false;
    const res = await apiFetch(API + new URL(payment.url).pathname, {
      method: 'POST',
      body: new URLSearchParams({ action: 'pay' }),
      redirect: 'manual',
    });
    return res.status === 303;
  };
  async function addAtGate(placeId, person, unit, vehicles) {
    await call(RAVI, 'POST', `/places/${placeId}/members/code`, { phone: person.phone });
    return call(RAVI, 'POST', `/places/${placeId}/members`, { phone: person.phone, code: DEV_CODE, name: person.name, unit, vehicles });
  }
  const plan = (planId, payMode = 'full') => ({ kind: 'plan', planId, payMode });
  const members = [
    { name: 'Anil Reddy', phone: '9440011001', unit: 'A-101', vehicles: [['vt_sedan', plan('wp_mana_premium', 'parts')]], pay: true },
    { name: 'Swathi Rao', phone: '9440011002', unit: 'A-203', vehicles: [['vt_hatchback', plan('wp_mana_weekly')], ['vt_scooter', plan('wp_mana_bike_monthly')]], pay: true },
    { name: 'Prakash N', phone: '9440011003', unit: 'B-102', vehicles: [['vt_mini_suv', plan('wp_mana_regular')]], pay: true },
    { name: 'Divya K', phone: '9440011004', unit: 'B-204', vehicles: [['vt_hatchback', plan('wp_mana_weekly')]], pay: false },
  ];
  const paidOrders = [];
  const unpaidOrders = [];
  for (const m of members) {
    const joined = await addAtGate(
      towers.id,
      m,
      { unitId: towerUnits[m.unit] },
      m.vehicles.map(([vehicleTypeId, choice]) => ({ vehicleTypeId, choice })),
    );
    for (const order of joined.orders) {
      const link = await call(RAVI, 'POST', `/places/orders/${order.id}/payment-link`);
      if (m.pay && (await payOnTestCheckout(link.payment))) paidOrders.push(order.id);
      else unpaidOrders.push(order.id);
    }
  }
  // Their first washes were today, so today's wash list has paid vehicles and one not paid yet.
  const ids = [...paidOrders, ...unpaidOrders].map(q).join(', ');
  if (ids) runSql([`UPDATE place_orders SET first_wash_on = ${q(day(0))} WHERE id IN (${ids});`], 'places-first-wash');
  placesDemo.paid = paidOrders.length;
  placesDemo.unpaid = unpaidOrders.length;

  // The first paid car is already washed today, at the building: the washer noted its number
  // plate and took an after photo.
  const today = await call(RAVI, 'GET', `/places/${towers.id}/day/${day(0)}`);
  const first = today.rows.find((r) => r.paid && r.vehicle.category === 'car');
  if (first) {
    const visit = await call(RAVI, 'POST', `/places/${towers.id}/visits`, {
      orderId: first.orderId,
      date: day(0),
      outcome: 'done',
      plate: { registrationNumber: 'AP39CK4821', make: 'Honda', model: 'City' },
      at: { latitude: 14.44415, longitude: 79.98725 },
    });
    const form = new FormData();
    form.set('file', vehiclePhoto('vt_sedan', 'AP39CK4821', 'after'));
    await call(RAVI, 'POST', `/places/${towers.id}/visits/${visit.visitId}/photo`, form);
  }

  // Someone joined Sri Ram Nagar from the app, from home: the team confirms them first.
  // App codes per network address are capped hourly; moving each back keeps re-seeding possible.
  const appTicket = async (phone) => {
    await call(null, 'POST', '/c/auth/code', { phone });
    runSql([`UPDATE signup_codes SET created_at = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now', '-2 hours') WHERE phone = ${q(phone)};`], `code-${phone}`);
    return (await call(null, 'POST', '/c/auth/verify', { phone, code: DEV_CODE })).ticket;
  };
  const colonyMenu = await call(null, 'GET', `/c/places/${colony.id}`);
  const hatch = colonyMenu.menu.vehicleTypes.find((t) => t.name === 'Hatchback');
  const pending = await call(null, 'POST', '/c/join', {
    ticket: await appTicket('9440011005'),
    placeId: colony.id,
    name: 'Ramesh G',
    unit: { text: 'H.No 14-2' },
    location: { latitude: 14.4521, longitude: 79.9811 },
    via: 'app',
    vehicles: [{ vehicleTypeId: hatch.id, choice: plan('wp_mana_weekly') }],
  });
  placesDemo.pending = pending.memberStatus === 'pending' ? 1 : 0;

  // People asking where we don't wash yet: two near Green Park (waiting for approval), and five
  // neighbours in one Dargamitta lane, enough to start a community there.
  const asking = [
    ['9440011006', 14.4612, 79.9724, 'Vedayapalem, 3rd cross', 1, 0],
    ['9440011007', 14.4616, 79.9726, 'Vedayapalem, 3rd cross', 1, 1],
    ['9440011008', 14.4352, 79.9688, 'Dargamitta, Vivekananda Street', 1, 0],
    ['9440011009', 14.4354, 79.9690, 'Dargamitta, Vivekananda Street', 2, 0],
    ['9440011010', 14.4351, 79.9686, 'Dargamitta, Vivekananda Street', 1, 1],
    ['9440011011', 14.4356, 79.9689, 'Dargamitta, Vivekananda Street', 1, 0],
    ['9440011012', 14.4353, 79.9692, 'Dargamitta, Vivekananda Street', 1, 2],
  ];
  for (const [phone, latitude, longitude, address, cars, bikes] of asking) {
    await call(null, 'POST', '/c/service-requests', {
      ticket: await appTicket(phone),
      location: { latitude, longitude },
      address,
      cars,
      bikes,
    });
  }
  placesDemo.asking = asking.length;
}

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
  (SELECT COUNT(*) FROM cash_days WHERE shop_id = '${SHOP}') AS cash_days,
  (SELECT COUNT(*) FROM reward_claims WHERE shop_id = '${SHOP}') AS free_washes,
  (SELECT COUNT(*) FROM reward_gifts WHERE shop_id = '${SHOP}' AND status = 'given') AS gifts_given,
  (SELECT COUNT(*) FROM reward_gifts WHERE shop_id = '${SHOP}' AND status = 'owed') AS gifts_owed,
  (SELECT COUNT(*) FROM wash_problems WHERE shop_id = '${SHOP}' AND status = 'open') AS open_problems,
  (SELECT COUNT(*) FROM vehicle_requests WHERE shop_id = '${SHOP}' AND status = 'pending') AS pending_vehicles,
  (SELECT COUNT(*) FROM wash_ratings WHERE shop_id = '${SHOP}') AS ratings`);
console.log(`
Done. Mana Wash Nellore City, branch code NLR-01:
  ${counts.customers} customers · ${counts.vehicles} vehicles · ${counts.jobs} washes · ${counts.expenses} expenses
  ${counts.photos} wash photos · ${counts.coupons} coupons · ${counts.cash_days} cash drawer days
  Rewards: ${counts.free_washes} free wash${counts.free_washes === 1 ? '' : 'es'} used · ${counts.gifts_given} welcome gifts given · ${counts.gifts_owed} owed
  Feedback: ${counts.open_problems} open problem${counts.open_problems === 1 ? '' : 's'} · ${counts.pending_vehicles} vehicle${counts.pending_vehicles === 1 ? '' : 's'} to add · ${counts.ratings} rating${counts.ratings === 1 ? '' : 's'}
  Communities: ${placesDemo.towers.name} (code ${placesDemo.towers.code}, ${placesDemo.towers.units} flats) and ${placesDemo.colony.name} (code ${placesDemo.colony.code}) live
    Green Park Residency waiting for approval · Sai Krupa Apartments still a draft
    ${placesDemo.paid} plan${placesDemo.paid === 1 ? '' : 's'} paid · ${placesDemo.unpaid} not paid · ${placesDemo.pending} member waiting for the team · ${placesDemo.asking} people asking
  ${canDraw ? '' : '(photos are a sample picture — bills are only drawn on macOS)\n  '}
Sign in (PIN ${PIN} for everyone):
  Owner   Hrushikesh   ${OWNER.phone}   (also head office: HQ in More)
  Staff   Ravi Kumar   ${ravi.phone}
  Staff   Suresh Babu  ${suresh.phone}
  Staff   Kiran Teja   ${kiran.phone}`);
