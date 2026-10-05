import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gradient, IconBike, IconCamera, IconCar, IconChevronRight, brandGradients, colors, formatDateTime, formatRupees, radius } from '@mana/ui';
import type { Wash } from '../api/types';
import { CHEVRON } from './CardList';

export const WASH_STATUS_LABEL: Record<Wash['status'], string> = {
  waiting: 'In the queue',
  washing: 'Washing now',
  ready: 'Ready to collect',
  paid: 'Done',
};

export function washTitle(wash: Pick<Wash, 'services'>): string {
  return (
    wash.services.map((s) => (s.quantity > 1 ? `${s.name} × ${s.quantity}` : s.name)).join(', ') || 'Wash'
  );
}

/** The pill for a wash that is still in progress. */
const LIVE_PILL = {
  waiting: { bg: '#EEF0FA', fg: colors.slateDeep, dot: colors.slate },
  washing: { bg: colors.indigoPale, fg: colors.indigoMid, dot: colors.indigoBright },
  ready: { bg: colors.amberLight, fg: colors.amberDeep, dot: colors.amber },
} as const;

interface WashRowProps {
  wash: Wash;
  onPress: () => void;
  /** Show the plate on the row (only when the customer has more than one vehicle). */
  showPlate?: boolean;
}

/**
 * One wash in a list, as a full-width row: the icon tile, what was done and the amount, then the date,
 * the plate (if more than one vehicle) and the photo count on one line. A wash that is still in
 * progress shows a status pill instead of the date, and an accent on its left edge.
 */
export function WashRow({ wash, onPress, showPlate }: WashRowProps) {
  const live = wash.status !== 'paid' ? LIVE_PILL[wash.status] : null;
  const Icon = wash.vehicle.category === 'bike' ? IconBike : IconCar;
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.indigoPale }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${washTitle(wash)} on ${wash.vehicle.registrationNumber}, ${formatDateTime(wash.createdAt)}`}
    >
      {live ? (
        <Gradient
          spec={{
            colors: wash.status === 'ready' ? ['#FBBF24', colors.amber] : [colors.indigoBright, colors.indigoDeep],
            start: { x: 0, y: 0 },
            end: { x: 0, y: 1 },
          }}
          style={styles.accent}
        />
      ) : null}
      <Gradient spec={brandGradients.tile} style={styles.tile}>
        <Icon size={22} color={colors.indigo} />
      </Gradient>
      <View style={styles.copy}>
        <View style={styles.line1}>
          <Text style={styles.title} numberOfLines={1}>
            {washTitle(wash)}
          </Text>
          <Text style={styles.total}>{formatRupees(wash.total)}</Text>
        </View>
        <View style={styles.line2}>
          {live ? (
            <View style={[styles.pill, { backgroundColor: live.bg }]}>
              <View style={[styles.dot, { backgroundColor: live.dot }]} />
              <Text style={[styles.pillText, { color: live.fg }]}>{WASH_STATUS_LABEL[wash.status]}</Text>
            </View>
          ) : (
            <Text style={styles.date}>{formatDateTime(wash.createdAt)}</Text>
          )}
          {showPlate ? (
            <View style={styles.plate}>
              <Text style={styles.plateText}>{wash.vehicle.registrationNumber}</Text>
            </View>
          ) : null}
          {wash.photoCount > 0 ? (
            <View style={styles.photos}>
              <IconCamera size={14} color={colors.slateDeep} />
              <Text style={styles.photosText}>{wash.photoCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <IconChevronRight size={16} color={CHEVRON} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingLeft: 16,
    paddingRight: 14,
    backgroundColor: colors.white,
  },
  pressed: { backgroundColor: colors.surface },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(84,104,212,0.14)',
  },
  copy: { flex: 1, minWidth: 0 },
  line1: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  title: { flexShrink: 1, fontSize: 16.5, fontWeight: '700', color: colors.ink, letterSpacing: -0.1 },
  total: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  line2: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4, marginTop: 3 },
  date: { fontSize: 13.5, color: colors.slateDeep },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3, paddingHorizontal: 10, borderRadius: radius.pill },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 12, fontWeight: '800' },
  plate: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 7, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  plateText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8, color: colors.slateDeep },
  photos: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  photosText: { fontSize: 12.5, fontWeight: '700', color: colors.slateDeep },
});
