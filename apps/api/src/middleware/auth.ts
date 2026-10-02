import type { Context, Next } from 'hono';
import { createPlatformDb, createShopDb, type DbClient } from '@mana/db';
import { verifySessionToken, type SessionClaims } from '../lib/jwt';
import { loadPlan, seatLocked, seatLockedBody } from '../lib/plan';
import type { Env } from '../types';

declare module 'hono' {
  interface ContextVariableMap {
    session: SessionClaims;
    /** Locked to the signed-in user's shop — the only database handle signed-in routes use. */
    db: DbClient;
  }
}

/**
 * Verifies the bearer token, then re-reads the user so the *database* is the source of truth
 * for role, access and shop: a deactivated staff member is locked out on their next request, and
 * a role change applies immediately instead of when the token expires. The token's shop must
 * match the user's, and everything after this runs against a client locked to that shop.
 * The shop's plan is read on the same trip, so a lapsed subscription applies on the next request.
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

  const platform = createPlatformDb(c.env.DB);
  const [user, plan] = await Promise.all([
    platform.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, shopId: true, role: true, phone: true, active: true, removedAt: true, sessionVersion: true },
    }),
    loadPlan(platform, claims.shopId),
  ]);
  if (!user || user.shopId !== claims.shopId || user.removedAt) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  if (!user.active) return c.json({ error: 'account_disabled' }, 403);
  // PIN changed or reset since this token was issued: this phone has to sign in again.
  if (claims.sv !== user.sessionVersion) return c.json({ error: 'session_revoked' }, 401);

  const db = createShopDb(c.env.DB, user.shopId);
  const role = user.role === 'owner' ? 'owner' : 'staff';
  // More staff than the plan has seats (e.g. the trial ended): the extra people are signed out
  // until the shop upgrades. Their data and the team list are untouched.
  if (role === 'staff' && (await seatLocked(db, user.id, plan))) {
    return c.json(seatLockedBody, 403);
  }

  c.set('session', { sub: user.id, shopId: user.shopId, role, phone: user.phone, sv: user.sessionVersion });
  c.set('db', db);
  c.set('plan', plan);
  await next();
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
