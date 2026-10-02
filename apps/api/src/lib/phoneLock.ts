import type { Env } from '../types';

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
interface D1Like {
  prepare(query: string): D1Statement;
}

/** A crashed request's lock is taken over after this long. */
const LOCK_SECONDS = 30;
/** How long a request waits for another one on the same key before giving up. */
const WAIT_MS = 3000;

export const phoneBusy = {
  error: 'phone_busy' as const,
  message: 'This number is being set up right now. Wait a moment and try again.',
};

/**
 * Runs `fn` while holding a short lock on `key`, for a "check, then write" that D1 can't do in
 * one statement (there are no transactions). Returns `null` when another request kept the lock
 * for longer than we were willing to wait.
 *
 * The lock is a row in rate_limits taken with one statement: inserted, or taken over only when
 * the holder's lock has lapsed. The holder normally finishes in well under a second; waiting a
 * little lets the second of two simultaneous requests see the first one's result instead of a
 * "try again".
 */
export async function withLock<T>(env: Env, key: string, fn: () => Promise<T>): Promise<T | null> {
  const db = env.DB as unknown as D1Like;
  const lockKey = `lock:${key}`;
  const take = (now: number) =>
    db
      .prepare(
        `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
         ON CONFLICT (key) DO UPDATE SET window_start = ?2, count = 1 WHERE window_start < ?3
         RETURNING count`,
      )
      .bind(lockKey, now, now - LOCK_SECONDS)
      .first<{ count: number }>();
  const giveUpAt = Date.now() + WAIT_MS;
  let now = Math.floor(Date.now() / 1000);
  while (!(await take(now))) {
    if (Date.now() >= giveUpAt) return null;
    await new Promise((r) => setTimeout(r, 150));
    now = Math.floor(Date.now() / 1000);
  }
  try {
    return await fn();
  } finally {
    await db.prepare('DELETE FROM rate_limits WHERE key = ?1 AND window_start = ?2').bind(lockKey, now).run();
  }
}

/**
 * A number may belong to only one person on the whole platform (an owner's branches share one
 * person), but each shop only keeps numbers unique within itself. Every step that brings a number
 * into a shop — sign-up, join approval, adding a teammate, changing a number, opening a branch —
 * runs its "is this number free?" check and its write inside this lock, so two of them at once
 * can't both see the number as free.
 */
export function withPhoneLock<T>(env: Env, phone: string, fn: () => Promise<T>): Promise<T | null> {
  return withLock(env, `phone:${phone}`, fn);
}
