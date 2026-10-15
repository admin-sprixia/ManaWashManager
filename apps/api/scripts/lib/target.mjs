// Which server and database the dev scripts talk to.
//
//   (default)                  local `wrangler dev` on :8787 and the local mana_db
//   --staging / MANA_TARGET=staging   the staging Worker and the remote mana_db_staging
//
// Production is deliberately not a target: no script here can write to the live database.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STAGING = process.argv.includes('--staging') || process.env.MANA_TARGET === 'staging';
export const TARGET = STAGING ? 'staging' : 'local';
export const STAGING_API = 'https://api-staging.manawashmanager.com';
export const API = process.env.API_URL ?? (STAGING ? STAGING_API : 'http://localhost:8787');
export const DB_NAME = STAGING ? 'mana_db_staging' : 'mana_db';
/** `wrangler d1 …` arguments that pick the database, after the sub-command. */
export const DB_FLAGS = STAGING ? ['--remote', '--env', 'staging'] : ['--local'];
export const API_DIR = fileURLToPath(new URL('../..', import.meta.url));

const STALE_SOCKET = new Set(['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE']);

/** The fixed code local dev and staging accept for every WhatsApp code. */
export const DEV_CODE = process.env.DEV_CODE ?? '000000';

/**
 * The scripts' "phone": sent on every request like the app does, and kept between runs (like a
 * real phone keeps its key), so a number trusted once isn't asked for a WhatsApp code again.
 */
export const DEVICE_KEY = process.env.DEVICE_KEY ?? scriptDeviceKey();

function scriptDeviceKey() {
  const dir = join(fileURLToPath(new URL('../../', import.meta.url)), '.wrangler');
  const file = join(dir, 'script-device-key');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    const key = `script_${randomBytes(24).toString('hex')}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, key);
    return key;
  }
}

/**
 * `fetch` that retries once when the connection drops before any response. Node reuses idle
 * keep-alive sockets, and `wrangler dev` can close one just as a request goes out (typically after
 * a pause for a `wrangler d1` query); the server never sees that request, so sending it again is
 * safe. Sends this run's device key unless the caller set one (or sent `x-device-key: none`).
 */
export async function apiFetch(url, init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has('x-device-key')) headers.set('x-device-key', DEVICE_KEY);
  if (headers.get('x-device-key') === 'none') headers.delete('x-device-key');
  const request = { ...init, headers };
  try {
    return await fetch(url, request);
  } catch (err) {
    if (!STALE_SOCKET.has(err?.cause?.code)) throw err;
    return fetch(url, request);
  }
}

async function send(method, path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await apiFetch(API + path, { method, headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

/**
 * Signs in the way the app does: on a phone the number hasn't trusted yet, the WhatsApp code
 * (fixed in dev) first; then the PIN. A number with no PIN yet confirms with the code and sets
 * `pin`. Returns the last response — `{ status, body }`, with `body.token` when signed in.
 */
/** Asks for a WhatsApp code, waiting out the resend timer from an earlier run if needed. */
export async function requestCode(phone) {
  const r = await send('POST', '/auth/code/request', { phone });
  if (r.body?.error !== 'too_soon') return r;
  await new Promise((done) => setTimeout(done, (r.body.retryAfter + 1) * 1000));
  return send('POST', '/auth/code/request', { phone });
}

export async function signIn(phone, pin) {
  const start = await send('POST', '/auth/start', { phone });
  const next = start.body?.next;
  if (next === 'verify_device') {
    await requestCode(phone);
    const v = await send('POST', '/auth/code/verify', { phone, code: DEV_CODE, purpose: 'device' });
    if (v.body?.next !== 'pin') return v;
  }
  if (next === 'pin' || next === 'verify_device') return send('POST', '/auth/pin/login', { phone, pin });
  if (next !== 'code') return start;
  await requestCode(phone);
  const v = await send('POST', '/auth/code/verify', { phone, code: DEV_CODE });
  if (!v.body?.token) return v;
  // Setting a PIN signs out older sessions; carry on with the fresh one it returns.
  return send('PUT', '/auth/pin', { pin }, v.body.token);
}

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
