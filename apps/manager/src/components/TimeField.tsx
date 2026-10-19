import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet, Button, FieldLabel, IconClock, colors, radius, spacing, typography } from '@mana/ui';

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

/** "07:30" → "7:30 AM"; "" → null. */
export function formatAmPm(value: string | null | undefined): string | null {
  const m = value?.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

function parts(value: string | null | undefined) {
  const m = value?.match(/^(\d{2}):(\d{2})$/);
  const h = m ? Number(m[1]) : 9;
  return { hour12: h % 12 === 0 ? 12 : h % 12, minute: m ? Number(m[2]) : 0, pm: h >= 12 };
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A time, picked not typed: hour, minute and AM / PM in a sheet, shown as "7:30 AM". The value
 * is "HH:MM" (24-hour, as stored), or "" for none.
 */
export function TimeField({
  label,
  value,
  onChange,
  placeholder = 'Set time',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hour12, setHour12] = useState(9);
  const [minute, setMinute] = useState(0);
  const [pm, setPm] = useState(false);

  useEffect(() => {
    if (!open) return;
    const p = parts(value);
    setHour12(p.hour12);
    setMinute(p.minute);
    setPm(p.pm);
  }, [open, value]);

  const shown = formatAmPm(value);
  const draft = `${pad((hour12 % 12) + (pm ? 12 : 0))}:${pad(minute)}`;

  return (
    <View style={styles.group}>
      <FieldLabel>{label}</FieldLabel>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown ?? placeholder}`}
      >
        <View style={styles.icon}>
          <IconClock size={16} color={colors.indigo} />
        </View>
        <Text style={[styles.value, !shown && styles.placeholder]}>{shown ?? placeholder}</Text>
      </Pressable>

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={label}
        subtitle={formatAmPm(draft) ?? undefined}
        footer={
          <View style={styles.footer}>
            {value ? (
              <View style={styles.flex}>
                <Button
                  label="Clear"
                  variant="ghost"
                  onPress={() => {
                    onChange('');
                    setOpen(false);
                  }}
                />
              </View>
            ) : null}
            <View style={styles.flex}>
              <Button
                label={`Set ${formatAmPm(draft)}`}
                onPress={() => {
                  onChange(draft);
                  setOpen(false);
                }}
              />
            </View>
          </View>
        }
      >
        <View style={styles.ampm} accessibilityRole="tablist">
          {(['AM', 'PM'] as const).map((k) => {
            const on = (k === 'PM') === pm;
            return (
              <Pressable key={k} onPress={() => setPm(k === 'PM')} style={[styles.ampmBtn, on && styles.ampmBtnOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <Text style={[styles.ampmText, on && styles.ampmTextOn]}>{k === 'AM' ? 'AM · morning' : 'PM · afternoon / night'}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.gridLabel}>Hour</Text>
        <View style={styles.grid}>
          {HOURS.map((h) => {
            const on = h === hour12;
            return (
              <Pressable key={h} onPress={() => setHour12(h)} style={[styles.cell, on && styles.cellOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.cellText, on && styles.cellTextOn]}>{h}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.gridLabel}>Minutes</Text>
        <View style={styles.grid}>
          {MINUTES.map((m) => {
            const on = m === minute;
            return (
              <Pressable key={m} onPress={() => setMinute(m)} style={[styles.cell, on && styles.cellOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                <Text style={[styles.cellText, on && styles.cellTextOn]}>:{pad(m)}</Text>
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: 6, flex: 1 },
  pressed: { opacity: 0.8 },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 54,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  icon: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.indigoPale, alignItems: 'center', justifyContent: 'center' },
  value: { ...typography.bodyStrong, fontSize: 17, fontWeight: '800', color: colors.waterInk, letterSpacing: 0.2 },
  placeholder: { color: colors.slate, fontWeight: '600', fontSize: 15 },
  footer: { flexDirection: 'row', gap: spacing.sm },
  ampm: { flexDirection: 'row', padding: 4, borderRadius: radius.pill, backgroundColor: colors.surface, gap: 4 },
  ampmBtn: { flex: 1, height: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  ampmBtnOn: { backgroundColor: colors.indigo },
  ampmText: { ...typography.label, fontSize: 13.5, fontWeight: '800', color: colors.slateDeep },
  ampmTextOn: { color: colors.white },
  gridLabel: { ...typography.caption, fontSize: 12, fontWeight: '800', color: colors.slate, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell: {
    width: '22%',
    flexGrow: 1,
    height: 46,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  cellText: { ...typography.bodyStrong, fontSize: 16, fontWeight: '800', color: colors.waterInk },
  cellTextOn: { color: colors.white },
});
