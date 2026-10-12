import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconBuilding, IconCheck, colors, radius, spacing, typography } from '@mana/ui';

export interface ShopPlan {
  orderId: string;
  placeName: string;
  unit: string | null;
  planName: string;
  vehicle: { typeId: string; typeName: string; registrationNumber: string | null };
  washesUsed: number;
  washesTotal: number;
  service: { id: string; name: string } | null;
  problem: string | null;
}

interface PlanWashCardProps {
  plan: ShopPlan;
  applied: boolean;
  /** Paise off the bill: the covered service's price for this vehicle. */
  saving: number;
  /** Why it can't be used on this bill right now (offline, other vehicle size…). */
  blocked: string | null;
  formatMoney: (paise: number) => string;
  onToggle: () => void;
}

/** A community plan member at the shop: one tap uses a plan wash, and its service is free. */
export function PlanWashCard({ plan, applied, saving, blocked, formatMoney, onToggle }: PlanWashCardProps) {
  const left = plan.washesTotal - plan.washesUsed;
  const note = plan.problem ?? blocked;
  const disabled = !applied && note != null;
  const where = [plan.placeName, plan.unit].filter(Boolean).join(', ');

  return (
    <View style={[styles.card, applied && styles.cardApplied]}>
      <View style={[styles.icon, applied && styles.iconApplied]}>
        {applied ? <IconCheck size={18} color={colors.white} /> : <IconBuilding size={19} color={colors.waterDeep} />}
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>
          {plan.planName} plan
          {applied && saving > 0 ? <Text style={styles.saving}> −{formatMoney(saving)}</Text> : null}
        </Text>
        <Text style={styles.meta} numberOfLines={2}>
          {where} · {left} of {plan.washesTotal} {plan.washesTotal === 1 ? 'wash' : 'washes'} left
          {plan.vehicle.registrationNumber ? ` · ${plan.vehicle.registrationNumber}` : ` · ${plan.vehicle.typeName}`}
        </Text>
        {note && !applied ? (
          <Text style={styles.note}>{note}</Text>
        ) : plan.service ? (
          <Text style={styles.covers}>
            {applied ? `${plan.service.name} is free · uses 1 plan wash` : `Covers ${plan.service.name}`}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={onToggle}
        disabled={disabled}
        style={({ pressed }) => [styles.btn, applied && styles.btnApplied, disabled && styles.btnDisabled, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ selected: applied, disabled }}
        accessibilityLabel={applied ? 'Don’t use the plan' : 'Use a plan wash'}
        hitSlop={6}
      >
        <Text style={[styles.btnText, applied && styles.btnTextApplied]}>{applied ? 'Remove' : 'Use'}</Text>
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
    backgroundColor: colors.waterPale,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.water,
  },
  cardApplied: { borderStyle: 'solid', borderColor: colors.waterDeep, backgroundColor: '#E0F2FE' },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconApplied: { backgroundColor: colors.waterDeep },
  copy: { flex: 1, gap: 2 },
  title: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  saving: { color: colors.tealDeep, fontWeight: '800' },
  meta: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0.2 },
  covers: { ...typography.caption, color: colors.waterDeep, fontWeight: '700', letterSpacing: 0 },
  note: { ...typography.caption, color: colors.amberDeep, letterSpacing: 0 },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.waterDeep,
  },
  btnApplied: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.water },
  btnDisabled: { backgroundColor: '#CBD5E1' },
  btnText: { ...typography.label, color: colors.white },
  btnTextApplied: { color: colors.waterDeep },
  pressed: { opacity: 0.85 },
});
