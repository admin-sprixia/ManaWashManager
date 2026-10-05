import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Gradient,
  IconBike,
  IconCamera,
  IconCar,
  IconCheck,
  IconChevronRight,
  brandGradients,
  colors,
  formatDateTime,
  formatRupees,
  radius,
  shadow,
  statusColors,
} from '@mana/ui';
import type { Wash } from '../api/types';
import { WASH_STATUS_LABEL, washTitle } from './WashRow';

interface LatestWashCardProps {
  wash: Wash;
  onPress: () => void;
  onSeeAll: () => void;
  /** Overlap the hero (when this is the first card on the screen). */
  overlap?: boolean;
}

/** Home's latest wash: a card that overlaps the hero, with what was done, when, the plate and the total. */
export function LatestWashCard({ wash, onPress, onSeeAll, overlap }: LatestWashCardProps) {
  const tone = statusColors[wash.status];
  const Icon = wash.vehicle.category === 'bike' ? IconBike : IconCar;
  return (
    <View style={[styles.card, overlap && styles.overlap]}>
      <View style={styles.head}>
        <Text style={styles.label} accessibilityRole="header">
          Latest wash
        </Text>
        <Pressable
          onPress={onSeeAll}
          hitSlop={10}
          style={styles.seeAll}
          accessibilityRole="button"
          accessibilityLabel="See all washes"
        >
          <Text style={styles.seeAllText}>See all</Text>
          <IconChevronRight size={16} color={colors.indigo} />
        </Pressable>
      </View>

      <Pressable
        onPress={onPress}
        android_ripple={{ color: colors.indigoPale, borderless: false }}
        style={({ pressed }) => pressed && styles.pressed}
        accessibilityRole="button"
        accessibilityLabel={`${washTitle(wash)} on ${wash.vehicle.registrationNumber}, ${formatDateTime(wash.createdAt)}`}
      >
        <View style={styles.row}>
          <Gradient spec={brandGradients.tile} style={styles.tile}>
            <Icon size={24} color={colors.indigo} />
          </Gradient>
          <View style={styles.copy}>
            <Text style={styles.title} numberOfLines={1}>
              {washTitle(wash)}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {formatDateTime(wash.createdAt)}
            </Text>
          </View>
          <Text style={styles.amount}>{formatRupees(wash.total)}</Text>
          <View style={styles.chevron}>
            <IconChevronRight size={16} color={colors.slate} />
          </View>
        </View>

        <View style={styles.badges}>
          <View style={[styles.badge, { backgroundColor: tone.bg }]}>
            {wash.status === 'paid' ? <IconCheck size={13} color={tone.fg} /> : null}
            <Text style={[styles.badgeText, { color: tone.fg }]}>{WASH_STATUS_LABEL[wash.status]}</Text>
          </View>
          <View style={styles.plate}>
            <Text style={styles.plateText}>{wash.vehicle.registrationNumber}</Text>
          </View>
          {wash.photoCount > 0 ? (
            <View style={styles.photos}>
              <IconCamera size={14} color={colors.slateDeep} />
              <Text style={styles.photosText}>
                {wash.photoCount} {wash.photoCount === 1 ? 'photo' : 'photos'}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E9EDFC',
    ...shadow('md'),
  },
  overlap: { marginTop: -44 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginHorizontal: 2 },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: colors.slateDeep },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAllText: { fontSize: 13.5, fontWeight: '700', color: colors.indigo },
  pressed: { opacity: 0.85 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  tile: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(84,104,212,0.14)',
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 16.5, fontWeight: '700', color: colors.ink, letterSpacing: -0.1 },
  meta: { fontSize: 13.5, color: colors.slateDeep, marginTop: 1 },
  amount: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, color: colors.ink },
  chevron: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  badges: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 13 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingLeft: 9, paddingRight: 11, borderRadius: radius.pill },
  badgeText: { fontSize: 12.5, fontWeight: '700' },
  plate: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 7,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  plateText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8, color: colors.slateDeep },
  photos: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingLeft: 9,
    paddingRight: 11,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photosText: { fontSize: 12.5, fontWeight: '700', color: colors.slateDeep },
});
