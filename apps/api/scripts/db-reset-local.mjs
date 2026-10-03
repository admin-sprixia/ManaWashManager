#!/usr/bin/env node
/**
 * Wipes the LOCAL database (or, with --staging, the STAGING database) and rebuilds it exactly the
 * way production is built: every migration in ./migrations, then the starter data in seed.sql.
 *
 *   npm run db:reset:local            (add --no-seed for empty tables)
 *   npm run db:reset:staging          (staging only: everything in mana_db_staging is deleted)
 *
 * There is deliberately no production version of this script. The live database only ever moves
 * forward through `npm run db:migrate:remote`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_DIR, DB_FLAGS, DB_NAME, TARGET, d1Execute, d1Rows } from './lib/target.mjs';

const seed = !process.argv.includes('--no-seed');

const wrangler = (...args) =>
  execFileSync('npx', ['wrangler', ...args], {
    cwd: API_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });

const tables = d1Rows(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
).map((r) => r.name);
if (tables.length > 0) {
  // Foreign-key checks are deferred to the end of the batch, so drop order doesn't matter.
  const dir = mkdtempSync(join(tmpdir(), 'mana-reset-'));
  const file = join(dir, 'drop.sql');
  writeFileSync(
    file,
    ['PRAGMA defer_foreign_keys = on;', ...tables.map((t) => `DROP TABLE IF EXISTS "${t}";`)].join('\n'),
  );
  d1Execute([`--file=${file}`]);
  rmSync(dir, { recursive: true, force: true });
  console.log(`Dropped ${tables.length} tables (${TARGET}).`);
}

wrangler('d1', 'migrations', 'apply', DB_NAME, ...DB_FLAGS);
console.log('Applied migrations.');

if (seed) {
  d1Execute(['--file=./seed.sql']);
  console.log('Loaded seed.sql.');
}
