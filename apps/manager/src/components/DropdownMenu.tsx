import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { IconCheck, IconChevronDown, colors, spacing, typography } from '@mana/ui';
import type { SelectOption } from './SelectField';

const ROW = 46;
const MAX_ROWS = 6;

/**
 * A small dropdown that opens right under its field (or above it near the bottom of the screen),
 * instead of a full sheet — for short pick-one lists like a clock time.
 */
export function DropdownMenu<T extends string>({
  value,
  options,
  onChange,
  icon,
  accent = colors.indigo,
  accentPale = colors.indigoPale,
  style,
  accessibilityLabel,
}: {
  value: T | null;
  options: readonly SelectOption<T>[];
  onChange: (v: T) => void;
  icon?: React.ReactNode;
  accent?: string;
  accentPale?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const anchor = useRef<View>(null);
  const [frame, setFrame] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const { height: screenH } = useWindowDimensions();
  const selected = options.find((o) => o.value === value) ?? null;
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const listH = Math.min(options.length, MAX_ROWS) * ROW + 8;

  const open = () => anchor.current?.measureInWindow((x, y, w, h) => setFrame({ x, y, w, h }));
  const close = () => setFrame(null);

  const below = frame ? frame.y + frame.h + 6 + listH < screenH - 24 : true;
  const top = frame ? (below ? frame.y + frame.h + 6 : frame.y - listH - 6) : 0;

  return (
    <>
      <Pressable
        ref={anchor}
        onPress={open}
        style={({ pressed }) => [styles.trigger, style, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ? `${accessibilityLabel}: ${selected?.label ?? 'not set'}` : undefined}
      >
        {icon ? <View style={[styles.icon, { backgroundColor: accentPale }]}>{icon}</View> : null}
        <Text style={styles.value} numberOfLines={1}>
          {selected?.label ?? 'Choose'}
        </Text>
        <IconChevronDown size={16} color={accent} />
      </Pressable>

      {/* Edge-to-edge app: the modal must start at the very top so window coordinates line up. */}
      <Modal visible={frame != null} transparent statusBarTranslucent animationType="fade" onRequestClose={close}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
        {frame ? (
          <View style={[styles.menu, { top, left: frame.x, width: Math.max(frame.w, 140), maxHeight: listH }]}>
            <ScrollView
              contentOffset={{ x: 0, y: Math.max(0, (index - 2) * ROW) }}
              showsVerticalScrollIndicator={options.length > MAX_ROWS}
              contentContainerStyle={styles.list}
            >
              {options.map((o) => {
                const on = o.value === value;
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => {
                      onChange(o.value);
                      close();
                    }}
                    style={({ pressed }) => [styles.row, on && { backgroundColor: accentPale }, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.rowText, on && { color: accent }]}>{o.label}</Text>
                    {on ? <IconCheck size={14} color={accent} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    height: 56,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  pressed: { opacity: 0.8 },
  icon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  value: { ...typography.heading, fontSize: 19, color: colors.waterInk, flex: 1, letterSpacing: -0.2 },
  menu: {
    position: 'absolute',
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: '#0C1442',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  list: { paddingVertical: 4 },
  row: {
    height: ROW,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginHorizontal: 4,
    borderRadius: 10,
  },
  rowText: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk },
});
