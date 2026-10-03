import { app } from './index';
import { withDevDbDelay } from './lib/devDbDelay';
import { runNightly } from './scheduled';
import type { Env } from './types';

export default {
  fetch: (request, env, ctx) => app.fetch(request, withDevDbDelay(env, request.url), ctx),
  // Cron trigger (see wrangler.toml): nightly backup, photo retention, error-log pruning.
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runNightly(env));
  },
} satisfies ExportedHandler<Env>;
