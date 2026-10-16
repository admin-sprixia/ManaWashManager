#!/usr/bin/env node
/**
 * Sprixia, once: sets up the business on an empty database — the business, its first branch, and
 * the person who owns it and runs it as HQ. Everything after that happens in the app: HQ sets the
 * services and prices, adds the team, and opens more branches.
 *
 *   npm run setup:business -- --name "Sreenivasulu" --phone 9876543210 --town Kovur --town-code KVR --into local
 *   npm run setup:business -- --name "Sreenivasulu" --phone 9876543210 --town Kovur --town-code KVR --into remote --yes
 *
 * Options:
 *   --name        the owner's name, as the app shows it (required)
 *   --phone       the owner's 10-digit mobile number (required)
 *   --town        the first branch's town, which is also its name (required)
 *   --town-code   the town's 3 letters; the branch becomes <CODE>-01, e.g. KVR-01 (required)
 *   --business    the business name (default "Mana Wash")
 *   --into        local | staging | remote (required); remote also needs --yes
 *
 * Refuses if a business already exists (more branches are opened from the app by HQ) or the number
 * is already on a team. Nobody is signed in: the owner signs in with their number and a WhatsApp
 * code, then chooses a 6-digit PIN.
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

const name = (opt('name') ?? '').trim();
if (name.length < 1 || name.length > 60) die('Give the owner’s name: --name "Sreenivasulu"');
const phone = (opt('phone') ?? '').replace(/\D/g, '').slice(-10);
if (!/^[6-9]\d{9}$/.test(phone)) die('Give the owner’s 10-digit mobile number: --phone 9876543210');
const town = (opt('town') ?? '').trim();
if (town.length < 2 || town.length > 40) die('Give the first branch’s town: --town Kovur');
const townCode = (opt('town-code') ?? '').trim().toUpperCase();
if (!/^[A-Z]{3}$/.test(townCode)) die('Give the town’s 3-letter code: --town-code KVR');
const business = (opt('business') ?? 'Mana Wash').trim();
if (business.length < 1 || business.length > 80) die('--business must be 1–80 characters.');
const target = TARGETS[opt('into') ?? ''];
if (!target) die('Say which database: --into local|staging|remote');
if (opt('into') === 'remote' && !flag('yes')) die('This changes production. Add --yes once the details are checked.');

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

const existing = d1('SELECT name FROM businesses LIMIT 1');
if (existing.length > 0) {
  die(`"${existing[0].name}" is already set up here. HQ opens more branches from the app (More → Mana Wash HQ → All branches).`);
}
if (d1(`SELECT id FROM users WHERE phone = ${sql(phone)} AND removed_at IS NULL LIMIT 1`).length > 0) {
  die(`The number ${phone} is already on a team.`);
}

const businessId = 'biz_mana';
const shopId = randomUUID();
const code = `${townCode}-01`;
d1(
  [
    `INSERT INTO businesses (id, name) VALUES (${sql(businessId)}, ${sql(business)})`,
    `INSERT INTO shops (id, code, name, city, business_id) VALUES (${sql(shopId)}, ${sql(code)}, ${sql(town)}, ${sql(town)}, ${sql(businessId)})`,
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES (${sql(randomUUID())}, ${sql(shopId)}, ${sql(name)}, ${sql(phone)}, 'owner')`,
    `INSERT INTO business_admins (business_id, phone) VALUES (${sql(businessId)}, ${sql(phone)})`,
  ].join(';\n'),
);

console.log(`${business} is set up (${opt('into')}):`);
console.log(`  • Branch ${code} · ${town}`);
console.log(`  • ${name} (${phone}): owner of ${code} and ${business} HQ`);
console.log('');
console.log('Next, in the app:');
console.log(`  1. ${name} signs in with ${phone}, a WhatsApp code, then a 6-digit PIN.`);
console.log('  2. More → Mana Wash HQ: services, prices and plans.');
console.log('  3. More → Team: add the staff (name + number).');
