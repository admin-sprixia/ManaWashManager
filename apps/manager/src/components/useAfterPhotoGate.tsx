import { useCallback } from 'react';
import { showToast } from '@mana/ui';
import { useSync } from '../offline/SyncProvider';
import { offerPhoto } from '../utils/requiredPhoto';

/**
 * The after photo, asked for when a car is marked ready: it goes in the customer's bill and is the
 * record if anything is questioned later. Optional (some tablets' cameras don't hand the photo
 * back). Resolves true when the wash has one, one is taken now, or the person skips it; false
 * when they go back.
 */
export function useAfterPhotoGate() {
  const { shopItems, submit } = useSync();

  return useCallback(
    async (jobId: string, afterOnServer: number): Promise<boolean> => {
      const queued = shopItems.some(
        (i) => i.op.kind === 'photo.upload' && i.op.payload.jobId === jobId && i.op.payload.kind === 'after',
      );
      if (afterOnServer > 0 || queued) return true;

      const photo = await offerPhoto(
        'Take the after photo?',
        'It goes in the customer’s bill and protects the shop if anything is questioned later. Skip it if the camera isn’t working; you can add it from the wash page.',
      );
      if (photo === null) return false;
      if (photo === 'skip') return true;
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
