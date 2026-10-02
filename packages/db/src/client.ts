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

/** Tables that belong to the platform, not to a shop — never filtered by shop. */
const PLATFORM_MODELS = new Set(['Shop', 'PlatformSetting', 'SignupCode', 'RateLimit']);

/** Operations whose `where` gets `shopId` added. Prisma 5 accepts extra fields on unique wheres. */
const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

type Plain = Record<string, unknown>;

function isPlain(v: unknown): v is Plain {
  return v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
}

/** Stamps a row being created, and any rows created through its relations. */
function stampCreate(data: unknown, shopId: string): unknown {
  if (Array.isArray(data)) return data.map((d) => stampCreate(d, shopId));
  if (!isPlain(data)) return data;
  return stampRelationWrites({ ...data, shopId }, shopId);
}

/** Rows created through relation writes (`jobServices: { create: [...] }`) belong to the same shop. */
function stampRelationWrites(data: Plain, shopId: string): Plain {
  const out: Plain = { ...data };
  for (const [key, value] of Object.entries(out)) {
    if (!isPlain(value)) continue;
    const write: Plain = { ...value };
    if ('create' in write) write.create = stampCreate(write.create, shopId);
    if (isPlain(write.createMany)) {
      write.createMany = { ...write.createMany, data: stampCreate(write.createMany.data, shopId) };
    }
    if (isPlain(write.connectOrCreate)) {
      write.connectOrCreate = { ...write.connectOrCreate, create: stampCreate(write.connectOrCreate.create, shopId) };
    }
    if (isPlain(write.upsert)) {
      write.upsert = { ...write.upsert, create: stampCreate(write.upsert.create, shopId) };
    }
    out[key] = write;
  }
  return out;
}

function scopeArgs(operation: string, args: Plain, shopId: string): Plain {
  const out: Plain = { ...args };
  if (WHERE_OPERATIONS.has(operation)) out.where = { ...(isPlain(args.where) ? args.where : {}), shopId };
  switch (operation) {
    case 'create':
      out.data = stampCreate(args.data, shopId);
      break;
    case 'createMany':
    case 'createManyAndReturn':
      out.data = stampCreate(args.data, shopId);
      break;
    case 'update':
    case 'updateMany':
      if (isPlain(args.data)) out.data = stampRelationWrites(args.data, shopId);
      break;
    case 'upsert':
      out.create = stampCreate(args.create, shopId);
      if (isPlain(args.update)) out.update = stampRelationWrites(args.update, shopId);
      break;
  }
  return out;
}

function build(d1: D1Database, shopId: string | null) {
  const adapter = new PrismaD1(d1 as never);
  return new PrismaClient({ adapter }).$extends({
    name: 'shop-scope',
    client: {
      /** The shop this client is locked to. Throws on the platform client. */
      $shopId(): string {
        if (!shopId) throw new Error('Platform client has no shop');
        return shopId;
      },
    },
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!shopId || PLATFORM_MODELS.has(model)) return query(args);
          return query(scopeArgs(operation, (args ?? {}) as Plain, shopId) as typeof args);
        },
      },
    },
  });
}

export type DbClient = ReturnType<typeof build>;

/**
 * The client every signed-in request uses: locked to one shop. Every read and update is
 * filtered to that shop and every created row (including nested creates) is stamped with it,
 * so a repository can't reach another shop's data even if it forgets to ask.
 */
export function createShopDb(d1: D1Database, shopId: string): DbClient {
  return build(d1, shopId);
}

/**
 * Unfiltered — sees every shop. Only for the few places that run before a shop is known or
 * across all shops: finding a user by phone at sign-in, the nightly job, platform admin.
 */
export function createPlatformDb(d1: D1Database): DbClient {
  return build(d1, null);
}
