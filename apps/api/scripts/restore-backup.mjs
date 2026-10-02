#!/usr/bin/env node
/**
 * Restores one nightly backup (see src/scheduled.ts) into an EMPTY database.
 *
 *   npm run backup:restore -- --list                          backups in the production bucket
 *   npm run backup:restore -- --date 2026-10-01 --into local  restore into the local database
 *   npm run backup:restore -- --date 2026-10-01 --into staging
 *   npm run backup:restore -- --date 2026-10-01 --into remote --yes
 *
 * Options:
 *   --from production|staging|local   which BACKUPS bucket to read (default production)
 *   --into local|staging|remote       which database to fill (required with --date)
 *
 * The target must already have every migration applied and hold no rows (for local:
 * `npm run db:reset:local -- --no-seed`; for a real database: create a fresh one, point
 * wrangler.toml at it, and run the migrations). The script refuses to touch a database that
 * has data — restoring is never a merge.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);

const SOURCES = {
  production: { bucket: 'mana-backups', flags: ['--remote'] },
  staging: { bucket: 'mana-backups-staging', flags: ['--remote'] },
  local: { bucket: 'mana-backups', flags: ['--local'] },
};
const TARGETS = {
  local: { db: 'mana_db', flags: ['--local'] },
  staging: { db: 'mana_db_staging', flags: ['--remote', '--env', 'staging'] },
  remote: { db: 'mana_db', flags: ['--remote'] },
};
/** Rows per INSERT statement and statements per file — well inside D1's statement limits. */
const ROWS_PER_INSERT = 50;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function die(message) {
  console.error(message);
  process.exit(1);
}

const wrangler = (...a) =>
  execFileSync('npx', ['wrangler', ...a], {
    cwd: API_DIR,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });

const source = SOURCES[opt('from') ?? 'production'] ?? die('--from must be production, staging or local');

function getObject(key) {
  return wrangler('r2', 'object', 'get', `${source.bucket}/${key}`, '--pipe', ...source.flags);
}

function query(target, sql) {
  const out = wrangler('d1', 'execute', target.db, ...target.flags, '--json', '--command', sql);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

function sqlValue(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Array.isArray(v)) return `X'${Buffer.from(v).toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

const ident = (name) => `"${name.replace(/"/g, '""')}"`;

/** Parents before children, read from the REFERENCES clauses in the backed-up schema. */
function insertOrder(manifest) {
  const tables = Object.keys(manifest.tables);
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const s of manifest.schema) {
    if (s.type !== 'table' || !deps.has(s.name) || !s.sql) continue;
    for (const m of s.sql.matchAll(/REFERENCES\s+"?(\w+)"?/gi)) {
      if (m[1] !== s.name && deps.has(m[1])) deps.get(s.name).add(m[1]);
    }
  }
  const order = [];
  const seen = new Set();
  const visit = (t, path = new Set()) => {
    if (seen.has(t) || path.has(t)) return;
    path.add(t);
    for (const d of deps.get(t)) visit(d, path);
    seen.add(t);
    order.push(t);
  };
  tables.forEach((t) => visit(t));
  return order;
}

if (flag('list')) {
  const out = wrangler('r2', 'object', 'list', source.bucket, '--prefix', 'backups/', ...source.flags);
  const days = [...new Set([...out.matchAll(/backups\/(\d{4}-\d{2}-\d{2})\/manifest\.json/g)].map((m) => m[1]))];
  console.log(days.length ? days.sort().join('\n') : 'No complete backups found.');
  process.exit(0);
}

const date = opt('date') ?? die('Pass --date YYYY-MM-DD (or --list to see what exists).');
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die('--date must look like 2026-10-01');
const target = TARGETS[opt('into') ?? ''] ?? die('Pass --into local, staging or remote.');
if (opt('into') === 'remote' && !flag('yes')) {
  die('Restoring into the production database needs --yes. Read the README “Restore a backup” section first.');
}

console.log(`Reading backups/${date}/manifest.json from ${source.bucket}…`);
const manifest = JSON.parse(getObject(`backups/${date}/manifest.json`));
if (manifest.format !== 2) die(`Unsupported backup format: ${manifest.format}`);

const order = insertOrder(manifest);
for (const table of order) {
  const [{ n }] = query(target, `SELECT COUNT(*) AS n FROM ${ident(table)}`);
  if (n > 0) die(`${table} already has ${n} rows. Restore only into an empty database.`);
}

const dir = mkdtempSync(join(tmpdir(), 'mana-restore-'));
const files = [];
let buffer = ['PRAGMA defer_foreign_keys = on;'];
let size = 0;
const flush = () => {
  if (buffer.length <= 1) return;
  const file = join(dir, `part-${String(files.length + 1).padStart(4, '0')}.sql`);
  writeFileSync(file, buffer.join('\n'));
  files.push(file);
  buffer = ['PRAGMA defer_foreign_keys = on;'];
  size = 0;
};

let total = 0;
try {
  for (const table of order) {
    const { pages, rows } = manifest.tables[table];
    if (rows === 0) continue;
    process.stdout.write(`  ${table}: ${rows} rows… `);
    for (const key of pages) {
      const pageRows = JSON.parse(getObject(key));
      for (let i = 0; i < pageRows.length; i += ROWS_PER_INSERT) {
        const slice = pageRows.slice(i, i + ROWS_PER_INSERT);
        const cols = Object.keys(slice[0]);
        const values = slice.map((r) => `(${cols.map((c) => sqlValue(r[c])).join(', ')})`).join(',\n');
        const stmt = `INSERT INTO ${ident(table)} (${cols.map(ident).join(', ')}) VALUES\n${values};`;
        if (size + stmt.length > MAX_FILE_BYTES) flush();
        buffer.push(stmt);
        size += stmt.length;
      }
    }
    total += rows;
    console.log('ok');
  }
  flush();

  console.log(`Writing ${total} rows in ${files.length} batch(es)…`);
  for (const file of files) wrangler('d1', 'execute', target.db, ...target.flags, `--file=${file}`);

  for (const table of order) {
    const [{ n }] = query(target, `SELECT COUNT(*) AS n FROM ${ident(table)}`);
    if (n !== manifest.tables[table].rows) {
      die(`${table}: expected ${manifest.tables[table].rows} rows, found ${n}. Check the output above.`);
    }
  }
  console.log(`Restored backup ${date} (taken ${manifest.takenAt}). Row counts match.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
