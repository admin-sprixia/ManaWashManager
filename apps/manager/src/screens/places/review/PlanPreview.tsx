import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { IconCalendar, IconCheck, IconClock, IconLock, IconUsers, colors, radius, spacing, typography } from '@mana/ui';
import { TEAL, TEAL_PALE } from '../panel/parts';
import { daysSummary, time12 } from './options';
import type { WashSettings } from './useWashSettings';

/** How the community will run with what's picked right now — updates as the owner chooses. */
export function PlanPreview({ settings, teamNames, title }: { settings: WashSettings; teamNames: string[]; title: string }) {
  const { days, time, approval, capacity } = settings;
  const ready = days.length > 0;
  const items = [
    { icon: <IconCalendar size={16} color={TEAL} />, label: 'Days', value: days.length ? daysSummary(days) : 'Not picked' },
    { icon: <IconClock size={16} color={TEAL} />, label: 'Time', value: time12(time) },
    { icon: <IconUsers size={16} color={TEAL} />, label: 'Team', value: teamNames.length ? teamNames.join(', ') : 'Nobody yet' },
    {
      icon: <IconLock size={16} color={TEAL} />,
      label: 'Joining',
      value: `${approval === 'yes' ? 'We confirm' : 'Open to all'} · ${capacity.trim() ? `${capacity} a day` : 'no limit'}`,
    },
  ];
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{title}</Text>
        <View style={[styles.pill, !ready && styles.pillWarn]}>
          {ready ? <IconCheck size={11} color={TEAL} /> : null}
          <Text style={[styles.pillText, !ready && styles.pillTextWarn]}>{ready ? 'Ready' : 'Pick days'}</Text>
        </View>
      </View>
      <View style={styles.grid}>
        {items.map((i) => (
          <View key={i.label} style={styles.item}>
            <View style={styles.itemIcon}>{i.icon}</View>
            <View style={styles.itemCopy}>
              <Text style={styles.itemLabel}>{i.label}</Text>
              <Text style={styles.itemValue} numberOfLines={2}>
                {i.value}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    gap: spacing.sm + 4,
    borderRadius: 20,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: TEAL_PALE,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...typography.label, fontSize: 12, fontWeight: '800', color: colors.slateDeep, letterSpacing: 0.7, textTransform: 'uppercase' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: '#ECFDF5' },
  pillWarn: { backgroundColor: '#FFFBEB' },
  pillText: { ...typography.caption, fontSize: 11.5, fontWeight: '800', color: TEAL, letterSpacing: 0 },
  pillTextWarn: { color: colors.amberDeep },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm + 4, columnGap: spacing.sm },
  item: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  itemIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#F0FDFA', alignItems: 'center', justifyContent: 'center' },
  itemCopy: { flex: 1, gap: 1 },
  itemLabel: { ...typography.caption, fontSize: 11, fontWeight: '700', color: colors.slate, letterSpacing: 0.2 },
  itemValue: { ...typography.bodyStrong, fontSize: 14, fontWeight: '800', color: colors.waterInk },
});
