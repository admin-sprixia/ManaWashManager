import type { Context, Next } from 'hono';
import { createDbClient } from '@mana/db';
import { verifySessionToken, type SessionClaims } from '../lib/jwt';
import type { Env } from '../types';

declare module 'hono' {
  interface ContextVariableMap {
    session: SessionClaims;
  }
}

/**
 * Verifies the bearer token, then re-reads the user so the *database* is the source of truth
 * for role and access: a deactivated staff member is locked out on their next request, and a
 * role change applies immediately instead of when the token expires.
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

  const db = createDbClient(c.env.DB);
  const user = await db.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, role: true, phone: true, active: true },
  });
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (!user.active) return c.json({ error: 'account_disabled' }, 403);

  c.set('session', {
    sub: user.id,
    orgId: claims.orgId,
    role: user.role === 'owner' ? 'owner' : 'staff',
    phone: user.phone,
  });
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
