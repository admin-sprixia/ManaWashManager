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
  /** A community plan, or one bought at this counter (for this vehicle, one wash a day). */
  source?: 'community' | 'shop';
  /**
   * A counter plan is a pack: its washes (Express and Premium; any a built plan holds), how many
   * of each are left, used in any order (one a day).
   */
  options?: PlanOption[];
}

export interface PlanOption {
  /** Its catalog wash: sent back to say which wash the plan pays. */
  key: string;
  kind: 'base' | 'upgrade';
  name: string;
  service: { id: string; name: string } | null;
  left: number;
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
  /** The pack's wash in use (an option's key), and picking another one. */
  kind?: string | null;
  onPickKind?: (key: string) => void;
  /** A better wash than the plan's is on the bill: the plan pays its wash, the customer the rest. */
  towards?: string | null;
}

/** A community plan member at the shop: one tap uses a plan wash, and its service is free. */
export function PlanWashCard({ plan, applied, saving, blocked, formatMoney, onToggle, kind, onPickKind, towards }: PlanWashCardProps) {
  const left = plan.washesTotal - plan.washesUsed;
  const options = plan.options ?? [];
  const chosen = options.find((o) => o.key === kind) ?? null;
  const covered = applied && chosen?.service ? chosen.service : plan.service;
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
          {where} ·{' '}
          {options.length
            ? `Left: ${options.map((o) => `${o.left} ${o.name.replace(/^Bike /, '').replace(/ Wash$/, '')}`).join(' · ')}`
            : `${left} of ${plan.washesTotal} ${plan.washesTotal === 1 ? 'wash' : 'washes'} left`}
          {plan.vehicle.registrationNumber ? ` · ${plan.vehicle.registrationNumber}` : ` · ${plan.vehicle.typeName}`}
        </Text>
        {options.length > 1 && onPickKind && !(note && !applied) ? (
          <View style={styles.kinds}>
            {options.map((o) => {
              const on = applied && kind === o.key;
              const off = o.left === 0 || !o.service;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => onPickKind(o.key)}
                  disabled={off}
                  style={({ pressed }) => [styles.kind, on && styles.kindOn, off && styles.kindOff, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: off }}
                  accessibilityLabel={`Use a ${o.name} from the plan, ${o.left} left`}
                  hitSlop={4}
                >
                  <Text style={[styles.kindText, on && styles.kindTextOn, off && styles.kindTextOff]}>
                    {o.name} · {o.left}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {note && !applied ? (
          <Text style={styles.note}>{note}</Text>
        ) : covered ? (
          <Text style={styles.covers}>
            {applied
              ? towards
                ? `Plan pays ${covered.name} · customer pays the rest of ${towards}`
                : `${covered.name} is free · uses 1 plan wash`
              : options.length > 1
                ? `Covers ${options.map((o) => o.name).join(', ')} · any order`
                : `Covers ${covered.name}`}
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
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  kind: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.water,
    backgroundColor: colors.white,
  },
  kindOn: { backgroundColor: colors.waterDeep, borderColor: colors.waterDeep },
  kindOff: { borderColor: '#CBD5E1', backgroundColor: '#F1F5F9' },
  kindText: { ...typography.caption, color: colors.waterDeep, fontWeight: '700', letterSpacing: 0 },
  kindTextOn: { color: colors.white },
  kindTextOff: { color: colors.slate },
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
