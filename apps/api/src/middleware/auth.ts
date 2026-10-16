import type { Context, Next } from 'hono';
import { createPlatformDb, createShopDb, securityRepo, type DbClient } from '@mana/db';
import {
  branchClosedMessage,
  branchPausedMessage,
  isSeniorRole,
  SENIOR_PIN_DIGITS,
  toUserRole,
  type BranchStatus,
  type UserRole,
} from '@mana/domain';
import { deviceHash } from '../lib/device';
import { verifySessionToken, type SessionClaims } from '../lib/jwt';
import type { Env } from '../types';

declare module 'hono' {
  interface ContextVariableMap {
    session: SessionClaims;
    /** Locked to the signed-in user's shop — the only database handle signed-in routes use. */
    db: DbClient;
    /** The signed-in branch's status, set by Mana Wash HQ. */
    branchStatus: BranchStatus;
  }
}

type Lookup =
  | { ok: true; session: SessionClaims; status: BranchStatus; statusReason: string | null; pinUpgrade: boolean }
  | { ok: false; status: 401 | 403; body: Record<string, string> };

export const pinUpgradeBody = {
  error: 'pin_upgrade_required' as const,
  message: `Owners and managers need a ${SENIOR_PIN_DIGITS}-digit PIN. Choose a new one to carry on.`,
};

/**
 * Reads the user and their branch in one round of parallel queries, so the *database* is the
 * source of truth for role, access and branch status: a deactivated teammate is locked out, a
 * role change applies, and a branch HQ closed stops working, without waiting for the token to
 * expire. The token's shop must match the user's.
 */
async function lookUp(env: Env, claims: SessionClaims): Promise<Lookup> {
  const platform = createPlatformDb(env.DB);
  const [user, shop, deviceTrusted] = await Promise.all([
    platform.user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        shopId: true,
        role: true,
        phone: true,
        active: true,
        removedAt: true,
        sessionVersion: true,
        pinHash: true,
        pinDigits: true,
      },
    }),
    platform.shop.findUnique({ where: { id: claims.shopId }, select: { status: true, statusReason: true } }),
    securityRepo.stillTrusted(platform, claims.phone, claims.dv),
  ]);
  if (!user || !shop || user.shopId !== claims.shopId || user.removedAt) {
    return { ok: false, status: 401, body: { error: 'unauthorized' } };
  }
  if (!user.active) return { ok: false, status: 403, body: { error: 'account_disabled' } };
  // PIN changed or reset since this token was issued: this phone has to sign in again.
  if (claims.sv !== user.sessionVersion) return { ok: false, status: 401, body: { error: 'session_revoked' } };
  // Signed out on that phone, removed from Your phones, or a reset forgot it.
  if (!deviceTrusted) return { ok: false, status: 401, body: { error: 'session_revoked' } };
  const status = shop.status as BranchStatus;
  if (status === 'closed') {
    return { ok: false, status: 403, body: { error: 'branch_closed', message: branchClosedMessage(shop.statusReason) } };
  }
  const role: UserRole = toUserRole(user.role);
  const pinUpgrade = isSeniorRole(role) && user.pinHash != null && (user.pinDigits ?? 0) < SENIOR_PIN_DIGITS;
  return {
    ok: true,
    status,
    statusReason: shop.statusReason,
    pinUpgrade,
    session: { sub: user.id, shopId: user.shopId, role, phone: user.phone, sv: user.sessionVersion, dv: claims.dv },
  };
}

/**
 * What a paused branch can still change: finishing washes already open and closing the counter.
 * HQ's own work (/business) isn't the branch's, so HQ signed in at a paused branch still runs HQ.
 */
const PAUSED_WRITES = [
  /^\/auth\//,
  /^\/business(\/|$)/,
  /^\/jobs\/[^/]+\/(status|washers|sellers|pay|void|payment-method)$/,
  /^\/photos(\/[^/]+)?$/,
  /^\/cash\/day\/(float|close|reopen)$/,
  /^\/shop\/errors(\/seen)?$/,
];

function allowedWhilePaused(method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD') return true;
  return PAUSED_WRITES.some((re) => re.test(path));
}

/**
 * Screens that only read reuse a recent look-up of the same token for a few seconds: opening the
 * app fires several requests at once, and each would otherwise wait on the database just to
 * learn who's asking. Kept safe by:
 * - changes, and anything about the account, always looking up fresh, so a removed teammate can
 *   never change anything;
 * - forgetting a shop after any change it makes, or when HQ changes it (`forgetShop`).
 * Memory is per Worker instance, so a change made through another instance can still leave a
 * removed teammate (or a branch HQ just closed) able to *view* for up to REMEMBER_MS.
 */
const REMEMBER_MS = 30_000;
const REMEMBER_MAX = 1000;
const remembered = new Map<string, { at: number; shopId: string; lookup: Promise<Lookup> }>();

function canRemember(c: Context<{ Bindings: Env }>) {
  return c.req.method === 'GET' && !c.req.path.startsWith('/auth');
}

/** Drops every remembered look-up for a shop: its team, status or sessions may just have changed. */
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
    if (!r.ok) drop();
  }, drop);
  return lookup;
}

/**
 * Verifies the bearer token and who it belongs to (see `lookUp`); everything after this runs
 * against a client locked to the user's shop. An owner or manager still on a short PIN can only
 * reach /auth until they choose a 6-digit one, and a paused branch can only finish what's open.
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

  // A session only works from the phone it was issued to: a copied token alone is useless.
  if ((await deviceHash(c)) !== claims.dv) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const found = await lookUpOrRemember(c, token, claims);
  if (!found.ok) return c.json(found.body, found.status);
  const path = c.req.path;
  if (found.pinUpgrade && !path.startsWith('/auth/')) return c.json(pinUpgradeBody, 403);
  if (found.status === 'paused' && !allowedWhilePaused(c.req.method, path)) {
    return c.json({ error: 'branch_paused' as const, message: branchPausedMessage(found.statusReason) }, 403);
  }
  c.set('session', found.session);
  c.set('db', createShopDb(c.env.DB, found.session.shopId));
  c.set('branchStatus', found.status);
  try {
    await next();
  } finally {
    if (!canRemember(c)) forgetShop(found.session.shopId);
  }
}

/** Guards role-only actions: owner for prices, reports and money fixes; managers also run the team. */
export function requireRole(...roles: UserRole[]) {
  return async (c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> => {
    if (!roles.includes(c.get('session').role)) {
      return c.json({ error: 'forbidden' }, 403);
    }
    await next();
  };
}
