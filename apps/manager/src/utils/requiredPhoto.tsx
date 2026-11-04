import React from 'react';
import { launchCamera } from 'react-native-image-picker';
import { MAX_PHOTO_BYTES } from '@mana/domain';
import { IconCamera, colors, showAlert, showToast } from '@mana/ui';
import { keepLocalCopy } from '../offline/photoFiles';
import { newId } from './id';
import { PICKER_OPTIONS } from './photoPicker';

/** A photo saved on this phone, ready to queue for upload. */
export interface TakenPhoto {
  id: string;
  uri: string;
  contentType: string;
}

/**
 * The shop's rule that every car has a before and an after photo: explains why, opens the camera
 * (never the gallery, so it's the car as it is now) and keeps the photo on this phone. Null when
 * the person cancels or the camera fails.
 */
export async function takeRequiredPhoto(title: string, message: string): Promise<TakenPhoto | null> {
  const go = await new Promise<boolean>((resolve) =>
    showAlert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Open camera', icon: <IconCamera size={20} color={colors.waterDeep} />, onPress: () => resolve(true) },
      ],
      { icon: <IconCamera size={26} color={colors.indigo} /> },
    ),
  );
  if (!go) return null;

  const res = await launchCamera({ ...PICKER_OPTIONS, saveToPhotos: false }).catch(() => null);
  if (!res || res.didCancel) return null;
  const asset = res.assets?.find((a) => a.uri);
  if (res.errorCode || !asset?.uri) {
    showToast(res.errorMessage ?? 'Couldn’t get that photo. Try again.', 'error');
    return null;
  }
  if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) {
    showToast('That photo is too large. Try again.', 'error');
    return null;
  }
  try {
    const contentType = asset.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const id = newId();
    const uri = await keepLocalCopy(asset.uri, id, contentType === 'image/png' ? 'png' : 'jpg');
    return { id, uri, contentType };
  } catch {
    showToast('Couldn’t save that photo. Try again.', 'error');
    return null;
  }
}
