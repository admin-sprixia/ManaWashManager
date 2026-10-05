import React, { useCallback } from 'react';
import type { PaymentMethod } from '@mana/domain';
import { showToast, showAlert, IconGift, colors } from '@mana/ui';
import { giftLine } from '../utils/rewards';
import { useSync, type SubmitResult } from './SyncProvider';
import type { BoardJob } from './types';

/** A first paid visit writes the welcome gift: tell whoever took the money to hand it over. */
function announceWelcomeGift(data: unknown): void {
  const job = data as Partial<BoardJob> | null;
  const gifts = job?.gifts ?? [];
  const given = gifts.filter((g) => g.status === 'given');
  const owed = gifts.filter((g) => g.status === 'owed');
  if (given.length === 0 && owed.length === 0) return;
  const plate = job?.vehicle?.registrationNumber;
  const lines = [
    given.length > 0 ? `Hand over now: ${given.map(giftLine).join(', ')}.` : null,
    owed.length > 0
      ? `${owed.map((g) => g.itemName).join(', ')} ${owed.length === 1 ? 'is' : 'are'} out of stock — saved as owed for their next visit.`
      : null,
  ].filter(Boolean);
  showAlert(`Welcome gift${plate ? ` · ${plate}` : ''}`, `First visit for this car. ${lines.join(' ')}`, [{ text: 'Done' }], {
    icon: React.createElement(IconGift, { size: 26, color: colors.tealDeep }),
  });
}

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
    async (jobId: string, status: 'washing' | 'ready', washers?: { id: string; name: string }[]) =>
      settle(
        await submit({
          kind: 'job.status',
          payload: {
            jobId,
            status,
            occurredAt: new Date().toISOString(),
            ...(washers ? { washerIds: washers.map((w) => w.id) } : {}),
          },
          ...(washers ? { meta: { washers } } : {}),
        }),
        'Saved offline — will sync automatically',
      ),
    [submit],
  );

  const setWashers = useCallback(
    async (jobId: string, washers: { id: string; name: string }[]) =>
      settle(
        await submit({
          kind: 'job.washers',
          payload: { jobId, washerIds: washers.map((w) => w.id), occurredAt: new Date().toISOString() },
          meta: { washers },
        }),
        'Washers saved offline — will sync automatically',
      ),
    [submit],
  );

  const setSellers = useCallback(
    async (jobId: string, sellers: { id: string; name: string }[]) =>
      settle(
        await submit({
          kind: 'job.sellers',
          payload: { jobId, sellerIds: sellers.map((s) => s.id), occurredAt: new Date().toISOString() },
          meta: { sellers },
        }),
        'Saved offline — will sync automatically',
      ),
    [submit],
  );

  const pay = useCallback(
    async (jobId: string, paymentMethod: PaymentMethod) => {
      const result = await submit({
        kind: 'job.pay',
        payload: { jobId, paymentMethod, occurredAt: new Date().toISOString() },
      });
      if (result.status === 'sent') announceWelcomeGift(result.data);
      return settle(result, 'Payment saved offline — will sync automatically');
    },
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

  return { advance, setWashers, setSellers, pay, voidJob };
}
