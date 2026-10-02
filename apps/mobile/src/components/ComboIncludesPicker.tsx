import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Service } from '@mana/domain';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { IconCheck, IconGift, IconPlus } from './Icons';

interface ComboIncludesPickerProps {
  /** Plain services the combo can bundle. */
  services: Service[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Shown in the empty state so the owner can go make single services first. */
  onCreateSingle?: () => void;
}

const COMBO_INK = '#5B21B6';
const COMBO_TINT = '#F5F3FF';
const COMBO_ACCENT = '#7C3AED';

/** Tick the services a combo bundles; a combo needs at least two. */
export function ComboIncludesPicker({ services, selected, onChange, onCreateSingle }: ComboIncludesPickerProps) {
  if (services.length < 2) {
    return (
      <View style={styles.empty}>
        <View style={styles.emptyIcon}>
          <IconGift size={26} color={COMBO_ACCENT} />
        </View>
        <Text style={styles.emptyTitle}>Combos bundle your services</Text>
        <Text style={styles.emptyText}>
          Add at least two single services first — like Foam Wash and Interior Cleaning — then bundle them here at
          one price.
        </Text>
        {onCreateSingle ? (
          <Pressable
            onPress={onCreateSingle}
            style={({ pressed }) => [styles.emptyBtn, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <IconPlus size={16} color={colors.white} />
            <Text style={styles.emptyBtnText}>Create a single service</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  const on = new Set(selected);
  return (
    <View style={[styles.card, shadow('sm')]}>
      {services.map((s, i) => {
        const picked = on.has(s.id);
        return (
          <Pressable
            key={s.id}
            onPress={() => onChange(picked ? selected.filter((id) => id !== s.id) : [...selected, s.id])}
            style={({ pressed }) => [
              styles.row,
              i > 0 && styles.divider,
              picked && styles.rowOn,
              pressed && styles.rowPressed,
            ]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: picked }}
          >
            <View style={[styles.check, picked && styles.checkOn]}>
              {picked ? <IconCheck size={14} color={colors.white} /> : null}
            </View>
            <View style={styles.copy}>
              <Text style={[styles.name, picked && styles.nameOn]} numberOfLines={1}>
                {s.name}
              </Text>
              {s.description?.trim() ? (
                <Text style={styles.desc} numberOfLines={1}>
                  {s.description.trim()}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  rowOn: { backgroundColor: COMBO_TINT },
  rowPressed: { opacity: 0.7 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  check: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.slate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: COMBO_ACCENT, borderColor: COMBO_ACCENT },
  copy: { flex: 1, gap: 2 },
  name: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  nameOn: { color: COMBO_INK, fontWeight: '700' },
  desc: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0 },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: COMBO_TINT,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
    ...shadow('sm'),
  },
  emptyTitle: { ...typography.bodyStrong, fontSize: 16, color: COMBO_INK, textAlign: 'center' },
  emptyText: { ...typography.body, fontSize: 14, lineHeight: 20, color: colors.slateDeep, textAlign: 'center' },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    height: 42,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.pill,
    backgroundColor: COMBO_ACCENT,
  },
  emptyBtnText: { ...typography.label, fontSize: 14, color: colors.white, fontWeight: '700' },
  pressed: { opacity: 0.75 },
});
