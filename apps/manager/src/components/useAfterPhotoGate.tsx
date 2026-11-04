import { useCallback } from 'react';
import { showToast } from '@mana/ui';
import { useSync } from '../offline/SyncProvider';
import { takeRequiredPhoto } from '../utils/requiredPhoto';

/**
 * The shop's rule: no car is marked ready without an after photo. It goes in the customer's bill
 * and is the record if anything is questioned later. Resolves true when the wash already has one
 * (on the server or waiting on this phone), or once one is taken with the camera now; false when
 * the person cancels.
 */
export function useAfterPhotoGate() {
  const { shopItems, submit } = useSync();

  return useCallback(
    async (jobId: string, afterOnServer: number): Promise<boolean> => {
      const queued = shopItems.some(
        (i) => i.op.kind === 'photo.upload' && i.op.payload.jobId === jobId && i.op.payload.kind === 'after',
      );
      if (afterOnServer > 0 || queued) return true;

      const photo = await takeRequiredPhoto(
        'Take the after photo',
        'Every car gets an after photo before it is marked ready. It goes in the customer’s bill and protects the shop if anything is questioned later.',
      );
      if (!photo) return false;
      try {
        const result = await submit({
          kind: 'photo.upload',
          payload: { id: photo.id, jobId, kind: 'after', uri: photo.uri, contentType: photo.contentType, occurredAt: new Date().toISOString() },
        });
        if (result.status === 'rejected') {
          showToast(result.message, 'error');
          return false;
        }
        return true;
      } catch {
        showToast('Couldn’t save that photo. Try again.', 'error');
        return false;
      }
    },
    [shopItems, submit],
  );
}
