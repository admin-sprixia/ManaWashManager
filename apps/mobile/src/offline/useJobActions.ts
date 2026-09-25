import { useCallback } from 'react';
import type { PaymentMethod } from '@mana/domain';
import { showToast } from '../components/Toast';
import { useSync, type SubmitResult } from './SyncProvider';

/**
 * Job Board and Job Detail change jobs through here, so both get the same offline behaviour:
 * sent now when there's signal, otherwise queued with a clear "saved on this phone" toast.
 * Each action resolves with an error message to show, or null when it's done / queued.
 */
export function useJobActions() {
  const { submit } = useSync();

  const settle = (result: SubmitResult, offlineText: string): string | null => {
    if (result.status === 'rejected') return result.message;
    if (result.status === 'queued') showToast(offlineText, 'offline');
    return null;
  };

  const advance = useCallback(
    async (jobId: string, status: 'washing' | 'ready') =>
      settle(
        await submit({ kind: 'job.status', payload: { jobId, status, occurredAt: new Date().toISOString() } }),
        'Saved offline — will sync automatically',
      ),
    [submit],
  );

  const pay = useCallback(
    async (jobId: string, paymentMethod: PaymentMethod) =>
      settle(
        await submit({ kind: 'job.pay', payload: { jobId, paymentMethod, occurredAt: new Date().toISOString() } }),
        'Payment saved offline — will sync automatically',
      ),
    [submit],
  );

  const voidJob = useCallback(
    async (jobId: string, reason: string) =>
      settle(
        await submit({ kind: 'job.void', payload: { jobId, reason, occurredAt: new Date().toISOString() } }),
        'Void saved offline — will sync automatically',
      ),
    [submit],
  );

  return { advance, pay, voidJob };
}
