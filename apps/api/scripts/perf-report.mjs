#!/usr/bin/env node
// API speed report: times every screen's requests from this machine against the target server,
// and splits each one into network time and server time using the `Server-Timing` header the
// Worker adds on staging and local dev (time on the server, time waiting on the database, how
// many database rounds one after another, and how many queries).
//
//   cd apps/api && npm run perf:report -- --staging     (needs the demo data: db:seed:staging)
//   cd apps/api && npm run perf:report                  (local wrangler dev + db:seed:demo)
//
// Writes perf-results/<target>-<timestamp>.json (every sample) and .md (the summary).
// It adds a few test washes, an expense and a stock use to the demo shop, then voids them.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { API, API_DIR, TARGET } from './lib/target.mjs';

const RUNS = Number(process.env.PERF_RUNS ?? 10);
const WARMUP = 2;
const PIN = '2580';
const OWNER_PHONE = process.env.PERF_OWNER ?? '9888626111';
const STAFF_PHONE = process.env.PERF_STAFF ?? '9300000011';
const PHOTO = readFileSync(join(API_DIR, '..', 'mobile', 'src', 'assets', 'vehicles', 'vehicle-sedan.jpg'));

const cid = (p) => `${p}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
const istDate = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

// ─── One timed request ────────────────────────────────────────────────────

function parseServerTiming(header) {
  const out = { app: null, db: null, rounds: null, queries: null };
  if (!header) return out;
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().split(';');
    const dur = params.find((p) => p.startsWith('dur='));
    const desc = params.find((p) => p.startsWith('desc='));
    if (name === 'app' && dur) out.app = Number(dur.slice(4));
    if (name === 'db' && dur) out.db = Number(dur.slice(4));
    if (name === 'db' && desc) {
      const m = desc.match(/(\d+) rounds \/ (\d+) queries/);
      if (m) [out.rounds, out.queries] = [Number(m[1]), Number(m[2])];
    }
  }
  return out;
}

async function timed(token, method, path, body) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const t0 = performance.now();
  const res = await fetch(API + path, { method, headers, body: payload });
  const t1 = performance.now();
  const buf = Buffer.from(await res.arrayBuffer());
  const t2 = performance.now();
  let json = null;
  if ((res.headers.get('content-type') ?? '').includes('json')) {
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      json = null;
    }
  }
  return {
    status: res.status,
    total: t2 - t0,
    ttfb: t1 - t0,
    bytes: buf.byteLength,
    encoding: res.headers.get('content-encoding'),
    colo: res.headers.get('cf-ray')?.split('-')[1] ?? null,
    ...parseServerTiming(res.headers.get('server-timing')),
    json,
  };
}

async function call(token, method, path, body) {
  const r = await timed(token, method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
}

// ─── Statistics ───────────────────────────────────────────────────────────

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
const median = (xs) => pct([...xs].sort((a, b) => a - b), 50);
const round = (n) => (n == null ? null : Math.round(n * 10) / 10);

function summarise(samples) {
  const ok = samples.filter((s) => s.status < 400);
  const totals = ok.map((s) => s.total).sort((a, b) => a - b);
  const num = (key) => ok.map((s) => s[key]).filter((v) => v != null);
  const app = num('app');
  const db = num('db');
  const appP50 = app.length ? median(app) : null;
  const totalP50 = pct(totals, 50);
  return {
    runs: samples.length,
    errors: samples.length - ok.length,
    statuses: [...new Set(samples.map((s) => s.status))],
    min: round(totals[0]),
    p50: round(totalP50),
    p90: round(pct(totals, 90)),
    max: round(totals.at(-1)),
    mean: round(totals.reduce((a, b) => a + b, 0) / (totals.length || 1)),
    ttfbP50: round(median(ok.map((s) => s.ttfb))),
    serverP50: round(appP50),
    dbP50: round(db.length ? median(db) : null),
    networkP50: round(appP50 != null && totalP50 != null ? totalP50 - appP50 : null),
    rounds: num('rounds').length ? Math.max(...num('rounds')) : null,
    queries: num('queries').length ? Math.max(...num('queries')) : null,
    bytes: ok.length ? ok[ok.length - 1].bytes : 0,
    encoding: ok[0]?.encoding ?? null,
    colo: ok[0]?.colo ?? null,
  };
}

// ─── Setup: sign in, find real ids from the demo data ─────────────────────

console.log(`API speed report → ${API} (${TARGET}), ${RUNS} runs per read after ${WARMUP} warm-ups`);

const health = await timed(null, 'GET', '/health');
if (health.status !== 200) throw new Error(`The API isn't answering at ${API}`);

const owner = (await call(null, 'POST', '/auth/pin/login', { phone: OWNER_PHONE, pin: PIN })).token;
const staff = (await call(null, 'POST', '/auth/pin/login', { phone: STAFF_PHONE, pin: PIN })).token;
const me = await call(owner, 'GET', '/auth/me');

const board = await call(owner, 'GET', '/jobs/today');
const sampleJob = board.find((j) => j.status === 'paid') ?? board[0];
if (!sampleJob) throw new Error('No jobs today — seed the demo data first (db:seed:demo / db:seed:staging)');
let photoId = null;
for (const j of board) {
  const detail = await call(owner, 'GET', `/jobs/${j.id}`);
  photoId = detail.photos?.[0]?.id ?? null;
  if (photoId) break;
}
const customerId = sampleJob.customer.id;
const plate = sampleJob.vehicle.registrationNumber;
const customerPhone = sampleJob.customer.phone;
const stock = await call(owner, 'GET', '/stock');
const stockItem = (stock.items ?? stock).find((i) => i.unit === 'pcs' && i.balance >= 10) ?? (stock.items ?? stock)[0];
const expenses = await call(owner, 'GET', '/expenses?range=month');
const expenseId = (expenses.expenses ?? expenses.items ?? expenses)[0]?.id ?? null;
const services = await call(owner, 'GET', '/services');
const vehicleTypes = await call(owner, 'GET', '/services/vehicle-types');
const carType = (vehicleTypes.vehicleTypes ?? vehicleTypes).find((v) => v.id === 'vt_sedan') ?? (vehicleTypes.vehicleTypes ?? vehicleTypes)[0];
const washService = (services.services ?? services).find((s) => s.id === 'svc_exterior_wash') ?? (services.services ?? services)[0];
const team = await call(owner, 'GET', '/team');
const staffMember = (team.members ?? team).find((m) => m.phone === STAFF_PHONE) ?? null;
const month = istDate().slice(0, 7);

// ─── Reads: every screen's GET requests ───────────────────────────────────

const READS = [
  ['Baseline', 'Health check (no auth, no database)', null, '/health'],
  ['App start', 'Who am I', 'owner', '/auth/me'],
  ['App start', 'Plan', 'owner', '/billing/plan'],
  ['App start', 'My shops', 'owner', '/auth/shops'],
  ['App start', 'Shop info', 'owner', '/shop/info'],
  ['App start', 'Shop settings', 'owner', '/shop/settings'],
  ['App start', 'Roster', 'owner', '/shop/roster'],
  ['App start', 'Unseen errors badge', 'owner', '/shop/errors/unseen'],
  ['App start', 'Rewards settings', 'owner', '/rewards/settings'],
  ['Job board', "Today's jobs", 'owner', '/jobs/today'],
  ['Job board', 'Job details', 'owner', `/jobs/${sampleJob.id}`],
  ['New Wash', 'Services', 'owner', '/services'],
  ['New Wash', 'Prices', 'owner', '/services/prices'],
  ['New Wash', 'Vehicle types', 'owner', '/services/vehicle-types'],
  ['New Wash', 'Commissions', 'owner', '/services/commissions'],
  ['New Wash', 'Customer lookup by phone', 'owner', `/customers/lookup?phone=${customerPhone}`],
  ['New Wash', 'Customer lookup by plate', 'owner', `/customers/lookup?registrationNumber=${plate}`],
  ['New Wash', "Car's stamp cards", 'owner', `/rewards/vehicle?registrationNumber=${plate}`],
  ['New Wash', 'Usable coupon', 'owner', `/coupons/usable?registrationNumber=${plate}&phone=${customerPhone}`],
  ['Customers', 'Offline directory (full download)', 'owner', '/customers/directory'],
  ['Customers', 'Customer profile', 'owner', `/customers/${customerId}`],
  ['Customers', 'Customer rewards', 'owner', `/rewards/customer/${customerId}`],
  ['Reminders', 'Reminders list', 'owner', '/reminders'],
  ['Reports', 'Report: today', 'owner', '/jobs/stats?range=today'],
  ['Reports', 'Report: 7 days', 'owner', '/jobs/stats?range=week'],
  ['Reports', 'Report: month', 'owner', '/jobs/stats?range=month'],
  ['Reports', 'Report: year', 'owner', '/jobs/stats?range=year'],
  ['Reports', 'Rewards report: month', 'owner', '/rewards/report?range=month'],
  ['Reports', 'Report export data: month', 'owner', '/jobs/stats/export?range=month'],
  ['Staff report', 'Staff report: month', 'owner', '/reports/staff?range=month'],
  ['Staff report', 'Audit trail: 7 days', 'owner', '/reports/audit?range=week'],
  ['Expenses', 'Expenses: month', 'owner', '/expenses?range=month'],
  ...(expenseId ? [['Expenses', 'Bill photo (R2)', 'owner', `/expenses/${expenseId}/photos/bill`]] : []),
  ['Cash drawer', 'Cash day', 'owner', `/cash/day?date=${istDate()}`],
  ['Cash drawer', 'Cash history: month', 'owner', '/cash/history?range=month'],
  ['Attendance', 'Attendance day', 'owner', `/attendance?date=${istDate()}`],
  ['Attendance', 'Attendance month', 'owner', `/attendance/month?month=${month}`],
  ['Inventory', 'Stock list', 'owner', '/stock'],
  ['Inventory', 'Stock item moves', 'owner', `/stock/${stockItem.id}/moves`],
  ['Rewards', 'Gifts owed', 'owner', '/rewards/gifts/owed'],
  ['Team', 'Team', 'owner', '/team'],
  ['Team', 'Join requests', 'owner', '/team/requests'],
  ['More', 'Plan & billing', 'owner', '/billing'],
  ['More', 'Error log', 'owner', '/shop/errors'],
  ...(photoId ? [['Job board', 'Wash photo (R2)', 'owner', `/photos/${photoId}`]] : []),
  ['Staff', 'My earnings: month (staff)', 'staff', '/shop/me/earnings?range=month'],
  ['Staff', "Today's jobs (staff)", 'staff', '/jobs/today'],
];

const tokenFor = (who) => (who === 'owner' ? owner : who === 'staff' ? staff : null);
const results = [];

for (const [screen, label, who, path] of READS) {
  for (let i = 0; i < WARMUP; i++) await timed(tokenFor(who), 'GET', path);
  const samples = [];
  for (let i = 0; i < RUNS; i++) samples.push(await timed(tokenFor(who), 'GET', path));
  const s = summarise(samples);
  results.push({ kind: 'read', screen, label, method: 'GET', path: path.split('?')[0], query: path.split('?')[1] ?? '', who, ...s, samples: samples.map(({ json, ...rest }) => rest) });
  console.log(`${String(s.p50).padStart(7)} ms p50 · ${String(s.serverP50 ?? '-').padStart(5)} server · ${s.rounds ?? '-'} rounds · ${s.queries ?? '-'} q · ${(s.bytes / 1024).toFixed(1)} KB  ${screen} → ${label}`);
}

// ─── Writes: a real day's actions ─────────────────────────────────────────

const writeSamples = new Map();
function recordWrite(screen, label, method, path, r) {
  const key = `${screen}|${label}`;
  if (!writeSamples.has(key)) writeSamples.set(key, { screen, label, method, path, samples: [] });
  const { json, ...rest } = r;
  writeSamples.get(key).samples.push(rest);
  if (r.status >= 400) console.log(`  ! ${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`);
  return r;
}

const WRITE_RUNS = Math.max(3, Math.ceil(RUNS / 2));
console.log(`\nWrites: ${WRITE_RUNS} wash lifecycles and other actions`);
for (let i = 0; i < WRITE_RUNS; i++) {
  const jobId = cid('job');
  const phone = `97${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
  const reg = `TS09PF${String(1000 + Math.floor(Math.random() * 8999))}`;
  recordWrite('New Wash', 'Start wash (new customer)', 'POST', '/jobs/start',
    await timed(staff, 'POST', '/jobs/start', {
      id: jobId,
      customer: { phone, name: 'Speed Test' },
      registrationNumber: reg,
      vehicleTypeId: carType.id,
      services: [{ serviceId: washService.id, quantity: 1 }],
      discount: 0,
    }));
  recordWrite('Job board', 'Start washing', 'PATCH', '/jobs/:id/status',
    await timed(staff, 'PATCH', `/jobs/${jobId}/status`, { status: 'washing', washerIds: staffMember ? [staffMember.id] : [] }));
  recordWrite('Job board', 'Mark ready', 'PATCH', '/jobs/:id/status', await timed(staff, 'PATCH', `/jobs/${jobId}/status`, { status: 'ready' }));
  const form = new FormData();
  form.set('id', cid('pho'));
  form.set('jobId', jobId);
  form.set('kind', 'after');
  form.set('file', new File([PHOTO], 'after.jpg', { type: 'image/jpeg' }));
  recordWrite('Job board', `Upload photo (${Math.round(PHOTO.length / 1024)} KB)`, 'POST', '/photos', await timed(staff, 'POST', '/photos', form));
  recordWrite('Job board', 'Collect payment', 'POST', '/jobs/:id/pay', await timed(staff, 'POST', `/jobs/${jobId}/pay`, { paymentMethod: 'cash' }));
  recordWrite('Job details', 'Void a paid wash (owner)', 'POST', '/jobs/:id/void',
    await timed(owner, 'POST', `/jobs/${jobId}/void`, { reason: 'Speed test wash, not real' }));
  recordWrite('Inventory', 'Use stock', 'POST', '/stock/moves',
    await timed(staff, 'POST', '/stock/moves', { id: cid('mov'), itemId: stockItem.id, kind: 'use', quantity: 1, unit: stockItem.unit }));
  recordWrite('Sign in', 'PIN sign-in', 'POST', '/auth/pin/login', await timed(null, 'POST', '/auth/pin/login', { phone: STAFF_PHONE, pin: PIN }));
  recordWrite('New Wash', 'Referral quote', 'POST', '/referrals/quote',
    await timed(staff, 'POST', '/referrals/quote', {
      referrerPhone: customerPhone,
      phone: `96${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`,
      registrationNumber: `TS10PF${String(1000 + Math.floor(Math.random() * 8999))}`,
    }));
  if (staffMember) {
    recordWrite('Attendance', 'Mark attendance', 'PUT', '/attendance',
      await timed(owner, 'PUT', '/attendance', { userId: staffMember.id, date: istDate(), status: 'present' }));
  }
}
{
  const expense = new FormData();
  const id = cid('exp');
  expense.set('data', JSON.stringify({ id, category: 'other', amount: 1000, itemName: 'Speed test', paymentMethod: 'cash' }));
  expense.set('billPhoto', new File([PHOTO], 'bill.jpg', { type: 'image/jpeg' }));
  expense.set('itemPhoto', new File([PHOTO], 'item.jpg', { type: 'image/jpeg' }));
  recordWrite('Expenses', 'Add expense with 2 photos', 'POST', '/expenses', await timed(staff, 'POST', '/expenses', expense));
  recordWrite('Expenses', 'Void expense (owner)', 'POST', '/expenses/:id/void',
    await timed(owner, 'POST', `/expenses/${id}/void`, { reason: 'Speed test entry' }));
}
for (const w of writeSamples.values()) {
  const s = summarise(w.samples);
  results.push({ kind: 'write', screen: w.screen, label: w.label, method: w.method, path: w.path, query: '', who: '', ...s, samples: w.samples });
  console.log(`${String(s.p50).padStart(7)} ms p50 · ${String(s.serverP50 ?? '-').padStart(5)} server · ${s.rounds ?? '-'} rounds · ${s.queries ?? '-'} q  ${w.screen} → ${w.label}${s.errors ? ` (${s.errors} errors)` : ''}`);
}

// ─── Screens: what the app loads together, in parallel ────────────────────

const SCREENS = [
  ['App start (signed in)', ['/auth/me', '/billing/plan', '/auth/shops', '/shop/info', '/shop/settings', '/shop/roster', '/stock', '/rewards/settings', '/jobs/today', '/shop/errors/unseen']],
  ['Job board', ['/jobs/today']],
  ['New Wash opened', ['/services', '/services/prices', '/services/vehicle-types', '/services/commissions']],
  ['New Wash: plate typed', [`/customers/lookup?registrationNumber=${plate}`, `/rewards/vehicle?registrationNumber=${plate}`, `/coupons/usable?registrationNumber=${plate}&phone=${customerPhone}`]],
  ['Customer profile', [`/customers/${customerId}`, `/rewards/customer/${customerId}`]],
  ['Reports (month)', ['/jobs/stats?range=month', '/rewards/report?range=month']],
  ['Reminders', ['/reminders']],
  ['Inventory', ['/stock']],
  ['Rewards', ['/rewards/settings', '/rewards/gifts/owed', '/services']],
];
const screens = [];
console.log('\nScreens (requests in parallel, like the app):');
for (const [name, paths] of SCREENS) {
  await Promise.all(paths.map((p) => timed(owner, 'GET', p)));
  const walls = [];
  let slowest = null;
  for (let i = 0; i < Math.max(3, Math.ceil(RUNS / 2)); i++) {
    const t0 = performance.now();
    const rs = await Promise.all(paths.map(async (p) => ({ p, r: await timed(owner, 'GET', p) })));
    walls.push(performance.now() - t0);
    const worst = rs.reduce((a, b) => (b.r.total > a.r.total ? b : a));
    slowest = worst.p.split('?')[0];
  }
  const sorted = walls.sort((a, b) => a - b);
  screens.push({ name, requests: paths.length, p50: round(pct(sorted, 50)), max: round(sorted.at(-1)), slowest });
  console.log(`${String(round(pct(sorted, 50))).padStart(7)} ms p50  ${name} (${paths.length} requests, slowest ${slowest})`);
}

// ─── Write the report ─────────────────────────────────────────────────────

const outDir = join(API_DIR, 'perf-results');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const base = join(outDir, `${TARGET}-${stamp}`);
const meta = {
  target: TARGET,
  api: API,
  at: new Date().toISOString(),
  runs: RUNS,
  warmup: WARMUP,
  colo: health.colo,
  healthP50: results[0].p50,
  shop: me.shop?.name ?? me.user?.shopId ?? null,
  node: process.version,
};
writeFileSync(`${base}.json`, JSON.stringify({ meta, results, screens }, null, 1));

const reads = results.filter((r) => r.kind === 'read');
const writes = results.filter((r) => r.kind === 'write');
const row = (r) =>
  `| ${r.screen} | ${r.label} | \`${r.method} ${r.path}\` | ${r.p50} | ${r.p90} | ${r.serverP50 ?? '–'} | ${r.dbP50 ?? '–'} | ${r.networkP50 ?? '–'} | ${r.rounds ?? '–'} | ${r.queries ?? '–'} | ${(r.bytes / 1024).toFixed(1)} |${r.errors ? ` ${r.errors} errors (${r.statuses.join(', ')}) |` : ''}`;
const head =
  '| Screen | Request | Endpoint | p50 ms | p90 ms | Server ms | DB ms | Network ms | DB rounds | Queries | KB |\n|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|';
const md = [
  `# API speed report: ${TARGET}`,
  '',
  `${meta.at} · ${API} · Cloudflare edge ${meta.colo ?? '?'} · ${RUNS} runs per read after ${WARMUP} warm-ups · from this Mac`,
  '',
  `Baseline (health check, no database): **${meta.healthP50} ms** p50. That is roughly the network round trip; anything above it is server work.`,
  '',
  '## Screens (requests in parallel, like the app)',
  '',
  '| Screen | Requests | p50 ms | Max ms | Slowest request |\n|---|---:|---:|---:|---|',
  ...screens.map((s) => `| ${s.name} | ${s.requests} | ${s.p50} | ${s.max} | \`${s.slowest}\` |`),
  '',
  '## Reads, slowest first',
  '',
  head,
  ...[...reads].sort((a, b) => b.p50 - a.p50).map(row),
  '',
  '## Writes',
  '',
  head,
  ...[...writes].sort((a, b) => b.p50 - a.p50).map(row),
  '',
].join('\n');
writeFileSync(`${base}.md`, md);
console.log(`\nSaved ${base}.json and .md`);
