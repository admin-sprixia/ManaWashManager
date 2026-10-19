import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import {
  MAX_PLAN_PRICE_PAISE,
  PLAN_SOLD_AT,
  PLAN_SOLD_AT_LABEL,
  WASH_PLAN_MAX_DISCOUNT_BP,
  WASH_PLAN_MAX_MONTHS,
  WASH_PLAN_MAX_WASHES,
  WASH_PLAN_NAME_MAX,
  formatInr,
  type PlanSoldAt,
} from '@mana/domain';
import {
  Button,
  ChoiceChips,
  IconCheck,
  ScreenContainer,
  ScreenHeader,
  TextField,
  colors,
  radius,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../../api/client';
import { parseRupees } from '../../utils/format';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { useApiData } from '../places/shared';
import { CatalogHero, bpToText, failure, paiseToText, textToBp, useCatalog } from './shared';
import { EditorCard, SwitchRow } from './editorParts';
import { nth, planPreview, planSizes, priceKey, type PlanMode } from './plansShared';

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessPlanEdit'>;
type Data = InferResponseType<(typeof api)['business']['plans']['$get'], 200>;

const EVERY_OPTIONS = [2, 3, 4, 5, 6, 8].map((n) => ({
  value: String(n),
  label: `Every ${nth(n)}`,
}));
const NO_UPGRADE = '__none';
const DISCOUNTS = [0, 5, 10, 15, 20, 25];
const SOLD_AT_HINT: Record<PlanSoldAt, string> = {
  community: 'Bought when joining a community, washed on its wash days.',
  shop: 'Sold at the counter in New Wash. One vehicle, that branch, one wash a day.',
  both: 'At a community, or at the counter in New Wash.',
};

/**
 * One wash plan, on its own page like a service: what it is (which wash, how many over how many
 * months, now and then a better wash), where it's sold, its price (the wash price less a
 * discount, or its own price per size), and how it shows. HQ only.
 */
export function PlanEditorScreen({ navigation, route }: Props) {
  const planId = route.params?.planId ?? null;
  const data = useApiData<Data>(() => api.business.plans.$get(), 'Couldn’t load the wash plans.');
  const { catalog } = useCatalog();
  const plan = planId ? (data.data?.plans.find((p) => p.id === planId) ?? null) : null;
  const priceMode = data.data?.rules.priceMode ?? 'doorstep';
  const services = useMemo(
    () =>
      (catalog?.services ?? [])
        .filter((s) => s.active)
        .map((s) => ({ value: s.id, label: s.name })),
    [catalog],
  );

  const [name, setName] = useState('');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [washes, setWashes] = useState('4');
  const [months, setMonths] = useState('1');
  const [discount, setDiscount] = useState('');
  const [parts, setParts] = useState(false);
  const [popular, setPopular] = useState(false);
  const [active, setActive] = useState(true);
  const [upgradeId, setUpgradeId] = useState<string>(NO_UPGRADE);
  const [every, setEvery] = useState('4');
  const [ownPrices, setOwnPrices] = useState(false);
  const [soldAt, setSoldAt] = useState<PlanSoldAt>('community');
  const [shopUse, setShopUse] = useState(true);
  const [priceText, setPriceText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Fill the form once the plan (or, for a new one, the services) has loaded.
  useEffect(() => {
    if (ready || !data.data || !catalog) return;
    setName(plan?.name ?? '');
    setServiceId(plan?.catalogServiceId ?? services[0]?.value ?? null);
    setWashes(String(plan?.washes ?? 4));
    setMonths(String(plan?.months ?? 1));
    setDiscount(plan?.discountBp ? bpToText(plan.discountBp) : '');
    setParts(plan?.allowParts ?? false);
    setPopular(plan?.popular ?? false);
    setActive(plan?.active !== false);
    setUpgradeId(plan?.upgradeServiceId ?? NO_UPGRADE);
    setEvery(String(plan?.upgradeEvery ?? 4));
    setOwnPrices((plan?.prices.length ?? 0) > 0);
    setSoldAt(plan?.soldAt ?? 'community');
    setShopUse(plan?.shopUse !== false);
    setPriceText(
      Object.fromEntries(
        (plan?.prices ?? []).map((p) => [priceKey(p.sizeId, p.mode), paiseToText(p.price)]),
      ),
    );
    setReady(true);
  }, [ready, data.data, catalog, plan, services]);

  const previewWashes = Math.min(WASH_PLAN_MAX_WASHES, Math.max(1, Number(washes) || 1));
  const previewBp = Math.min(WASH_PLAN_MAX_DISCOUNT_BP, Math.max(0, textToBp(discount) ?? 0));
  const better = upgradeId === NO_UPGRADE ? null : upgradeId;
  const fixed = useMemo(() => {
    if (!ownPrices) return null;
    const map = new Map<string, number>();
    for (const [key, text] of Object.entries(priceText)) {
      const p = parseRupees(text);
      if (p != null && !Number.isNaN(p)) map.set(key, p);
    }
    return map;
  }, [ownPrices, priceText]);
  const sizes = useMemo(
    () => (catalog && serviceId ? planSizes(catalog, serviceId) : []),
    [catalog, serviceId],
  );
  const previewFor = useCallback(
    (mode: PlanMode) =>
      catalog && serviceId
        ? planPreview(
            catalog,
            {
              serviceId,
              upgradeId: better,
              every: Number(every) || 4,
              washes: previewWashes,
              discountBp: previewBp,
              fixed,
            },
            mode,
          )
        : [],
    [catalog, serviceId, better, every, previewWashes, previewBp, fixed],
  );
  // What a member pays at each place the plan is sold: the shop counter, and communities.
  const atShop = useMemo(
    () => (soldAt !== 'community' ? previewFor('hub') : []),
    [previewFor, soldAt],
  );
  const atCommunity = useMemo(
    () => (soldAt !== 'shop' ? previewFor(priceMode) : []),
    [previewFor, soldAt, priceMode],
  );
  const preview = atCommunity.length ? atCommunity : atShop;
  const serviceName = services.find((s) => s.value === serviceId)?.label ?? 'a wash';
  const cheapest = preview.length ? preview.reduce((a, b) => (b.total < a.total ? b : a)) : null;

  const save = async () => {
    const w = Number(washes);
    const m = Number(months);
    const bp = textToBp(discount);
    if (!name.trim()) return setError('Name the plan, like “Monthly”.');
    if (!serviceId) return setError('Pick the wash each visit is.');
    if (!Number.isInteger(w) || w < 1 || w > WASH_PLAN_MAX_WASHES)
      return setError(`Washes is 1 to ${WASH_PLAN_MAX_WASHES}.`);
    if (!Number.isInteger(m) || m < 1 || m > WASH_PLAN_MAX_MONTHS)
      return setError(`Months is 1 to ${WASH_PLAN_MAX_MONTHS}.`);
    if (bp == null || bp < 0 || bp > WASH_PLAN_MAX_DISCOUNT_BP)
      return setError(`The discount is 0 to ${bpToText(WASH_PLAN_MAX_DISCOUNT_BP)}%.`);
    if (better === serviceId) return setError('The better wash must be a different wash.');
    const prices: { sizeId: string; mode: PlanMode; price: number }[] = [];
    if (ownPrices) {
      for (const size of sizes) {
        for (const mode of ['hub', 'doorstep'] as const) {
          const p = parseRupees(priceText[priceKey(size.id, mode)] ?? '');
          if (p == null) continue;
          if (Number.isNaN(p) || p > MAX_PLAN_PRICE_PAISE)
            return setError(
              `Check the ${size.name} ${mode === 'hub' ? 'shop' : 'community'} price.`,
            );
          prices.push({ sizeId: size.id, mode, price: p });
        }
      }
      if (!prices.length)
        return setError('Enter the plan price for at least one size, or use the wash price.');
    }
    const values = {
      name: name.trim(),
      catalogServiceId: serviceId,
      washes: w,
      months: m,
      discountBp: bp,
      allowParts: soldAt !== 'shop' && parts,
      popular,
      upgradeServiceId: better,
      upgradeEvery: better ? Number(every) : null,
      soldAt,
      shopUse,
      prices,
    };
    setBusy(true);
    setError(null);
    try {
      const res = plan
        ? await api.business.plans[':id'].$patch({
            param: { id: plan.id },
            json: { ...values, active },
          })
        : await api.business.plans.$post({ json: values });
      if (!res.ok) return setError(await apiErrorMessage(res, 'Couldn’t save the plan.'));
      showToast(plan ? 'Plan saved' : 'Plan added', 'success');
      navigation.goBack();
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  };

  const title = plan ? plan.name : 'New plan';
  if (!ready) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title={title} onBack={() => navigation.goBack()} />
        </View>
        {data.error ? (
          <View style={styles.centerPad}>
            <Text style={styles.error}>{data.error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void data.load()} />
          </View>
        ) : planId && data.data && !plan ? (
          <View style={styles.centerPad}>
            <Text style={styles.error}>This plan isn’t there any more.</Text>
          </View>
        ) : (
          <ActivityIndicator color={colors.indigo} style={styles.loading} />
        )}
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title={title} onBack={() => navigation.goBack()} />
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroBleed}>
            <CatalogHero
              eyebrow={
                plan ? (active ? 'Wash plan · offered' : 'Wash plan · off') : 'New wash plan'
              }
              title={name.trim() || 'Your plan'}
              meta={`${previewWashes} × ${serviceName} over ${Number(months) === 1 ? '1 month' : `${Number(months) || 1} months`}${better ? `, every ${nth(Number(every))} ${services.find((s) => s.value === better)?.label}` : ''}.`}
              chips={[
                { label: 'Sold', value: PLAN_SOLD_AT_LABEL[soldAt] },
                { label: 'From', value: cheapest ? formatInr(cheapest.total) : '—' },
                {
                  label: ownPrices ? 'Prices' : 'Discount',
                  value: ownPrices ? 'Own' : previewBp ? `${bpToText(previewBp)}%` : 'None',
                },
              ]}
            />
          </View>

          <EditorCard title="The plan">
            <TextField
              label="Name"
              value={name}
              onChangeText={setName}
              maxLength={WASH_PLAN_NAME_MAX}
              placeholder="Monthly"
              autoCapitalize="words"
            />
            <ChoiceChips
              label="Each wash is"
              options={services}
              value={serviceId}
              onChange={setServiceId}
            />
            <View style={styles.row}>
              <Stepper
                label="Washes"
                value={washes}
                onChange={setWashes}
                min={1}
                max={WASH_PLAN_MAX_WASHES}
              />
              <Stepper
                label="Months"
                value={months}
                onChange={setMonths}
                min={1}
                max={WASH_PLAN_MAX_MONTHS}
              />
            </View>
            <ChoiceChips
              label="Now and then a better wash"
              options={[
                { value: NO_UPGRADE, label: 'No, every wash the same' },
                ...services.filter((s) => s.value !== serviceId),
              ]}
              value={upgradeId}
              onChange={setUpgradeId}
            />
            {better ? (
              <ChoiceChips
                label={`Which wash is ${services.find((s) => s.value === better)?.label ?? 'the better one'}`}
                options={EVERY_OPTIONS}
                value={every}
                onChange={setEvery}
              />
            ) : null}
          </EditorCard>

          <EditorCard title="Where it’s sold" badge={PLAN_SOLD_AT_LABEL[soldAt]}>
            <View style={styles.placeRow}>
              {PLAN_SOLD_AT.map((v) => {
                const on = soldAt === v;
                return (
                  <Pressable
                    key={v}
                    onPress={() => setSoldAt(v)}
                    style={({ pressed }) => [
                      styles.placeCard,
                      on && styles.placeCardOn,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <View style={[styles.tick, on && styles.tickOn]}>
                      {on ? <IconCheck size={12} color={colors.white} /> : null}
                    </View>
                    <Text style={[styles.placeLabel, on && styles.placeLabelOn]}>
                      {PLAN_SOLD_AT_LABEL[v]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.help}>{SOLD_AT_HINT[soldAt]}</Text>
            {soldAt !== 'shop' ? (
              <>
                <SwitchRow
                  title="Also pays for a wash at the shop"
                  subtitle="A community member can use a wash at the branch’s shop too."
                  value={shopUse}
                  onChange={setShopUse}
                />
                <SwitchRow
                  title="Pay in parts"
                  subtitle="Community members can pay in instalments, by the plan rules."
                  value={parts}
                  onChange={setParts}
                />
              </>
            ) : null}
          </EditorCard>

          <EditorCard
            title="Price"
            badge={
              ownPrices
                ? 'Own price per size'
                : previewBp
                  ? `${bpToText(previewBp)}% off`
                  : 'Wash price'
            }
          >
            <View style={styles.segment} accessibilityRole="tablist">
              {[
                { on: false, label: 'From the wash price' },
                { on: true, label: 'Own price per size' },
              ].map((o) => {
                const selected = ownPrices === o.on;
                return (
                  <Pressable
                    key={o.label}
                    onPress={() => setOwnPrices(o.on)}
                    style={[styles.segmentBtn, selected && styles.segmentBtnOn]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!ownPrices ? (
              <View style={styles.discount}>
                <Text style={styles.discountLabel}>Discount on {serviceName}</Text>
                <View style={styles.discountRow}>
                  {DISCOUNTS.map((pct) => {
                    const on = previewBp === pct * 100;
                    return (
                      <Pressable
                        key={pct}
                        onPress={() => setDiscount(pct ? String(pct) : '')}
                        style={({ pressed }) => [
                          styles.discountChip,
                          on && styles.discountChipOn,
                          pressed && styles.pressed,
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[styles.discountChipText, on && styles.discountChipTextOn]}>
                          {pct ? `${pct}%` : 'None'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.discountCustom}>
                  <Text style={styles.discountCustomLabel}>Or type it</Text>
                  <View style={styles.discountInputWrap}>
                    <TextInput
                      style={styles.discountInput}
                      value={discount}
                      onChangeText={(t) => setDiscount(t.replace(/[^\d.]/g, ''))}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.slate}
                      maxLength={5}
                      accessibilityLabel="Discount in percent"
                    />
                    <Text style={styles.discountPct}>%</Text>
                  </View>
                </View>
                <Text style={styles.help}>
                  {previewBp
                    ? `Every wash at ${serviceName}’s price, ${bpToText(previewBp)}% less. Up to ${bpToText(WASH_PLAN_MAX_DISCOUNT_BP)}%.`
                    : `Every wash at ${serviceName}’s price, with no discount.`}
                </Text>
              </View>
            ) : (
              <View style={styles.priceGrid}>
                <View style={styles.priceRow}>
                  <Text style={[styles.priceSize, styles.priceHead]}>Size</Text>
                  <Text style={[styles.priceCell, styles.priceHead]}>At the shop ₹</Text>
                  <Text style={[styles.priceCell, styles.priceHead]}>Community ₹</Text>
                </View>
                {sizes.map((size) => (
                  <View key={size.id} style={styles.priceRow}>
                    <Text style={styles.priceSize} numberOfLines={1}>
                      {size.name}
                    </Text>
                    {(['hub', 'doorstep'] as const).map((mode) => (
                      <TextInput
                        key={mode}
                        style={[
                          styles.priceCell,
                          styles.priceInput,
                          mode === 'doorstep' && styles.priceInputAway,
                        ]}
                        value={priceText[priceKey(size.id, mode)] ?? ''}
                        onChangeText={(t) =>
                          setPriceText((prev) => ({
                            ...prev,
                            [priceKey(size.id, mode)]: t.replace(/[^\d.]/g, ''),
                          }))
                        }
                        keyboardType="numeric"
                        placeholder="—"
                        placeholderTextColor={colors.slate}
                        maxLength={8}
                        accessibilityLabel={`${size.name} ${mode === 'hub' ? 'shop' : 'community'} plan price`}
                      />
                    ))}
                  </View>
                ))}
                <Text style={styles.help}>A size left empty is priced from its wash.</Text>
              </View>
            )}
            {preview.length ? (
              <View style={styles.pay}>
                <View style={styles.payHead}>
                  <Text style={[styles.payTitle, styles.flex]}>What members pay</Text>
                  {atShop.length ? (
                    <Text style={[styles.payCol, styles.payColShop]}>At the shop</Text>
                  ) : null}
                  {atCommunity.length ? (
                    <Text style={[styles.payCol, styles.payColCommunity]}>Community</Text>
                  ) : null}
                </View>
                {preview.map((row, i) => {
                  const cells = [
                    atShop.length
                      ? { key: 'shop', shop: true, p: atShop.find((x) => x.key === row.key) }
                      : null,
                    atCommunity.length
                      ? {
                          key: 'community',
                          shop: false,
                          p: atCommunity.find((x) => x.key === row.key),
                        }
                      : null,
                  ].filter((c): c is NonNullable<typeof c> => c != null);
                  const save = Math.max(...cells.map((c) => c.p?.save ?? 0));
                  return (
                    <View key={row.key} style={[styles.payRow, i > 0 && styles.payDivider]}>
                      <View style={styles.flex}>
                        <Text style={styles.paySize} numberOfLines={1}>
                          {row.name}
                        </Text>
                        {save > 0 ? (
                          <View style={styles.saveTag}>
                            <Text style={styles.saveTagText}>Save up to {formatInr(save)}</Text>
                          </View>
                        ) : (
                          <Text style={styles.payNoSave}>Same as single washes</Text>
                        )}
                      </View>
                      {cells.map((c) => (
                        <View
                          key={c.key}
                          style={[
                            styles.payCell,
                            c.shop ? styles.payCellShop : styles.payCellCommunity,
                          ]}
                        >
                          <Text style={styles.payTotal}>{c.p ? formatInr(c.p.total) : '—'}</Text>
                          <Text style={styles.payEach}>
                            {c.p
                              ? `${formatInr(Math.round(c.p.total / previewWashes))} a wash`
                              : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  );
                })}
                <Text style={[styles.help, styles.payFoot]}>
                  For {previewWashes} {previewWashes === 1 ? 'wash' : 'washes'}, from the default
                  price book. Branches on another book, or with their own prices, may differ; big
                  communities may get a volume discount on top.
                </Text>
              </View>
            ) : null}
          </EditorCard>

          <EditorCard title="How it shows">
            <SwitchRow
              title="Most popular"
              subtitle="Marked as the one to pick, when customers choose a plan."
              value={popular}
              onChange={setPopular}
            />
            {plan ? (
              <SwitchRow
                title="Offered now"
                subtitle="Off: no new orders. Running plans carry on."
                value={active}
                onChange={setActive}
              />
            ) : null}
          </EditorCard>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            label={plan ? 'Save plan' : 'Add plan'}
            size="lg"
            loading={busy}
            onPress={() => void save()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

/** A whole number with − and + either side, typed or tapped. */
function Stepper({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min: number;
  max: number;
}) {
  const n = Number(value) || min;
  const set = (next: number) => onChange(String(Math.min(max, Math.max(min, next))));
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepLabel}>{label}</Text>
      <View style={styles.stepRow}>
        <Pressable
          onPress={() => set(n - 1)}
          disabled={n <= min}
          style={({ pressed }) => [
            styles.stepBtn,
            n <= min && styles.disabled,
            pressed && styles.pressed,
          ]}
          accessibilityLabel={`Fewer ${label.toLowerCase()}`}
        >
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <TextInput
          style={styles.stepInput}
          value={value}
          onChangeText={(t) => onChange(t.replace(/\D/g, ''))}
          keyboardType="number-pad"
          maxLength={3}
          accessibilityLabel={label}
        />
        <Pressable
          onPress={() => set(n + 1)}
          disabled={n >= max}
          style={({ pressed }) => [
            styles.stepBtn,
            n >= max && styles.disabled,
            pressed && styles.pressed,
          ]}
          accessibilityLabel={`More ${label.toLowerCase()}`}
        >
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.35 },
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  centerPad: { padding: spacing.lg, gap: spacing.md, alignItems: 'center' },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  heroBleed: { marginHorizontal: -spacing.md, marginTop: -spacing.xs },
  help: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slateDeep,
    letterSpacing: 0,
    lineHeight: 18,
  },
  error: { ...typography.label, color: colors.danger },

  stepper: { flex: 1, gap: 6 },
  stepLabel: { ...typography.label, fontSize: 13, color: colors.slateDeep, fontWeight: '700' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.indigoPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { ...typography.heading, fontSize: 22, color: colors.indigo, lineHeight: 24 },
  stepInput: {
    ...typography.heading,
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    textAlign: 'center',
    fontSize: 19,
    color: colors.ink,
    paddingVertical: 0,
  },

  placeRow: { flexDirection: 'row', gap: spacing.sm },
  placeCard: {
    flex: 1,
    padding: spacing.sm + 2,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 6,
  },
  placeCardOn: { borderColor: colors.indigo, backgroundColor: colors.indigoPale },
  placeLabel: { ...typography.bodyStrong, fontSize: 14.5, color: colors.ink, fontWeight: '800' },
  placeLabelOn: { color: colors.indigo },
  tick: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },

  segment: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  segmentBtn: {
    flex: 1,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  segmentBtnOn: { backgroundColor: colors.indigo },
  segmentText: { ...typography.label, fontSize: 13, fontWeight: '800', color: colors.slateDeep },
  segmentTextOn: { color: colors.white },

  priceGrid: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing.sm + 2,
    gap: 8,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  priceHead: {
    ...typography.caption,
    color: colors.slateDeep,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  priceSize: { flex: 1, ...typography.body, fontSize: 14, color: colors.waterInk },
  priceCell: { width: 96, textAlign: 'center' },
  priceInput: {
    height: 42,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: 15,
    fontWeight: '700',
    color: colors.waterInk,
    paddingVertical: 0,
  },
  priceInputAway: { borderColor: '#99F6E4', backgroundColor: '#F0FDFA' },

  discount: { gap: spacing.sm },
  discountLabel: { ...typography.label, fontSize: 13, color: colors.slateDeep, fontWeight: '700' },
  discountRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  discountChip: {
    minWidth: 64,
    height: 42,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discountChipOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  discountChipText: {
    ...typography.bodyStrong,
    fontSize: 15,
    fontWeight: '800',
    color: colors.waterInk,
  },
  discountChipTextOn: { color: colors.white },
  discountCustom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  discountCustomLabel: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slate,
    letterSpacing: 0,
  },
  discountInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  discountInput: {
    ...typography.bodyStrong,
    width: 52,
    fontSize: 16,
    fontWeight: '800',
    color: colors.waterInk,
    textAlign: 'right',
    paddingVertical: 0,
  },
  discountPct: { ...typography.bodyStrong, fontSize: 15, color: colors.slateDeep, marginLeft: 2 },

  pay: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  payHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.surface,
  },
  payTitle: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '800', color: colors.waterInk },
  payCol: {
    width: 104,
    textAlign: 'center',
    ...typography.caption,
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  payColShop: { color: colors.indigo },
  payColCommunity: { color: colors.tealDeep },
  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
  },
  payDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  paySize: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },
  payNoSave: {
    ...typography.caption,
    fontSize: 11.5,
    color: colors.slate,
    letterSpacing: 0,
    marginTop: 2,
  },
  saveTag: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
  },
  saveTagText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '800',
    color: '#166534',
    letterSpacing: 0,
  },
  payCell: {
    width: 104,
    paddingVertical: 8,
    borderRadius: radius.md,
    alignItems: 'center',
    gap: 1,
  },
  payCellShop: { backgroundColor: colors.indigoPale },
  payCellCommunity: { backgroundColor: '#E6F7F3' },
  payTotal: { ...typography.bodyStrong, fontSize: 16.5, fontWeight: '800', color: colors.waterInk },
  payEach: { ...typography.caption, fontSize: 11, color: colors.slateDeep, letterSpacing: 0 },
  payFoot: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
