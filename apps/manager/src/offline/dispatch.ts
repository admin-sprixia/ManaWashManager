import { api, apiErrorMessage, uploadExpense, uploadPhoto, type ApiResponse } from '../api/client';
import { NetworkError } from '../api/network';
import { deleteLocalCopy, localFileExists } from './photoFiles';
import type { OutboxOp } from './types';

/** Phone copies of photos an op carries; removed once the server has them or the op is dropped. */
export function opLocalFiles(op: OutboxOp): string[] {
  if (op.kind === 'photo.upload') return [op.payload.uri];
  if (op.kind === 'expense.create') {
    return [op.payload.billPhoto?.uri, op.payload.itemPhoto?.uri].filter((u): u is string => Boolean(u));
  }
  return [];
}

export type SendResult =
  | { ok: true; data: unknown }
  /** Never reached the server — keep it queued. */
  | { ok: false; kind: 'network' }
  /** The session ended (signed out elsewhere, PIN changed) — keep it queued for next sign-in. */
  | { ok: false; kind: 'auth' }
  /** Server hiccup (5xx, rate limit, busy) — keep it queued, try again later with backoff. */
  | { ok: false; kind: 'retry'; message: string }
  /** The server said no (validation, permission, branch paused) — replaying won't help as things stand. */
  | { ok: false; kind: 'rejected'; message: string }
  /** Someone else already moved the job on; the server's state wins, nothing to do. */
  | { ok: false; kind: 'superseded' };

async function call(op: OutboxOp, asToken?: string): Promise<ApiResponse> {
  const as = asToken ? { headers: { Authorization: `Bearer ${asToken}` } } : undefined;
  switch (op.kind) {
    case 'job.start':
      return api.jobs.start.$post({ json: op.payload }, as);
    case 'job.status':
      return api.jobs[':id'].status.$patch({
        param: { id: op.payload.jobId },
        json:
          op.payload.status === 'washing'
            ? { status: 'washing', occurredAt: op.payload.occurredAt, washerIds: op.payload.washerIds }
            : { status: 'ready', occurredAt: op.payload.occurredAt },
      }, as);
    case 'job.washers':
      return api.jobs[':id'].washers.$put({
        param: { id: op.payload.jobId },
        json: { washerIds: op.payload.washerIds },
      }, as);
    case 'job.sellers':
      return api.jobs[':id'].sellers.$put({
        param: { id: op.payload.jobId },
        json: { sellerIds: op.payload.sellerIds },
      }, as);
    case 'photo.upload':
      return uploadPhoto(op.payload, asToken);
    case 'job.pay':
      return api.jobs[':id'].pay.$post({
        param: { id: op.payload.jobId },
        json: { paymentMethod: op.payload.paymentMethod, occurredAt: op.payload.occurredAt },
      }, as);
    case 'job.void':
      return api.jobs[':id'].void.$post({
        param: { id: op.payload.jobId },
        json: { reason: op.payload.reason, occurredAt: op.payload.occurredAt },
      }, as);
    case 'expense.create':
      return uploadExpense(op.payload, asToken);
    case 'stock.move':
      return api.stock.moves.$post({ json: op.payload }, as);
    case 'place.visit': {
      const { placeId, ...json } = op.payload;
      return api.places[':id'].visits.$post({ param: { id: placeId }, json }, as);
    }
  }
}

/**
 * Sends one outbox operation and classifies the outcome for the sync loop. `asToken` sends it as
 * the session that queued it, so a branch switched to mid-sync can't receive another's changes.
 */
export async function sendOp(op: OutboxOp, asToken?: string): Promise<SendResult> {
  // A missing photo file makes the upload fail exactly like a lost signal; catch it here so it
  // doesn't wait forever.
  for (const uri of opLocalFiles(op)) {
    if (!(await localFileExists(uri))) {
      return {
        ok: false,
        kind: 'rejected',
        message: 'The photo saved on this phone is gone (Android cleared it). Discard this and add it again.',
      };
    }
  }

  let res: ApiResponse;
  try {
    res = await call(op, asToken);
  } catch (e) {
    if (e instanceof NetworkError) return { ok: false, kind: 'network' };
    return { ok: false, kind: 'retry', message: e instanceof Error ? e.message : 'Unexpected error' };
  }

  if (res.ok) {
    for (const uri of opLocalFiles(op)) void deleteLocalCopy(uri);
    return { ok: true, data: await res.json().catch(() => null) };
  }
  // Read the body once; it decides the outcome and gives the message.
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const replay: ApiResponse = { ok: false, status: res.status, json: () => Promise.resolve(body) };
  const error = typeof body?.error === 'string' ? body.error : null;

  if (res.status === 401 || (res.status === 403 && (error === 'account_disabled' || error === 'branch_closed' || error === 'pin_upgrade_required'))) {
    return { ok: false, kind: 'auth' };
  }
  if (res.status >= 500 || res.status === 429 || (res.status === 409 && error === 'busy')) {
    return { ok: false, kind: 'retry', message: await apiErrorMessage(replay) };
  }
  // A status change that lost the race (job already further along or voided) isn't an error.
  if (res.status === 409 && op.kind === 'job.status') return { ok: false, kind: 'superseded' };
  // That wash day is already recorded (this same send landed earlier, or a teammate did it).
  if (res.status === 409 && op.kind === 'place.visit') return { ok: false, kind: 'superseded' };
  return { ok: false, kind: 'rejected', message: await apiErrorMessage(replay) };
}
