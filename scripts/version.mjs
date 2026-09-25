#!/usr/bin/env node
/**
 * One product version (MAJOR.MINOR.PATCH) shared by every app and package.
 *
 *   npm run version:set -- 2.1.0   write it everywhere
 *   npm run version:check          fail if anything has drifted
 *
 * Android's versionCode is derived (MAJOR*10000 + MINOR*100 + PATCH), so it always increases
 * with the version and never needs hand-editing. MINOR and PATCH must stay below 100.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['package.json', 'apps/api/package.json', 'apps/mobile/package.json', 'packages/db/package.json', 'packages/domain/package.json'];
const LOCK_KEYS = ['', 'apps/api', 'apps/mobile', 'packages/db', 'packages/domain'];
const GRADLE = 'apps/mobile/android/app/build.gradle';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

const read = (file) => readFileSync(join(root, file), 'utf8');
const readJson = (file) => JSON.parse(read(file));
const writeJson = (file, data) => writeFileSync(join(root, file), `${JSON.stringify(data, null, 2)}\n`);

function versionCode(version) {
  const [, major, minor, patch] = version.match(SEMVER).map(Number);
  if (minor > 99 || patch > 99) throw new Error('MINOR and PATCH must be 0–99 so versionCode stays ordered.');
  return major * 10000 + minor * 100 + patch;
}

function current() {
  const found = PACKAGES.map((file) => [file, readJson(file).version]);
  const lock = readJson('package-lock.json');
  for (const key of LOCK_KEYS) found.push([`package-lock.json#${key || 'root'}`, lock.packages[key]?.version]);
  const gradle = read(GRADLE);
  found.push([`${GRADLE}#versionName`, gradle.match(/versionName "([^"]+)"/)?.[1]]);
  found.push([`${GRADLE}#versionCode`, gradle.match(/versionCode (\d+)/)?.[1]]);
  return found;
}

function check() {
  const version = readJson('package.json').version;
  if (!SEMVER.test(version)) return fail(`Root version "${version}" is not MAJOR.MINOR.PATCH.`);
  const expectedCode = String(versionCode(version));
  const drift = current().filter(([where, v]) => (where.endsWith('versionCode') ? v !== expectedCode : v !== version));
  if (drift.length) return fail(`Version drift from ${version}:\n${drift.map(([w, v]) => `  ${w}: ${v}`).join('\n')}`);
  console.log(`All versions are ${version} (Android versionCode ${expectedCode}).`);
}

function set(version) {
  if (!SEMVER.test(version ?? '')) return fail('Usage: npm run version:set -- MAJOR.MINOR.PATCH');
  const code = versionCode(version);
  for (const file of PACKAGES) writeJson(file, { ...readJson(file), version });
  const lock = readJson('package-lock.json');
  lock.version = version;
  for (const key of LOCK_KEYS) if (lock.packages[key]) lock.packages[key].version = version;
  writeJson('package-lock.json', lock);
  const gradle = read(GRADLE)
    .replace(/versionCode \d+/, `versionCode ${code}`)
    .replace(/versionName "[^"]+"/, `versionName "${version}"`);
  writeFileSync(join(root, GRADLE), gradle);
  check();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [command, arg] = process.argv.slice(2);
if (command === 'set') set(arg);
else if (command === 'check') check();
else fail('Usage: node scripts/version.mjs <set VERSION | check>');
