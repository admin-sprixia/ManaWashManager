import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import { istDate } from '../utils/format';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { IconCalendar, IconCheck, IconChevronDown } from './Icons';
import { RangeCalendar, rangeDays, rangeLabel, shortDate, type DateRange } from './RangeCalendar';

export type PeriodKey = 'today' | 'week' | 'month' | 'year';

export const PERIOD_OPTIONS: { key: PeriodKey; label: string; hint: string }[] = [
  { key: 'today', label: 'Today', hint: 'Since midnight' },
  { key: 'week', label: 'Last 7 days', hint: 'Rolling week, including today' },
  { key: 'month', label: 'This month', hint: 'From the 1st' },
  { key: 'year', label: 'This year', hint: 'From 1 January' },
];

export type { DateRange };

interface CustomRange {
  /** The applied range; non-null means "Custom dates" is the active period. */
  range: DateRange | null;
  onApply: (range: DateRange) => void;
  /** Earliest pickable day. */
  min?: string;
  /** Longest allowed range, counting both ends. The reports API caps at a year. */
  maxDays?: number;
}

/** Period dropdown: one trigger row; options (and optional custom From → To dates) in a bottom sheet. */
export function PeriodSelect<K extends string = PeriodKey>({
  value,
  onChange,
  options = PERIOD_OPTIONS as unknown as { key: K; label: string; hint: string }[],
  menuTitle = 'Show numbers for',
  custom,
}: {
  value: K;
  onChange: (next: K) => void;
  options?: { key: K; label: string; hint: string }[];
  menuTitle?: string;
  custom?: CustomRange;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const today = istDate(0);
  const maxDays = custom?.maxDays ?? 366;
  const customOn = custom?.range != null;
  const selected = options.find((o) => o.key === value) ?? options[0]!;

  useEffect(() => {
    if (!open) return;
    setPicking(customOn);
    setFrom(custom?.range?.from ?? null);
    setTo(custom?.range?.to ?? null);
  }, [open, customOn, custom?.range?.from, custom?.range?.to]);

  const draft = from && to ? { from, to } : null;
  const tooLong = draft != null && rangeDays(draft) > maxDays;

  const pick = (key: K) => {
    setOpen(false);
    onChange(key);
  };

  const apply = () => {
    if (!draft || tooLong || !custom) return;
    setOpen(false);
    custom.onApply(draft);
  };

  const applied = custom?.range ?? null;
  const triggerLabel = applied ? 'Custom dates' : selected.label;
  const triggerHint = applied
    ? `${rangeLabel(applied)} · ${rangeDays(applied)} day${rangeDays(applied) === 1 ? '' : 's'}`
    : selected.hint;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Period: ${triggerLabel}. Change`}
      >
        <View style={styles.triggerIcon}>
          <IconCalendar size={16} color={colors.waterDeep} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.triggerLabel}>{triggerLabel}</Text>
          <Text style={styles.hint} numberOfLines={1}>
            {triggerHint}
          </Text>
        </View>
        <View style={styles.chevron}>
          <IconChevronDown size={16} color={colors.waterDeep} />
        </View>
      </Pressable>

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={picking ? 'Pick dates' : 'Choose period'}
        subtitle={picking ? 'Tap the first day, then the last day.' : menuTitle}
        footer={
          picking ? (
            <Button
              label={
                tooLong
                  ? `Pick ${maxDays} days or fewer`
                  : draft
                    ? `Show ${rangeLabel(draft)}`
                    : from
                      ? 'Now tap the last day'
                      : 'Tap the first day'
              }
              disabled={!draft || tooLong}
              onPress={apply}
            />
          ) : undefined
        }
      >
        {picking ? (
          <>
            <View style={styles.rangeBand}>
              <View style={[styles.rangeEnd, !(from != null && !to) && styles.rangeEndActive]}>
                <Text style={styles.rangeCaption}>From</Text>
                <Text style={[styles.rangeValue, !from && styles.rangeEmpty]}>
                  {from ? shortDate(from) : 'Pick a day'}
                </Text>
              </View>
              <Text style={styles.rangeArrow}>→</Text>
              <View style={[styles.rangeEnd, from != null && !to && styles.rangeEndNext]}>
                <Text style={styles.rangeCaption}>To</Text>
                <Text style={[styles.rangeValue, !to && styles.rangeEmpty]}>
                  {to ? shortDate(to) : 'Pick a day'}
                </Text>
              </View>
            </View>
            {draft ? (
              <Text style={[styles.rangeMeta, tooLong && styles.rangeMetaBad]}>
                {rangeDays(draft)} day{rangeDays(draft) === 1 ? '' : 's'}
                {tooLong ? ` — the most is ${maxDays}` : ''}
              </Text>
            ) : null}
            <RangeCalendar
              from={from}
              to={to}
              min={custom?.min}
              max={today}
              onChange={(f, t) => {
                setFrom(f);
                setTo(t);
              }}
            />
            <Pressable
              onPress={() => setPicking(false)}
              style={({ pressed }) => [styles.backLink, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.backLinkText}>Back to quick periods</Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.list}>
            {options.map((o, i) => {
              const on = !customOn && o.key === value;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => pick(o.key)}
                  style={({ pressed }) => [
                    styles.row,
                    i > 0 && styles.rowDivider,
                    on && styles.rowOn,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <View style={styles.flex}>
                    <Text style={[styles.rowLabel, on && styles.rowLabelOn]}>{o.label}</Text>
                    <Text style={styles.hint}>{o.hint}</Text>
                  </View>
                  <View style={[styles.radio, on && styles.radioOn]}>
                    {on ? <IconCheck size={12} color={colors.white} /> : null}
                  </View>
                </Pressable>
              );
            })}
            {custom ? (
              <Pressable
                onPress={() => setPicking(true)}
                style={({ pressed }) => [
                  styles.row,
                  styles.rowDivider,
                  customOn && styles.rowOn,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: customOn }}
              >
                <View style={styles.flex}>
                  <Text style={[styles.rowLabel, customOn && styles.rowLabelOn]}>Custom dates</Text>
                  <Text style={styles.hint}>
                    {customOn
                      ? rangeLabel(custom.range!)
                      : 'Pick any From → To range on a calendar'}
                  </Text>
                </View>
                <View style={styles.calBadge}>
                  <IconCalendar size={15} color={colors.waterDeep} />
                </View>
              </Pressable>
            ) : null}
          </View>
        )}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 1 },
  pressed: { opacity: 0.8 },
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
  triggerIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerLabel: { ...typography.bodyStrong, color: colors.waterInk },
  hint: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  chevron: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    marginHorizontal: -spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 6,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowOn: { backgroundColor: '#F0F9FF' },
  rowLabel: { ...typography.bodyStrong, color: colors.waterInk },
  rowLabelOn: { color: colors.waterDeep },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.water, borderColor: colors.water },
  calBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeBand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rangeEnd: {
    flex: 1,
    gap: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  rangeEndActive: { borderColor: colors.water, backgroundColor: '#F0F9FF' },
  rangeEndNext: { borderColor: colors.water, backgroundColor: '#F0F9FF' },
  rangeCaption: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '800',
    color: colors.slate,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  rangeValue: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk },
  rangeEmpty: { color: colors.slate, fontWeight: '600' },
  rangeArrow: { ...typography.bodyStrong, color: colors.slate },
  rangeMeta: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slateDeep,
    textAlign: 'center',
    letterSpacing: 0,
    marginTop: -spacing.xs,
  },
  rangeMetaBad: { color: colors.danger, fontWeight: '700' },
  backLink: { alignSelf: 'center', paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  backLinkText: { ...typography.label, fontSize: 13.5, color: colors.waterDeep },
});
