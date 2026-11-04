import React, { useCallback } from 'react';
import { launchCamera } from 'react-native-image-picker';
import { MAX_PHOTO_BYTES } from '@mana/domain';
import { IconCamera, colors, showAlert, showToast } from '@mana/ui';
import { useSync } from '../offline/SyncProvider';
import { keepLocalCopy } from '../offline/photoFiles';
import { newId } from '../utils/id';
import { PICKER_OPTIONS } from '../utils/photoPicker';

/**
 * The shop's rule: no car is marked ready without an after photo. It goes in the customer's bill
 * and is the record if anything is questioned later. Resolves true when the wash already has one
 * (on the server or waiting on this phone), or once one is taken with the camera now; false when
 * the person cancels. The gallery isn't offered, so it's a photo of the car as it leaves.
 */
export function useAfterPhotoGate() {
  const { shopItems, submit } = useSync();

  return useCallback(
    async (jobId: string, afterOnServer: number): Promise<boolean> => {
      const queued = shopItems.some(
        (i) => i.op.kind === 'photo.upload' && i.op.payload.jobId === jobId && i.op.payload.kind === 'after',
      );
      if (afterOnServer > 0 || queued) return true;

      const go = await new Promise<boolean>((resolve) =>
        showAlert(
          'Take the after photo',
          'Every car gets an after photo before it is marked ready. It goes in the customer’s bill and protects the shop if anything is questioned later.',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Open camera', icon: <IconCamera size={20} color={colors.waterDeep} />, onPress: () => resolve(true) },
          ],
          { icon: <IconCamera size={26} color={colors.indigo} /> },
        ),
      );
      if (!go) return false;

      const res = await launchCamera({ ...PICKER_OPTIONS, saveToPhotos: false }).catch(() => null);
      if (!res || res.didCancel) return false;
      const asset = res.assets?.find((a) => a.uri);
      if (res.errorCode || !asset?.uri) {
        showToast(res.errorMessage ?? 'Couldn’t get that photo. Try again.', 'error');
        return false;
      }
      if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) {
        showToast('That photo is too large. Try again.', 'error');
        return false;
      }
      try {
        const contentType = asset.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const id = newId();
        const uri = await keepLocalCopy(asset.uri, id, contentType === 'image/png' ? 'png' : 'jpg');
        const result = await submit({
          kind: 'photo.upload',
          payload: { id, jobId, kind: 'after', uri, contentType, occurredAt: new Date().toISOString() },
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
