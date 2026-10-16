import type { Context } from 'hono';
import { sha256Hex } from './recovery';

/**
 * The app makes a random key once per install and sends it on every auth request. Only its hash
 * is stored, so a database leak can't be replayed as a trusted phone.
 */
export const DEVICE_HEADER = 'x-device-key';

const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{32,128}$/;

/**
 * Every session is tied to a phone (SessionClaims.dv), so a sign-in without the key is refused.
 * The app always sends one; this only shows if its secure storage failed.
 */
export const noDeviceKey = {
  error: 'device_key_required' as const,
  message: 'This phone couldn’t be recognised. Close the app, open it again and try once more.',
};

/** The hash identifying this install, or null when the app sent no (or a malformed) key. */
export async function deviceHash(c: Context): Promise<string | null> {
  const key = c.req.header(DEVICE_HEADER)?.trim();
  return key && DEVICE_KEY_RE.test(key) ? sha256Hex(key) : null;
}

/** The phone's make and model as the app reports it ("Motorola XT2575"), for Your phones. */
export function deviceLabel(c: Context): string | null {
  const label = c.req.header('x-device-name')?.replace(/[^\w .+()-]/g, '').trim().slice(0, 60);
  return label || null;
}
