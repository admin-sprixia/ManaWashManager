import type { Context, Next } from 'hono';
import { CatalogError, catalogRepo, createPlatformDb, menuRepo } from '@mana/db';
import { reportError } from './alerts';
import type { Env } from '../types';

declare module 'hono' {
  interface ContextVariableMap {
    /** The signed-in branch's business, for /business routes (set by requireBusinessAdmin). */
    businessId: string;
  }
}

type Ctx = Context<{ Bindings: Env }>;

/** Branches rebuilt during the request; the rest finish in the background (and nightly). */
const INLINE_PUBLISH = 3;

/**
 * Only the business's admins (by phone) change the catalog. The signed-in branch's business is
 * the one they manage; a branch without one gets its own on first use.
 */
export async function requireBusinessAdmin(c: Ctx, next: Next): Promise<Response | void> {
  const session = c.get('session');
  const businessId = await catalogRepo.ensureBusinessForShop(c.env.DB, session.shopId);
  const pdb = createPlatformDb(c.env.DB);
  if (!(await catalogRepo.isAdmin(pdb, businessId, session.phone))) {
    // A branch that just got its own business: its owners run it.
    const admins = await pdb.businessAdmin.count({ where: { businessId } });
    if (admins > 0 || session.role !== 'owner') {
      return c.json({ error: 'forbidden' as const, message: 'Only the business admins can change this.' }, 403);
    }
    await catalogRepo.addAdmin(c.env.DB, businessId, session.phone);
  }
  c.set('businessId', businessId);
  await next();
}

/** The repo's validation errors as API errors; anything else is a real failure. */
export function catalogError(c: Ctx, e: unknown) {
  if (!(e instanceof CatalogError)) throw e;
  const status = e.code === 'not_found' ? 404 : e.code === 'in_use' || e.code === 'last_admin' || e.code === 'default_book' ? 409 : 400;
  return c.json({ error: e.code, message: e.message }, status);
}

function background(c: Ctx): ((p: Promise<unknown>) => void) | null {
  try {
    const ctx = c.executionCtx;
    return (p) => ctx.waitUntil(p);
  } catch {
    return null;
  }
}

/**
 * Rebuilds every branch of the business after a catalog change: the signed-in branch and a few
 * more right away, so what the admin sees next is current, and the rest in the background. A
 * branch that fails stays stale and is rebuilt by the nightly run (or its next menu read).
 */
export async function publishBusiness(c: Ctx, businessId: string) {
  const session = c.get('session');
  const stale = await catalogRepo.staleBranches(createPlatformDb(c.env.DB), businessId);
  const ordered = [...stale].sort((a, b) => (a === session.shopId ? -1 : b === session.shopId ? 1 : 0));
  const report = (shopId: string, e: unknown) => {
    const sent = reportError(c.env, {
      source: 'api',
      message: `Menu rebuild failed: ${e instanceof Error ? e.message : String(e)}`,
      stack: e instanceof Error ? e.stack : undefined,
      context: 'publishBusiness',
      shopId,
    });
    background(c)?.(sent);
  };
  const now = ordered.slice(0, INLINE_PUBLISH);
  const later = ordered.slice(INLINE_PUBLISH);
  await menuRepo.publishMany(c.env.DB, now, report);
  if (later.length) {
    const run = menuRepo.publishMany(c.env.DB, later, report);
    const wait = background(c);
    if (wait) wait(run);
    else await run;
  }
  return { branches: ordered.length };
}
