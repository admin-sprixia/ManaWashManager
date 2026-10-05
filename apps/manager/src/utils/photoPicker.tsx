import React from 'react';
import { launchCamera, launchImageLibrary, type ImagePickerResponse } from 'react-native-image-picker';
import { PHOTO_MAX_EDGE_PX } from '@mana/domain';
import { showAlert, IconCamera, IconImage, colors } from '@mana/ui';

/** Shrunk on the phone before upload, so a photo stays well under the server's size limit. */
const PICKER_OPTIONS = {
  mediaType: 'photo' as const,
  maxWidth: PHOTO_MAX_EDGE_PX,
  maxHeight: PHOTO_MAX_EDGE_PX,
  quality: 0.7 as const,
  includeBase64: false,
};

/**
 * "Take photo / Choose from gallery" in the app's own alert. Resolves with the picker's answer,
 * or null when cancelled or the picker failed. The gallery allows up to `limit` photos.
 */
export function pickPhotos(title: string, hint: string, limit = 1): Promise<ImagePickerResponse | null> {
  return new Promise((resolve) => {
    showAlert(
      title,
      hint,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
        {
          text: 'Take photo',
          icon: <IconCamera size={20} color={colors.waterDeep} />,
          onPress: () =>
            void launchCamera({ ...PICKER_OPTIONS, saveToPhotos: false }).then(resolve, () => resolve(null)),
        },
        {
          text: 'Choose from gallery',
          icon: <IconImage size={20} color={colors.waterDeep} />,
          onPress: () =>
            void launchImageLibrary({ ...PICKER_OPTIONS, selectionLimit: limit }).then(resolve, () =>
              resolve(null),
            ),
        },
      ],
      { icon: <IconCamera size={26} color={colors.waterDeep} /> },
    );
  });
}
