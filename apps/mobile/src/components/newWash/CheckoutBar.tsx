import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../Button';
import { IconDroplet } from '../Icons';
import { colors, spacing, typography } from '../../theme';
import { formatRupees } from '../../utils/format';

interface CheckoutBarProps {
  serviceCount: number;
  subtotal: number;
  discount: number;
  /** What to call the discount in the summary, e.g. "8% coupon". */
  discountLabel?: string;
  total: number;
  /** What's still missing, in plain words. Null when the wash can start. */
  missing: string | null;
  submitting: boolean;
  onSubmit: () => void;
}

/** Pinned bill + primary action. Explains a disabled button instead of leaving the user guessing. */
export function CheckoutBar({
  serviceCount,
  subtotal,
  discount,
  discountLabel = 'discount',
  total,
  missing,
  submitting,
  onSubmit,
}: CheckoutBarProps) {
  const insets = useSafeAreaInsets();
  const ready = missing == null;

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <View style={styles.summary}>
        <View style={styles.summaryCopy}>
          <Text style={styles.summaryTitle}>
            {serviceCount > 0
              ? `${serviceCount} service${serviceCount === 1 ? '' : 's'}`
              : 'No services yet'}
          </Text>
          <Text style={[styles.summaryHint, !ready && styles.summaryHintMissing]} numberOfLines={1}>
            {!ready
              ? missing
              : discount > 0
                ? `${formatRupees(subtotal)} − ${formatRupees(discount)} ${discountLabel}`
                : 'Ready to start'}
          </Text>
        </View>
        <Text style={styles.total} accessibilityLabel={`Total ${formatRupees(total)}`}>
          {formatRupees(total)}
        </Text>
      </View>
      <Button
        label={
          submitting ? 'Starting…' : ready ? `Start wash · ${formatRupees(total)}` : 'Start wash'
        }
        size="lg"
        onPress={onSubmit}
        loading={submitting}
        disabled={!ready}
        icon={<IconDroplet size={16} color={colors.white} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 4,
    gap: spacing.sm + 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    shadowColor: colors.waterMidnight,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryCopy: { flex: 1 },
  summaryTitle: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  summaryHint: {
    ...typography.caption,
    color: colors.tealDeep,
    letterSpacing: 0,
    fontSize: 13,
    marginTop: 1,
  },
  summaryHintMissing: { color: colors.amberDeep },
  total: { ...typography.title, color: colors.waterInk, fontSize: 28, letterSpacing: -0.5 },
});
