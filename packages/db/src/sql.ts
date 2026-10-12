import { chunk } from './chunk';
import type { D1Database } from './client';

/**
 * Plain SQL for bulk writes Prisma can't do in few round trips (a branch menu rebuild touches
 * hundreds of price rows). Statements run through D1's `batch`: one round trip and one
 * transaction per batch, so a rebuild either lands whole or not at all.
 */
export interface SqlStatement {
  sql: string;
  params: unknown[];
}

/** D1 refuses a statement with more than 100 bound parameters. */
const MAX_PARAMS = 99;
/** Statements per D1 batch; a rebuild needs far fewer, this only bounds pathological cases. */
const MAX_BATCH = 400;

/** The timestamp format every table's DEFAULT uses (see schema.sql). */
export const SQL_NOW = "strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')";

type Value = string | number | null;

/** D1 binds numbers, strings and null; booleans are stored as 0 / 1. */
function bindable(value: unknown): Value {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string') return value;
  throw new Error(`Unsupported SQL value: ${typeof value}`);
}

/** Multi-row INSERTs, as many rows per statement as the parameter limit allows. */
export function insertRows(
  table: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  /** `orIgnore` skips rows that already exist; `onConflict` is an `ON CONFLICT (…) DO …` clause. */
  options: { orIgnore?: boolean; onConflict?: string } = {},
): SqlStatement[] {
  if (!rows.length) return [];
  const perStatement = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
  const placeholders = `(${columns.map(() => '?').join(', ')})`;
  const verb = options.orIgnore ? 'INSERT OR IGNORE' : 'INSERT';
  const tail = options.onConflict ? ` ${options.onConflict}` : '';
  return chunk([...rows], perStatement).map((slice) => ({
    sql: `${verb} INTO ${table} (${columns.join(', ')}) VALUES ${slice.map(() => placeholders).join(', ')}${tail}`,
    params: slice.flat(),
  }));
}

/**
 * `DELETE FROM table WHERE <scope> AND column IN (…)`, sliced to the parameter limit. `scope`
 * always pins the owner (shop or business) so a stray id can't reach another's rows.
 */
export function deleteIn(
  table: string,
  column: string,
  ids: readonly string[],
  scope: { sql: string; params: readonly unknown[] },
): SqlStatement[] {
  if (!ids.length) return [];
  const room = MAX_PARAMS - scope.params.length;
  return chunk([...ids], room).map((slice) => ({
    sql: `DELETE FROM ${table} WHERE ${scope.sql} AND ${column} IN (${slice.map(() => '?').join(', ')})`,
    params: [...scope.params, ...slice],
  }));
}

interface D1Prepared {
  bind(...values: Value[]): unknown;
}

/** Runs statements in order, in as few batches (transactions) as possible. */
export async function runStatements(d1: D1Database, statements: readonly SqlStatement[]): Promise<void> {
  for (const slice of chunk([...statements], MAX_BATCH)) {
    if (!slice.length) continue;
    await d1.batch(
      slice.map((s) => (d1.prepare(s.sql) as D1Prepared).bind(...s.params.map(bindable))),
    );
  }
}

/** Rows from one SELECT. */
export async function queryRows<T>(d1: D1Database, sql: string, params: readonly unknown[] = []): Promise<T[]> {
  const prepared = (d1.prepare(sql) as D1Prepared).bind(...params.map(bindable)) as {
    all(): Promise<{ results: T[] }>;
  };
  return (await prepared.all()).results;
}
