import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MAX_PHOTO_BYTES, MAX_PHOTOS_PER_KIND } from '@mana/domain';
import { IconCamera, IconClose, colors, radius, showToast, spacing, typography } from '@mana/ui';
import { deleteLocalCopy, keepLocalCopy } from '../../offline/photoFiles';
import { newId } from '../../utils/id';
import { pickPhotos } from '../../utils/photoPicker';

/** A before photo kept on this phone until the wash is started (then it uploads with it). */
export interface PendingPhoto {
  id: string;
  uri: string;
  contentType: string;
}

/**
 * Before photos, taken while the vehicle arrives: dents and scratches on record before anyone
 * touches it. They're attached to the wash when it's started and upload when there's signal.
 */
export function BeforePhotos({ photos, onChange }: { photos: PendingPhoto[]; onChange: (next: PendingPhoto[]) => void }) {
  const [adding, setAdding] = useState(false);
  const left = MAX_PHOTOS_PER_KIND - photos.length;

  const add = async () => {
    const picked = await pickPhotos('Before photo', `Scratches, dents, anything to note. You can add ${left} more.`, left);
    if (!picked || picked.didCancel) return;
    const assets = (picked.assets ?? []).filter((a) => a.uri).slice(0, left);
    if (picked.errorCode || assets.length === 0) {
      showToast(picked.errorMessage ?? 'Couldn’t get that photo.', 'error');
      return;
    }
    setAdding(true);
    const next = [...photos];
    let tooBig = 0;
    try {
      for (const a of assets) {
        if (a.fileSize && a.fileSize > MAX_PHOTO_BYTES) {
          tooBig += 1;
          continue;
        }
        const contentType = a.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const id = newId();
        const uri = await keepLocalCopy(a.uri!, id, contentType === 'image/png' ? 'png' : 'jpg');
        next.push({ id, uri, contentType });
      }
    } catch {
      showToast('Couldn’t save that photo.', 'error');
    } finally {
      setAdding(false);
    }
    onChange(next);
    if (tooBig > 0) {
      showToast(`${tooBig === 1 ? 'A photo was' : `${tooBig} photos were`} too large even after shrinking and skipped.`, 'error');
    }
  };

  const remove = (p: PendingPhoto) => {
    void deleteLocalCopy(p.uri);
    onChange(photos.filter((x) => x.id !== p.id));
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>Before photos</Text>
        <Text style={styles.count}>
          {photos.length > 0 ? `${photos.length}/${MAX_PHOTOS_PER_KIND}` : 'Optional · before the wash starts'}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles}>
        {left > 0 ? (
          <Pressable
            onPress={() => void add()}
            disabled={adding}
            style={({ pressed }) => [styles.tile, styles.addTile, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Add a before photo"
          >
            {adding ? <ActivityIndicator color={colors.indigo} /> : <IconCamera size={22} color={colors.indigo} />}
            <Text style={styles.addText}>{photos.length ? 'Add' : 'Take'}</Text>
          </Pressable>
        ) : null}
        {photos.map((p) => (
          <View key={p.id} style={styles.tile}>
            <Image source={{ uri: p.uri }} style={styles.image} />
            <Pressable
              onPress={() => remove(p)}
              hitSlop={8}
              style={styles.remove}
              accessibilityRole="button"
              accessibilityLabel="Remove this photo"
            >
              <IconClose size={11} color={colors.white} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const TILE = 76;

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  count: { ...typography.caption, color: colors.slate, fontSize: 12.5, letterSpacing: 0 },
  tiles: { gap: spacing.sm, paddingRight: spacing.md },
  tile: { width: TILE, height: TILE, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface },
  image: { width: '100%', height: '100%' },
  addTile: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#C7D2FE',
    backgroundColor: colors.indigoPale,
  },
  addText: { ...typography.label, color: colors.indigo, fontSize: 12 },
  pressed: { opacity: 0.7 },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(15,23,42,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
