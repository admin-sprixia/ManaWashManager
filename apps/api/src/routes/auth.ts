import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  catalogRepo,
  createPlatformDb,
  createShopDb,
  loginCodeRepo,
  securityRepo,
  shopRepo,
  userRepo,
  type DbClient,
} from '@mana/db';
import {
  branchClosedMessage,
  checkPin,
  isSeniorRole,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_RESEND_SECONDS,
  LOGIN_CODE_TTL_MINUTES,
  LOGIN_CODES_PER_HOUR,
  normalizePhone,
  PIN_LOCK_MINUTES,
  PIN_LOCK_STEPS_MINUTES,
  PIN_MAX_ATTEMPTS,
  pinProblemMessage,
  toUserRole,
} from '@mana/domain';
import { issueSession, publicUser, type DbUser } from '../lib/session';
import { deviceHash, deviceLabel } from '../lib/device';
import { verifySessionToken } from '../lib/jwt';
import {
  bypassWhatsAppOtp,
  generateLoginCode,
  hashLoginCode,
  loginCodeExpiry,
  sendLoginCodeOnWhatsApp,
  whatsappConfigured,
} from '../lib/loginCode';
import { checkPhoneCode, sendPhoneCode } from '../lib/phoneCode';
import { phoneBusy, withPhoneLock } from '../lib/phoneLock';
import { hashPin, verifyPin } from '../lib/pin';
import { devCode, sameHex } from '../lib/recovery';
import { forgetShop, requireAuth } from '../middleware/auth';
import type { Env } from '../types';

const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((p) => /^[6-9]\d{9}$/.test(p), 'Enter a valid 10-digit mobile number');

/** The branch the phone was last on, for people at several; ignored if it isn't theirs. */
const shopHint = z.string().min(1).max(64).optional();
const pinLoginSchema = z.object({
  phone: phoneSchema,
  pin: z.string().min(4).max(6),
  shopId: shopHint,
});
const codeRequestSchema = z.object({ phone: phoneSchema });
/** `reset`: for a forgotten PIN, so an owner on an unknown phone is told before a code is sent. */
const loginCodeRequestSchema = z.object({ phone: phoneSchema, purpose: z.enum(['device', 'reset']).optional() });
const codeVerifySchema = z.object({
  phone: phoneSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'Enter the code'),
  shopId: shopHint,
  /**
   * `device`: proves the number on a new phone, which is then trusted and goes on to the PIN.
   * `reset`: forgot the PIN (or has none) — clears it and signs in to choose a new one.
   */
  purpose: z.enum(['device', 'reset']).default('reset'),
});
const switchShopSchema = z.object({ shopId: z.string().min(1).max(64) });
/** `currentPin` is required once a PIN exists — an unlocked, borrowed phone can't change it. */
const setPinSchema = z.object({ pin: z.string(), currentPin: z.string().min(4).max(6).optional() });
const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
});
const changePhoneSchema = z.object({
  phone: phoneSchema,
  pin: z.string().min(4).max(6),
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'Enter the code sent to your new number'),
});

const phoneTakenBody = {
  error: 'phone_taken' as const,
  message: 'This number is already registered to another account.',
};

/** A number-change code belongs to this person and this new number only. */
function phoneChangeSubject(userId: string, phone: string) {
  return `phone:${userId}:${phone}`;
}

/** Why this person can't move to `phone` right now, if anything. */
function phoneChangeProblem(me: DbUser, phone: string) {
  if (me.phone === phone) {
    return { status: 400 as const, body: { error: 'same_phone' as const, message: 'That’s already your number.' } };
  }
  if (!me.pinHash) {
    return {
      status: 409 as const,
      body: { error: 'pin_not_set' as const, message: 'Set a PIN first, then change your number.' },
    };
  }
  return null;
}

/**
 * Sign-in starts before we know the shop: find the person by phone across every shop, then do
 * everything else through a client locked to their shop. Someone at several branches has a row
 * in each; PIN checks, lockouts and codes always use their first live row, so trying another
 * branch never buys extra guesses.
 */
async function findSignInUser(env: Env, phone: string) {
  const rows = await userRepo.listByPhone(createPlatformDb(env.DB), phone);
  const user = rows.find((r) => r.active) ?? rows[0];
  return user ? { user, rows, db: createShopDb(env.DB, user.shopId) } : null;
}

/**
 * Two rows on one number are the same person when they share the PIN (set, changed and cleared
 * on every row together, and copied onto a new row when they join another branch). Anything else
 * (a stray row from a race, say) must never be reachable from the other one's sign-in.
 */
function samePerson(a: DbUser | undefined, b: DbUser) {
  return !!a && a.pinHash === b.pinHash;
}

type Found = NonNullable<Awaited<ReturnType<typeof findSignInUser>>>;

/**
 * The person's rows they can sign in to right now: turned on, the same person, and in a branch
 * HQ hasn't closed. When every branch is closed, says why.
 */
async function usableRows(env: Env, found: Found) {
  const candidates = found.rows.filter((r) => r.active && (r.id === found.user.id || samePerson(found.user, r)));
  const shops = await shopRepo.listByIds(createPlatformDb(env.DB), candidates.map((r) => r.shopId));
  const closed = new Map(shops.filter((s) => s.status === 'closed').map((s) => [s.id, s.statusReason]));
  const rows = candidates.filter((r) => !closed.has(r.shopId));
  if (rows.length > 0) return { rows };
  const reason = closed.get(found.user.shopId) ?? null;
  return { closed: { error: 'branch_closed' as const, message: branchClosedMessage(reason) } };
}

/** The branch the phone asked for when it's one of theirs, else their first open one. */
function pickRow(rows: DbUser[], shopId: string | undefined) {
  return rows.find((r) => r.shopId === shopId) ?? rows[0]!;
}

async function sessionFor(env: Env, row: DbUser, device: string | null) {
  const user = (await userRepo.findById(createPlatformDb(env.DB), row.id)) ?? row;
  return issueSession(user, env, device);
}

/** Owners, managers and HQ: 6-digit PINs, and a self-reset only on a phone they've used. */
async function isSeniorPerson(platform: DbClient, phone: string, rows: DbUser[]) {
  return rows.some((r) => isSeniorRole(toUserRole(r.role))) || (await catalogRepo.isAdminAnywhere(platform, phone));
}

const resetNeedsKnownPhone = {
  error: 'reset_needs_known_phone' as const,
  message:
    'For safety, owners, managers and HQ can only reset their own PIN on a phone they’ve signed in on before. Use that phone, or ask the person above you (the owner, Mana Wash HQ, or Sprixia for HQ) to reset it.',
};

/**
 * Whether a WhatsApp code alone may clear this person's PIN on this phone. Staff, and anyone
 * without a PIN yet, always may. Owners, managers and HQ need a phone where their PIN has been
 * used: a SIM swap or a hijacked WhatsApp on its own isn't enough to take over a branch.
 */
async function maySelfReset(platform: DbClient, found: Found, device: string | null) {
  if (!found.user.pinHash) return true;
  if (!(await isSeniorPerson(platform, found.user.phone, found.rows))) return true;
  return device != null && (await securityRepo.isPinConfirmed(platform, found.user.phone, device));
}

const untrustedDevice = {
  error: 'device_not_trusted' as const,
  message: 'This phone is new for your number. Confirm with the WhatsApp code first.',
};

function lockedUntil(user: DbUser, now: Date): Date | null {
  return user.pinLockedUntil && user.pinLockedUntil.getTime() > now.getTime()
    ? user.pinLockedUntil
    : null;
}

type GuardedCheck = { ok: true } | { lockedUntil: Date } | { attemptsLeft: number };

/**
 * Checks a PIN against the person's guess allowance. The guess is taken from the allowance
 * *before* `check` runs, so a burst of parallel requests gets at most PIN_MAX_ATTEMPTS real
 * checks — the rest are refused without being compared.
 */
async function guardedCheck(
  db: DbClient,
  user: DbUser,
  now: Date,
  check: () => Promise<boolean>,
): Promise<GuardedCheck> {
  if (!(await userRepo.reservePinAttempt(db, user.id, PIN_MAX_ATTEMPTS, now))) {
    const state = await userRepo.settlePinFailure(db, user.id, PIN_MAX_ATTEMPTS, now, PIN_LOCK_STEPS_MINUTES);
    return { lockedUntil: state?.pinLockedUntil ?? new Date(now.getTime() + PIN_LOCK_MINUTES * 60 * 1000) };
  }
  if (await check()) {
    await userRepo.clearPinFailures(db, user.id);
    return { ok: true };
  }
  const state = await userRepo.settlePinFailure(db, user.id, PIN_MAX_ATTEMPTS, now, PIN_LOCK_STEPS_MINUTES);
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
// Everyone signs in day to day with phone + PIN, on a phone their number has trusted. A new phone
// (or a forgotten PIN) is confirmed with a code sent on WhatsApp. Nobody can sign in for someone
// else: an owner or HQ can only clear a PIN (routes/team.ts, routes/business.ts), and the person
// then proves their number with a code. Numbers without an account ask to join a branch through
// routes/signup.ts; only HQ opens branches (routes/business.ts).
export const authRoutes = new Hono<{ Bindings: Env }>()
  // Tells the app what to ask for after the phone number: the PIN pad, a WhatsApp code first (a
  // new phone, or no PIN yet), or — for a number with no account — "join a branch".
  .post('/start', zValidator('json', codeRequestSchema), async (c) => {
    const { phone } = c.req.valid('json');
    const found = await findSignInUser(c.env, phone);
    if (!found) {
      return c.json({ next: 'new' as const });
    }
    const { user } = found;
    if (!user.active) return c.json({ error: 'account_disabled' as const }, 403);
    const usable = await usableRows(c.env, found);
    if ('closed' in usable) return c.json(usable.closed, 403);
    if (!user.pinHash) return c.json({ next: 'code' as const });
    const device = await deviceHash(c);
    if (device && (await securityRepo.isTrusted(createPlatformDb(c.env.DB), user.phone, device))) {
      return c.json({ next: 'pin' as const });
    }
    return c.json({ next: 'verify_device' as const });
  })
  // Only on a trusted phone, checked before the PIN so an unknown phone can't spend guesses.
  // After PIN_MAX_ATTEMPTS wrong tries the PIN is locked for PIN_LOCK_MINUTES.
  .post('/pin/login', zValidator('json', pinLoginSchema), async (c) => {
    const body = c.req.valid('json');
    const found = await findSignInUser(c.env, body.phone);
    if (!found) return c.json({ error: 'no_account' as const }, 404);
    const { user, db } = found;
    if (!user.active) return c.json({ error: 'account_disabled' as const }, 403);
    const platform = createPlatformDb(c.env.DB);
    const device = await deviceHash(c);
    if (!device || !(await securityRepo.isTrusted(platform, user.phone, device))) {
      return c.json(untrustedDevice, 403);
    }
    if (!user.pinHash) {
      return c.json({ error: 'pin_not_set' as const, useCode: true }, 409);
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
    const usable = await usableRows(c.env, found);
    if ('closed' in usable) return c.json(usable.closed, 403);
    if (user.pinDigits == null) await userRepo.notePinDigits(platform, user.phone, body.pin.length);
    await securityRepo.trust(platform, user.phone, device, { now, label: deviceLabel(c), pinConfirmed: true });
    return c.json(await sessionFor(c.env, pickRow(usable.rows, body.shopId), device));
  })
  // Sends a sign-in code on WhatsApp. At most one every LOGIN_CODE_RESEND_SECONDS and
  // LOGIN_CODES_PER_HOUR an hour, which caps both guessing and message cost.
  .post('/code/request', zValidator('json', loginCodeRequestSchema), async (c) => {
    const { phone, purpose } = c.req.valid('json');
    const found = await findSignInUser(c.env, phone);
    if (!found) return c.json({ error: 'no_account' as const }, 404);
    const { user, db } = found;
    if (!user.active) return c.json({ error: 'account_disabled' as const }, 403);
    if (purpose === 'reset' && !(await maySelfReset(createPlatformDb(c.env.DB), found, await deviceHash(c)))) {
      return c.json(resetNeedsKnownPhone, 403);
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
          message: `Too many codes asked for. Try again in ${Math.ceil(retryAfter / 60)} min.`,
        },
        429,
      );
    }

    const bypass = bypassWhatsAppOtp(c.env, c.req.url);
    if (!bypass && !whatsappConfigured(c.env)) {
      return c.json(
        {
          error: 'code_not_configured' as const,
          message: 'WhatsApp codes aren’t set up on the server yet. Call Mana Wash support.',
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
          message: 'Couldn’t send the WhatsApp message. Try again in a minute.',
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
  // A correct code trusts this phone for the number. For a new phone that's all (the PIN comes
  // next); for a forgotten or reset PIN it also clears the PIN and signs in to choose a new one,
  // telling the person if someone else reset it.
  .post('/code/verify', zValidator('json', codeVerifySchema), async (c) => {
    const { phone, code, shopId, purpose } = c.req.valid('json');
    const found = await findSignInUser(c.env, phone);
    if (!found) {
      return c.json({ error: 'invalid_code' as const, message: 'That code isn’t right.' }, 401);
    }
    const { user, db } = found;
    if (!user.active) return c.json({ error: 'account_disabled' as const }, 403);
    const device = await deviceHash(c);
    if (purpose === 'device' && !device) {
      return c.json({ error: 'device_key_required' as const, message: 'Update the app, then try again.' }, 400);
    }
    const platform = createPlatformDb(c.env.DB);
    if (purpose === 'reset' && !(await maySelfReset(platform, found, device))) {
      return c.json(resetNeedsKnownPhone, 403);
    }

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

    const usable = await usableRows(c.env, found);
    if ('closed' in usable) return c.json(usable.closed, 403);
    if (device) await securityRepo.trust(platform, user.phone, device, { now, label: deviceLabel(c) });
    if (purpose === 'device' && user.pinHash) return c.json({ next: 'pin' as const });

    const reset = await securityRepo.resetSince(platform, user.phone, user.pinSetAt);
    await userRepo.setPinHashForPhone(platform, user.phone, null, now);
    const session = await sessionFor(c.env, pickRow(usable.rows, shopId), device);
    return c.json({
      ...session,
      resetBy: reset ? { by: reset.byLabel, at: reset.createdAt.toISOString() } : null,
    });
  })
  // Stops trusting this phone for the number. Only needs a token this server signed (even an
  // old one), so a phone that was signed out remotely can still forget itself.
  .post('/signout', async (c) => {
    const header = c.req.header('authorization');
    const device = await deviceHash(c);
    if (header?.startsWith('Bearer ') && device) {
      try {
        const claims = await verifySessionToken(header.slice('Bearer '.length), c.env.JWT_SECRET);
        await securityRepo.forget(createPlatformDb(c.env.DB), claims.phone, device);
      } catch {
        // Not a token of ours: nothing to forget.
      }
    }
    return c.json({ ok: true as const });
  })
  .get('/me', requireAuth, async (c) => {
    const db = c.get('db');
    const user = await userRepo.findById(db, c.get('session').sub);
    if (!user) return c.json({ error: 'unauthorized' as const }, 401);
    return c.json(publicUser(user));
  })
  // First PIN after a WhatsApp code, a change from More, or the move to 6 digits. Owners,
  // managers and HQ (in any of their branches) need 6 digits. Every other phone signed in as this
  // person is signed out; this one gets a fresh session back.
  .put('/pin', requireAuth, zValidator('json', setPinSchema), async (c) => {
    const { pin, currentPin } = c.req.valid('json');
    const session = c.get('session');
    const db = c.get('db');
    const platform = createPlatformDb(c.env.DB);
    const rows = await userRepo.listByPhone(platform, session.phone);
    const senior = await isSeniorPerson(platform, session.phone, rows);
    const problem = checkPin(pin, senior);
    if (problem) {
      return c.json({ error: 'weak_pin' as const, message: pinProblemMessage(problem) }, 400);
    }
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
    await userRepo.setPinHashForPhone(platform, session.phone, { hash: await hashPin(pin), digits: pin.length });
    if (session.dv) await securityRepo.trust(platform, session.phone, session.dv, { label: deviceLabel(c), pinConfirmed: true });
    const user = await userRepo.findById(db, session.sub);
    if (!user) return c.json({ error: 'unauthorized' as const }, 401);
    return c.json(await issueSession(user, c.env, session.dv));
  })
  .patch('/me', requireAuth, zValidator('json', updateProfileSchema), async (c) => {
    const { name } = c.req.valid('json');
    const session = c.get('session');
    await userRepo.updateForPhone(createPlatformDb(c.env.DB), session.phone, { name });
    const user = await userRepo.findById(c.get('db'), session.sub);
    if (!user) return c.json({ error: 'unauthorized' as const }, 401);
    return c.json(publicUser(user));
  })
  // Step 1 of moving to a new number: a WhatsApp code to the *new* number, so nobody can move an
  // account to a number they don't have (a typo would lock the person out).
  .post('/me/phone/code', requireAuth, zValidator('json', codeRequestSchema), async (c) => {
    const { phone } = c.req.valid('json');
    const me = await userRepo.findById(c.get('db'), c.get('session').sub);
    if (!me) return c.json({ error: 'unauthorized' as const }, 401);
    const problem = phoneChangeProblem(me, phone);
    if (problem) return c.json(problem.body, problem.status);
    const platform = createPlatformDb(c.env.DB);
    const taken = await userRepo.findByPhone(platform, phone);
    if (taken && taken.id !== me.id) return c.json(phoneTakenBody, 409);

    const sent = await sendPhoneCode({
      env: c.env,
      requestUrl: c.req.url,
      ip: c.req.header('cf-connecting-ip') ?? null,
      phone,
      purpose: 'phone',
      subject: phoneChangeSubject(me.id, phone),
    });
    if (!sent.ok) return c.json(sent.body, sent.status);
    return c.json(sent.body);
  })
  // Step 2: the phone number is the sign-in identity, so moving it needs the current PIN (a
  // borrowed, unlocked phone can't redirect the account) and the code sent to the new number.
  .post('/me/phone', requireAuth, zValidator('json', changePhoneSchema), async (c) => {
    const { phone, pin, code } = c.req.valid('json');
    const db = c.get('db');
    const me = await userRepo.findById(db, c.get('session').sub);
    if (!me) return c.json({ error: 'unauthorized' as const }, 401);
    const problem = phoneChangeProblem(me, phone);
    if (problem) return c.json(problem.body, problem.status);

    const now = new Date();
    const locked = lockedUntil(me, now);
    if (locked) {
      return c.json(
        { error: 'pin_locked' as const, message: 'Too many wrong PINs. Try again later.' },
        423,
      );
    }
    const pinHash = me.pinHash!;
    const result = await guardedCheck(db, me, now, () => verifyPin(pin, pinHash));
    if (!('ok' in result)) return c.json({ error: 'invalid_pin' as const, message: wrongPinMessage(result) }, 401);

    const checked = await checkPhoneCode({
      env: c.env,
      phone,
      purpose: 'phone',
      subject: phoneChangeSubject(me.id, phone),
      code,
    });
    if (!checked.ok) return c.json(checked.body, checked.status);
    const platform = createPlatformDb(c.env.DB);

    // Phones are unique across every shop, so check them all — without saying which shop.
    const moved = await withPhoneLock(c.env, phone, async () => {
      const taken = await userRepo.findByPhone(platform, phone);
      if (taken && taken.id !== me.id) return false;
      await userRepo.movePhone(platform, me.phone, phone);
      return true;
    });
    if (moved === null) return c.json(phoneBusy, 409);
    if (!moved) return c.json(phoneTakenBody, 409);
    // Phones trusted for the old number aren't trusted for the new one; this phone just proved it.
    await securityRepo.forgetAll(platform, me.phone);
    const device = await deviceHash(c);
    if (device) await securityRepo.trust(platform, phone, device, { now, label: deviceLabel(c), pinConfirmed: true });
    for (const r of await userRepo.listByPhone(platform, phone)) forgetShop(r.shopId);
    const user = await userRepo.findById(db, me.id);
    if (!user) return c.json({ error: 'unauthorized' as const }, 401);
    return c.json(await issueSession(user, c.env, device));
  })
  // Every branch this person can open with one sign-in (closed ones left out).
  .get('/shops', requireAuth, async (c) => {
    const session = c.get('session');
    const platform = createPlatformDb(c.env.DB);
    const all = await userRepo.listByPhone(platform, session.phone);
    const me = all.find((r) => r.id === session.sub);
    const rows = all.filter((r) => r.active && (r.id === session.sub || samePerson(me, r)));
    const shops = await shopRepo.listByIds(
      platform,
      rows.map((r) => r.shopId),
    );
    const byId = new Map(shops.map((s) => [s.id, s]));
    return c.json({
      shops: rows.flatMap((r) => {
        const shop = byId.get(r.shopId);
        if (!shop || shop.status === 'closed') return [];
        return [
          {
            shopId: shop.id,
            name: shop.name,
            city: shop.city,
            code: shop.code,
            role: toUserRole(r.role),
            status: shop.status as 'active' | 'paused',
            current: r.shopId === session.shopId,
          },
        ];
      }),
    });
  })
  // Same person, another of their branches: no PIN again, since they've already proved who they are.
  .post('/switch', requireAuth, zValidator('json', switchShopSchema), async (c) => {
    const { shopId } = c.req.valid('json');
    const session = c.get('session');
    const rows = await userRepo.listByPhone(createPlatformDb(c.env.DB), session.phone);
    const me = rows.find((r) => r.id === session.sub);
    // Only the same person's other branches: a row there with the same PIN.
    const target = rows.find(
      (r) => r.shopId === shopId && (r.id === session.sub || samePerson(me, r)),
    );
    if (!target) {
      return c.json({ error: 'not_found' as const, message: 'You aren’t part of that shop.' }, 404);
    }
    if (!target.active) {
      return c.json(
        { error: 'account_disabled' as const, message: 'Your access to that shop is turned off.' },
        403,
      );
    }
    const shop = await shopRepo.statusOf(createPlatformDb(c.env.DB), shopId);
    if (shop?.status === 'closed') {
      return c.json({ error: 'branch_closed' as const, message: branchClosedMessage(shop.statusReason) }, 403);
    }
    return c.json(await issueSession(target, c.env, session.dv));
  })
  // More → Your phones: every phone this number is trusted (and may be signed in) on.
  .get('/devices', requireAuth, async (c) => {
    const session = c.get('session');
    const devices = await securityRepo.list(createPlatformDb(c.env.DB), session.phone);
    return c.json({
      devices: devices.map((d) => ({
        id: d.id,
        label: d.label,
        createdAt: d.createdAt.toISOString(),
        lastUsedAt: d.lastUsedAt.toISOString(),
        current: d.deviceHash === session.dv,
      })),
    });
  })
  // Signs out one of your other phones and stops trusting it: it needs a WhatsApp code to come back.
  .delete('/devices/:id', requireAuth, zValidator('param', z.object({ id: z.string().min(1).max(64) })), async (c) => {
    const session = c.get('session');
    const platform = createPlatformDb(c.env.DB);
    const mine = (await securityRepo.list(platform, session.phone)).find((d) => d.id === c.req.valid('param').id);
    if (!mine) return c.json({ error: 'not_found' as const, message: 'That phone isn’t signed in any more.' }, 404);
    if (mine.deviceHash === session.dv) {
      return c.json({ error: 'this_phone' as const, message: 'To sign out this phone, use Sign out.' }, 400);
    }
    await securityRepo.forgetById(platform, session.phone, mine.id);
    for (const r of await userRepo.listByPhone(platform, session.phone)) forgetShop(r.shopId);
    return c.json({ ok: true as const });
  })
  // Lost or shared phone: signs out every other phone and forgets them; this one stays signed in.
  .post('/devices/sign-out-others', requireAuth, async (c) => {
    const session = c.get('session');
    const platform = createPlatformDb(c.env.DB);
    await userRepo.signOutEverywhere(platform, session.phone);
    if (session.dv) await securityRepo.forgetOthers(platform, session.phone, session.dv);
    else await securityRepo.forgetAll(platform, session.phone);
    for (const r of await userRepo.listByPhone(platform, session.phone)) forgetShop(r.shopId);
    const user = await userRepo.findById(c.get('db'), session.sub);
    if (!user) return c.json({ error: 'unauthorized' as const }, 401);
    return c.json(await issueSession(user, c.env, session.dv));
  });
