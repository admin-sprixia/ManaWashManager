#!/usr/bin/env node
/**
 * One product version (MAJOR.MINOR.PATCH) shared by every app and package.
 *
 *   npm run version:set -- 2.1.0   write it everywhere
 *   npm run version:check          fail if anything has drifted
 *
 * The build number (Android versionCode, iOS CURRENT_PROJECT_VERSION) is derived
 * (MAJOR*10000 + MINOR*100 + PATCH), so it always increases with the version and never needs
 * hand-editing. MINOR and PATCH must stay below 100.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACES = ['apps/api', 'apps/manager', 'apps/customer', 'packages/db', 'packages/domain', 'packages/ui'];
const PACKAGES = ['package.json', ...WORKSPACES.map((w) => `${w}/package.json`)];
const LOCK_KEYS = ['', ...WORKSPACES];
const GRADLES = ['apps/manager/android/app/build.gradle', 'apps/customer/android/app/build.gradle'];
const XCODE = 'apps/customer/ios/ManaCarWash.xcodeproj/project.pbxproj';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

const read = (file) => readFileSync(join(root, file), 'utf8');
const readJson = (file) => JSON.parse(read(file));
const writeJson = (file, data) => writeFileSync(join(root, file), `${JSON.stringify(data, null, 2)}\n`);

function buildNumber(version) {
  const [, major, minor, patch] = version.match(SEMVER).map(Number);
  if (minor > 99 || patch > 99) throw new Error('MINOR and PATCH must be 0–99 so build numbers stay ordered.');
  return major * 10000 + minor * 100 + patch;
}

/** Every place a version is written, as [where, value, 'version' | 'build']. */
function current() {
  const found = PACKAGES.map((file) => [file, readJson(file).version, 'version']);
  const lock = readJson('package-lock.json');
  for (const key of LOCK_KEYS) found.push([`package-lock.json#${key || 'root'}`, lock.packages[key]?.version, 'version']);
  for (const file of GRADLES) {
    const gradle = read(file);
    found.push([`${file}#versionName`, gradle.match(/versionName "([^"]+)"/)?.[1], 'version']);
    found.push([`${file}#versionCode`, gradle.match(/versionCode (\d+)/)?.[1], 'build']);
  }
  // Each Xcode build configuration (Debug, Release, tests) carries its own copy; all must agree.
  const xcode = read(XCODE);
  for (const [i, m] of [...xcode.matchAll(/MARKETING_VERSION = ([^;]+);/g)].entries()) {
    found.push([`${XCODE}#MARKETING_VERSION[${i}]`, m[1], 'version']);
  }
  for (const [i, m] of [...xcode.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].entries()) {
    found.push([`${XCODE}#CURRENT_PROJECT_VERSION[${i}]`, m[1], 'build']);
  }
  return found;
}

function check() {
  const version = readJson('package.json').version;
  if (!SEMVER.test(version)) return fail(`Root version "${version}" is not MAJOR.MINOR.PATCH.`);
  const build = String(buildNumber(version));
  const drift = current().filter(([, v, kind]) => v !== (kind === 'build' ? build : version));
  if (drift.length) return fail(`Version drift from ${version}:\n${drift.map(([w, v]) => `  ${w}: ${v}`).join('\n')}`);
  console.log(`All versions are ${version} (build number ${build}).`);
}

function set(version) {
  if (!SEMVER.test(version ?? '')) return fail('Usage: npm run version:set -- MAJOR.MINOR.PATCH');
  const build = buildNumber(version);
  for (const file of PACKAGES) writeJson(file, { ...readJson(file), version });
  const lock = readJson('package-lock.json');
  lock.version = version;
  for (const key of LOCK_KEYS) if (lock.packages[key]) lock.packages[key].version = version;
  writeJson('package-lock.json', lock);
  for (const file of GRADLES) {
    const gradle = read(file)
      .replace(/versionCode \d+/, `versionCode ${build}`)
      .replace(/versionName "[^"]+"/, `versionName "${version}"`);
    writeFileSync(join(root, file), gradle);
  }
  const xcode = read(XCODE)
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
  writeFileSync(join(root, XCODE), xcode);
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
