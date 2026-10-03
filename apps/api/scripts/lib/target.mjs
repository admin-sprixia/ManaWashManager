// Which server and database the dev scripts talk to.
//
//   (default)                  local `wrangler dev` on :8787 and the local mana_db
//   --staging / MANA_TARGET=staging   the staging Worker and the remote mana_db_staging
//
// Production is deliberately not a target: no script here can write to the live database.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const STAGING = process.argv.includes('--staging') || process.env.MANA_TARGET === 'staging';
export const TARGET = STAGING ? 'staging' : 'local';
export const STAGING_API = 'https://api-staging.manawashmanager.com';
export const API = process.env.API_URL ?? (STAGING ? STAGING_API : 'http://localhost:8787');
export const DB_NAME = STAGING ? 'mana_db_staging' : 'mana_db';
/** `wrangler d1 …` arguments that pick the database, after the sub-command. */
export const DB_FLAGS = STAGING ? ['--remote', '--env', 'staging'] : ['--local'];
export const API_DIR = fileURLToPath(new URL('../..', import.meta.url));

/** Runs `wrangler d1 execute` against the target database; returns stdout. */
export function d1Execute(args) {
  return execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, ...DB_FLAGS, ...args], {
    cwd: API_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
}

/** Rows of a read-only query against the target database. */
export function d1Rows(sql) {
  const out = d1Execute(['--json', '--command', sql]);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

/** Runs SQL statements (no result needed) against the target database. */
export function d1Run(sql) {
  d1Execute(['--command', sql]);
}
