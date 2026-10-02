import { billingRepo, createPlatformDb, opsRepo } from '@mana/db';
import { addDays, PHOTO_RETENTION_DAYS } from '@mana/domain';
import { reportError } from './lib/alerts';
import { syncShopSubscription } from './lib/billing';
import { billingConfigured } from './lib/razorpay';
import { formatIstDateOnly } from './lib/istDate';
import { pruneRateLimits } from './lib/rateLimit';
import type { Env } from './types';

const BACKUP_PREFIX = 'backups/';
const BACKUP_KEEP_DAYS = 30;
/** Rows per backup file. Keeps every read and every object small, however big a table grows. */
const BACKUP_PAGE_ROWS = 2000;
/** Rebuilt by the migrations or worthless after a day; not worth restoring. */
const BACKUP_SKIP_TABLES = new Set(['rate_limits']);
const ERROR_KEEP_DAYS = 90;
/** R2 deletes are batched; the purge loops in batches until done or out of time. */
const PHOTO_PURGE_BATCH = 500;
const PHOTO_PURGE_BUDGET_MS = 5 * 60 * 1000;
/** Deleted photos whose image removal is retried, in case the delete request's own try failed. */
const PHOTO_DELETE_RETRY_DAYS = 2;

interface D1Rows<T> {
  results: T[];
}
interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): { all<T>(): Promise<D1Rows<T>> };
    all<T>(): Promise<D1Rows<T>>;
  };
}

export interface BackupManifest {
  format: 2;
  takenAt: string;
  /** `CREATE` statements as they stood, for reference; restores apply the migrations instead. */
  schema: { type: string; name: string; sql: string | null }[];
  tables: Record<string, { rows: number; pages: string[] }>;
}

function quoteIdent(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Nightly copy of every table into the BACKUPS bucket, under `backups/YYYY-MM-DD/`, kept for
 * 30 days. Each table is read in pages by rowid, so no single query or file grows with the
 * data. `manifest.json` is written last: a backup without one is incomplete and is ignored by
 * `npm run backup:restore`. On top of D1's own point-in-time restore (Time Travel).
 */
async function backupDatabase(env: Env, now: Date) {
  const d1 = env.DB as unknown as D1Like;
  const schema = await d1
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY type, name",
    )
    .all<{ type: string; name: string; sql: string | null }>();

  const day = `${BACKUP_PREFIX}${formatIstDateOnly(now)}/`;
  const manifest: BackupManifest = { format: 2, takenAt: now.toISOString(), schema: schema.results, tables: {} };

  for (const { name, type } of schema.results) {
    if (type !== 'table' || BACKUP_SKIP_TABLES.has(name)) continue;
    const entry = { rows: 0, pages: [] as string[] };
    let after = 0;
    for (;;) {
      const page = await d1
        .prepare(`SELECT rowid AS "__rowid", * FROM ${quoteIdent(name)} WHERE rowid > ?1 ORDER BY rowid LIMIT ?2`)
        .bind(after, BACKUP_PAGE_ROWS)
        .all<Record<string, unknown> & { __rowid: number }>();
      if (page.results.length === 0) break;
      after = page.results[page.results.length - 1]!.__rowid;
      const rows = page.results.map(({ __rowid: _rowid, ...row }) => row);
      const key = `${day}${name}/${String(entry.pages.length + 1).padStart(5, '0')}.json`;
      await env.BACKUPS.put(key, JSON.stringify(rows), { httpMetadata: { contentType: 'application/json' } });
      entry.pages.push(key);
      entry.rows += rows.length;
      if (page.results.length < BACKUP_PAGE_ROWS) break;
    }
    manifest.tables[name] = entry;
  }
  await env.BACKUPS.put(`${day}manifest.json`, JSON.stringify(manifest), {
    httpMetadata: { contentType: 'application/json' },
  });

  await pruneOldBackups(env, now);
}

/** Deletes every object under a backup day older than BACKUP_KEEP_DAYS. */
async function pruneOldBackups(env: Env, now: Date) {
  const cutoff = `${BACKUP_PREFIX}${formatIstDateOnly(addDays(now, -BACKUP_KEEP_DAYS))}/`;
  let cursor: string | undefined;
  do {
    const listed = await env.BACKUPS.list({ prefix: BACKUP_PREFIX, cursor, limit: 1000 });
    const stale = listed.objects.map((o) => o.key).filter((k) => k < cutoff);
    if (stale.length) await env.BACKUPS.delete(stale);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

/**
 * Photos past the retention window, in every shop: image and row both go. Loops in batches
 * until nothing is left or the time budget runs out (the next night carries on). Also retries
 * removing images of recently deleted photos.
 */
async function purgePhotos(env: Env, now: Date) {
  const db = createPlatformDb(env.DB);
  const started = Date.now();
  const before = addDays(now, -PHOTO_RETENTION_DAYS);
  while (Date.now() - started < PHOTO_PURGE_BUDGET_MS) {
    const expired = await opsRepo.listExpiredPhotos(db, before, PHOTO_PURGE_BATCH);
    if (expired.length === 0) break;
    await env.PHOTOS.delete(expired.map((p) => p.r2Key));
    await opsRepo.purgePhotos(db, expired.map((p) => p.id));
    if (expired.length < PHOTO_PURGE_BATCH) break;
  }

  const deleted = await opsRepo.listRecentlyDeletedPhotos(
    db,
    addDays(now, -PHOTO_DELETE_RETRY_DAYS),
    PHOTO_PURGE_BATCH,
  );
  if (deleted.length) await env.PHOTOS.delete(deleted.map((p) => p.r2Key));
}

const BILLING_SYNC_BATCH = 200;

/**
 * Catches up subscriptions whose webhook went missing: any shop due to renew within a day is
 * re-read from Razorpay. Renewals normally arrive by webhook within seconds; this is the net.
 */
async function reconcileBilling(env: Env, now: Date) {
  if (!billingConfigured(env)) return;
  const db = createPlatformDb(env.DB);
  const due = await billingRepo.listDueForSync(db, addDays(now, 1), BILLING_SYNC_BATCH);
  for (const { id } of due) {
    try {
      await syncShopSubscription(env, db, id);
    } catch (e) {
      console.error(e);
    }
  }
}

/** Runs across every shop, so it uses the platform client. */
export async function runNightly(env: Env, now = new Date()) {
  const db = createPlatformDb(env.DB);
  const jobs: [string, Promise<unknown>][] = [
    ['backup', backupDatabase(env, now)],
    ['photo purge', purgePhotos(env, now)],
    ['error log prune', opsRepo.pruneErrors(db, addDays(now, -ERROR_KEEP_DAYS))],
    ['rate limit prune', pruneRateLimits(env)],
    ['billing sync', reconcileBilling(env, now)],
  ];
  const results = await Promise.allSettled(jobs.map(([, p]) => p));
  for (const [i, r] of results.entries()) {
    if (r.status === 'rejected') {
      const err = r.reason instanceof Error ? r.reason : new Error(String(r.reason));
      console.error(err);
      await reportError(env, {
        source: 'api',
        message: `Nightly ${jobs[i]![0]}: ${err.message}`,
        stack: err.stack,
      });
    }
  }
}
