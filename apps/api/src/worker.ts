import { app } from './index';
import { runNightly } from './scheduled';
import type { Env } from './types';

export default {
  fetch: app.fetch,
  // Cron trigger (see wrangler.toml): nightly backup, photo retention, error-log pruning.
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runNightly(env));
  },
} satisfies ExportedHandler<Env>;
