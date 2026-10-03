import { AsyncLocalStorage } from 'node:async_hooks';
import type { D1Database } from '@mana/db';
import type { Env } from '../types';
import { isDevMode } from './recovery';

const RUNS = new Set(['first', 'all', 'run', 'raw']);
const INNER = Symbol('inner');

type Statement = Record<string | symbol, unknown> & { bind: (...args: unknown[]) => Statement };

interface Tally {
  inFlight: number;
  busySince: number;
  dbMs: number;
  rounds: number;
  queries: number;
}

const current = new AsyncLocalStorage<Tally>();

async function track<T>(count: number, run: () => Promise<T>): Promise<T> {
  const tally = current.getStore();
  if (!tally) return run();
  tally.queries += count;
  if (tally.inFlight++ === 0) {
    tally.busySince = Date.now();
    tally.rounds++;
  }
  try {
    return await run();
  } finally {
    if (--tally.inFlight === 0) tally.dbMs += Date.now() - tally.busySince;
  }
}

function wrap(statement: Statement): Statement {
  return new Proxy(statement, {
    get(target, prop) {
      if (prop === INNER) return target;
      const value = target[prop];
      if (prop === 'bind') return (...args: unknown[]) => wrap(target.bind(...args));
      if (typeof prop === 'string' && RUNS.has(prop) && typeof value === 'function') {
        return (...args: unknown[]) => track(1, () => Promise.resolve((value as (...a: unknown[]) => unknown).apply(target, args)));
      }
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

// One wrapper per binding, so the database client cached for that binding is reused across requests.
const timedBindings = new WeakMap<D1Database, D1Database>();

function timed(db: D1Database): D1Database {
  let out = timedBindings.get(db);
  if (!out) {
    out = {
      prepare: (query) => wrap(db.prepare(query) as Statement),
      batch: (statements) => track(statements.length, () => db.batch(statements.map((s) => (s as Statement)[INNER] ?? s))),
      exec: (query) => track(1, () => db.exec(query)),
    };
    timedBindings.set(db, out);
  }
  return out;
}

/**
 * Staging and local dev only: adds a `Server-Timing` header to every response, so speed tests
 * can tell network time from server time and see how a request used the database:
 *
 *   Server-Timing: app;dur=84, db;dur=61;desc="2 rounds / 9 queries"
 *
 * `db` is the time at least one query was in flight; a "round" is a stretch of queries running
 * together, so rounds are the database trips the request made one after another. Workers only
 * advance the clock across I/O, so `app` is effectively waiting time (database, R2, fetch).
 * Production never gets the header or the wrapper.
 */
export function withServerTiming(
  env: Env,
  requestUrl: string,
): { run: (handle: (env: Env) => Promise<Response>) => Promise<Response> } | null {
  if (env.ENVIRONMENT !== 'staging' && !isDevMode(env, requestUrl)) return null;
  const timedEnv = { ...env, DB: timed(env.DB) };
  return {
    async run(handle) {
      const started = Date.now();
      const tally: Tally = { inFlight: 0, busySince: 0, dbMs: 0, rounds: 0, queries: 0 };
      const res = await current.run(tally, () => handle(timedEnv));
      const out = new Response(res.body, res);
      out.headers.set(
        'Server-Timing',
        `app;dur=${Date.now() - started}, db;dur=${tally.dbMs};desc="${tally.rounds} rounds / ${tally.queries} queries"`,
      );
      return out;
    },
  };
}
