import type { Context, Next } from 'hono';
import { verifySessionToken, type SessionClaims } from '../lib/jwt';
import type { Env } from '../types';

declare module 'hono' {
  interface ContextVariableMap {
    session: SessionClaims;
  }
}

export async function requireAuth(
  c: Context<{ Bindings: Env }>,
  next: Next,
): Promise<Response | void> {
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const token = header.slice('Bearer '.length);
  try {
    const claims = await verifySessionToken(token, c.env.JWT_SECRET);
    c.set('session', claims);
    await next();
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }
}

/** Guards owner-only actions (pricing, reports) — see V2.0's role field in the build plan. */
export function requireRole(role: 'owner') {
  return async (c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> => {
    const session = c.get('session');
    if (session.role !== role) {
      return c.json({ error: 'forbidden' }, 403);
    }
    await next();
  };
}
