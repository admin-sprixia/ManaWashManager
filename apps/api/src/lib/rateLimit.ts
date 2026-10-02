import type { Context, MiddlewareHandler, Next } from 'hono';
import { isDevMode } from './recovery';
import type { Env } from '../types';

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface D1Like {
  prepare(query: string): D1Statement;
}

/**
 * Counts one hit against `key` in a fixed window and returns how many hits the window now has.
 * One upsert statement, so parallel requests can't all read "0" and slip past the limit.
 */
export async function countHit(env: Env, key: string, windowSeconds: number): Promise<{ count: number; resetAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const row = await (env.DB as unknown as D1Like)
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN window_start = ?2 THEN count + 1 ELSE 1 END,
         window_start = ?2
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  return { count: row?.count ?? 1, resetAt: windowStart + windowSeconds };
}

/** Old windows are dead weight; the nightly job clears anything older than a day. */
export async function pruneRateLimits(env: Env): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  await (env.DB as unknown as D1Like).prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(cutoff).run();
}

export function clientIp(c: Context): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? 'unknown';
}

/** Local `wrangler dev` runs the test scripts from one address, so it gets more headroom. */
const DEV_SCALE = 10;

/**
 * Caps how often one network address can call a route: `limit` hits per `windowSeconds`.
 * Sits in front of sign-in, codes and sign-up so a script can't hammer guesses in parallel.
 * A shop's phones share one Wi-Fi address, so limits leave room for a whole team.
 */
export function rateLimit(name: string, limit: number, windowSeconds: number): MiddlewareHandler<{ Bindings: Env }> {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const max = isDevMode(c.env, c.req.url) ? limit * DEV_SCALE : limit;
    const { count, resetAt } = await countHit(c.env, `${name}:ip:${clientIp(c)}`, windowSeconds);
    if (count > max) {
      const retryAfter = Math.max(1, resetAt - Math.floor(Date.now() / 1000));
      c.header('Retry-After', String(retryAfter));
      return c.json(
        {
          error: 'rate_limited' as const,
          retryAfter,
          message: `Too many tries from this network. Wait ${Math.ceil(retryAfter / 60)} min and try again.`,
        },
        429,
      );
    }
    await next();
  };
}
