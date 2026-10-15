#!/usr/bin/env node
/**
 * Sprixia support: clears a PIN when nobody above the person can — Mana Wash HQ themselves.
 * Only after a phone call confirming it's really them (call back on the number on file).
 *
 *   npm run support:reset-pin -- --phone 9876543210 --into local
 *   npm run support:reset-pin -- --phone 9876543210 --into remote --yes
 *
 * Options:
 *   --into local|staging|remote   which database (required)
 *   --by "Name"                   who did it, shown to the person (default "Sprixia support")
 *
 * Same as a reset from the app (apps/api/src/lib/pinReset.ts): clears the PIN on every branch,
 * signs out every phone, stops trusting them all, and records who did it. Nobody is signed in:
 * the person confirms their number with a WhatsApp code and picks a new PIN, and the app tells
 * them who reset it.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name) => args.includes(`--${name}`);

const TARGETS = {
  local: { db: 'mana_db', flags: ['--local'] },
  staging: { db: 'mana_db_staging', flags: ['--remote', '--env', 'staging'] },
  remote: { db: 'mana_db', flags: ['--remote'] },
};

function die(message) {
  console.error(message);
  process.exit(1);
}

const phone = (opt('phone') ?? '').replace(/\D/g, '').slice(-10);
if (!/^[6-9]\d{9}$/.test(phone)) die('Give the 10-digit mobile number: --phone 9876543210');
const target = TARGETS[opt('into') ?? ''];
if (!target) die('Say which database: --into local|staging|remote');
if (opt('into') === 'remote' && !flag('yes')) die('This changes production. Add --yes once you have confirmed it is them.');
const by = (opt('by') ?? 'Sprixia support').trim();
if (by.length < 1 || by.length > 100) die('--by must be 1–100 characters.');

const sql = (s) => `'${String(s).replaceAll("'", "''")}'`;

function d1(command) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', target.db, ...target.flags, '--json', '--command', command], {
    cwd: API_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  return JSON.parse(out)[0]?.results ?? [];
}

const rows = d1(
  `SELECT u.name, u.role, s.name AS branch FROM users u JOIN shops s ON s.id = u.shop_id
    WHERE u.phone = ${sql(phone)} AND u.removed_at IS NULL ORDER BY u.created_at`,
);
if (rows.length === 0) die(`No one on any team has the number ${phone}.`);

d1(
  [
    `UPDATE users SET pin_hash = NULL, pin_digits = NULL, pin_failed_attempts = 0, pin_locked_until = NULL,
       session_version = session_version + 1 WHERE phone = ${sql(phone)} AND removed_at IS NULL`,
    `DELETE FROM trusted_devices WHERE phone = ${sql(phone)}`,
    `INSERT INTO pin_resets (id, phone, shop_id, by_phone, by_label) VALUES (${sql(randomUUID())}, ${sql(phone)}, NULL, NULL, ${sql(by)})`,
  ].join(';\n'),
);

console.log(`PIN cleared for ${rows[0].name} (${phone}) at:`);
for (const r of rows) console.log(`  • ${r.branch} — ${r.role}`);
console.log('They now sign in with a WhatsApp code and choose a new PIN.');
