import type { Context, Next } from 'hono';
import { billingRepo, createPlatformDb, createShopDb, type DbClient } from '@mana/db';
import { verifySessionToken, type SessionClaims } from '../lib/jwt';
import { loadPlan, seatIsLocked, seatLockedBody } from '../lib/plan';
import type { PlanStatus } from '@mana/domain';
import type { Env } from '../types';

declare module 'hono' {
  interface ContextVariableMap {
    session: SessionClaims;
    /** Locked to the signed-in user's shop — the only database handle signed-in routes use. */
    db: DbClient;
  }
}

type Lookup =
  | { ok: true; session: SessionClaims; plan: PlanStatus }
  | { ok: false; status: 401 | 403; body: Record<string, string> };

/**
 * Reads the user, the shop's plan and the seat order in one round of parallel queries, so the
 * *database* is the source of truth for role, access and shop: a deactivated staff member is
 * locked out, and a role change applies, without waiting for the token to expire. The token's
 * shop must match the user's.
 */
async function lookUp(env: Env, claims: SessionClaims): Promise<Lookup> {
  const platform = createPlatformDb(env.DB);
  const [user, plan, seatOrder] = await Promise.all([
    platform.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, shopId: true, role: true, phone: true, active: true, removedAt: true, sessionVersion: true },
    }),
    loadPlan(platform, claims.shopId),
    billingRepo.listSeatOrder(createShopDb(env.DB, claims.shopId)),
  ]);
  if (!user || user.shopId !== claims.shopId || user.removedAt) {
    return { ok: false, status: 401, body: { error: 'unauthorized' } };
  }
  if (!user.active) return { ok: false, status: 403, body: { error: 'account_disabled' } };
  // PIN changed or reset since this token was issued: this phone has to sign in again.
  if (claims.sv !== user.sessionVersion) return { ok: false, status: 401, body: { error: 'session_revoked' } };
  const role = user.role === 'owner' ? 'owner' : 'staff';
  // More staff than the plan has seats (e.g. the trial ended): the extra people are signed out
  // until the shop upgrades. Their data and the team list are untouched.
  if (role === 'staff' && seatIsLocked(seatOrder, user.id, plan)) {
    return { ok: false, status: 403, body: seatLockedBody };
  }
  return { ok: true, plan, session: { sub: user.id, shopId: user.shopId, role, phone: user.phone, sv: user.sessionVersion } };
}

/**
 * Screens that only read reuse a recent look-up of the same token for a few seconds: opening the
 * app fires several requests at once, and each would otherwise wait on the database just to
 * learn who's asking. Kept safe by:
 * - changes, and anything about the plan or the account, always looking up fresh, so a removed
 *   teammate can never change anything;
 * - remembering Pro shops only, so a Free shop that just paid never sees a stale lock;
 * - forgetting a shop after any change it makes or any billing update for it (`forgetShop`).
 * Memory is per Worker instance, so a change made through another instance can still leave a
 * removed teammate or a lapsed plan able to *view* for up to REMEMBER_MS.
 */
const REMEMBER_MS = 30_000;
const REMEMBER_MAX = 1000;
const remembered = new Map<string, { at: number; shopId: string; lookup: Promise<Lookup> }>();

function canRemember(c: Context<{ Bindings: Env }>) {
  const path = c.req.path;
  return c.req.method === 'GET' && !path.startsWith('/auth') && !path.startsWith('/billing');
}

/** Drops every remembered look-up for a shop: its team, plan or sessions may just have changed. */
export function forgetShop(shopId: string) {
  for (const [token, entry] of remembered) {
    if (entry.shopId === shopId) remembered.delete(token);
  }
}

function lookUpOrRemember(c: Context<{ Bindings: Env }>, token: string, claims: SessionClaims): Promise<Lookup> {
  if (!canRemember(c)) return lookUp(c.env, claims);
  const now = Date.now();
  const hit = remembered.get(token);
  if (hit && now - hit.at < REMEMBER_MS) return hit.lookup;
  if (remembered.size >= REMEMBER_MAX) remembered.clear();
  const lookup = lookUp(c.env, claims);
  const entry = { at: now, shopId: claims.shopId, lookup };
  remembered.set(token, entry);
  const drop = () => {
    if (remembered.get(token) === entry) remembered.delete(token);
  };
  lookup.then((r) => {
    if (!r.ok || r.plan.tier !== 'pro') drop();
  }, drop);
  return lookup;
}

/**
 * Verifies the bearer token and who it belongs to (see `lookUp`); everything after this runs
 * against a client locked to the user's shop.
 */
export async function requireAuth(
  c: Context<{ Bindings: Env }>,
  next: Next,
): Promise<Response | void> {
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const token = header.slice('Bearer '.length);

  let claims: SessionClaims;
  try {
    claims = await verifySessionToken(token, c.env.JWT_SECRET);
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const found = await lookUpOrRemember(c, token, claims);
  if (!found.ok) return c.json(found.body, found.status);
  c.set('session', found.session);
  c.set('db', createShopDb(c.env.DB, found.session.shopId));
  c.set('plan', found.plan);
  try {
    await next();
  } finally {
    if (!canRemember(c)) forgetShop(found.session.shopId);
  }
}

/** Guards owner-only actions: pricing, reports, team, and money corrections. */
export function requireRole(role: 'owner') {
  return async (c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> => {
    const session = c.get('session');
    if (session.role !== role) {
      return c.json({ error: 'forbidden' }, 403);
    }
    await next();
  };
}
