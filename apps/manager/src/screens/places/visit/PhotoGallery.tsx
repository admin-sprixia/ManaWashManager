import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PLACE_PHOTO_KIND_LABEL, type PlacePhotoKind } from '@mana/domain';
import { IconCamera, IconClose, colors, radius, spacing, typography } from '@mana/ui';
import { PrivatePhoto, placePhotoPath, type PhotoItem } from '../communityParts';

/** Each kind of photo has its own colour, so the gate, parking, wash space, water and power points are easy to tell apart. */
export const PHOTO_KIND_TONE: Record<PlacePhotoKind, { fg: string; bg: string }> = {
  gate: { fg: '#334155', bg: '#E2E8F0' },
  parking: { fg: '#0F766E', bg: '#CCFBF1' },
  space: { fg: '#166534', bg: '#DCFCE7' },
  water: { fg: '#0369A1', bg: '#E0F2FE' },
  power: { fg: '#A16207', bg: '#FEF9C3' },
  building: { fg: '#92400E', bg: '#FEF3C7' },
  other: { fg: colors.indigo, bg: colors.indigoPale },
};

function KindBadge({ kind, solid }: { kind: PlacePhotoKind; solid?: boolean }) {
  const t = PHOTO_KIND_TONE[kind];
  return (
    <View style={[styles.badge, { backgroundColor: solid ? t.fg : t.bg }]}>
      <Text style={[styles.badgeText, { color: solid ? colors.white : t.fg }]}>{PLACE_PHOTO_KIND_LABEL[kind]}</Text>
    </View>
  );
}

/** The visit's photos: a big first one, the rest as tiles, and a full-screen viewer to swipe through. */
export function PhotoGallery({ placeId, photos }: { placeId: string; photos: readonly PhotoItem[] }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The viewer draws under the status bar; Android's inset can read 0 inside a modal.
  const top = Math.max(insets.top, StatusBar.currentHeight ?? 0);
  const barH = top + spacing.sm + 38 + spacing.sm;

  if (!photos.length) {
    return (
      <View style={styles.empty}>
        <IconCamera size={22} color={colors.slate} />
        <Text style={styles.emptyText}>No photos from the visit yet</Text>
      </View>
    );
  }

  const [cover, ...rest] = photos;
  const kinds = [...new Set(photos.map((p) => p.kind))];

  return (
    <View style={styles.gallery}>
      <Pressable onPress={() => setViewing(0)} accessibilityRole="imagebutton" accessibilityLabel={`${PLACE_PHOTO_KIND_LABEL[cover!.kind]} photo, open`}>
        <PrivatePhoto path={placePhotoPath(placeId, cover!.id)} style={styles.cover} />
        <View style={styles.coverFoot}>
          <KindBadge kind={cover!.kind} solid />
        </View>
        <View style={styles.coverCount}>
          <IconCamera size={12} color={colors.white} />
          <Text style={styles.coverCountText}>{photos.length}</Text>
        </View>
      </Pressable>

      {rest.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
          {rest.map((p, i) => (
            <Pressable key={p.id} onPress={() => setViewing(i + 1)} style={styles.thumb} accessibilityRole="imagebutton" accessibilityLabel={`${PLACE_PHOTO_KIND_LABEL[p.kind]} photo`}>
              <PrivatePhoto path={placePhotoPath(placeId, p.id)} style={styles.thumbImg} />
              <View style={[styles.thumbBar, { backgroundColor: PHOTO_KIND_TONE[p.kind].fg }]} />
              <Text style={[styles.thumbLabel, { color: PHOTO_KIND_TONE[p.kind].fg }]} numberOfLines={1}>
                {PLACE_PHOTO_KIND_LABEL[p.kind]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.kinds}>
        {kinds.map((k) => (
          <KindBadge key={k} kind={k} />
        ))}
      </View>

      <Modal visible={viewing != null} transparent statusBarTranslucent animationType="fade" onRequestClose={() => setViewing(null)}>
        <View style={styles.viewer}>
          <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
          <ScrollView
            style={{ marginTop: barH, marginBottom: insets.bottom + spacing.md }}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: (viewing ?? 0) * width, y: 0 }}
            onMomentumScrollEnd={(e) => setViewing(Math.round(e.nativeEvent.contentOffset.x / width))}
          >
            {photos.map((p) => (
              <View key={p.id} style={[styles.page, { width }]}>
                <PrivatePhoto path={placePhotoPath(placeId, p.id)} style={styles.full} fit="contain" />
              </View>
            ))}
          </ScrollView>
          <View style={[styles.viewerTop, { paddingTop: top + spacing.sm }]}>
            {viewing != null && photos[viewing] ? <KindBadge kind={photos[viewing].kind} solid /> : null}
            <Text style={styles.viewerCount}>
              {(viewing ?? 0) + 1} / {photos.length}
            </Text>
            <Pressable onPress={() => setViewing(null)} style={styles.close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close photos">
              <IconClose size={18} color={colors.white} />
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  gallery: { gap: spacing.sm },
  cover: { width: '100%', aspectRatio: 16 / 10, borderRadius: 18, backgroundColor: '#F0FDFA' },
  coverFoot: { position: 'absolute', left: spacing.sm + 2, bottom: spacing.sm + 2 },
  coverCount: {
    position: 'absolute',
    right: spacing.sm + 2,
    top: spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(12,20,66,0.55)',
  },
  coverCountText: { ...typography.caption, fontSize: 11.5, fontWeight: '800', color: colors.white, letterSpacing: 0 },
  thumbs: { gap: spacing.sm },
  thumb: { width: 84, gap: 4 },
  thumbImg: { width: 84, height: 72, borderRadius: 12 },
  thumbBar: { position: 'absolute', left: 8, right: 8, top: 66, height: 3, borderRadius: 2 },
  thumbLabel: { ...typography.caption, fontSize: 11, fontWeight: '800', letterSpacing: 0, textAlign: 'center' },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { ...typography.caption, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.2 },
  empty: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.lg,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  emptyText: { ...typography.label, fontSize: 13.5, color: colors.slate, fontWeight: '700' },
  viewer: { flex: 1, backgroundColor: 'rgba(6,10,34,0.96)' },
  page: { flex: 1, justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
  viewerTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  viewerCount: { ...typography.label, fontSize: 14, fontWeight: '700', color: 'rgba(255,255,255,0.85)', flex: 1 },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
});
