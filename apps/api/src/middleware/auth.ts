import type { Context, Next } from 'hono';
import { createPlatformDb, createShopDb, type DbClient } from '@mana/db';
import { verifySessionToken, type SessionClaims } from '../lib/jwt';
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

  const user = await createPlatformDb(c.env.DB).user.findUnique({
    where: { id: claims.sub },
    select: { id: true, shopId: true, role: true, phone: true, active: true, removedAt: true, sessionVersion: true },
  });
  if (!user || user.shopId !== claims.shopId || user.removedAt) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  if (!user.active) return c.json({ error: 'account_disabled' }, 403);
  // PIN changed or reset since this token was issued: this phone has to sign in again.
  if (claims.sv !== user.sessionVersion) return c.json({ error: 'session_revoked' }, 401);

  c.set('session', {
    sub: user.id,
    shopId: user.shopId,
    role: user.role === 'owner' ? 'owner' : 'staff',
    phone: user.phone,
    sv: user.sessionVersion,
  });
  c.set('db', createShopDb(c.env.DB, user.shopId));
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
