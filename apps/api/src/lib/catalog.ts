import type { Context, Next } from 'hono';
import { CatalogError, catalogRepo, createPlatformDb, menuRepo, userRepo } from '@mana/db';
import { SENIOR_PIN_DIGITS } from '@mana/domain';
import { pinUpgradeBody } from '../middleware/auth';
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
 * Only HQ — the business's admins, by phone — changes the catalog and opens or staffs branches.
 * The signed-in branch's business is the one they manage. Being a branch owner is never enough.
 */
export async function requireBusinessAdmin(c: Ctx, next: Next): Promise<Response | void> {
  const session = c.get('session');
  const businessId = await catalogRepo.businessForShop(c.env.DB, session.shopId);
  const platform = createPlatformDb(c.env.DB);
  if (!(await catalogRepo.isAdmin(platform, businessId, session.phone))) {
    return c.json({ error: 'forbidden' as const, message: 'Only Mana Wash HQ can change this.' }, 403);
  }
  // Owners and managers are already held to 6 digits by requireAuth; HQ is too, whatever their role here.
  const me = await userRepo.findById(platform, session.sub);
  if (me?.pinHash && (me.pinDigits ?? 0) < SENIOR_PIN_DIGITS) return c.json(pinUpgradeBody, 403);
  c.set('businessId', businessId);
  await next();
}

/** True when the signed-in person is HQ for their branch's business. */
export async function isHq(c: Ctx): Promise<boolean> {
  const session = c.get('session');
  const branch = await catalogRepo.branchOf(createPlatformDb(c.env.DB), session.shopId);
  if (!branch?.businessId) return false;
  return catalogRepo.isAdmin(createPlatformDb(c.env.DB), branch.businessId, session.phone);
}

/** The repo's validation errors as API errors; anything else is a real failure. */
export function catalogError(c: Ctx, e: unknown) {
  if (!(e instanceof CatalogError)) throw e;
  const status = e.code === 'not_found' ? 404 : e.code === 'in_use' || e.code === 'last_admin' || e.code === 'not_on_team' || e.code === 'default_book' ? 409 : 400;
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
