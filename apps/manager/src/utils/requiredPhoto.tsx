import React from 'react';
import { launchCamera, launchImageLibrary, type Asset, type ImagePickerResponse } from 'react-native-image-picker';
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
 * and keeps the photo on this phone. If the camera hands nothing back, the person can open it
 * again or pick the photo just taken from the gallery. Null when they cancel.
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

  // Saved to the gallery too: if the camera app hands nothing back (it happens on some tablets
  // after the tick), the photo just taken is still there to pick.
  let res: ImagePickerResponse | null = await launchCamera({ ...PICKER_OPTIONS, saveToPhotos: true }).catch(() => null);
  for (;;) {
    const asset = res && !res.didCancel ? res.assets?.find((a) => a.uri) : undefined;
    if (asset?.uri) return keep(asset);
    if (res?.errorCode === 'camera_unavailable' || res?.errorCode === 'permission') {
      showToast(res.errorMessage ?? 'The camera isn’t available. Pick the photo from the gallery.', 'error');
    }
    const next = await new Promise<'camera' | 'gallery' | null>((resolve) =>
      showAlert(
        'No photo came back',
        'If you took the photo and tapped ✓, it is saved in the gallery: pick it from there. Or open the camera again.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
          { text: 'Camera again', onPress: () => resolve('camera') },
          { text: 'Pick from gallery', onPress: () => resolve('gallery') },
        ],
        { icon: <IconCamera size={26} color={colors.indigo} /> },
      ),
    );
    if (!next) return null;
    res =
      next === 'camera'
        ? await launchCamera({ ...PICKER_OPTIONS, saveToPhotos: true }).catch(() => null)
        : await launchImageLibrary({ ...PICKER_OPTIONS, selectionLimit: 1 }).catch(() => null);
  }
}

async function keep(asset: Asset): Promise<TakenPhoto | null> {
  if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) {
    showToast('That photo is too large. Try again.', 'error');
    return null;
  }
  try {
    const contentType = asset.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const id = newId();
    const uri = await keepLocalCopy(asset.uri!, id, contentType === 'image/png' ? 'png' : 'jpg');
    return { id, uri, contentType };
  } catch {
    showToast('Couldn’t save that photo. Try again.', 'error');
    return null;
  }
}
