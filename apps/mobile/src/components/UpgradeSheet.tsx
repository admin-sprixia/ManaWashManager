import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {
  BRANCH_PRICE_LABEL,
  PLAN_LIMITS,
  PRO_FEATURE_LABEL,
  PRO_PRICE_PAISE,
  type ProFeature,
} from '@mana/domain';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { IconCheck, IconSparkle } from './Icons';
import { useAuth } from '../api/auth';
import type { ApiResponse } from '../api/client';
import { planRefusalFrom, type PlanRefusal } from '../api/planErrors';
import { colors, gradients, radius, spacing, typography } from '../theme';
import { formatRupees } from '../utils/format';

/** Why the upgrade sheet opened: a Pro feature, or one of the Free plan's limits. */
export type UpgradeReason = PlanRefusal;

const FEATURE_PITCH: Record<ProFeature, string> = {
  photos: 'Snap the car before and after every wash, so a scratch complaint is settled in seconds.',
  reminders: 'See who’s due for their next wash and message them on WhatsApp in one tap.',
  coupons: 'Send comeback coupons that bring quiet customers back, and track every one used.',
  referrals: 'Reward customers who bring their friends, with the discount worked out for you.',
  rewards: 'Give every car a stamp card — wash 5, the next one is free — and a welcome gift on its first visit.',
  fullReports: 'See this month, this year or any dates you pick — not just today and the last 7 days.',
  pdfExport: 'Share a clean PDF report with your partner or accountant.',
  expenses: 'Log what the shop spends with bill photos, and see your real profit.',
  cashDrawer: 'Count the cash box morning and night, and know right away if money is short.',
  commission: 'Set a reward per service, and each staff member sees what they’ve earned.',
  attendance: 'Mark who worked each day and see the month at a glance.',
  inventory: 'Track shampoo, wax and cloths, and get warned before you run out.',
  staffReport: 'See each person’s washes, sales, commission and days worked.',
  auditTrail: 'See every discount, cancellation and payment change, with who did it.',
  branches: `Run another branch from the same phone and PIN. Opens once this shop is on paid Pro — a free trial doesn’t count. Each extra branch can then go Pro for just ${BRANCH_PRICE_LABEL}.`,
};

const PRO_POINTS = [
  `Unlimited washes and up to ${PLAN_LIMITS.pro.staff} staff`,
  'Cash drawer, expenses and real profit',
  'Reminders, coupons and referrals',
  'Reports for any dates, with PDF',
];

type Listener = (reason: UpgradeReason) => void;
const listeners = new Set<Listener>();
let openPlans: (() => void) | null = null;

/** Opens the upgrade sheet from anywhere (a locked row, a blocked New Wash, a 402 reply). */
export function showUpgrade(reason: UpgradeReason): void {
  listeners.forEach((l) => l(reason));
}

/** Set once by the navigator so the sheet can open the plan screen. */
export function setOpenPlans(fn: (() => void) | null): void {
  openPlans = fn;
}

/**
 * If the API refused because of the plan (HTTP 402), shows the upgrade sheet and returns true.
 * Reads the body, so call it before anything else reads the response.
 */
export async function handlePlanError(res: ApiResponse): Promise<boolean> {
  if (res.status !== 402) return false;
  const refusal = planRefusalFrom(res.status, await res.json().catch(() => null));
  if (refusal) showUpgrade(refusal);
  return true;
}

function copyFor(reason: UpgradeReason): { title: string; body: string } {
  switch (reason.kind) {
    case 'feature':
      return {
        title: `${PRO_FEATURE_LABEL[reason.feature]} is part of Pro`,
        body: FEATURE_PITCH[reason.feature],
      };
    case 'washLimit':
      return {
        title: 'This month’s free washes are used',
        body:
          reason.message ??
          `The Free plan includes ${PLAN_LIMITS.free.washesPerMonth} washes a month. Upgrade to Pro for unlimited washes.`,
      };
    case 'staffLimit':
      return {
        title: 'Your team is full',
        body: reason.message ?? `Pro lets you add up to ${PLAN_LIMITS.pro.staff} staff.`,
      };
  }
}

/** Mounted once inside the navigator. */
export function UpgradeHost() {
  const { isOwner } = useAuth();
  const [reason, setReason] = useState<UpgradeReason | null>(null);

  useEffect(() => {
    const listener: Listener = (r) => setReason(r);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const close = () => setReason(null);
  const copy = reason ? copyFor(reason) : null;

  return (
    <BottomSheet
      visible={reason != null}
      onClose={close}
      title={copy?.title ?? ''}
      footer={
        isOwner ? (
          <View style={styles.footer}>
            <Button
              label="See Pro plans"
              size="lg"
              icon={<IconSparkle size={18} color={colors.white} />}
              onPress={() => {
                close();
                openPlans?.();
              }}
            />
            <Button label="Not now" variant="ghost" onPress={close} />
          </View>
        ) : (
          <Button label="OK" size="lg" onPress={close} />
        )
      }
    >
      <LinearGradient colors={gradients.hero as unknown as string[]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.badge}>
        <IconSparkle size={16} color={colors.white} />
        <Text style={styles.badgeText}>MANA PRO</Text>
      </LinearGradient>
      <Text style={styles.body}>{copy?.body}</Text>
      <View style={styles.points}>
        {PRO_POINTS.map((p) => (
          <View key={p} style={styles.point}>
            <View style={styles.tick}>
              <IconCheck size={13} color={colors.tealDeep} />
            </View>
            <Text style={styles.pointText}>{p}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.price}>
        {isOwner
          ? `From ${formatRupees(PRO_PRICE_PAISE.monthly)}/month · cancel anytime · nothing is deleted on Free`
          : 'Only the owner can upgrade. Ask them to open More → Your plan.'}
      </Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 6,
    marginBottom: spacing.md,
  },
  badgeText: { ...typography.label, color: colors.white, letterSpacing: 1 },
  body: { ...typography.body, color: colors.waterInk, lineHeight: 23 },
  points: { gap: spacing.sm + 2, marginTop: spacing.lg },
  point: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointText: { ...typography.body, color: colors.waterInk, fontSize: 15, flex: 1 },
  price: { ...typography.caption, color: colors.slateDeep, marginTop: spacing.lg, letterSpacing: 0, fontSize: 13 },
  footer: { gap: spacing.xs },
});
