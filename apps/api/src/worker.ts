import { openDbLease } from '@mana/db';
import { app } from './index';
import { withDevDbDelay } from './lib/devDbDelay';
import { withServerTiming } from './lib/serverTiming';
import { runNightly } from './scheduled';
import type { Env } from './types';

export default {
  async fetch(request, env, ctx) {
    // The request keeps its database clients until its background (`waitUntil`) work is done too.
    const lease = openDbLease();
    const background: Promise<unknown>[] = [];
    const requestCtx = new Proxy(ctx, {
      get(target, prop) {
        if (prop === 'waitUntil') {
          return (promise: Promise<unknown>) => {
            background.push(promise);
            target.waitUntil(promise);
          };
        }
        const value: unknown = Reflect.get(target, prop);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    try {
      return await lease.run(async () => {
        const base = withDevDbDelay(env, request.url);
        const timing = withServerTiming(base, request.url);
        if (!timing) return app.fetch(request, base, requestCtx);
        return timing.run((timedEnv) => Promise.resolve(app.fetch(request, timedEnv, requestCtx)));
      });
    } finally {
      ctx.waitUntil(Promise.allSettled(background).then(() => lease.release()));
    }
  },
  // Cron trigger (see wrangler.toml): nightly backup, photo retention, error-log pruning.
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runNightly(env));
  },
} satisfies ExportedHandler<Env>;
