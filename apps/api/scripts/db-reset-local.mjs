#!/usr/bin/env node
/**
 * Wipes the LOCAL database and rebuilds it exactly the way production is built: every migration
 * in ./migrations, then the starter data in seed.sql.
 *
 *   npm run db:reset:local            (add --no-seed for empty tables)
 *
 * There is deliberately no remote version of this script. The live database only ever moves
 * forward through `npm run db:migrate:remote`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const DB = 'mana_db';
const seed = !process.argv.includes('--no-seed');

const wrangler = (...args) =>
  execFileSync('npx', ['wrangler', ...args], {
    cwd: API_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });

function localTables() {
  const out = wrangler(
    'd1', 'execute', DB, '--local', '--json',
    '--command', "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  );
  const json = JSON.parse(out.slice(out.indexOf('[')));
  return json[0].results.map((r) => r.name);
}

const tables = localTables();
if (tables.length > 0) {
  // Foreign-key checks are deferred to the end of the batch, so drop order doesn't matter.
  const dir = mkdtempSync(join(tmpdir(), 'mana-reset-'));
  const file = join(dir, 'drop.sql');
  writeFileSync(
    file,
    ['PRAGMA defer_foreign_keys = on;', ...tables.map((t) => `DROP TABLE IF EXISTS "${t}";`)].join('\n'),
  );
  wrangler('d1', 'execute', DB, '--local', `--file=${file}`);
  rmSync(dir, { recursive: true, force: true });
  console.log(`Dropped ${tables.length} tables.`);
}

wrangler('d1', 'migrations', 'apply', DB, '--local');
console.log('Applied migrations.');

if (seed) {
  wrangler('d1', 'execute', DB, '--local', '--file=./seed.sql');
  console.log('Loaded seed.sql.');
}
