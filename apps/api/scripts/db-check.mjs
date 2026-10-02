#!/usr/bin/env node
/**
 * Fails if schema.sql and the migrations describe different databases.
 *
 *   npm run db:check
 *
 * Builds one in-memory SQLite database from schema.sql and another by running every
 * migrations/NNNN_*.sql in order, then compares tables, columns (type, NOT NULL, default,
 * primary key), foreign keys, CHECK constraints, indexes (columns, uniqueness, partial WHERE)
 * and triggers. Also loads seed.sql on top of the migrated database, so a broken seed fails too.
 * Needs Node 22.5+ (built-in node:sqlite); no network, no wrangler.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS_DIR = join(API_DIR, 'migrations');
const read = (p) => readFileSync(p, 'utf8');

const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const badName = migrations.find((f) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(f));
if (badName) fail(`Migration "${badName}" must be named NNNN_lower_snake_case.sql`);
migrations.forEach((f, i) => {
  if (Number(f.slice(0, 4)) !== i + 1) fail(`Migrations must be numbered 0001, 0002, … with no gaps (found ${f})`);
});

function build(sqlFiles) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const [name, sql] of sqlFiles) {
    try {
      db.exec(sql);
    } catch (e) {
      fail(`${name}: ${e.message}`);
    }
  }
  return db;
}

/** SQL text with comments and formatting removed, for comparing CHECKs, partial indexes, triggers. */
const normalize = (sql) =>
  (sql ?? '')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;=<>])\s*/g, '$1')
    .trim()
    .toLowerCase();

/** The CHECK (...) clauses of a CREATE TABLE, balanced-parenthesis aware. */
function checks(sql) {
  const text = normalize(sql);
  const found = [];
  let i = text.indexOf('check(');
  while (i !== -1) {
    let depth = 0;
    let j = i + 5;
    for (; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')' && --depth === 0) break;
    }
    found.push(text.slice(i, j + 1));
    i = text.indexOf('check(', j);
  }
  return found.sort();
}

function describe(db) {
  const objects = db
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != 'd1_migrations' ORDER BY type, name")
    .all();
  const out = {};
  for (const o of objects) {
    if (o.type === 'table') {
      out[`table ${o.name}`] = {
        columns: db.prepare(`PRAGMA table_xinfo("${o.name}")`).all().map((c) => ({
          name: c.name,
          type: c.type.toUpperCase(),
          notnull: c.notnull,
          default: c.dflt_value,
          pk: c.pk,
        })),
        foreignKeys: db
          .prepare(`PRAGMA foreign_key_list("${o.name}")`)
          .all()
          .map((f) => `${f.from}->${f.table}.${f.to}`)
          .sort(),
        checks: checks(o.sql),
      };
    } else if (o.type === 'index') {
      const info = db.prepare(`PRAGMA index_list("${o.tbl_name}")`).all().find((x) => x.name === o.name);
      const where = normalize(o.sql).split(' where ')[1] ?? null;
      out[`index ${o.name}`] = {
        table: o.tbl_name,
        unique: info?.unique ?? 0,
        columns: db.prepare(`PRAGMA index_xinfo("${o.name}")`).all().filter((c) => c.key).map((c) => c.name),
        where,
      };
    } else {
      out[`${o.type} ${o.name}`] = { table: o.tbl_name, sql: normalize(o.sql) };
    }
  }
  return out;
}

function fail(message) {
  console.error(`db:check failed: ${message}`);
  process.exit(1);
}

const fromSchema = describe(build([['schema.sql', read(join(API_DIR, 'schema.sql'))]]));
const migrated = build(migrations.map((f) => [`migrations/${f}`, read(join(MIGRATIONS_DIR, f))]));
const fromMigrations = describe(migrated);

const problems = [];
for (const key of new Set([...Object.keys(fromSchema), ...Object.keys(fromMigrations)])) {
  const a = fromSchema[key];
  const b = fromMigrations[key];
  if (!a) problems.push(`${key}: created by the migrations but missing from schema.sql`);
  else if (!b) problems.push(`${key}: in schema.sql but no migration creates it`);
  else if (JSON.stringify(a) !== JSON.stringify(b)) {
    for (const field of Object.keys(a)) {
      if (JSON.stringify(a[field]) !== JSON.stringify(b[field])) {
        problems.push(`${key}: ${field} differ\n    schema.sql: ${JSON.stringify(a[field])}\n    migrations: ${JSON.stringify(b[field])}`);
      }
    }
  }
}
if (problems.length) fail(`schema.sql and migrations/ disagree:\n  ${problems.join('\n  ')}`);

try {
  migrated.exec(read(join(API_DIR, 'seed.sql')));
} catch (e) {
  fail(`seed.sql doesn't load on the migrated database: ${e.message}`);
}

console.log(`db:check ok — schema.sql matches ${migrations.length} migration(s); seed.sql loads.`);
