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
 * The before and after photos are asked for but optional (some tablets' cameras don't hand the
 * photo back): explains why, opens the camera and keeps the photo on this phone. If the camera
 * hands nothing back, the person can open it again, pick the photo from the gallery or skip.
 * Resolves the photo, 'skip' (carry on without one) or null (go back, nothing done).
 */
export async function offerPhoto(title: string, message: string): Promise<TakenPhoto | 'skip' | null> {
  const choice = await new Promise<'camera' | 'skip' | null>((resolve) =>
    showAlert(
      title,
      message,
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(null) },
        { text: 'Skip photo', onPress: () => resolve('skip') },
        { text: 'Open camera', icon: <IconCamera size={20} color={colors.waterDeep} />, onPress: () => resolve('camera') },
      ],
      { icon: <IconCamera size={26} color={colors.indigo} /> },
    ),
  );
  if (choice !== 'camera') return choice;

  // Saved to the gallery too: if the camera app hands nothing back (it happens on some tablets
  // after the tick), the photo just taken is still there to pick.
  let res: ImagePickerResponse | null = await launchCamera({ ...PICKER_OPTIONS, saveToPhotos: true }).catch(() => null);
  for (;;) {
    const asset = res && !res.didCancel ? res.assets?.find((a) => a.uri) : undefined;
    if (asset?.uri) return (await keep(asset)) ?? 'skip';
    if (res?.errorCode === 'camera_unavailable' || res?.errorCode === 'permission') {
      showToast(res.errorMessage ?? 'The camera isn’t available. Pick the photo from the gallery.', 'error');
    }
    const next = await new Promise<'camera' | 'gallery' | 'skip'>((resolve) =>
      showAlert(
        'No photo came back',
        'If you took the photo and tapped ✓, it is saved in the gallery: pick it from there. Or open the camera again.',
        [
          { text: 'Skip photo', style: 'cancel', onPress: () => resolve('skip') },
          { text: 'Camera again', onPress: () => resolve('camera') },
          { text: 'Pick from gallery', onPress: () => resolve('gallery') },
        ],
        { icon: <IconCamera size={26} color={colors.indigo} /> },
      ),
    );
    if (next === 'skip') return 'skip';
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
