import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FieldLabel, IconClock, colors, spacing, typography } from '@mana/ui';
import { DropdownMenu } from '../../../components/DropdownMenu';
import { TEAL, TEAL_PALE } from '../panel/parts';
import { clockOptions, meridiemOf, switchMeridiem, type Meridiem } from './options';

/** A wash time as a clock dropdown ("7:00") and AM / PM beside it. Value is "HH:MM", 24-hour. */
export function TimeField({ label = 'Time', value, onChange, hint }: { label?: string; value: string; onChange: (t: string) => void; hint?: string }) {
  const meridiem = meridiemOf(value);
  const options = useMemo(() => clockOptions(meridiem, value), [meridiem, value]);

  return (
    <View style={styles.group}>
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.row}>
        <DropdownMenu
          value={value}
          options={options}
          onChange={onChange}
          icon={<IconClock size={17} color={TEAL} />}
          accent={TEAL}
          accentPale={TEAL_PALE}
          style={styles.clock}
          accessibilityLabel={label}
        />
        <View style={styles.meridiem} accessibilityRole="radiogroup">
          {(['AM', 'PM'] as Meridiem[]).map((m) => {
            const on = m === meridiem;
            return (
              <Pressable
                key={m}
                onPress={() => onChange(switchMeridiem(value, m))}
                style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && !on && styles.pressed]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{m}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  clock: { flex: 1 },
  meridiem: {
    flexDirection: 'row',
    height: 56,
    padding: 4,
    gap: 4,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chip: { width: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: TEAL },
  pressed: { backgroundColor: colors.white },
  chipText: { ...typography.label, fontSize: 15, fontWeight: '800', color: colors.slateDeep, letterSpacing: 0.5 },
  chipTextOn: { color: colors.white },
  hint: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0, lineHeight: 17 },
});
