/**
 * PIN hashing with PBKDF2-SHA256 via WebCrypto (available natively in Workers — no deps).
 * Stored as `iterations$saltB64$hashB64` so the cost can be raised later without a migration:
 * old hashes keep verifying with the iteration count they were created with.
 * 100k is the ceiling the Workers runtime allows for PBKDF2.
 */
const ITERATIONS = 100_000;
const KEY_BITS = 256;

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, ITERATIONS);
  return `${ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [iterStr, saltB64, hashB64] = stored.split('$');
  const iterations = Number(iterStr);
  if (!iterations || !saltB64 || !hashB64) return false;
  const expected = fromB64(hashB64);
  const actual = await derive(pin, fromB64(saltB64), iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}
