import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth';
import { customerRoutes } from './routes/customer';
import { serviceRoutes } from './routes/service';
import { jobRoutes } from './routes/job';
import { teamRoutes } from './routes/team';
import { expenseRoutes } from './routes/expense';
import { reportRoutes } from './routes/report';
import { reminderRoutes } from './routes/reminder';
import { couponRoutes } from './routes/coupon';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true }));

// Unhandled errors come back as a stable JSON shape the app can show, never an HTML page.
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'server_error', message: 'Something went wrong on the server.' }, 500);
});

const routes = app
  .route('/auth', authRoutes)
  .route('/customers', customerRoutes)
  .route('/services', serviceRoutes)
  .route('/jobs', jobRoutes)
  .route('/team', teamRoutes)
  .route('/expenses', expenseRoutes)
  .route('/reports', reportRoutes)
  .route('/reminders', reminderRoutes)
  .route('/coupons', couponRoutes);

// Hono RPC: the mobile app imports this type (via hc<AppType>) to get a fully typed API
// client with zero codegen — this is what "tRPC or Hono RPC" in the build plan resolved to.
export type AppType = typeof routes;

export default app;
