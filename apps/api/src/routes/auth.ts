import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createDbClient, userRepo } from '@mana/db';
import {
  checkPin,
  normalizePhone,
  PIN_LOCK_MINUTES,
  PIN_MAX_ATTEMPTS,
  pinProblemMessage,
} from '@mana/domain';
import { Msg91OtpProvider } from '../lib/otp';
import { createSessionToken } from '../lib/jwt';
import { hashPin, verifyPin } from '../lib/pin';
import { requireAuth } from '../middleware/auth';
import type { Env } from '../types';

const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((p) => /^[6-9]\d{9}$/.test(p), 'Enter a valid 10-digit mobile number');

const sendOtpSchema = z.object({ phone: phoneSchema });
const verifyOtpSchema = z.object({ phone: phoneSchema, code: z.string().length(6) });
const pinLoginSchema = z.object({ phone: phoneSchema, pin: z.string().min(4).max(6) });
const setPinSchema = z.object({ pin: z.string() });
const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
});
const changePhoneSendSchema = z.object({ phone: phoneSchema });
const changePhoneVerifySchema = z.object({ phone: phoneSchema, code: z.string().length(6) });

// Dev-only bypass so the app can be tested end to end before a real MSG91 account exists.
// Enabled by setting DEV_OTP_BYPASS=true in .dev.vars — never set this in production
// (wrangler secret put only touches the real deployment, so there's no risk of it leaking there).
function isDevOtpBypass(env: Env): boolean {
  return env.DEV_OTP_BYPASS === 'true';
}

type DbUser = NonNullable<Awaited<ReturnType<typeof userRepo.findById>>>;

function publicUser(user: DbUser) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: (user.role === 'owner' ? 'owner' : 'staff') as 'owner' | 'staff',
    hasPin: user.pinHash != null,
  };
}

// Single-tenant for V1–V3: this Worker only ever binds MANA's own D1 database, so the
// orgId is a fixed literal here. V4 replaces this with the organization resolved from
// the Worker's own deployment, not a per-request lookup — see the build plan's V4.0 flow.
async function issueSession(user: DbUser, env: Env) {
  const token = await createSessionToken(
    { sub: user.id, orgId: 'mana', role: publicUser(user).role, phone: user.phone },
    env.JWT_SECRET,
  );
  return { token, user: publicUser(user) };
}

// Routes are chained in one expression, and every JSON body is declared with `zValidator`
// rather than parsed by hand inside the handler — see the Naming conventions / Tech stack
// note on why: Hono RPC's client can only infer a route's `json` input type (and give the
// mobile app a compile-time error on a mismatch) when the schema is visible at the type
// level via `zValidator`. A hand-parsed `schema.parse(await c.req.json())` works at runtime
// but is invisible to `hc<AppType>()`, silently degrading the client's types to `unknown`.
export const authRoutes = new Hono<{ Bindings: Env }>()
  // Only team members get an SMS — an open endpoint would let anyone burn MSG91 credits.
  .post('/otp/send', zValidator('json', sendOtpSchema), async (c) => {
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    const user = await userRepo.findByPhone(db, body.phone);
    if (!user) return c.json({ error: 'no_account' as const }, 404);
    if (!user.active) return c.json({ error: 'account_disabled' as const }, 403);

    if (isDevOtpBypass(c.env)) {
      return c.json({ sent: true, dev: `bypass active — use code ${c.env.DEV_OTP_CODE ?? '000000'}` });
    }

    await new Msg91OtpProvider(c.env.MSG91_API_KEY).sendOtp(`91${body.phone}`);
    return c.json({ sent: true });
  })
  .post('/otp/verify', zValidator('json', verifyOtpSchema), async (c) => {
    const body = c.req.valid('json');

    const valid = isDevOtpBypass(c.env)
      ? body.code === (c.env.DEV_OTP_CODE ?? '000000')
      : await new Msg91OtpProvider(c.env.MSG91_API_KEY).verifyOtp(`91${body.phone}`, body.code);
    if (!valid) return c.json({ error: 'invalid_otp' as const }, 401);

    const db = createDbClient(c.env.DB);
    const user = await userRepo.findByPhone(db, body.phone);
    if (!user) return c.json({ error: 'no_account' as const }, 404);
    if (!user.active) return c.json({ error: 'account_disabled' as const }, 403);

    return c.json(await issueSession(user, c.env));
  })
  // PIN sign-in for shared shop phones where waiting on an SMS every shift change is too slow.
  // After PIN_MAX_ATTEMPTS wrong tries the PIN is locked for PIN_LOCK_MINUTES; OTP still works,
  // and the owner can reset the PIN from Team.
  .post('/pin/login', zValidator('json', pinLoginSchema), async (c) => {
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    const user = await userRepo.findByPhone(db, body.phone);
    if (!user) return c.json({ error: 'no_account' as const }, 404);
    if (!user.active) return c.json({ error: 'account_disabled' as const }, 403);
    if (!user.pinHash) return c.json({ error: 'pin_not_set' as const }, 409);

    const now = new Date();
    if (user.pinLockedUntil && user.pinLockedUntil.getTime() > now.getTime()) {
      return c.json(
        { error: 'pin_locked' as const, lockedUntil: user.pinLockedUntil.toISOString() },
        423,
      );
    }

    if (!(await verifyPin(body.pin, user.pinHash))) {
      // A lock that has expired starts a fresh round of attempts.
      const previous = user.pinLockedUntil ? 0 : user.pinFailedAttempts;
      const attempts = previous + 1;
      if (attempts >= PIN_MAX_ATTEMPTS) {
        const lockedUntil = new Date(now.getTime() + PIN_LOCK_MINUTES * 60 * 1000);
        await userRepo.recordPinFailure(db, user.id, 0, lockedUntil);
        return c.json({ error: 'pin_locked' as const, lockedUntil: lockedUntil.toISOString() }, 423);
      }
      await userRepo.recordPinFailure(db, user.id, attempts, null);
      return c.json(
        { error: 'invalid_pin' as const, attemptsLeft: PIN_MAX_ATTEMPTS - attempts },
        401,
      );
    }

    if (user.pinFailedAttempts > 0 || user.pinLockedUntil) {
      await userRepo.clearPinFailures(db, user.id);
    }
    return c.json(await issueSession(user, c.env));
  })
  .get('/me', requireAuth, async (c) => {
    const db = createDbClient(c.env.DB);
    const user = await userRepo.findById(db, c.get('session').sub);
    if (!user) return c.json({ error: 'unauthorized' as const }, 401);
    return c.json(publicUser(user));
  })
  .put('/pin', requireAuth, zValidator('json', setPinSchema), async (c) => {
    const { pin } = c.req.valid('json');
    const problem = checkPin(pin);
    if (problem) {
      return c.json({ error: 'weak_pin' as const, message: pinProblemMessage(problem) }, 400);
    }
    const db = createDbClient(c.env.DB);
    const user = await userRepo.setPinHash(db, c.get('session').sub, await hashPin(pin));
    return c.json(publicUser(user));
  })
  .patch('/me', requireAuth, zValidator('json', updateProfileSchema), async (c) => {
    const { name } = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    const user = await userRepo.update(db, c.get('session').sub, { name });
    return c.json(publicUser(user));
  })
  // The phone number is the sign-in identity, so moving it requires proving the new number
  // with an SMS code — otherwise a borrowed, unlocked phone could redirect someone's account.
  .post('/me/phone/send', requireAuth, zValidator('json', changePhoneSendSchema), async (c) => {
    const { phone } = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    const me = await userRepo.findById(db, c.get('session').sub);
    if (!me) return c.json({ error: 'unauthorized' as const }, 401);
    if (me.phone === phone) {
      return c.json({ error: 'same_phone' as const, message: 'That’s already your number.' }, 400);
    }
    if (await userRepo.findByPhone(db, phone)) {
      return c.json(
        { error: 'phone_taken' as const, message: 'Another team member already uses this number.' },
        409,
      );
    }

    if (isDevOtpBypass(c.env)) {
      return c.json({ sent: true, dev: `bypass active — use code ${c.env.DEV_OTP_CODE ?? '000000'}` });
    }
    await new Msg91OtpProvider(c.env.MSG91_API_KEY).sendOtp(`91${phone}`);
    return c.json({ sent: true });
  })
  .post('/me/phone/verify', requireAuth, zValidator('json', changePhoneVerifySchema), async (c) => {
    const { phone, code } = c.req.valid('json');

    const valid = isDevOtpBypass(c.env)
      ? code === (c.env.DEV_OTP_CODE ?? '000000')
      : await new Msg91OtpProvider(c.env.MSG91_API_KEY).verifyOtp(`91${phone}`, code);
    if (!valid) {
      return c.json(
        { error: 'invalid_otp' as const, message: 'That code isn’t right. Check the SMS and try again.' },
        401,
      );
    }

    const db = createDbClient(c.env.DB);
    const taken = await userRepo.findByPhone(db, phone);
    if (taken && taken.id !== c.get('session').sub) {
      return c.json(
        { error: 'phone_taken' as const, message: 'Another team member already uses this number.' },
        409,
      );
    }
    const user = await userRepo.update(db, c.get('session').sub, { phone });
    return c.json(await issueSession(user, c.env));
  });
