import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  buildPlan,
  builtPlanTitle,
  istDay,
  PLAN_GRACE_DAYS,
  PLAN_WASHES_A_MONTH,
  planLastDay,
  planUseBy,
  secondCarPlanPrice,
  type PlanLength,
} from '@mana/domain';
import { BottomSheet, Button, ChoiceChips, Counter, IconCheck, colors, radius, showToast, spacing, typography } from '@mana/ui';
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

/** A wash a customer can build a plan from, with its price for this vehicle. */
interface BuildWash {
  serviceId: string;
  name: string;
  price: number;
}

const MODES = [
  { value: 'ready', label: 'Our plans' },
  { value: 'build', label: 'Build your own' },
] as const;
type Mode = (typeof MODES)[number]['value'];

const LENGTHS = [
  { value: '1', label: '1 month' },
  { value: '3', label: '3 months' },
  { value: '12', label: '12 months' },
] as const;
type Length = (typeof LENGTHS)[number]['value'];

const PAY_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'other', label: 'Other' },
] as const;
type Pay = (typeof PAY_OPTIONS)[number]['value'];

const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** A plan's pack: "3 × Express Wash + 1 × Premium Wash", or "4 × Basic Wash". */
function packText(p: { washes: number; serviceName: string; upgrade: { every: number; name: string } | null }): string {
  const better = p.upgrade && p.upgrade.every > 1 ? Math.floor(p.washes / p.upgrade.every) : 0;
  return better ? `${p.washes - better} × ${p.serviceName} + ${better} × ${p.upgrade!.name}` : `${p.washes} × ${p.serviceName}`;
}

/**
 * Selling a wash plan at the counter: the plans this branch sells for the vehicle, with their
 * price, or one the customer builds from any 4 washes (priced like WhatsApp shows it: the 4 added
 * up, less 8%). Paid in full now; for this vehicle, at this branch, one wash a day until a week
 * after it ends. Needs internet.
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
  const [washes, setWashes] = useState<BuildWash[]>([]);
  const [secondCar, setSecondCar] = useState(false);
  const [mode, setMode] = useState<Mode>('ready');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [length, setLength] = useState<Length>('1');
  const [pay, setPay] = useState<Pay>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPlans(null);
    setPlanId(null);
    setWashes([]);
    setSecondCar(false);
    setMode('ready');
    setCounts({});
    setLength('1');
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
        setWashes(body.washes ?? []);
        setSecondCar(!!body.secondCar);
      } catch (e) {
        if (alive) setError(e instanceof NetworkError ? 'Selling a plan needs internet.' : 'Couldn’t load the plans.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, vehicleTypeId, customer.phone, registrationNumber]);

  const ready = mode === 'ready' ? plans?.find((p) => p.planId === planId) ?? null : null;
  const pickedCount = Object.values(counts).reduce((n, c) => n + c, 0);
  // The customer's own plan, once 4 washes are picked: priced as the server prices it.
  const built = useMemo(() => {
    if (mode !== 'build' || pickedCount !== PLAN_WASHES_A_MONTH) return null;
    const picks = washes.flatMap((w) => Array.from({ length: counts[w.serviceId] ?? 0 }, () => w));
    const plan = buildPlan(
      picks.map((w) => ({ id: w.serviceId, price: w.price })),
      Number(length) as PlanLength,
    );
    return {
      serviceIds: picks.map((w) => w.serviceId),
      name: builtPlanTitle(
        washes.filter((w) => counts[w.serviceId]).map((w) => ({ name: w.name, count: counts[w.serviceId]! })),
        Number(length) as PlanLength,
      ),
      months: plan.months,
      washes: plan.washesTotal,
      total: secondCar ? secondCarPlanPrice(plan.price) : plan.price,
      fullTotal: plan.price,
      listTotal: plan.listPrice,
    };
  }, [mode, pickedCount, washes, counts, length, secondCar]);
  const picked = ready ?? built;

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
          ...(built ? { custom: { serviceIds: built.serviceIds, length: Number(length) as PlanLength } } : { planId: ready!.planId }),
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
  const canBuild = !!plans?.length && washes.length > 0;
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title="Sell a plan"
      subtitle={`${registrationNumber} · ${vehicleName}`}
      footer={
        <Button
          label={
            picked
              ? `Sell ${built ? 'custom plan' : picked.name} · ${formatMoney(picked.total)}`
              : mode === 'build'
                ? `Pick ${PLAN_WASHES_A_MONTH} washes (${pickedCount} of ${PLAN_WASHES_A_MONTH})`
                : 'Sell'
          }
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
        {canBuild ? <ChoiceChips options={MODES} value={mode} onChange={setMode} /> : null}
        {mode === 'build' ? (
          <>
            <Text style={styles.hint}>
              Pick {PLAN_WASHES_A_MONTH} washes for the month, any mix. Used in any order, on any days. The {PLAN_WASHES_A_MONTH} added up,
              less 8%.
            </Text>
            {washes.map((w) => (
              <Counter
                key={w.serviceId}
                label={`${w.name} · ${formatMoney(w.price)}`}
                value={counts[w.serviceId] ?? 0}
                max={(counts[w.serviceId] ?? 0) + PLAN_WASHES_A_MONTH - pickedCount}
                onChange={(n) => setCounts((c) => ({ ...c, [w.serviceId]: n }))}
              />
            ))}
            <ChoiceChips label="For" options={LENGTHS} value={length} onChange={setLength} />
            {built ? (
              <View style={[styles.plan, styles.planOn]}>
                <View style={styles.flex}>
                  <Text style={styles.planName}>{built.name.replace(/^Custom plan · /, '')}</Text>
                  <Text style={styles.planMeta}>
                    {built.washes} washes · any order
                    {length === '3' ? ' · 1 free' : length === '12' ? ' · 13 months for 12' : ''}
                  </Text>
                  {built.listTotal > built.fullTotal ? <Text style={styles.save}>Saves {formatMoney(built.listTotal - built.fullTotal)}</Text> : null}
                  {secondCar ? <Text style={styles.secondCar}>Second car at home · 10% off</Text> : null}
                </View>
                <View style={styles.priceCol}>
                  {secondCar ? <Text style={styles.wasPrice}>{formatMoney(built.fullTotal)}</Text> : null}
                  <Text style={styles.price}>{formatMoney(built.total)}</Text>
                </View>
              </View>
            ) : null}
          </>
        ) : null}
        {mode === 'ready' && plans?.map((p) => {
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
                  {packText(p)} · any order · {p.months === 1 ? '1 month' : p.months >= 12 ? '12 months' : `${p.months} months`}
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
              For {registrationNumber} only, at this branch, one wash a day. Ends {endsOn ? shortDate(endsOn) : ''}, with {PLAN_GRACE_DAYS} more days
              (to {endsOn ? shortDate(planUseBy(endsOn)) : ''}) to use what’s left; 1 unused wash carries over when they renew.
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
