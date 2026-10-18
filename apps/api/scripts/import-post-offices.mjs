#!/usr/bin/env node
/**
 * Loads India Post's office list into post_offices: every pincode with its offices, district,
 * state and points, so HQ can open a branch from its pincode and a pin on the map.
 *
 *   npm run data:post-offices -- --into local
 *   npm run data:post-offices -- --into staging
 *   npm run data:post-offices -- --into remote --yes     (production, once; again after a refresh)
 *
 * Source: India Post's All India Pincode Directory on data.gov.in (Open Government Data License –
 * India), as packaged by the `india-pincode` npm package (a dev dependency, never shipped).
 *
 * Rows are cleaned before they go in: office names trimmed, kinds limited to HO / PO / BO,
 * "NA" districts and states filled from the pincode's other offices (or the row dropped), points
 * outside India or at 0,0 cleared, duplicates removed. Each batch replaces whole pincodes in one
 * transaction, so lookups keep working during an import and running it again is safe.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const TARGETS = {
  local: { db: 'mana_db', flags: ['--local'] },
  staging: { db: 'mana_db_staging', flags: ['--remote', '--env', 'staging'] },
  remote: { db: 'mana_db', flags: ['--remote'] },
};
const target = TARGETS[opt('into') ?? ''];
if (!target) {
  console.error('Say which database: --into local|staging|remote');
  process.exit(1);
}
if (opt('into') === 'remote' && !args.includes('--yes')) {
  console.error('This writes to production. Add --yes.');
  process.exit(1);
}

// ─── Read and clean ─────────────────────────────────────────────────────────

const require = createRequire(join(API_DIR, 'package.json'));
const dataFile = join(dirname(require.resolve('india-pincode')), '..', 'data', 'pincodes.json.gz');
const raw = JSON.parse(gunzipSync(readFileSync(dataFile)).toString('utf8'));
if (!Array.isArray(raw) || raw.length < 100_000) throw new Error(`Unexpected data in ${dataFile}`);

const PINCODE = /^[1-9]\d{5}$/;
const KINDS = new Set(['HO', 'PO', 'BO']);
const missing = (v) => typeof v !== 'string' || !v.trim() || /^n\/?a$/i.test(v.trim());
const text = (v) => String(v).replace(/\s+/g, ' ').trim();
const inIndia = (lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' && lat >= 6 && lat <= 37.6 && lng >= 68 && lng <= 97.5;

/** The most common value of a field among a pincode's offices. */
const majority = new Map();
for (const r of raw) {
  if (!PINCODE.test(String(r.p))) continue;
  const m = majority.get(r.p) ?? { district: new Map(), state: new Map() };
  if (!missing(r.i)) m.district.set(text(r.i), (m.district.get(text(r.i)) ?? 0) + 1);
  if (!missing(r.s)) m.state.set(text(r.s), (m.state.get(text(r.s)) ?? 0) + 1);
  majority.set(r.p, m);
}
const top = (counts) => [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

const stats = { read: raw.length, badPincode: 0, badName: 0, filledPlace: 0, droppedPlace: 0, clearedPoint: 0, duplicate: 0 };
const seen = new Set();
const rows = [];
for (const r of raw) {
  const pincode = String(r.p);
  if (!PINCODE.test(pincode)) {
    stats.badPincode++;
    continue;
  }
  const name = typeof r.o === 'string' ? text(r.o).slice(0, 120) : '';
  if (!name) {
    stats.badName++;
    continue;
  }
  const kind = KINDS.has(r.t) ? r.t : 'BO';
  let district = missing(r.i) ? null : text(r.i);
  let state = missing(r.s) ? null : text(r.s);
  if (!district || !state) {
    district ??= top(majority.get(pincode).district);
    state ??= top(majority.get(pincode).state);
    if (!district || !state) {
      stats.droppedPlace++;
      continue;
    }
    stats.filledPlace++;
  }
  const located = inIndia(r.a, r.n) && !(r.a === 0 && r.n === 0);
  if (!located && (r.a || r.n)) stats.clearedPoint++;
  const key = `${pincode}|${name.toLowerCase()}|${kind}|${district.toLowerCase()}`;
  if (seen.has(key)) {
    stats.duplicate++;
    continue;
  }
  seen.add(key);
  rows.push({ pincode, name, kind, district, state, latitude: located ? r.a : null, longitude: located ? r.n : null });
}

// ─── Write ──────────────────────────────────────────────────────────────────

const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : `'${String(v).replaceAll("'", "''")}'`);
const byPincode = new Map();
for (const r of rows) byPincode.set(r.pincode, [...(byPincode.get(r.pincode) ?? []), r]);
const pincodes = [...byPincode.keys()].sort();

const ROWS_PER_FILE = 6000;
const ROWS_PER_INSERT = 150;
const dir = mkdtempSync(join(tmpdir(), 'mana-post-offices-'));
const files = [];
let batch = [];
let batchRows = 0;
const flush = () => {
  if (!batch.length) return;
  const list = batch.flatMap((p) => byPincode.get(p));
  const sql = [`DELETE FROM post_offices WHERE pincode IN (${batch.map(q).join(', ')});`];
  for (let i = 0; i < list.length; i += ROWS_PER_INSERT) {
    const values = list
      .slice(i, i + ROWS_PER_INSERT)
      .map((r) => `(${[r.pincode, r.name, r.kind, r.district, r.state, r.latitude, r.longitude].map(q).join(', ')})`);
    sql.push(`INSERT INTO post_offices (pincode, name, kind, district, state, latitude, longitude) VALUES ${values.join(', ')};`);
  }
  const file = join(dir, `batch-${String(files.length).padStart(3, '0')}.sql`);
  writeFileSync(file, sql.join('\n'));
  files.push(file);
  batch = [];
  batchRows = 0;
};
for (const p of pincodes) {
  batch.push(p);
  batchRows += byPincode.get(p).length;
  if (batchRows >= ROWS_PER_FILE) flush();
}
flush();

console.log(
  `${rows.length} offices in ${pincodes.length} pincodes (read ${stats.read}; dropped ${stats.badPincode} bad pincodes, ` +
    `${stats.badName} without a name, ${stats.droppedPlace} without a district or state, ${stats.duplicate} duplicates; ` +
    `filled ${stats.filledPlace} districts/states, cleared ${stats.clearedPoint} points outside India).`,
);
console.log(`Writing ${files.length} batches to ${opt('into')}…`);
try {
  for (const [i, file] of files.entries()) {
    execFileSync('npx', ['wrangler', 'd1', 'execute', target.db, ...target.flags, `--file=${file}`], {
      cwd: API_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
      maxBuffer: 64 * 1024 * 1024,
    });
    if ((i + 1) % 5 === 0 || i === files.length - 1) console.log(`  ${i + 1}/${files.length}`);
  }
  // Pincodes India Post no longer lists.
  const keep = new Set(pincodes);
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', target.db, ...target.flags, '--json', '--command', 'SELECT DISTINCT pincode FROM post_offices'], {
    cwd: API_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const gone = JSON.parse(out.slice(out.indexOf('[')))[0].results.map((r) => r.pincode).filter((p) => !keep.has(p));
  if (gone.length) {
    writeFileSync(join(dir, 'gone.sql'), `DELETE FROM post_offices WHERE pincode IN (${gone.map(q).join(', ')});`);
    execFileSync('npx', ['wrangler', 'd1', 'execute', target.db, ...target.flags, `--file=${join(dir, 'gone.sql')}`], {
      cwd: API_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    });
    console.log(`Removed ${gone.length} pincodes no longer listed.`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log('Done.');
