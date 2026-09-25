import { api, apiErrorMessage, type ApiResponse } from '../api/client';
import { NetworkError } from '../api/network';
import type { OutboxOp } from './types';

export type SendResult =
  | { ok: true; data: unknown }
  /** Never reached the server — keep it queued. */
  | { ok: false; kind: 'network' }
  /** Server hiccup (5xx) — keep it queued, try again later. */
  | { ok: false; kind: 'retry'; message: string }
  /** The server said no (validation, permission) — replaying won't help. */
  | { ok: false; kind: 'rejected'; message: string }
  /** Someone else already moved the job on; the server's state wins, nothing to do. */
  | { ok: false; kind: 'superseded' };

async function call(op: OutboxOp): Promise<ApiResponse> {
  switch (op.kind) {
    case 'job.start':
      return api.jobs.start.$post({ json: op.payload });
    case 'job.status':
      return api.jobs[':id'].status.$patch({
        param: { id: op.payload.jobId },
        json: { status: op.payload.status, occurredAt: op.payload.occurredAt },
      });
    case 'job.pay':
      return api.jobs[':id'].pay.$post({
        param: { id: op.payload.jobId },
        json: { paymentMethod: op.payload.paymentMethod, occurredAt: op.payload.occurredAt },
      });
    case 'job.void':
      return api.jobs[':id'].void.$post({
        param: { id: op.payload.jobId },
        json: { reason: op.payload.reason, occurredAt: op.payload.occurredAt },
      });
    case 'expense.create':
      return api.expenses.$post({ json: op.payload });
  }
}

/** Sends one outbox operation and classifies the outcome for the sync loop. */
export async function sendOp(op: OutboxOp): Promise<SendResult> {
  let res: ApiResponse;
  try {
    res = await call(op);
  } catch (e) {
    if (e instanceof NetworkError) return { ok: false, kind: 'network' };
    return { ok: false, kind: 'retry', message: e instanceof Error ? e.message : 'Unexpected error' };
  }

  if (res.ok) return { ok: true, data: await res.json().catch(() => null) };
  if (res.status >= 500) return { ok: false, kind: 'retry', message: await apiErrorMessage(res) };
  // A status change that lost the race (job already further along or voided) isn't an error.
  if (res.status === 409 && op.kind === 'job.status') return { ok: false, kind: 'superseded' };
  return { ok: false, kind: 'rejected', message: await apiErrorMessage(res) };
}
