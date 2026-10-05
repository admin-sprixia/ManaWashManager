import type { Context, Next } from 'hono';
import { createPlatformDb, customerAccountRepo, customerAppRepo, type CustomerLink } from '@mana/db';
import { verifyCustomerToken } from '../lib/customerToken';
import type { Env } from '../types';

declare module 'hono' {
  interface ContextVariableMap {
    /** The MANA Car Wash account behind the request (customer routes only). */
    customer: { accountId: string; phone: string };
    /** Listed branches where this phone is a customer — every customer read is limited to these. */
    customerLinks: CustomerLink[];
  }
}

/**
 * Verifies a customer token and re-reads the account, so "sign out everywhere" and deleting the
 * account take effect on the next request. Also works out which branches the phone is a customer
 * of right now: a branch removing them takes effect at once too.
 */
export async function requireCustomer(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer ')) return c.json({ error: 'unauthorized' as const }, 401);
  const claims = await verifyCustomerToken(header.slice('Bearer '.length), c.env.JWT_SECRET);
  if (!claims) return c.json({ error: 'unauthorized' as const }, 401);

  const platform = createPlatformDb(c.env.DB);
  const [account, links] = await Promise.all([
    customerAccountRepo.findById(platform, claims.sub),
    customerAppRepo.links(platform, claims.phone),
  ]);
  if (!account || account.phone !== claims.phone) return c.json({ error: 'unauthorized' as const }, 401);
  if (account.sessionVersion !== claims.sv) return c.json({ error: 'session_revoked' as const }, 401);
  c.set('customer', { accountId: account.id, phone: account.phone });
  c.set('customerLinks', links);
  await next();
}
