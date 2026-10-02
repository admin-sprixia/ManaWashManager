import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createPlatformDb,
  createShopDb,
  loginCodeRepo,
  platformSettingsRepo,
  shopRepo,
  userRepo,
  type DbClient,
} from '@mana/db';
import {
  checkPin,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_RESEND_SECONDS,
  LOGIN_CODE_TTL_MINUTES,
  LOGIN_CODES_PER_HOUR,
  MAX_SHOPS_PER_OWNER,
  normalizePhone,
  PIN_LOCK_MINUTES,
  PIN_MAX_ATTEMPTS,
  pinProblemMessage,
} from '@mana/domain';
import { issueSession, publicUser, type DbUser } from '../lib/session';
import {
  bypassWhatsAppOtp,
  generateLoginCode,
  hashLoginCode,
  loginCodeExpiry,
  sendLoginCodeOnWhatsApp,
  whatsappConfigured,
} from '../lib/loginCode';
import { hashPin, verifyPin } from '../lib/pin';
import {
  configuredRecoveryCode,
  devCode,
  recoveryCodeMatches,
  recoveryUsedKey,
  sameHex,
  sha256Hex,
  usesTestCodes,
} from '../lib/recovery';
import { createShopWithOwner } from '../lib/shops';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';

const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((p) => /^[6-9]\d{9}$/.test(p), 'Enter a valid 10-digit mobile number');

/** The branch the phone was last on, for owners with several; ignored if it isn't theirs. */
const shopHint = z.string().min(1).max(64).optional();
const pinLoginSchema = z.object({
  phone: phoneSchema,
  pin: z.string().min(4).max(6),
  shopId: shopHint,
});
const recoverSchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().min(1).max(64),
  shopId: shopHint,
});
const codeRequestSchema = z.object({ phone: phoneSchema });
const codeVerifySchema = z.object({
  phone: phoneSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'Enter the code'),
  shopId: shopHint,
});
const switchShopSchema = z.object({ shopId: z.string().min(1).max(64) });
const addShopSchema = z.object({
  shopName: z.string().trim().min(2, 'Enter the shop name').max(60),
  city: z.string().trim().max(40).optional(),
});
/** `currentPin` is required once a PIN exists — an unlocked, borrowed phone can't change it. */
const setPinSchema = z.object({ pin: z.string(), currentPin: z.string().min(4).max(6).optional() });
const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
});
const changePhoneSchema = z.object({ phone: phoneSchema, pin: z.string().min(4).max(6) });

/**
 * Sign-in starts before we know the shop: find the person by phone across every shop, then do
 * everything else through a client locked to their shop. An owner with several branches has a
 * row in each; PIN checks, lockouts and codes always use their first live row, so trying another
 * branch never buys extra guesses.
 */
async function findSignInUser(env: Env, phone: string) {
  const rows = await userRepo.listByPhone(createPlatformDb(env.DB), phone);
  const user = rows.find((r) => r.active) ?? rows[0];
  return user ? { user, rows, db: createShopDb(env.DB, user.shopId) } : null;
}

/** Signs in to the branch the phone asked for when it's one of theirs, else their first shop. */
async function signInTo(
  env: Env,
  found: NonNullable<Awaited<ReturnType<typeof findSignInUser>>>,
  shopId: string | undefined,
) {
  const pick = found.rows.find((r) => r.shopId === shopId && r.active) ?? found.user;
  const fresh = await userRepo.findById(createPlatformDb(env.DB), pick.id);
  return issueSession(fresh ?? pick, env);
}

function lockedUntil(user: DbUser, now: Date): Date | null {
  return user.pinLockedUntil && user.pinLockedUntil.getTime() > now.getTime()
    ? user.pinLockedUntil
    : null;
}

type GuardedCheck = { ok: true } | { lockedUntil: Date } | { attemptsLeft: number };

/**
 * Checks a PIN or the recovery code against the person's guess allowance. Both share one
 * counter, so alternating between them doesn't buy extra guesses. The guess is taken from the
 * allowance *before* `check` runs, so a burst of parallel requests gets at most PIN_MAX_ATTEMPTS
 * real checks — the rest are refused without being compared.
 */
async function guardedCheck(
  db: DbClient,
  user: DbUser,
  now: Date,
  check: () => Promise<boolean>,
): Promise<GuardedCheck> {
  const lockUntil = new Date(now.getTime() + PIN_LOCK_MINUTES * 60 * 1000);
  if (!(await userRepo.reservePinAttempt(db, user.id, PIN_MAX_ATTEMPTS, now))) {
    const state = await userRepo.settlePinFailure(db, user.id, PIN_MAX_ATTEMPTS, lockUntil);
    return { lockedUntil: state?.pinLockedUntil ?? lockUntil };
  }
  if (await check()) {
    await userRepo.clearPinFailures(db, user.id);
    return { ok: true };
  }
  const state = await userRepo.settlePinFailure(db, user.id, PIN_MAX_ATTEMPTS, lockUntil);
  if (state?.pinLockedUntil) return { lockedUntil: state.pinLockedUntil };
  return { attemptsLeft: Math.max(0, PIN_MAX_ATTEMPTS - (state?.pinFailedAttempts ?? PIN_MAX_ATTEMPTS)) };
}

function wrongPinMessage(result: { lockedUntil: Date } | { attemptsLeft: number }): string {
  if ('lockedUntil' in result) return 'Too many wrong PINs. Try again later.';
  const left = result.attemptsLeft;
  return `That PIN isn’t right. ${left} ${left === 1 ? 'try' : 'tries'} left.`;
}

// Routes are chained in one expression, and every JSON body is declared with `zValidator`
// rather than parsed by hand inside the handler — see the Naming conventions / Tech stack
// note on why: Hono RPC's client can only infer a route's `json` input type (and give the
// mobile app a compile-time error on a mismatch) when the schema is visible at the type
// level via `zValidator`. A hand-parsed `schema.parse(await c.req.json())` works at runtime
// but is invisible to `hc<AppType>()`, silently degrading the client's types to `unknown`.
//
// Everyone signs in day to day with phone + PIN. The owner gets in on a new phone (or after
// forgetting their PIN) with a code sent on WhatsApp; the one-time recovery code on the server is
// the emergency fallback if WhatsApp isn't reachable. Numbers without an account go through
// routes/signup.ts (start a shop, or ask to join one).
export const authRoutes = new Hono<{ Bindings: Env }>()
  // Tells the app what to ask for after the phone number: the PIN pad, a WhatsApp code (owner
  // with no PIN yet), or — for a number with no account — "start a shop or join one?".
  .post('/start', zValidator('json', codeRequestSchema), async (c) => {
    const { phone } = c.req.valid('json');
    const found = await findSignInUser(c.env, phone);
    if (!found) return c.json({ next: 'new' as const });
    const { user } = found;
    if (!user.active) return c.json({ error: 'account_disabled' as const }, 403);
    if (user.pinHash) return c.json({ next: 'pin' as const });
    if (user.role === 'owner') return c.json({ next: 'code' as const });
    return c.json(
      {
        error: 'pin_not_set' as const,
        message: 'No PIN for this number yet. Ask the owner to set one in More → Team.',
      },
      409,
    );
  })
  // After PIN_MAX_ATTEMPTS wrong tries the PIN is locked for PIN_LOCK_MINUTES; the owner can
  // reset a staff PIN from Team at any time.
  .post('/pin/login', zValidator('json', pinLoginSchema), async (c) => {
    const body = c.req.valid('json');
    const found = await findSignInUser(c.env, body.phone);
    if (!found) return c.json({ error: 'no_account' as const }, 404);
    const { user, db } = found;
    if (!user.active) return c.json({ error: 'account_disabled' as const }, 403);
    if (!user.pinHash) {
      // The owner sets their own PIN after a WhatsApp code; staff wait for the owner to set one.
      return c.json({ error: 'pin_not_set' as const, useCode: user.role === 'owner' }, 409);
    }

    const now = new Date();
    const locked = lockedUntil(user, now);
    if (locked) {
      return c.json({ error: 'pin_locked' as const, lockedUntil: locked.toISOString() }, 423);
    }

    const pinHash = user.pinHash;
    const result = await guardedCheck(db, user, now, () => verifyPin(body.pin, pinHash));
    if ('lockedUntil' in result) {
      return c.json(
        { error: 'pin_locked' as const, lockedUntil: result.lockedUntil.toISOString() },
        423,
      );
    }
    if ('attemptsLeft' in result) {
      return c.json({ error: 'invalid_pin' as const, attemptsLeft: result.attemptsLeft }, 401);
    }
    return c.json(await signInTo(c.env, found, body.shopId));
  })
  // Owner only. Clears the old PIN, so the app goes straight to "set a new PIN".
  .post('/recover', zValidator('json', recoverSchema), async (c) => {
    const body = c.req.valid('json');
    const denied = {
      error: 'recovery_denied' as const,
      message: 'That recovery code isn’t right for this number.',
    };

    const dev = usesTestCodes(c.env, c.req.url);
    const expected = configuredRecoveryCode(c.env, c.req.url);
    if (!expected) {
      return c.json(
        {
          error: 'recovery_not_configured' as const,
          message: 'Recovery isn’t set up on the server yet.',
        },
        503,
      );
    }

    const found = await findSignInUser(c.env, body.phone);
    // Same answer for "no such owner" and "wrong code", so the endpoint can't be used to find
    // out which numbers belong to the owner.
    if (!found || found.user.role !== 'owner') return c.json(denied, 401);
    const { user, db } = found;
    if (!user.active) return c.json({ error: 'account_disabled' as const }, 403);

    const now = new Date();
    const locked = lockedUntil(user, now);
    if (locked) {
      return c.json({ error: 'pin_locked' as const, lockedUntil: locked.toISOString() }, 423);
    }

    const result = await guardedCheck(db, user, now, () => recoveryCodeMatches(body.code, expected));
    if ('lockedUntil' in result) {
      return c.json(
        { error: 'pin_locked' as const, lockedUntil: result.lockedUntil.toISOString() },
        423,
      );
    }
    if ('attemptsLeft' in result) {
      return c.json({ ...denied, attemptsLeft: result.attemptsLeft }, 401);
    }

    if (!dev) {
      const codeHash = await sha256Hex(expected);
      const claimed = await platformSettingsRepo.claim(
        createPlatformDb(c.env.DB),
        recoveryUsedKey(codeHash),
        user.id,
      );
      if (!claimed) {
        return c.json(
          {
            error: 'recovery_used' as const,
            message: 'This recovery code was already used. Set a new one on the server first.',
          },
          410,
        );
      }
    }

    await userRepo.setPinHashForPhone(createPlatformDb(c.env.DB), user.phone, null);
    return c.json(await signInTo(c.env, found, body.shopId));
  })
  // Owner only: sends a sign-in code on WhatsApp. At most one every LOGIN_CODE_RESEND_SECONDS
  // and LOGIN_CODES_PER_HOUR an hour, which caps both guessing and message cost.
  .post('/code/request', zValidator('json', codeRequestSchema), async (c) => {
    const { phone } = c.req.valid('json');
    const found = await findSignInUser(c.env, phone);
    if (!found) return c.json({ error: 'no_account' as const }, 404);
    const { user, db } = found;
    if (!user.active) return c.json({ error: 'account_disabled' as const }, 403);
    if (user.role !== 'owner') {
      return c.json(
        {
          error: 'owner_only' as const,
          message: 'WhatsApp codes are only for the owner. Ask the owner to set or reset your PIN.',
        },
        403,
      );
    }

    const now = new Date();
    const recent = await loginCodeRepo.listSince(
      db,
      user.id,
      new Date(now.getTime() - 60 * 60 * 1000),
    );
    const latest = recent[0];
    if (latest) {
      const wait = Math.ceil(
        LOGIN_CODE_RESEND_SECONDS - (now.getTime() - latest.createdAt.getTime()) / 1000,
      );
      if (wait > 0) return c.json({ error: 'too_soon' as const, retryAfter: wait }, 429);
    }
    if (recent.length >= LOGIN_CODES_PER_HOUR) {
      const oldest = recent[recent.length - 1]!;
      const retryAfter = Math.ceil(
        (oldest.createdAt.getTime() + 60 * 60 * 1000 - now.getTime()) / 1000,
      );
      return c.json(
        {
          error: 'too_many' as const,
          retryAfter,
          message: `Too many codes asked for. Try again in ${Math.ceil(retryAfter / 60)} min, or use the recovery code.`,
        },
        429,
      );
    }

    const bypass = bypassWhatsAppOtp(c.env, c.req.url);
    if (!bypass && !whatsappConfigured(c.env)) {
      return c.json(
        {
          error: 'code_not_configured' as const,
          message: 'WhatsApp codes aren’t set up on the server yet. Use the recovery code instead.',
        },
        503,
      );
    }

    const code = bypass ? devCode(c.env) : generateLoginCode();
    const row = await loginCodeRepo.create(db, {
      userId: user.id,
      codeHash: await hashLoginCode(code, user.id, c.env.JWT_SECRET),
      expiresAt: loginCodeExpiry(now),
    });
    await loginCodeRepo.retireOthers(db, user.id, row.id, now);

    if (!bypass && !(await sendLoginCodeOnWhatsApp(c.env, phone, code))) {
      await loginCodeRepo.consume(db, row.id, now);
      return c.json(
        {
          error: 'send_failed' as const,
          message:
            'Couldn’t send the WhatsApp message. Try again in a minute, or use the recovery code.',
        },
        502,
      );
    }
    return c.json({
      sent: true as const,
      expiresInMinutes: LOGIN_CODE_TTL_MINUTES,
      resendAfter: LOGIN_CODE_RESEND_SECONDS,
    });
  })
  // Owner only. Like the recovery code, a correct code clears the old PIN so the app goes
  // straight to "set a new PIN".
  .post('/code/verify', zValidator('json', codeVerifySchema), async (c) => {
    const { phone, code, shopId } = c.req.valid('json');
    const found = await findSignInUser(c.env, phone);
    if (!found || found.user.role !== 'owner') {
      return c.json({ error: 'invalid_code' as const, message: 'That code isn’t right.' }, 401);
    }
    const { user, db } = found;
    if (!user.active) return c.json({ error: 'account_disabled' as const }, 403);

    const now = new Date();
    const expired = {
      error: 'code_expired' as const,
      message: 'This code has expired or was replaced. Tap “Send a new code”.',
    };
    const live = await loginCodeRepo.findLive(db, user.id, now, LOGIN_CODE_MAX_ATTEMPTS);
    if (!live) return c.json(expired, 410);

    const attemptsLeft = await loginCodeRepo.reserveGuess(db, live.id, LOGIN_CODE_MAX_ATTEMPTS);
    if (attemptsLeft == null) {
      return c.json({ ...expired, message: 'Too many wrong tries. Tap “Send a new code”.' }, 410);
    }
    const matches = sameHex(await hashLoginCode(code, user.id, c.env.JWT_SECRET), live.codeHash);
    if (!matches) {
      if (attemptsLeft <= 0) {
        return c.json({ ...expired, message: 'Too many wrong tries. Tap “Send a new code”.' }, 410);
      }
      return c.json(
        { error: 'invalid_code' as const, message: 'That code isn’t right.', attemptsLeft },
        401,
      );
    }
    if (!(await loginCodeRepo.consume(db, live.id, now))) return c.json(expired, 410);

    await userRepo.setPinHashForPhone(createPlatformDb(c.env.DB), user.phone, null);
    return c.json(await signInTo(c.env, found, shopId));
  })
  .get('/me', requireAuth, async (c) => {
    const db = c.get('db');
    const user = await userRepo.findById(db, c.get('session').sub);
    if (!user) return c.json({ error: 'unauthorized' as const }, 401);
    return c.json(publicUser(user));
  })
  // First PIN after a WhatsApp/recovery code, or a change from More. Every other phone signed in
  // as this person is signed out; this one gets a fresh session back.
  .put('/pin', requireAuth, zValidator('json', setPinSchema), async (c) => {
    const { pin, currentPin } = c.req.valid('json');
    const problem = checkPin(pin);
    if (problem) {
      return c.json({ error: 'weak_pin' as const, message: pinProblemMessage(problem) }, 400);
    }
    const session = c.get('session');
    const db = c.get('db');
    const me = await userRepo.findById(db, session.sub);
    if (!me) return c.json({ error: 'unauthorized' as const }, 401);
    if (me.pinHash) {
      if (!currentPin) {
        return c.json({ error: 'current_pin_required' as const, message: 'Enter your current PIN first.' }, 400);
      }
      const now = new Date();
      const locked = lockedUntil(me, now);
      if (locked) {
        return c.json({ error: 'pin_locked' as const, message: 'Too many wrong PINs. Try again later.' }, 423);
      }
      const pinHash = me.pinHash;
      const result = await guardedCheck(db, me, now, () => verifyPin(currentPin, pinHash));
      if (!('ok' in result)) {
        return c.json({ error: 'invalid_pin' as const, message: wrongPinMessage(result) }, 401);
      }
    }
    await userRepo.setPinHashForPhone(createPlatformDb(c.env.DB), session.phone, await hashPin(pin));
    const user = await userRepo.findById(db, session.sub);
    if (!user) return c.json({ error: 'unauthorized' as const }, 401);
    return c.json(await issueSession(user, c.env));
  })
  .patch('/me', requireAuth, zValidator('json', updateProfileSchema), async (c) => {
    const { name } = c.req.valid('json');
    const session = c.get('session');
    await userRepo.updateForPhone(createPlatformDb(c.env.DB), session.phone, { name });
    const user = await userRepo.findById(c.get('db'), session.sub);
    if (!user) return c.json({ error: 'unauthorized' as const }, 401);
    return c.json(publicUser(user));
  })
  // The phone number is the sign-in identity, so moving it needs the current PIN — otherwise a
  // borrowed, unlocked phone could redirect someone's account.
  .post('/me/phone', requireAuth, zValidator('json', changePhoneSchema), async (c) => {
    const { phone, pin } = c.req.valid('json');
    const db = c.get('db');
    const me = await userRepo.findById(db, c.get('session').sub);
    if (!me) return c.json({ error: 'unauthorized' as const }, 401);
    if (me.phone === phone) {
      return c.json({ error: 'same_phone' as const, message: 'That’s already your number.' }, 400);
    }
    if (!me.pinHash) {
      return c.json(
        { error: 'pin_not_set' as const, message: 'Set a PIN first, then change your number.' },
        409,
      );
    }

    const now = new Date();
    const locked = lockedUntil(me, now);
    if (locked) {
      return c.json(
        { error: 'pin_locked' as const, message: 'Too many wrong PINs. Try again later.' },
        423,
      );
    }
    const pinHash = me.pinHash;
    const result = await guardedCheck(db, me, now, () => verifyPin(pin, pinHash));
    if (!('ok' in result)) return c.json({ error: 'invalid_pin' as const, message: wrongPinMessage(result) }, 401);

    // Phones are unique across every shop, so check them all — without saying which shop.
    const taken = await userRepo.findByPhone(createPlatformDb(c.env.DB), phone);
    if (taken && taken.id !== me.id) {
      return c.json(
        {
          error: 'phone_taken' as const,
          message: 'This number is already registered to another account.',
        },
        409,
      );
    }
    await userRepo.updateForPhone(createPlatformDb(c.env.DB), me.phone, { phone });
    const user = await userRepo.findById(db, me.id);
    if (!user) return c.json({ error: 'unauthorized' as const }, 401);
    return c.json(await issueSession(user, c.env));
  })
  // Every shop this person can open with one sign-in. Staff have one; an owner one per branch.
  .get('/shops', requireAuth, async (c) => {
    const session = c.get('session');
    const platform = createPlatformDb(c.env.DB);
    const rows = (await userRepo.listByPhone(platform, session.phone)).filter((r) => r.active);
    const shops = await shopRepo.listByIds(
      platform,
      rows.map((r) => r.shopId),
    );
    const byId = new Map(shops.map((s) => [s.id, s]));
    return c.json({
      shops: rows.flatMap((r) => {
        const shop = byId.get(r.shopId);
        if (!shop) return [];
        return [
          {
            shopId: shop.id,
            name: shop.name,
            city: shop.city,
            code: shop.code,
            role: r.role === 'owner' ? ('owner' as const) : ('staff' as const),
            current: r.shopId === session.shopId,
          },
        ];
      }),
      canAdd:
        session.role === 'owner' &&
        rows.every((r) => r.role === 'owner') &&
        rows.length < MAX_SHOPS_PER_OWNER,
    });
  })
  // Same person, another of their branches: no PIN again, since they've already proved who they are.
  .post('/switch', requireAuth, zValidator('json', switchShopSchema), async (c) => {
    const { shopId } = c.req.valid('json');
    const session = c.get('session');
    const rows = await userRepo.listByPhone(createPlatformDb(c.env.DB), session.phone);
    const target = rows.find((r) => r.shopId === shopId);
    if (!target) {
      return c.json({ error: 'not_found' as const, message: 'You aren’t part of that shop.' }, 404);
    }
    if (!target.active) {
      return c.json(
        { error: 'account_disabled' as const, message: 'Your access to that shop is turned off.' },
        403,
      );
    }
    return c.json(await issueSession(target, c.env));
  })
  // An owner opens another branch: its own shop ID, team, prices, data and free trial, with them
  // as owner on the same phone and PIN. Staff can't — their number belongs to their shop.
  .post(
    '/shops',
    requireAuth,
    requireRole('owner'),
    zValidator('json', addShopSchema),
    async (c) => {
      const body = c.req.valid('json');
      const session = c.get('session');
      const platform = createPlatformDb(c.env.DB);
      const rows = await userRepo.listByPhone(platform, session.phone);
      if (!rows.every((r) => r.role === 'owner')) {
        return c.json(
          { error: 'forbidden' as const, message: 'Only owners can open another shop.' },
          403,
        );
      }
      if (rows.length >= MAX_SHOPS_PER_OWNER) {
        return c.json(
          {
            error: 'too_many_shops' as const,
            message: `You can run up to ${MAX_SHOPS_PER_OWNER} shops on one number. Contact support for more.`,
          },
          400,
        );
      }
      const me = rows.find((r) => r.id === session.sub);
      if (!me?.pinHash) {
        return c.json({ error: 'pin_not_set' as const, message: 'Set your PIN first.' }, 409);
      }
      const owner = await createShopWithOwner(c.env, {
        shopName: body.shopName,
        city: body.city || null,
        ownerName: me.name,
        phone: me.phone,
        pinHash: me.pinHash,
      });
      return c.json(await issueSession(owner, c.env), 201);
    },
  );
