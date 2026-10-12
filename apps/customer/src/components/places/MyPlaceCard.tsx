import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconChevronRight, IconHome, colors, radius, shadow } from '@mana/ui';
import type { Membership } from '../../api/types';
import { NEEDS_PAYMENT, nextWashOf, washDayLine } from '../../places/format';
import { PlacePhoto, placeTitle } from './PlaceCard';

/** Home's card for the place the customer lives: next wash day, and anything waiting on them. */
export function MyPlaceCard({ membership: m, onPress }: { membership: Membership; onPress: () => void }) {
  const live = m.vehicles.flatMap((v) => (v.orders[0] ? [v.orders[0]] : []));
  const owing = live.filter((o) => NEEDS_PAYMENT.has(o.phase)).length;
  const ending = live.filter((o) => o.renewalDue).length;
  const next = nextWashOf(live);
  const status =
    m.status === 'pending'
      ? { text: 'Waiting for the team to confirm', tone: styles.amber }
      : owing
        ? { text: owing === 1 ? 'Payment due · tap to pay' : `${owing} payments due · tap to pay`, tone: styles.amber }
        : ending
          ? { text: ending === 1 ? 'Plan ending soon · tap to renew' : `${ending} plans ending soon · tap to renew`, tone: styles.amber }
          : next
            ? { text: `Next wash ${washDayLine(next, m.place.washTime)}`, tone: styles.teal }
            : null;

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.indigoPale }}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <PlacePhoto place={m.place} size={56} />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>
          {placeTitle(m.place)}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {m.unit} · {m.vehicles.length === 1 ? '1 vehicle' : `${m.vehicles.length} vehicles`}
        </Text>
        {status ? (
          <Text style={[styles.status, status.tone]} numberOfLines={1}>
            {status.text}
          </Text>
        ) : null}
      </View>
      <View style={styles.chevron}>
        <IconChevronRight size={16} color={colors.slate} />
      </View>
    </Pressable>
  );
}

/** For customers not on a place yet: their building or colony may already be served. */
export function WashAtHomePromo({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.promo}>
      <View style={styles.row}>
        <View style={styles.tile}>
          <IconHome size={22} color={colors.indigo} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title} accessibilityRole="header">
            Wash at your home
          </Text>
          <Text style={styles.body}>Our team may already wash cars at your apartment or colony. Plans from one wash a week.</Text>
        </View>
      </View>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.cta, pressed && styles.pressed]} accessibilityRole="button">
        <Text style={styles.ctaText}>Find my place</Text>
        <IconChevronRight size={15} color={colors.white} />
      </Pressable>
    </View>
  );
}

const card = {
  marginHorizontal: 16,
  borderRadius: radius.lg,
  backgroundColor: colors.white,
  borderWidth: 1,
  borderColor: '#E9EDFC',
  ...shadow('md'),
} as const;

const styles = StyleSheet.create({
  card: { ...card, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  pressed: { opacity: 0.88 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 16.5, fontWeight: '700', color: colors.ink, letterSpacing: -0.1 },
  meta: { fontSize: 13.5, color: colors.slateDeep },
  status: { fontSize: 13.5, fontWeight: '700', marginTop: 2 },
  amber: { color: colors.amberDeep },
  teal: { color: colors.tealDeep },
  chevron: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  promo: { ...card, padding: 16, gap: 14, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  tile: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.indigoPale },
  body: { fontSize: 13.5, lineHeight: 19, color: colors.slateDeep, marginTop: 2 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: colors.indigoMid,
  },
  ctaText: { fontSize: 15, fontWeight: '800', color: colors.white },
});
