const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Client-generated record ids for offline creates. The server treats a repeated id as "already
 * done", which is what makes replaying the outbox safe. A time prefix keeps ids roughly
 * ordered; 16 random chars (~82 bits) make collisions between phones practically impossible.
 */
export function newId(): string {
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  const bytes = new Uint8Array(16);
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let rand = '';
  for (const b of bytes) rand += ALPHABET[b % ALPHABET.length];
  return `${Date.now().toString(36)}_${rand}`;
}
