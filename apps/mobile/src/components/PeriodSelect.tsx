import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { IconCalendar, IconCheck, IconChevronDown } from './Icons';

export type PeriodKey = 'today' | 'week' | 'month' | 'year';

export const PERIOD_OPTIONS: { key: PeriodKey; label: string; hint: string }[] = [
  { key: 'today', label: 'Today', hint: 'Since midnight' },
  { key: 'week', label: 'Last 7 days', hint: 'Rolling week, including today' },
  { key: 'month', label: 'This month', hint: 'From the 1st' },
  { key: 'year', label: 'This year', hint: 'From 1 January' },
];

/** Dropdown period selector — a single trigger row, options in a floating menu. */
export function PeriodSelect({
  value,
  onChange,
  options = PERIOD_OPTIONS,
}: {
  value: PeriodKey;
  onChange: (next: PeriodKey) => void;
  options?: typeof PERIOD_OPTIONS;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.key === value) ?? options[0]!;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Period: ${selected.label}. Change`}
      >
        <View style={styles.triggerIcon}>
          <IconCalendar size={16} color={colors.waterDeep} />
        </View>
        <View style={styles.triggerCopy}>
          <Text style={styles.triggerLabel}>{selected.label}</Text>
          <Text style={styles.triggerHint}>{selected.hint}</Text>
        </View>
        <IconChevronDown size={18} color={colors.waterDeep} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={[styles.menu, shadow('lg')]}>
            <Text style={styles.menuTitle}>Show numbers for</Text>
            {options.map((o) => {
              const on = o.key === value;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => {
                    setOpen(false);
                    onChange(o.key);
                  }}
                  style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <View style={styles.triggerCopy}>
                    <Text style={[styles.optionLabel, on && styles.optionLabelOn]}>{o.label}</Text>
                    <Text style={styles.triggerHint}>{o.hint}</Text>
                  </View>
                  {on ? <IconCheck size={18} color={colors.water} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  pressed: { opacity: 0.8 },
  triggerIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerCopy: { flex: 1, gap: 1 },
  triggerLabel: { ...typography.bodyStrong, color: colors.waterInk },
  triggerHint: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 47, 73, 0.4)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  menu: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    overflow: 'hidden',
  },
  menuTitle: {
    ...typography.label,
    color: colors.slateDeep,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 11,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    gap: spacing.sm,
  },
  optionOn: { backgroundColor: colors.waterPale },
  optionLabel: { ...typography.bodyStrong, color: colors.waterInk },
  optionLabelOn: { color: colors.waterDeep },
});
