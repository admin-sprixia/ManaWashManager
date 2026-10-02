import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { MAX_PHOTO_BYTES } from '@mana/domain';
import { reportError } from './lib/alerts';
import { rateLimit } from './lib/rateLimit';
import type { SessionClaims } from './lib/jwt';
import { authRoutes } from './routes/auth';
import { signupRoutes } from './routes/signup';
import { customerRoutes } from './routes/customer';
import { serviceRoutes } from './routes/service';
import { jobRoutes } from './routes/job';
import { teamRoutes } from './routes/team';
import { expenseRoutes } from './routes/expense';
import { reportRoutes } from './routes/report';
import { reminderRoutes } from './routes/reminder';
import { couponRoutes } from './routes/coupon';
import { referralRoutes } from './routes/referral';
import { shopRoutes } from './routes/shop';
import { attendanceRoutes } from './routes/attendance';
import { cashRoutes } from './routes/cash';
import { photoRoutes } from './routes/photo';
import { stockRoutes } from './routes/stock';
import { billingRoutes } from './routes/billing';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

// Brute-force protection per network address, on top of the per-account PIN and code lockouts.
const TEN_MIN = 10 * 60;
app.use('/auth/start', rateLimit('start', 60, TEN_MIN));
app.use('/auth/pin/login', rateLimit('pin', 40, TEN_MIN));
app.use('/auth/recover', rateLimit('recover', 10, TEN_MIN));
app.use('/auth/code/*', rateLimit('code', 20, TEN_MIN));
app.use('/auth/me/phone', rateLimit('phone', 10, TEN_MIN));
app.use('/auth/me/phone/code', rateLimit('phone-code', 10, TEN_MIN));
app.use('/signup/*', rateLimit('signup', 60, TEN_MIN));

// Requests are read into memory, so cap their size before anything parses them. Uploads carry
// photos (one per request, two for an expense); everything else is small JSON.
const tooLarge = (c: Context) =>
  c.json({ error: 'too_large' as const, message: 'That upload is too large.' }, 413);
app.use('/photos', bodyLimit({ maxSize: MAX_PHOTO_BYTES + 64 * 1024, onError: tooLarge }));
app.use('/expenses', bodyLimit({ maxSize: 2 * MAX_PHOTO_BYTES + 64 * 1024, onError: tooLarge }));
const jsonLimit: MiddlewareHandler<{ Bindings: Env }> = bodyLimit({ maxSize: 256 * 1024, onError: tooLarge });
app.use('*', async (c, next) =>
  c.req.path === '/photos' || c.req.path === '/expenses' ? next() : jsonLimit(c as Context<{ Bindings: Env }, string>, next),
);

app.get('/health', (c) => c.json({ ok: true }));

// Unhandled errors come back as a stable JSON shape the app can show, never an HTML page, and
// are kept in the error log the owner can read in the app.
app.onError(async (err, c) => {
  // Deliberate HTTP errors (bad JSON, body too large, …) keep their status and aren't bugs.
  if (err instanceof HTTPException && err.status < 500) {
    return c.json({ error: 'bad_request', message: err.message || 'The request was not valid.' }, err.status);
  }
  console.error(err);
  let waitUntil: ((p: Promise<unknown>) => void) | undefined;
  try {
    const ctx = c.executionCtx;
    waitUntil = (p) => ctx.waitUntil(p);
  } catch {
    // No execution context (e.g. app.request in tests): report inline instead.
  }
  await reportError(
    c.env,
    {
      source: 'api',
      message: err.message || 'Unknown error',
      stack: err.stack,
      context: `${c.req.method} ${new URL(c.req.url).pathname}`,
      shopId: (c.get('session') as SessionClaims | undefined)?.shopId ?? null,
    },
    waitUntil,
  );
  return c.json({ error: 'server_error', message: 'Something went wrong on the server.' }, 500);
});

const routes = app
  .route('/auth', authRoutes)
  .route('/signup', signupRoutes)
  .route('/customers', customerRoutes)
  .route('/services', serviceRoutes)
  .route('/jobs', jobRoutes)
  .route('/team', teamRoutes)
  .route('/expenses', expenseRoutes)
  .route('/reports', reportRoutes)
  .route('/reminders', reminderRoutes)
  .route('/coupons', couponRoutes)
  .route('/referrals', referralRoutes)
  .route('/shop', shopRoutes)
  .route('/attendance', attendanceRoutes)
  .route('/cash', cashRoutes)
  .route('/photos', photoRoutes)
  .route('/stock', stockRoutes)
  .route('/billing', billingRoutes);

// Hono RPC: the mobile app imports this type (via hc<AppType>) to get a fully typed API
// client with zero codegen — this is what "tRPC or Hono RPC" in the build plan resolved to.
export type AppType = typeof routes;

// The Worker entry (fetch + cron) lives in worker.ts, so this file — which the mobile app
// imports for AppType — never needs the Workers runtime's global types.
export { app };
