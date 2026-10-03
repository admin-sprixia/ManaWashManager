import type { D1Database } from '@mana/db';
import type { Env } from '../types';
import { isDevMode } from './recovery';

const RUNS = new Set(['first', 'all', 'run', 'raw']);
const INNER = Symbol('inner');

type Statement = Record<string | symbol, unknown> & { bind: (...args: unknown[]) => Statement };

// One wrapper per binding, so the database client cached for that binding is reused across requests.
const delayedBindings = new WeakMap<D1Database, { ms: number; db: D1Database }>();

function delayed(db: D1Database, ms: number): D1Database {
  const cached = delayedBindings.get(db);
  if (cached?.ms === ms) return cached.db;
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
  const out: D1Database = {
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
  delayedBindings.set(db, { ms, db: out });
  return out;
}

/**
 * Local `wrangler dev` answers database calls instantly, so a request's round trips can't be
 * seen. With DEV_DB_DELAY_MS set (and dev mode on localhost), every database call waits that
 * long first: a request taking 3× the delay made three trips one after another.
 */
export function withDevDbDelay(env: Env, requestUrl: string): Env {
  const ms = Number(env.DEV_DB_DELAY_MS);
  if (!(ms > 0) || !isDevMode(env, requestUrl)) return env;
  return { ...env, DB: delayed(env.DB, ms) };
}
