const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Client-generated record ids for offline creates. The server treats a repeated id as "already
 * done", which is what makes replaying the outbox safe. A time prefix keeps ids roughly
 * ordered; 16 random chars (~82 bits) make collisions between phones practically impossible.
 * The randomness is the OS's secure source (react-native-get-random-values, loaded in index.js).
 */
export function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let rand = '';
  for (const b of bytes) rand += ALPHABET[b % ALPHABET.length];
  return `${Date.now().toString(36)}_${rand}`;
}
