import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing, typography } from '@mana/ui';

/** The big rupee field used for the morning cash, the closing count and doorstep handovers. */
export function MoneyInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  right,
  accessibilityLabel,
}: {
  value: string;
  onChange: (t: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  right?: React.ReactNode;
  accessibilityLabel?: string;
}) {
  const filled = value.trim().length > 0;
  return (
    <View style={[styles.moneyField, filled && styles.moneyFieldFilled]}>
      <Text style={[styles.moneyRupee, filled && styles.moneyRupeeFilled]}>₹</Text>
      <TextInput
        style={styles.moneyInput}
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholder={placeholder}
        placeholderTextColor={colors.slate}
        autoFocus={autoFocus}
        maxLength={9}
        accessibilityLabel={accessibilityLabel}
      />
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  moneyField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 60,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  moneyFieldFilled: { borderColor: colors.indigo, backgroundColor: colors.white },
  moneyRupee: { ...typography.heading, fontSize: 24, color: colors.slate },
  moneyRupeeFilled: { color: colors.ink },
  moneyInput: { ...typography.heading, flex: 1, fontSize: 26, color: colors.ink, paddingVertical: 0 },
});
