import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { istDay, planLastDay } from '@mana/domain';
import { BottomSheet, Button, ChoiceChips, IconCheck, colors, radius, showToast, spacing, typography } from '@mana/ui';
import { api, apiErrorMessage } from '../../api/client';
import { NetworkError } from '../../api/network';
import { newId } from '../../utils/id';

interface PlanOffer {
  planId: string;
  name: string;
  washes: number;
  months: number;
  serviceName: string;
  upgrade: { every: number; name: string } | null;
  popular: boolean;
  total: number;
  listTotal: number;
  /** A second car in the same home: `total` is 10% off this usual price. */
  secondCar?: { fullTotal: number } | null;
}

const PAY_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'other', label: 'Other' },
] as const;
type Pay = (typeof PAY_OPTIONS)[number]['value'];

const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Selling a wash plan at the counter: the plans this branch sells for the vehicle, with their
 * price, and how it's paid. Paid in full now; for this vehicle, at this branch, one wash a day
 * until it ends. Needs internet.
 */
export function SellPlanSheet({
  visible,
  vehicleTypeId,
  vehicleName,
  customer,
  registrationNumber,
  ownership,
  onClose,
  onSold,
  formatMoney,
  startsNextVisit = false,
  make,
  model,
}: {
  visible: boolean;
  vehicleTypeId: string;
  vehicleName: string;
  customer: { phone: string; name: string };
  registrationNumber: string;
  ownership?: 'new_owner' | 'same_person';
  onClose: () => void;
  onSold: () => void;
  formatMoney: (paise: number) => string;
  /** Sold beside a wash already on the board: that wash is paid as usual. */
  startsNextVisit?: boolean;
  /** A vehicle added while selling: kept on it. */
  make?: string;
  model?: string;
}) {
  const [plans, setPlans] = useState<PlanOffer[] | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [pay, setPay] = useState<Pay>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPlans(null);
    setPlanId(null);
    setPay('cash');
    setError(null);
    let alive = true;
    void (async () => {
      try {
        // With the customer's phone, a second car in the same home is priced 10% off.
        const res = await api['shop-plans']['for-sale'].$get({
          query: { vehicleTypeId, phone: customer.phone, registrationNumber },
        });
        if (!alive) return;
        if (!res.ok) return setError(await apiErrorMessage(res, 'Couldn’t load the plans.'));
        const body = await res.json();
        setPlans(body.plans);
        setPlanId(body.plans.find((p) => p.popular)?.planId ?? body.plans[0]?.planId ?? null);
      } catch (e) {
        if (alive) setError(e instanceof NetworkError ? 'Selling a plan needs internet.' : 'Couldn’t load the plans.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, vehicleTypeId, customer.phone, registrationNumber]);

  const picked = plans?.find((p) => p.planId === planId) ?? null;

  const sell = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api['shop-plans'].sell.$post({
        json: {
          id: newId(),
          occurredAt: new Date().toISOString(),
          customer,
          registrationNumber,
          vehicleTypeId,
          ...(ownership ? { ownership } : {}),
          ...(make && model ? { make, model } : {}),
          planId: picked.planId,
          paymentMethod: pay,
        },
      });
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t sell the plan.'));
        return;
      }
      showToast(`${picked.name} sold · ${formatMoney(picked.total)} paid by ${pay === 'upi' ? 'UPI' : pay}`, 'success');
      onSold();
      onClose();
    } catch (e) {
      setError(e instanceof NetworkError ? 'Selling a plan needs internet.' : 'Couldn’t sell the plan.');
    } finally {
      setBusy(false);
    }
  };

  const endsOn = picked ? planLastDay(istDay(new Date()), picked.months) : null;
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title="Sell a plan"
      subtitle={`${registrationNumber} · ${vehicleName}`}
      footer={
        <Button
          label={picked ? `Sell ${picked.name} · ${formatMoney(picked.total)}` : 'Sell'}
          size="lg"
          loading={busy}
          disabled={!picked}
          onPress={() => void sell()}
        />
      }
    >
      <View style={styles.form}>
        {plans == null && !error ? <ActivityIndicator color={colors.indigo} /> : null}
        {plans && !plans.length ? (
          <Text style={styles.hint}>
            No plan is sold at the shop for {/^[aeiou]/i.test(vehicleName) ? 'an' : 'a'} {vehicleName.toLowerCase()} yet.
            Plans sold only to communities don’t show here: HQ opens a plan in Services and plans › Plans and sets
            “Where it’s sold” to Shop or Both.
          </Text>
        ) : null}
        {plans?.map((p) => {
          const on = p.planId === planId;
          const save = p.listTotal - p.total;
          return (
            <Pressable
              key={p.planId}
              onPress={() => setPlanId(p.planId)}
              style={({ pressed }) => [styles.plan, on && styles.planOn, pressed && styles.pressed]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <View style={[styles.radio, on && styles.radioOn]}>{on ? <IconCheck size={12} color={colors.white} /> : null}</View>
              <View style={styles.flex}>
                <Text style={styles.planName}>
                  {p.name}
                  {p.popular ? <Text style={styles.popular}>  Most popular</Text> : null}
                </Text>
                <Text style={styles.planMeta}>
                  {p.washes} × {p.serviceName}
                  {p.upgrade ? `, every ${p.upgrade.every}th ${p.upgrade.name}` : ''} · {p.months === 1 ? '1 month' : `${p.months} months`}
                </Text>
                {save > 0 ? <Text style={styles.save}>Saves {formatMoney(save)}</Text> : null}
                {p.secondCar ? <Text style={styles.secondCar}>Second car at home · 10% off</Text> : null}
              </View>
              <View style={styles.priceCol}>
                {p.secondCar ? <Text style={styles.wasPrice}>{formatMoney(p.secondCar.fullTotal)}</Text> : null}
                <Text style={styles.price}>{formatMoney(p.total)}</Text>
              </View>
            </Pressable>
          );
        })}
        {picked ? (
          <>
            <ChoiceChips label="Paid by" options={PAY_OPTIONS} value={pay} onChange={setPay} />
            <Text style={styles.hint}>
              For {registrationNumber} only, at this branch, one wash a day. Ends {endsOn ? shortDate(endsOn) : ''}: washes not used by then are
              lost.
            </Text>
            {startsNextVisit ? (
              <Text style={styles.hint}>Today’s wash is paid as usual. The plan starts from their next visit.</Text>
            ) : null}
          </>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.75 },
  form: { gap: spacing.sm + 2 },
  hint: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },
  error: { ...typography.label, color: colors.danger },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    padding: spacing.sm + 4,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  planOn: { borderColor: colors.indigo, backgroundColor: colors.indigoPale },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  planName: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },
  popular: { fontSize: 11.5, fontWeight: '800', color: colors.amberDeep },
  planMeta: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  save: { ...typography.caption, fontSize: 12, color: colors.tealDeep, fontWeight: '800', letterSpacing: 0 },
  price: { ...typography.heading, fontSize: 18, color: colors.waterInk },
  priceCol: { alignItems: 'flex-end' },
  wasPrice: { ...typography.caption, fontSize: 12, color: colors.slate, textDecorationLine: 'line-through', letterSpacing: 0 },
  secondCar: { ...typography.caption, fontSize: 12, color: colors.tealDeep, fontWeight: '800', letterSpacing: 0, marginTop: 2 },
});
