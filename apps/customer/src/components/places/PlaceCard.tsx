import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { PLACE_TYPE_LABEL, type PlaceType } from '@mana/domain';
import { Gradient, IconChevronRight, IconHome, brandGradients, colors, radius, shadow } from '@mana/ui';
import { API_BASE_URL } from '../../api/client';
import { distanceLine, washDaysLine } from '../../places/format';

interface PlaceLike {
  id: string;
  type: PlaceType;
  name: string | null;
  label: string;
  hasPhoto: boolean;
  washDays: readonly number[];
  washTime: string;
}

/** A place's front photo (public, like prices); a soft tile with a house when there's none. */
export function PlacePhoto({ place, size }: { place: Pick<PlaceLike, 'id' | 'hasPhoto'>; size: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderRadius: Math.round(size / 4) };
  if (!place.hasPhoto || failed) {
    return (
      <Gradient spec={brandGradients.tile} style={[styles.tile, box]}>
        <IconHome size={Math.round(size * 0.45)} color={colors.indigo} />
      </Gradient>
    );
  }
  return (
    <Image
      source={{ uri: `${API_BASE_URL}/c/places/${encodeURIComponent(place.id)}/photo` }}
      style={[styles.photo, box]}
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
    />
  );
}

/** "Sai Residency" or, for a place without a name, its label. */
export const placeTitle = (p: Pick<PlaceLike, 'name' | 'label'>) => p.name || p.label;

/** One place in the nearby list: photo, name, label, distance and wash days. */
export function PlaceRow({
  place,
  distanceM,
  onPress,
}: {
  place: PlaceLike;
  distanceM?: number | null;
  onPress: () => void;
}) {
  const subtitle = [place.name ? place.label : PLACE_TYPE_LABEL[place.type], distanceM != null ? distanceLine(distanceM) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.indigoPale }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${placeTitle(place)}. ${subtitle}`}
    >
      <PlacePhoto place={place} size={56} />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>
          {placeTitle(place)}
        </Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {subtitle}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {washDaysLine(place.washDays, place.washTime)}
        </Text>
      </View>
      <IconChevronRight size={16} color={colors.slate} />
    </Pressable>
  );
}

/** The place being joined, at the top of the join screen. */
export function PlaceHeaderCard({ place, branchName }: { place: PlaceLike; branchName: string }) {
  return (
    <View style={styles.card}>
      <PlacePhoto place={place} size={72} />
      <View style={styles.copy}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {placeTitle(place)}
        </Text>
        {place.name ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {place.label}
          </Text>
        ) : null}
        <Text style={styles.meta}>{washDaysLine(place.washDays, place.washTime)}</Text>
        <Text style={styles.branch}>{branchName}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(84,104,212,0.14)' },
  photo: { backgroundColor: colors.surface },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.white,
  },
  pressed: { backgroundColor: colors.surface },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 16.5, fontWeight: '700', color: colors.ink, letterSpacing: -0.1 },
  subtitle: { fontSize: 13.5, color: colors.slateDeep },
  meta: { fontSize: 12.5, fontWeight: '600', color: colors.indigo },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E9EDFC',
    ...shadow('md'),
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: colors.ink, letterSpacing: -0.2 },
  branch: { fontSize: 12.5, color: colors.slate, marginTop: 2 },
});
