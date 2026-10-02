import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useAuth } from '../api/auth';
import { usePlan } from '../offline/PlanProvider';
import { colors, spacing, typography } from '../theme';
import { IconAlert, IconClock, IconSparkle } from './Icons';
import { showUpgrade } from './UpgradeSheet';

/** Free washes left at which the board starts showing the count. */
const LOW_WASHES = 30;
/** Trial days left at which the owner is reminded to upgrade. */
const TRIAL_REMINDER_DAYS = 3;

/**
 * One slim strip under the sync banner, only when the plan needs attention: the Free wash limit
 * is close or reached, the trial is about to end, or a renewal payment failed. Quiet otherwise.
 */
export function PlanBanner({ onOpenPlan }: { onOpenPlan: () => void }) {
  const { isOwner } = useAuth();
  const { plan, isPro, washesLeft } = usePlan();
  if (!plan) return null;
  const open = isOwner ? onOpenPlan : () => showUpgrade({ kind: 'washLimit' });

  if (!isPro && washesLeft === 0) {
    return (
      <Pressable onPress={open} style={({ pressed }) => [styles.bar, styles.danger, pressed && styles.pressed]}>
        <IconAlert size={16} color={colors.danger} />
        <Text style={[styles.text, styles.dangerText]} numberOfLines={1}>
          This month’s free washes are used
        </Text>
        <Text style={[styles.action, styles.dangerText]}>{isOwner ? 'Upgrade' : 'Why?'}</Text>
      </Pressable>
    );
  }

  if (!isPro && washesLeft != null && washesLeft <= LOW_WASHES) {
    return (
      <Pressable onPress={open} style={({ pressed }) => [styles.bar, styles.amber, pressed && styles.pressed]}>
        <IconClock size={16} color={colors.amberDeep} />
        <Text style={[styles.text, styles.amberText]} numberOfLines={1}>
          {washesLeft} free wash{washesLeft === 1 ? '' : 'es'} left this month
        </Text>
        {isOwner ? <Text style={[styles.action, styles.amberText]}>Go unlimited</Text> : null}
      </Pressable>
    );
  }

  if (!isOwner) return null;

  if (isPro && plan.state === 'grace') {
    return (
      <Pressable onPress={onOpenPlan} style={({ pressed }) => [styles.bar, styles.amber, pressed && styles.pressed]}>
        <IconAlert size={16} color={colors.amberDeep} />
        <Text style={[styles.text, styles.amberText]} numberOfLines={1}>
          Pro payment didn’t go through
        </Text>
        <Text style={[styles.action, styles.amberText]}>Check</Text>
      </Pressable>
    );
  }

  if (isPro && plan.state === 'trial' && plan.daysLeft != null && plan.daysLeft <= TRIAL_REMINDER_DAYS) {
    return (
      <Pressable onPress={onOpenPlan} style={({ pressed }) => [styles.bar, styles.water, pressed && styles.pressed]}>
        <IconSparkle size={16} color={colors.waterDeep} />
        <Text style={[styles.text, styles.waterText]} numberOfLines={1}>
          {plan.daysLeft === 0
            ? 'Pro trial ends today'
            : `Pro trial ends in ${plan.daysLeft} day${plan.daysLeft === 1 ? '' : 's'}`}
        </Text>
        <Text style={[styles.action, styles.waterText]}>Keep Pro</Text>
      </Pressable>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pressed: { opacity: 0.85 },
  text: { ...typography.label, flex: 1, textTransform: 'none', fontSize: 13 },
  action: { ...typography.label, fontWeight: '700', fontSize: 13 },
  danger: { backgroundColor: '#FEF2F2', borderBottomColor: '#FECACA' },
  dangerText: { color: colors.danger },
  amber: { backgroundColor: '#FFFBEB', borderBottomColor: colors.amberLight },
  amberText: { color: colors.amberDeep },
  water: { backgroundColor: colors.waterPale, borderBottomColor: colors.border },
  waterText: { color: colors.waterDeep },
});
