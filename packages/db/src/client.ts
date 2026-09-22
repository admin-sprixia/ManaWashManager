import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';

/**
 * Shape of the D1Database binding Cloudflare Workers injects at runtime.
 * Declared locally so this package has no hard dependency on @cloudflare/workers-types.
 */
export interface D1Database {
  prepare: (query: string) => unknown;
  batch: (statements: unknown[]) => Promise<unknown[]>;
  exec: (query: string) => Promise<unknown>;
}

export type DbClient = PrismaClient;

/** Every Worker only ever binds its own organization's D1 database — see Naming conventions. */
export function createDbClient(d1: D1Database): DbClient {
  const adapter = new PrismaD1(d1 as never);
  return new PrismaClient({ adapter });
}
