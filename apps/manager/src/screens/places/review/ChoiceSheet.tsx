import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ProposedSlot } from '@mana/domain';
import { BottomSheet, Button, IconCalendar, colors, spacing, typography } from '@mana/ui';
import { SheetHead, SheetLabel, SheetNotice } from '../../../components/SheetBits';
import { TEAL, TEAL_MIST } from '../panel/parts';
import { DAY_SELECT_OPTIONS, daysSummary, time12 } from './options';
import { TimeField } from './TimeField';

/** One more day-and-time choice from the residents: days ticked in a list, and a time. */
export function ChoiceSheet({
  visible,
  title,
  onClose,
  onSave,
}: {
  visible: boolean;
  /** "3rd choice". */
  title: string;
  onClose: () => void;
  /** Resolves with an error message, or null once it's saved. */
  onSave: (slot: ProposedSlot) => Promise<string | null>;
}) {
  const [days, setDays] = useState<string[]>(['6']);
  const [time, setTime] = useState('07:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDays(['6']);
    setTime('07:00');
    setError(null);
  }, [visible]);

  const toggle = (d: string) => setDays((all) => (all.includes(d) ? (all.length > 1 ? all.filter((x) => x !== d) : all) : [...all, d]));

  const save = async () => {
    setBusy(true);
    const message = await onSave({ days: days.map(Number), time });
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={`Add ${title}`}
      footer={<Button label={`Save · ${daysSummary(days)} · ${time12(time)}`} loading={busy} onPress={() => void save()} />}
    >
      <View style={styles.body}>
        <SheetHead tone="amber" icon={<IconCalendar size={20} color={colors.amberDeep} />} title="What did residents ask for?" caption="Tick the days, then pick the time." />
        <SheetLabel>Days</SheetLabel>
        <View style={styles.days} accessibilityRole="radiogroup">
          {DAY_SELECT_OPTIONS.map((d, i) => {
            const on = days.includes(d.value);
            return (
              <Pressable
                key={d.value}
                onPress={() => toggle(d.value)}
                style={({ pressed }) => [styles.day, i > 0 && styles.dayDivider, on && styles.dayOn, pressed && styles.pressed]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <Text style={[styles.dayText, on && styles.dayTextOn]}>{d.label}</Text>
                <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
              </Pressable>
            );
          })}
        </View>
        <TimeField value={time} onChange={setTime} />
        {error ? <SheetNotice tone="danger">{error}</SheetNotice> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  days: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', backgroundColor: colors.white },
  day: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4 },
  dayDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  dayOn: { backgroundColor: TEAL_MIST },
  pressed: { opacity: 0.8 },
  dayText: { ...typography.bodyStrong, fontSize: 15.5, color: colors.waterInk },
  dayTextOn: { color: TEAL, fontWeight: '800' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: TEAL },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: TEAL },
});
