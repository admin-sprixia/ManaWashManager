import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconCheck, IconGift } from '../Icons';
import { colors, radius, spacing, typography } from '../../theme';

export interface UsableCoupon {
  code: string;
  percent: number;
  expiresAt: string;
  issuedFor: string;
}

interface CouponOfferProps {
  coupon: UsableCoupon;
  registrationNumber: string;
  applied: boolean;
  /** Paise off the current bill, once services are picked. */
  saving: number;
  online: boolean;
  formatMoney: (paise: number) => string;
  onToggle: () => void;
}

/** A live comeback coupon for this customer, one tap to apply. Needs a connection to redeem. */
export function CouponOffer({
  coupon,
  registrationNumber,
  applied,
  saving,
  online,
  formatMoney,
  onToggle,
}: CouponOfferProps) {
  const until = new Date(coupon.expiresAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
  const otherVehicle = coupon.issuedFor !== registrationNumber;
  const disabled = !online && !applied;

  return (
    <View style={[styles.card, applied && styles.cardApplied]}>
      <View style={[styles.icon, applied && styles.iconApplied]}>
        {applied ? (
          <IconCheck size={18} color={colors.white} />
        ) : (
          <IconGift size={19} color={colors.tealDeep} />
        )}
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>
          {coupon.percent}% comeback offer
          {applied && saving > 0 ? (
            <Text style={styles.saving}> −{formatMoney(saving)}</Text>
          ) : null}
        </Text>
        <Text style={styles.meta} numberOfLines={2}>
          {coupon.code} · till {until}
          {otherVehicle ? ` · sent for ${coupon.issuedFor}` : ''}
        </Text>
        {!online && !applied ? <Text style={styles.offline}>Needs internet to apply</Text> : null}
      </View>
      <Pressable
        onPress={onToggle}
        disabled={disabled}
        style={({ pressed }) => [
          styles.btn,
          applied && styles.btnApplied,
          disabled && styles.btnDisabled,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: applied, disabled }}
        accessibilityLabel={applied ? 'Remove coupon' : 'Apply coupon'}
        hitSlop={6}
      >
        <Text style={[styles.btnText, applied && styles.btnTextApplied]}>
          {applied ? 'Remove' : 'Apply'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: '#F0FDFA',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.tealLight,
  },
  cardApplied: { borderStyle: 'solid', borderColor: colors.teal, backgroundColor: '#ECFDF5' },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconApplied: { backgroundColor: colors.teal },
  copy: { flex: 1, gap: 2 },
  title: { ...typography.bodyStrong, color: colors.tealDeep, fontSize: 15 },
  saving: { color: colors.teal, fontWeight: '800' },
  meta: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0.3 },
  offline: { ...typography.caption, color: colors.amberDeep, letterSpacing: 0 },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.teal,
  },
  btnApplied: { backgroundColor: colors.white, borderWidth: 1, borderColor: '#A7F3D0' },
  btnDisabled: { backgroundColor: '#CBD5E1' },
  btnText: { ...typography.label, color: colors.white },
  btnTextApplied: { color: colors.tealDeep },
  pressed: { opacity: 0.85 },
});
