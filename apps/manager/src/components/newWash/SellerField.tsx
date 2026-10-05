import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MAX_SELLERS_PER_JOB } from '@mana/domain';
import { colors, radius, spacing, typography, IconPerson } from '@mana/ui';
import { PeoplePickerSheet, type Person } from '../PeoplePickerSheet';

interface SellerFieldProps {
  /** Commission the picked services carry for this vehicle size, in paise. */
  commission: number;
  sellers: Person[];
  onChange: (sellers: Person[]) => void;
  formatMoney: (paise: number) => string;
}

/**
 * "Who got this service?" — shown only when a picked service pays staff commission (e.g. rust
 * coating). Starts as whoever is entering the wash; up to three people share it equally.
 */
export function SellerField({ commission, sellers, onChange, formatMoney }: SellerFieldProps) {
  const [open, setOpen] = useState(false);
  const each = sellers.length > 1 ? Math.floor(commission / sellers.length) : commission;

  return (
    <View style={styles.group}>
      <Pressable
        onPress={() => setOpen(true)}
        android_ripple={{ color: colors.waterPale }}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={`Who got this service: ${sellers.map((s) => s.name).join(', ')}. Tap to change.`}
      >
        <View style={styles.icon}>
          <IconPerson size={18} color={colors.teal} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>WHO GOT THIS SERVICE?</Text>
          <Text style={styles.title} numberOfLines={1}>
            {sellers.map((s) => s.name).join(', ')}
          </Text>
          <Text style={styles.hint}>
            {sellers.length > 1
              ? `${formatMoney(each)} each · ${formatMoney(commission)} commission, once paid`
              : `Earns ${formatMoney(commission)} commission, once paid`}
          </Text>
        </View>
        <Text style={styles.change}>Change</Text>
      </Pressable>

      <PeoplePickerSheet
        visible={open}
        title="Who got this service?"
        subtitle={`The person who got the customer to take it · ${formatMoney(commission)} commission`}
        confirmLabel="Done"
        max={MAX_SELLERS_PER_JOB}
        initial={sellers}
        sharedHint={(count) => `${formatMoney(Math.floor(commission / count))} each — shared equally.`}
        onClose={() => setOpen(false)}
        onConfirm={(picked) => {
          onChange(picked);
          setOpen(false);
          return Promise.resolve(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: {
    marginTop: spacing.lg,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm + 2,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: { ...typography.caption, color: colors.teal, fontWeight: '700', fontSize: 11 },
  title: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 16 },
  hint: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  change: { ...typography.label, color: colors.water, fontSize: 14 },
});
