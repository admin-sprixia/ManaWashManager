import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth';
import { customerRoutes } from './routes/customer';
import { serviceRoutes } from './routes/service';
import { jobRoutes } from './routes/job';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true }));

const routes = app
  .route('/auth', authRoutes)
  .route('/customers', customerRoutes)
  .route('/services', serviceRoutes)
  .route('/jobs', jobRoutes);

// Hono RPC: the mobile app imports this type (via hc<AppType>) to get a fully typed API
// client with zero codegen — this is what "tRPC or Hono RPC" in the build plan resolved to.
export type AppType = typeof routes;

export default app;
