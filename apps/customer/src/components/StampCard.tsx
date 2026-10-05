import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { daysUntilReset, isRewardExpiringSoon, stampsToGo } from '@mana/domain';
import { IconAlert, IconCheck, IconStar, colors, radius, spacing, typography } from '@mana/ui';
import type { Vehicle } from '../api/types';

export type Card = Vehicle['cards'][number];

/** Cards up to this size draw one dot per stamp; bigger ones draw a bar. */
const MAX_DOTS = 12;

export function progress(card: Card): string {
  if (card.free > 0) {
    return card.free === 1 ? 'A free wash is ready. Ask for it on your next visit.' : `${card.free} free washes are ready.`;
  }
  const left = stampsToGo(card.every, card);
  return `${left} more ${left === 1 ? 'wash' : 'washes'} and the next one is free.`;
}

export function warning(card: Card, now: Date): string | null {
  const expiry = { expiresAt: card.expiresAt ? new Date(card.expiresAt) : null };
  if (!isRewardExpiringSoon(expiry, now)) return null;
  const days = daysUntilReset(expiry, now) ?? 0;
  const when = days <= 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`;
  return card.free > 0 ? `Use it before it expires ${when}` : `Stamps reset ${when} without a ${card.serviceName}`;
}

/** A free-wash card as a list row: stamps so far for one service on one vehicle. */
export function StampCard({ card, now = new Date(), vehicle }: { card: Card; now?: Date; vehicle?: string }) {
  const hasFree = card.free > 0;
  const warn = warning(card, now);
  const label = progress(card);
  return (
    <View
      style={[styles.card, hasFree && styles.cardFree]}
      accessible
      accessibilityLabel={`${card.serviceName}: ${card.stamps} of ${card.every} stamps. ${label}${warn ? ` ${warn}.` : ''}`}
    >
      <View style={[styles.icon, hasFree && styles.iconFree]}>
        <IconStar size={17} color={hasFree ? colors.white : colors.amberDeep} />
      </View>
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {card.serviceName}
            {vehicle ? <Text style={styles.vehicle}>{`  ·  ${vehicle}`}</Text> : null}
          </Text>
          <Text style={styles.count}>
            {card.stamps}/{card.every}
          </Text>
        </View>
        {card.every > MAX_DOTS ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(1, card.stamps / card.every) * 100}%` }]} />
          </View>
        ) : (
          <View style={styles.dots}>
            {Array.from({ length: card.every }, (_, i) => (
              <View key={i} style={[styles.dot, i < card.stamps && styles.dotOn]}>
                {i < card.stamps ? <IconCheck size={9} color={colors.white} /> : null}
              </View>
            ))}
          </View>
        )}
        <Text style={[styles.meta, hasFree && styles.metaFree]}>{label}</Text>
        {warn ? (
          <View style={styles.warnRow}>
            <IconAlert size={13} color={colors.amberDeep} />
            <Text style={styles.warn}>{warn}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    backgroundColor: colors.white,
  },
  cardFree: { backgroundColor: '#FFFBEB' },
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconFree: { backgroundColor: colors.amber },
  copy: { flex: 1, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.bodyStrong, color: colors.waterInk, flex: 1 },
  vehicle: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0.6, fontWeight: '700' },
  count: { ...typography.label, color: colors.amberDeep },
  dots: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#FCD34D',
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.amberLight, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.amber },
  meta: { ...typography.caption, color: colors.slateDeep, fontSize: 13, letterSpacing: 0, lineHeight: 18 },
  metaFree: { color: colors.amberDeep, fontWeight: '700' },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  warn: { ...typography.caption, color: colors.amberDeep, fontWeight: '700', fontSize: 13, letterSpacing: 0 },
});
