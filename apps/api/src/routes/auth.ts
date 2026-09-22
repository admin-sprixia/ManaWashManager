import { Hono } from 'hono';
import { z } from 'zod';
import { createDbClient } from '@mana/db';
import { Msg91OtpProvider } from '../lib/otp';
import { createSessionToken } from '../lib/jwt';
import type { Env } from '../types';

export const authRoutes = new Hono<{ Bindings: Env }>();

const sendOtpSchema = z.object({ phone: z.string().min(10) });
const verifyOtpSchema = z.object({ phone: z.string().min(10), code: z.string().length(6) });

// Dev-only bypass so the app can be tested end to end before a real MSG91 account exists.
// Enabled by setting DEV_OTP_BYPASS=true in .dev.vars — never set this in production
// (wrangler secret put only touches the real deployment, so there's no risk of it leaking there).
function isDevOtpBypass(env: Env): boolean {
  return env.DEV_OTP_BYPASS === 'true';
}

authRoutes.post('/otp/send', async (c) => {
  const body = sendOtpSchema.parse(await c.req.json());

  if (isDevOtpBypass(c.env)) {
    return c.json({ sent: true, dev: `bypass active — use code ${c.env.DEV_OTP_CODE ?? '000000'}` });
  }

  const otp = new Msg91OtpProvider(c.env.MSG91_API_KEY);
  await otp.sendOtp(body.phone);
  return c.json({ sent: true });
});

authRoutes.post('/otp/verify', async (c) => {
  const body = verifyOtpSchema.parse(await c.req.json());

  const valid = isDevOtpBypass(c.env)
    ? body.code === (c.env.DEV_OTP_CODE ?? '000000')
    : await new Msg91OtpProvider(c.env.MSG91_API_KEY).verifyOtp(body.phone, body.code);
  if (!valid) return c.json({ error: 'invalid_otp' }, 401);

  const db = createDbClient(c.env.DB);
  const user = await db.user.findUnique({ where: { phone: body.phone } });
  if (!user) return c.json({ error: 'no_account' }, 404);

  // Single-tenant for V1–V3: this Worker only ever binds MANA's own D1 database, so the
  // orgId is a fixed literal here. V4 replaces this with the organization resolved from
  // the Worker's own deployment, not a per-request lookup — see the build plan's V4.0 flow.
  const token = await createSessionToken(
    { sub: user.id, orgId: 'mana', role: user.role as 'owner' | 'staff', phone: user.phone },
    c.env.JWT_SECRET,
  );

  return c.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});
