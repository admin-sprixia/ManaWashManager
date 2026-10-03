import { app } from './index';
import { withDevDbDelay } from './lib/devDbDelay';
import { withServerTiming } from './lib/serverTiming';
import { runNightly } from './scheduled';
import type { Env } from './types';

export default {
  async fetch(request, env, ctx) {
    const base = withDevDbDelay(env, request.url);
    const timing = withServerTiming(base, request.url);
    if (!timing) return app.fetch(request, base, ctx);
    return timing.run((env) => Promise.resolve(app.fetch(request, env, ctx)));
  },
  // Cron trigger (see wrangler.toml): nightly backup, photo retention, error-log pruning.
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runNightly(env));
  },
} satisfies ExportedHandler<Env>;
