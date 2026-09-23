import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createDbClient } from '@mana/db';
import { Msg91OtpProvider } from '../lib/otp';
import { createSessionToken } from '../lib/jwt';
import type { Env } from '../types';

const sendOtpSchema = z.object({ phone: z.string().min(10) });
const verifyOtpSchema = z.object({ phone: z.string().min(10), code: z.string().length(6) });

// Dev-only bypass so the app can be tested end to end before a real MSG91 account exists.
// Enabled by setting DEV_OTP_BYPASS=true in .dev.vars — never set this in production
// (wrangler secret put only touches the real deployment, so there's no risk of it leaking there).
function isDevOtpBypass(env: Env): boolean {
  return env.DEV_OTP_BYPASS === 'true';
}

// Routes are chained in one expression, and every JSON body is declared with `zValidator`
// rather than parsed by hand inside the handler — see the Naming conventions / Tech stack
// note on why: Hono RPC's client can only infer a route's `json` input type (and give the
// mobile app a compile-time error on a mismatch) when the schema is visible at the type
// level via `zValidator`. A hand-parsed `schema.parse(await c.req.json())` works at runtime
// but is invisible to `hc<AppType>()`, silently degrading the client's types to `unknown`.
export const authRoutes = new Hono<{ Bindings: Env }>()
  .post('/otp/send', zValidator('json', sendOtpSchema), async (c) => {
    const body = c.req.valid('json');

    if (isDevOtpBypass(c.env)) {
      return c.json({ sent: true, dev: `bypass active — use code ${c.env.DEV_OTP_CODE ?? '000000'}` });
    }

    const otp = new Msg91OtpProvider(c.env.MSG91_API_KEY);
    await otp.sendOtp(body.phone);
    return c.json({ sent: true });
  })
  .post('/otp/verify', zValidator('json', verifyOtpSchema), async (c) => {
    const body = c.req.valid('json');

    const valid = isDevOtpBypass(c.env)
      ? body.code === (c.env.DEV_OTP_CODE ?? '000000')
      : await new Msg91OtpProvider(c.env.MSG91_API_KEY).verifyOtp(body.phone, body.code);
    if (!valid) return c.json({ error: 'invalid_otp' as const }, 401);

    const db = createDbClient(c.env.DB);
    const user = await db.user.findUnique({ where: { phone: body.phone } });
    if (!user) return c.json({ error: 'no_account' as const }, 404);

    // Single-tenant for V1–V3: this Worker only ever binds MANA's own D1 database, so the
    // orgId is a fixed literal here. V4 replaces this with the organization resolved from
    // the Worker's own deployment, not a per-request lookup — see the build plan's V4.0 flow.
    const token = await createSessionToken(
      { sub: user.id, orgId: 'mana', role: user.role as 'owner' | 'staff', phone: user.phone },
      c.env.JWT_SECRET,
    );

    return c.json({
      token,
      user: { id: user.id, name: user.name, role: user.role as 'owner' | 'staff' },
    });
  });
