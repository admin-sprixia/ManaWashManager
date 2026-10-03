import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconAlert, IconCheck, IconStar } from '../Icons';
import { colors, radius, spacing, typography } from '../../theme';
import type { RewardCard } from '../../offline/types';
import { cardExpiryWarning, cardProgressLabel } from '../../utils/rewards';

/** Cards up to this size draw one dot per stamp; bigger ones draw a bar. */
const MAX_DOTS = 12;

interface StampCardViewProps {
  card: RewardCard;
  now?: Date;
  /** "Use free wash" on New Wash: shown only when the card has a free wash. */
  action?: {
    on: boolean;
    disabled?: boolean;
    /** Why it can't be used right now, e.g. "Needs internet". */
    note?: string | null;
    onToggle: () => void;
  };
  /** Inside a list row instead of a standalone card. */
  flat?: boolean;
}

function Stamps({ card }: { card: RewardCard }) {
  if (card.every > MAX_DOTS) {
    const pct = Math.min(1, card.stamps / card.every);
    return (
      <View style={styles.track} accessibilityElementsHidden>
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>
    );
  }
  return (
    <View style={styles.dots} accessibilityElementsHidden>
      {Array.from({ length: card.every }, (_, i) => (
        <View key={i} style={[styles.dot, i < card.stamps && styles.dotOn]}>
          {i < card.stamps ? <IconCheck size={9} color={colors.white} /> : null}
        </View>
      ))}
    </View>
  );
}

/** One car's stamp card for one service: stamps so far, free washes ready, and a reset warning. */
export function StampCardView({ card, now = new Date(), action, flat }: StampCardViewProps) {
  const hasFree = card.free > 0;
  const warning = cardExpiryWarning(card, now);
  const label = cardProgressLabel(card);

  return (
    <View
      style={[styles.card, flat && styles.flat, hasFree && !flat && styles.cardFree, action?.on && styles.cardOn]}
      accessible={!action}
      accessibilityLabel={`${card.serviceName} stamp card. ${label}.${warning ? ` ${warning}.` : ''}`}
    >
      <View style={[styles.icon, hasFree && styles.iconFree]}>
        <IconStar size={17} color={hasFree ? colors.white : colors.amberDeep} />
      </View>
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {card.serviceName}
          </Text>
          {hasFree ? (
            <View style={styles.freeBadge}>
              <Text style={styles.freeBadgeText}>{card.free > 1 ? `${card.free} FREE` : 'FREE'}</Text>
            </View>
          ) : null}
        </View>
        <Stamps card={card} />
        <Text style={styles.meta}>{label}</Text>
        {warning ? (
          <View style={styles.warnRow}>
            <IconAlert size={13} color={colors.amberDeep} />
            <Text style={styles.warn}>{warning}</Text>
          </View>
        ) : null}
        {action && hasFree && action.note && !action.on ? <Text style={styles.note}>{action.note}</Text> : null}
      </View>
      {action && hasFree ? (
        <Pressable
          onPress={action.onToggle}
          disabled={action.disabled && !action.on}
          style={({ pressed }) => [
            styles.btn,
            action.on && styles.btnOn,
            action.disabled && !action.on && styles.btnDisabled,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: action.on, disabled: action.disabled && !action.on }}
          accessibilityLabel={action.on ? `Don’t use the free ${card.serviceName}` : `Use the free ${card.serviceName}`}
          hitSlop={6}
        >
          <Text style={[styles.btnText, action.on && styles.btnTextOn]}>{action.on ? 'Remove' : 'Use free'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  flat: {
    marginHorizontal: 0,
    marginTop: 0,
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: colors.white,
    paddingVertical: spacing.sm + 4,
  },
  cardFree: { borderColor: colors.amber, borderWidth: 1.5 },
  cardOn: { backgroundColor: '#ECFDF5', borderColor: colors.teal, borderWidth: 1.5 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconFree: { backgroundColor: colors.amber },
  copy: { flex: 1, gap: 5 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15, flexShrink: 1 },
  freeBadge: {
    backgroundColor: colors.amber,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  freeBadgeText: { ...typography.caption, color: colors.white, fontWeight: '800', fontSize: 10, letterSpacing: 0.6 },
  dots: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#FCD34D',
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotOn: { backgroundColor: colors.amber, borderColor: colors.amber },
  track: { height: 6, borderRadius: 3, backgroundColor: '#FDE68A', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.amber },
  meta: { ...typography.caption, color: colors.slateDeep, fontSize: 13, letterSpacing: 0 },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  warn: { ...typography.caption, color: colors.amberDeep, fontWeight: '700', fontSize: 13, letterSpacing: 0 },
  note: { ...typography.caption, color: colors.amberDeep, letterSpacing: 0 },
  btn: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.teal,
  },
  btnOn: { backgroundColor: colors.white, borderWidth: 1, borderColor: '#A7F3D0' },
  btnDisabled: { backgroundColor: '#CBD5E1' },
  btnText: { ...typography.label, color: colors.white },
  btnTextOn: { color: colors.tealDeep },
  pressed: { opacity: 0.85 },
});
