import type { Env } from '../types';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Local `wrangler dev` only: fixed, reusable codes so testing isn't one-shot. Needs both the flag
 * and a request to localhost, so a flag left on by mistake can't open a deployed Worker.
 */
export function isDevMode(env: Env, requestUrl: string): boolean {
  const flag = env.DEV_MODE === 'true' || env.DEV_OTP_BYPASS === 'true';
  return flag && LOCAL_HOSTS.has(new URL(requestUrl).hostname);
}

/** Local dev, or the staging Worker with test codes switched on: fixed, reusable codes. */
export function usesTestCodes(env: Env, requestUrl: string): boolean {
  if (isDevMode(env, requestUrl)) return true;
  return env.ENVIRONMENT === 'staging' && env.STAGING_TEST_CODES === 'true';
}

export function devCode(env: Env): string {
  return env.DEV_RECOVERY_CODE ?? env.DEV_OTP_CODE ?? '000000';
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two hex digests of equal length. */
export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
