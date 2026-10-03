import type { D1Database } from '@mana/db';
import type { Env } from '../types';
import { isDevMode } from './recovery';

const RUNS = new Set(['first', 'all', 'run', 'raw']);
const INNER = Symbol('inner');

type Statement = Record<string | symbol, unknown> & { bind: (...args: unknown[]) => Statement };

/**
 * Local `wrangler dev` answers database calls instantly, so a request's round trips can't be
 * seen. With DEV_DB_DELAY_MS set (and dev mode on localhost), every database call waits that
 * long first: a request taking 3× the delay made three trips one after another.
 */
export function withDevDbDelay(env: Env, requestUrl: string): Env {
  const ms = Number(env.DEV_DB_DELAY_MS);
  if (!(ms > 0) || !isDevMode(env, requestUrl)) return env;
  const wait = () => new Promise((resolve) => setTimeout(resolve, ms));
  const wrap = (statement: Statement): Statement =>
    new Proxy(statement, {
      get(target, prop) {
        if (prop === INNER) return target;
        const value = target[prop];
        if (prop === 'bind') return (...args: unknown[]) => wrap(target.bind(...args));
        if (typeof prop === 'string' && RUNS.has(prop) && typeof value === 'function') {
          return async (...args: unknown[]) => {
            await wait();
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
  const db = env.DB;
  const delayed: D1Database = {
    prepare: (query) => wrap(db.prepare(query) as Statement),
    batch: async (statements) => {
      await wait();
      return db.batch(statements.map((s) => (s as Statement)[INNER] ?? s));
    },
    exec: async (query) => {
      await wait();
      return db.exec(query);
    },
  };
  return { ...env, DB: delayed };
}
