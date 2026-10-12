// Workers and Node both have Web Crypto; declared here because the packages build with lib ES2022.
declare const crypto: { randomUUID(): string };

/** A new row id, the same shape Prisma's `@default(uuid())` makes. */
export function newId(): string {
  return crypto.randomUUID();
}
