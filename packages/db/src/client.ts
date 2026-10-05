import { AsyncLocalStorage } from 'node:async_hooks';
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
const PLATFORM_MODELS = new Set([
  'Shop',
  'PlatformSetting',
  'SignupCode',
  'RateLimit',
  'BillingEvent',
  'CustomerAccount',
]);

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

/**
 * Each PrismaClient loads its own copy of the query engine (WebAssembly): several milliseconds
 * of CPU and megabytes of memory, so a client per request exhausts the isolate's memory when
 * requests overlap ("RangeError: Invalid array buffer length"). But one client can't be shared
 * by requests running at the same time either: Prisma batches concurrent queries into one
 * database call, and the Workers runtime cancels a request left waiting on I/O another request
 * started ("the Worker's code had hung"). So each request leases clients from a per-isolate pool
 * for its whole life (`openDbLease`) and hands them back when it — and its background work — is
 * done. The pool grows only to the number of requests that actually overlap.
 * The per-shop scoping below is a cheap `$extends` layer on top of the leased client.
 */
interface Lease {
  clients: Map<D1Database, PrismaClient>;
  released: boolean;
}

const currentLease = new AsyncLocalStorage<Lease>();
const idleClients = new WeakMap<D1Database, PrismaClient[]>();

const newClient = (d1: D1Database) => new PrismaClient({ adapter: new PrismaD1(d1 as never) });

function baseClient(d1: D1Database): PrismaClient {
  const lease = currentLease.getStore();
  // Outside a request (the nightly job), or late work after its lease ended: a client of its own.
  if (!lease || lease.released) return newClient(d1);
  let client = lease.clients.get(d1);
  if (!client) {
    client = idleClients.get(d1)?.pop() ?? newClient(d1);
    lease.clients.set(d1, client);
  }
  return client;
}

/**
 * One request's database clients. Run the request inside `run`; call `release` once the
 * response is sent and every `waitUntil` task has settled, so no other request gets the
 * clients while this one may still be using them.
 */
export function openDbLease(): { run<T>(fn: () => T): T; release(): void } {
  const lease: Lease = { clients: new Map(), released: false };
  return {
    run: (fn) => currentLease.run(lease, fn),
    release() {
      if (lease.released) return;
      lease.released = true;
      for (const [d1, client] of lease.clients) {
        const idle = idleClients.get(d1);
        if (idle) idle.push(client);
        else idleClients.set(d1, [client]);
      }
      lease.clients.clear();
    },
  };
}

function build(d1: D1Database, shopId: string | null) {
  return baseClient(d1).$extends({
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
