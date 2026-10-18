import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { InferResponseType } from 'hono/client';
import {
  GSTIN_RE,
  MAX_PLAN_PRICE_PAISE,
  WASH_PLAN_MAX_DISCOUNT_BP,
  WASH_PLAN_MAX_MONTHS,
  WASH_PLAN_MAX_WASHES,
  WASH_PLAN_NAME_MAX,
  WASH_PLAN_RULE_LIMITS,
  formatClock,
  formatInr,
  isClockTime,
  listPrice,
  washPlanPrice,
  type PlacePriceMode,
  PLAN_SOLD_AT,
  PLAN_SOLD_AT_LABEL,
  type PlanSoldAt,
} from '@mana/domain';
import {
  BottomSheet,
  Button,
  ChoiceChips,
  IconCalendar,
  IconPlus,
  IconSparkle,
  TextField,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { api, type ApiResponse } from '../../api/client';
import { useApiData } from '../places/shared';
import { parseRupees } from '../../utils/format';
import {
  Band,
  BandRow,
  CatalogHero,
  SectionTitle,
  bpToText,
  paiseToText,
  plural,
  textToBp,
  useCatalog,
  type Catalog,
} from './shared';

type Data = InferResponseType<(typeof api)['business']['plans']['$get'], 200>;
type Plan = Data['plans'][number];
type Rules = Data['rules'];
type RuleKey = keyof typeof WASH_PLAN_RULE_LIMITS;

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

/**
 * Wash plans (Monthly, Quarterly…): how many washes over how many months, of which service, the
 * discount, and where it's sold (communities, the shop counter, or both). Prices follow each
 * branch's price for that service. Below, the rules community plans run by: paying in parts,
 * deadlines, skips, pauses, refunds and GST. The Plans tab of Services.
 */
export function WashPlansPane() {
  const data = useApiData<Data>(() => api.business.plans.$get(), 'Couldn’t load the wash plans.');
  const { catalog } = useCatalog();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const services = (catalog?.services ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }));
  const plans = data.data?.plans ?? [];
  const activePlans = plans.filter((p) => p.active).length;
  const rules = data.data?.rules;

  return (
    <View style={styles.flex}>
      {!data.data ? (
        data.error ? (
          <View style={styles.centerPad}>
            <Text style={styles.error}>{data.error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void data.load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.indigo} style={styles.loading} />
        )
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <CatalogHero
            eyebrow="Mana Wash HQ"
            title="Plans"
            meta="Washes over months at a discount: sold at communities, at the shop counter, or both."
            chips={[
              { label: 'Plans', value: activePlans },
              { label: 'Pay by', value: formatClock(data.data.rules.payDeadlineTime) },
              {
                label: 'GST',
                value: data.data.rules.gstRateBp ? `${bpToText(data.data.rules.gstRateBp)}%` : 'Off',
              },
            ]}
          />

          <SectionTitle>Plans</SectionTitle>
          <Band>
            {plans.map((p) => (
              <BandRow
                key={p.id}
                icon={<IconSparkle size={18} color={p.active ? colors.tealDeep : colors.slate} />}
                iconBg={p.active ? '#CCFBF1' : '#F1F5F9'}
                title={p.name}
                subtitle={[
                  `${p.washes} washes · ${p.months === 1 ? '1 month' : `${p.months} months`}`,
                  p.upgradeServiceName && p.upgradeEvery ? `${p.serviceName}, every ${nth(p.upgradeEvery)} ${p.upgradeServiceName}` : p.serviceName,
                  p.prices.length ? 'own prices' : p.discountBp ? `${bpToText(p.discountBp)}% off` : null,
                  PLAN_SOLD_AT_LABEL[p.soldAt],
                  p.allowParts ? 'parts' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                muted={!p.active}
                right={
                  !p.active ? (
                    <View style={styles.offPill}>
                      <Text style={styles.offPillText}>Off</Text>
                    </View>
                  ) : p.popular ? (
                    <View style={styles.popPill}>
                      <Text style={styles.popPillText}>Popular</Text>
                    </View>
                  ) : undefined
                }
                onPress={() => setEditing(p)}
              />
            ))}
            <BandRow
              icon={<IconPlus size={18} color={colors.indigo} />}
              iconBg={colors.indigoPale}
              title="Add a plan"
              last
              onPress={() => setEditing('new')}
            />
          </Band>

          <SectionTitle>Rules for community plans</SectionTitle>
          <Band>
            <BandRow
              icon={<IconCalendar size={18} color={colors.indigo} />}
              iconBg={colors.indigoPale}
              title="Paying, skips and refunds"
              subtitle={
                rules
                  ? `Pay by ${formatClock(rules.payDeadlineTime)} the day before · ${plural(rules.skipsPerMonth, 'skip')} a month · ${
                      rules.refundRule === 'pro_rata' ? 'pro-rata refunds' : 'refund at single price'
                    }`
                  : undefined
              }
              onPress={() => setRulesOpen(true)}
            />
            <BandRow
              icon={<IconSparkle size={18} color={colors.tealDeep} />}
              iconBg="#CCFBF1"
              title="GST on receipts"
              subtitle={
                rules?.gstRateBp
                  ? `${bpToText(rules.gstRateBp)}%${rules.gstin ? ` · ${rules.gstin}` : ''}`
                  : 'No GST'
              }
              last
              onPress={() => setRulesOpen(true)}
            />
          </Band>
          <View style={styles.bottomPad} />
        </ScrollView>
      )}
      <PlanSheet
        plan={editing === 'new' ? null : editing}
        visible={editing != null}
        services={services}
        catalog={catalog}
        priceMode={data.data?.rules.priceMode ?? 'doorstep'}
        onClose={() => setEditing(null)}
        run={data.run}
      />
      {data.data ? <RulesSheet rules={data.data.rules} visible={rulesOpen} onClose={() => setRulesOpen(false)} run={data.run} /> : null}
    </View>
  );
}

const nth = (n: number) => (n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

const EVERY_OPTIONS = [2, 3, 4, 5, 6, 8].map((n) => ({ value: String(n), label: `Every ${nth(n)}` }));
const NO_UPGRADE = '__none';

type PlanMode = 'hub' | 'doorstep';
const priceKey = (sizeId: string, mode: PlanMode) => `${sizeId}|${mode}`;

/** A service's list price for one size and way, at the default price book. */
function servicePrice(catalog: Catalog, serviceId: string, classKey: string, sizeId: string, mode: PlanMode): number | null {
  const book = catalog.priceBooks.find((b) => b.isDefault);
  const entry = book && catalog.prices.find((p) => p.priceBookId === book.id && p.serviceId === serviceId && p.sizeId === sizeId);
  if (!entry || entry.price <= 0) return null;
  const classKeyOf = new Map(catalog.classes.map((c) => [c.id, c.key]));
  const adjustments = catalog.adjustments.map((a) => ({ ...a, classKey: a.classId ? (classKeyOf.get(a.classId) ?? null) : null }));
  return listPrice({
    base: entry.price,
    mode,
    classKey,
    adjustments,
    zonePercentBp: 0,
    roundToPaise: catalog.policy.roundToPaise,
    doorstepBase: entry.doorstepPrice,
  }).price;
}

/** The sizes a plan's wash is priced for, by class. */
function planSizes(catalog: Catalog, serviceId: string) {
  const service = catalog.services.find((s) => s.id === serviceId);
  if (!service) return [];
  return catalog.classes
    .filter((c) => service.classIds.includes(c.id))
    .flatMap((cls) =>
      cls.sizes
        .filter((size) => servicePrice(catalog, serviceId, cls.key, size.id, 'hub') != null)
        .map((size) => ({ id: size.id, classKey: cls.key, name: cls.sizes.length > 1 ? size.name : cls.name, short: size.key })),
    );
}

/**
 * What one vehicle of each size pays for the plan: its own price when set, otherwise the
 * washes one by one (every Nth the better wash) less the discount, at the default price book.
 */
function planPreview(
  catalog: Catalog,
  plan: { serviceId: string; upgradeId: string | null; every: number; washes: number; discountBp: number; fixed: Map<string, number> | null },
  priceMode: PlacePriceMode,
) {
  return planSizes(catalog, plan.serviceId).flatMap((size) => {
    const perWash = servicePrice(catalog, plan.serviceId, size.classKey, size.id, priceMode);
    if (perWash == null) return [];
    const better = plan.upgradeId ? servicePrice(catalog, plan.upgradeId, size.classKey, size.id, priceMode) : null;
    const ups = plan.upgradeId && better != null ? Math.floor(plan.washes / plan.every) : 0;
    const listTotal = perWash * (plan.washes - ups) + (better ?? 0) * ups;
    const own = plan.fixed?.get(priceKey(size.id, priceMode));
    const total = own ?? washPlanPrice(listTotal / plan.washes, plan.washes, plan.discountBp);
    return [{ key: size.id, name: size.name, total, save: Math.max(0, listTotal - total) }];
  });
}

function PlanSheet({
  plan,
  visible,
  services,
  catalog,
  priceMode,
  onClose,
  run,
}: {
  plan: Plan | null;
  visible: boolean;
  services: { value: string; label: string }[];
  catalog: Catalog | null;
  priceMode: PlacePriceMode;
  onClose: () => void;
  run: (call: () => Promise<ApiResponse>, done?: string) => Promise<string | null>;
}) {
  const [name, setName] = useState('');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [washes, setWashes] = useState('4');
  const [months, setMonths] = useState('1');
  const [discount, setDiscount] = useState('');
  const [parts, setParts] = useState<'yes' | 'no'>('no');
  const [popular, setPopular] = useState<'yes' | 'no'>('no');
  const [active, setActive] = useState<'yes' | 'no'>('yes');
  const [upgradeId, setUpgradeId] = useState<string>(NO_UPGRADE);
  const [every, setEvery] = useState('4');
  const [fixedOn, setFixedOn] = useState<'yes' | 'no'>('no');
  const [soldAt, setSoldAt] = useState<PlanSoldAt>('community');
  const [shopUse, setShopUse] = useState<'yes' | 'no'>('yes');
  const [priceText, setPriceText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(plan?.name ?? '');
    setServiceId(plan?.catalogServiceId ?? services[0]?.value ?? null);
    setWashes(String(plan?.washes ?? 4));
    setMonths(String(plan?.months ?? 1));
    setDiscount(plan?.discountBp ? bpToText(plan.discountBp) : '');
    setParts(plan?.allowParts ? 'yes' : 'no');
    setPopular(plan?.popular ? 'yes' : 'no');
    setActive(plan?.active === false ? 'no' : 'yes');
    setUpgradeId(plan?.upgradeServiceId ?? NO_UPGRADE);
    setEvery(String(plan?.upgradeEvery ?? 4));
    setFixedOn(plan?.prices.length ? 'yes' : 'no');
    setSoldAt(plan?.soldAt ?? 'community');
    setShopUse(plan?.shopUse === false ? 'no' : 'yes');
    setPriceText(Object.fromEntries((plan?.prices ?? []).map((p) => [priceKey(p.sizeId, p.mode), paiseToText(p.price)])));
    setError(null);
    setBusy(false);
  }, [visible, plan, services]);

  const previewWashes = Math.min(WASH_PLAN_MAX_WASHES, Math.max(1, Number(washes) || 1));
  const previewBp = Math.min(WASH_PLAN_MAX_DISCOUNT_BP, Math.max(0, textToBp(discount) ?? 0));
  const better = upgradeId === NO_UPGRADE ? null : upgradeId;
  const fixed = useMemo(() => {
    if (fixedOn !== 'yes') return null;
    const map = new Map<string, number>();
    for (const [key, text] of Object.entries(priceText)) {
      const p = parseRupees(text);
      if (p != null && !Number.isNaN(p)) map.set(key, p);
    }
    return map;
  }, [fixedOn, priceText]);
  const sizes = useMemo(() => (catalog && serviceId ? planSizes(catalog, serviceId) : []), [catalog, serviceId]);
  const preview = useMemo(
    () =>
      catalog && serviceId
        ? planPreview(catalog, { serviceId, upgradeId: better, every: Number(every) || 4, washes: previewWashes, discountBp: previewBp, fixed }, priceMode)
        : [],
    [catalog, serviceId, better, every, previewWashes, previewBp, fixed, priceMode],
  );
  const awayLabel = 'Community';

  const save = async () => {
    const w = Number(washes);
    const m = Number(months);
    const bp = textToBp(discount);
    if (!name.trim()) return setError('Name the plan, like “Monthly”.');
    if (!serviceId) return setError('Pick the service each wash is.');
    if (!Number.isInteger(w) || w < 1 || w > WASH_PLAN_MAX_WASHES) return setError(`Washes is 1 to ${WASH_PLAN_MAX_WASHES}.`);
    if (!Number.isInteger(m) || m < 1 || m > WASH_PLAN_MAX_MONTHS) return setError(`Months is 1 to ${WASH_PLAN_MAX_MONTHS}.`);
    if (bp == null || bp < 0 || bp > WASH_PLAN_MAX_DISCOUNT_BP) return setError(`The discount is 0 to ${bpToText(WASH_PLAN_MAX_DISCOUNT_BP)}%.`);
    if (better === serviceId) return setError('The better wash must be a different wash.');
    const prices: { sizeId: string; mode: PlanMode; price: number }[] = [];
    if (fixedOn === 'yes') {
      for (const size of sizes) {
        for (const mode of ['hub', 'doorstep'] as const) {
          const text = priceText[priceKey(size.id, mode)] ?? '';
          const p = parseRupees(text);
          if (p == null) continue;
          if (Number.isNaN(p) || p > MAX_PLAN_PRICE_PAISE) return setError(`Check the ${size.name} ${mode === 'hub' ? 'hub' : awayLabel.toLowerCase()} price.`);
          prices.push({ sizeId: size.id, mode, price: p });
        }
      }
      if (!prices.length) return setError('Enter the plan price for at least one size, or turn own prices off.');
    }
    const values = {
      name: name.trim(),
      catalogServiceId: serviceId,
      washes: w,
      months: m,
      discountBp: bp,
      allowParts: parts === 'yes',
      popular: popular === 'yes',
      upgradeServiceId: better,
      upgradeEvery: better ? Number(every) : null,
      soldAt,
      shopUse: shopUse === 'yes',
      prices,
    };
    setBusy(true);
    setError(null);
    const message = plan
      ? await run(() => api.business.plans[':id'].$patch({ param: { id: plan.id }, json: { ...values, active: active === 'yes' } }), 'Plan saved')
      : await run(() => api.business.plans.$post({ json: values }), 'Plan added');
    setBusy(false);
    if (message) setError(message);
    else onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={plan ? plan.name : 'New plan'}
      footer={<Button label={plan ? 'Save' : 'Add plan'} size="lg" loading={busy} onPress={() => void save()} />}
    >
      <View style={styles.sheet}>
        <TextField label="Name" value={name} onChangeText={setName} maxLength={WASH_PLAN_NAME_MAX} placeholder="Monthly" autoCapitalize="words" />
        <ChoiceChips
          label="Where it’s sold"
          options={PLAN_SOLD_AT.map((v) => ({ value: v, label: PLAN_SOLD_AT_LABEL[v] }))}
          value={soldAt}
          onChange={setSoldAt}
        />
        <Text style={styles.previewNote}>
          {soldAt === 'community'
            ? 'Bought when joining a community, washed on its wash days.'
            : soldAt === 'shop'
              ? 'Sold at the counter in New Wash, paid there. For one vehicle, at that branch, one wash a day until it ends.'
              : 'Bought when joining a community, or at the counter in New Wash.'}
        </Text>
        {soldAt !== 'shop' ? (
          <ChoiceChips label="A community plan can also pay for a wash at the shop" options={YES_NO} value={shopUse} onChange={setShopUse} />
        ) : null}
        <ChoiceChips label="Each wash is" options={services} value={serviceId} onChange={setServiceId} />
        <View style={styles.row}>
          <View style={styles.flex}>
            <TextField label="Washes" value={washes} onChangeText={(t) => setWashes(t.replace(/\D/g, ''))} keyboardType="number-pad" />
          </View>
          <View style={styles.flex}>
            <TextField label="Months" value={months} onChangeText={(t) => setMonths(t.replace(/\D/g, ''))} keyboardType="number-pad" />
          </View>
        </View>
        <ChoiceChips
          label="Now and then a better wash"
          options={[{ value: NO_UPGRADE, label: 'No, every wash the same' }, ...services.filter((s) => s.value !== serviceId)]}
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
        <ChoiceChips
          label="Plan prices"
          options={[
            { value: 'no', label: 'From the wash price' },
            { value: 'yes', label: 'Own price per size' },
          ]}
          value={fixedOn}
          onChange={setFixedOn}
        />
        {fixedOn === 'no' ? (
          <TextField label="Discount (%)" optional value={discount} onChangeText={(t) => setDiscount(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder="0" />
        ) : (
          <View style={styles.priceGrid}>
            <View style={styles.priceHead}>
              <Text style={[styles.priceSize, styles.priceHeadText]}>Size</Text>
              <Text style={[styles.priceCell, styles.priceHeadText]}>Hub ₹</Text>
              <Text style={[styles.priceCell, styles.priceHeadText]}>{awayLabel} ₹</Text>
            </View>
            {sizes.map((size) => (
              <View key={size.id} style={styles.priceRow}>
                <Text style={styles.priceSize} numberOfLines={1}>
                  {size.name}
                </Text>
                {(['hub', 'doorstep'] as const).map((mode) => (
                  <TextInput
                    key={mode}
                    style={[styles.priceCell, styles.priceInput, mode === 'doorstep' && styles.priceInputAway]}
                    value={priceText[priceKey(size.id, mode)] ?? ''}
                    onChangeText={(t) => setPriceText((prev) => ({ ...prev, [priceKey(size.id, mode)]: t.replace(/[^\d.]/g, '') }))}
                    keyboardType="numeric"
                    placeholder="—"
                    placeholderTextColor={colors.slate}
                    maxLength={8}
                    accessibilityLabel={`${size.name} ${mode === 'hub' ? 'hub' : awayLabel} plan price`}
                  />
                ))}
              </View>
            ))}
            <Text style={styles.previewNote}>A size left empty is priced from its wash.</Text>
          </View>
        )}
        {preview.length ? (
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>What {priceMode === 'doorstep' ? `${awayLabel.toLowerCase()} members` : 'members'} pay</Text>
            {preview.map((p) => (
              <View key={p.key} style={styles.previewRow}>
                <Text style={styles.previewName} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={styles.previewEach}>
                  {formatInr(Math.round(p.total / previewWashes))} a wash{p.save > 0 ? ` · save ${formatInr(p.save)}` : ''}
                </Text>
                <Text style={styles.previewTotal}>{formatInr(p.total)}</Text>
              </View>
            ))}
            <Text style={styles.previewNote}>From the default price list. Branches with their own prices may differ.</Text>
          </View>
        ) : null}
        {soldAt !== 'shop' ? <ChoiceChips label="Pay in parts (communities)" options={YES_NO} value={parts} onChange={setParts} /> : null}
        <ChoiceChips label="Show as most popular" options={YES_NO} value={popular} onChange={setPopular} />
        {plan ? <ChoiceChips label="Offered now" options={YES_NO} value={active} onChange={setActive} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

const RULE_FIELDS: { key: RuleKey; label: string; hint?: string }[] = [
  { key: 'partsFirstPct', label: 'First part (% of the plan)' },
  { key: 'partsCount', label: 'Parts after the first' },
  { key: 'graceDays', label: 'Days a part may be late', hint: 'After this, washes stop until it’s paid.' },
  { key: 'skipsPerMonth', label: 'Skips per month' },
  { key: 'pauseDaysPerMonth', label: 'Pause days per month' },
  { key: 'renewalReminderDays', label: 'Renewal reminder (days before the end)' },
  { key: 'unpaidCloseDays', label: 'Close never-paid orders after (days)' },
  { key: 'atPlaceMeters', label: '“At the place” distance (metres)', hint: 'Joining within this distance needs no confirming.' },
];

const REFUND_OPTIONS = [
  { value: 'single_price', label: 'Washes given at single price' },
  { value: 'pro_rata', label: 'Pro-rata' },
] as const;

function RulesSheet({
  rules,
  visible,
  onClose,
  run,
}: {
  rules: Rules;
  visible: boolean;
  onClose: () => void;
  run: (call: () => Promise<ApiResponse>, done?: string) => Promise<string | null>;
}) {
  const [values, setValues] = useState<Record<RuleKey, string>>({} as Record<RuleKey, string>);
  const [payBy, setPayBy] = useState('');
  const [skipBy, setSkipBy] = useState('');
  const [refundRule, setRefundRule] = useState<'single_price' | 'pro_rata'>('single_price');
  const [gst, setGst] = useState('');
  const [gstin, setGstin] = useState('');
  const [legalName, setLegalName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setValues(Object.fromEntries(RULE_FIELDS.map((f) => [f.key, String(rules[f.key])])) as Record<RuleKey, string>);
    setPayBy(rules.payDeadlineTime);
    setSkipBy(rules.skipCutoffTime);
    setRefundRule(rules.refundRule);
    setGst(bpToText(rules.gstRateBp));
    setGstin(rules.gstin ?? '');
    setLegalName(rules.legalName ?? '');
    setError(null);
    setBusy(false);
  }, [visible, rules]);

  const save = async () => {
    const ints: Partial<Record<RuleKey, number>> = {};
    for (const f of RULE_FIELDS) {
      const n = Number(values[f.key]);
      const [min, max] = WASH_PLAN_RULE_LIMITS[f.key];
      if (!Number.isInteger(n) || n < min || n > max) return setError(`${f.label}: ${min} to ${max}.`);
      ints[f.key] = n;
    }
    if (!isClockTime(payBy) || !isClockTime(skipBy)) return setError('Times are like 20:00.');
    const gstBp = textToBp(gst);
    const [gMin, gMax] = WASH_PLAN_RULE_LIMITS.gstRateBp;
    if (gstBp == null || gstBp < gMin || gstBp > gMax) return setError('GST is 0 to 28%.');
    const cleanGstin = gstin.trim().toUpperCase();
    if (cleanGstin && !GSTIN_RE.test(cleanGstin)) return setError('Enter a valid GSTIN, or leave it empty.');
    setBusy(true);
    setError(null);
    const message = await run(
      () =>
        api.business['plan-rules'].$patch({
          json: { ...ints, payDeadlineTime: payBy, skipCutoffTime: skipBy, refundRule, gstRateBp: gstBp, gstin: cleanGstin || null, legalName: legalName.trim() || null },
        }),
      'Rules saved',
    );
    setBusy(false);
    if (message) setError(message);
    else onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title="Plan rules"
      subtitle="New orders follow these; running plans keep the rules they started with."
      footer={<Button label="Save" size="lg" loading={busy} onPress={() => void save()} />}
    >
      <View style={styles.sheet}>
        <View style={styles.row}>
          <View style={styles.flex}>
            <TextField label="Pay by (day before)" value={payBy} onChangeText={setPayBy} placeholder="20:00" keyboardType="numbers-and-punctuation" />
          </View>
          <View style={styles.flex}>
            <TextField label="Skip by (day before)" value={skipBy} onChangeText={setSkipBy} placeholder="20:00" keyboardType="numbers-and-punctuation" />
          </View>
        </View>
        {RULE_FIELDS.map((f) => (
          <TextField
            key={f.key}
            label={f.label}
            value={values[f.key] ?? ''}
            onChangeText={(t) => setValues((v) => ({ ...v, [f.key]: t.replace(/\D/g, '') }))}
            keyboardType="number-pad"
            hint={f.hint}
          />
        ))}
        <ChoiceChips label="Refund on cancel" options={REFUND_OPTIONS} value={refundRule} onChange={setRefundRule} />
        <TextField label="GST (%)" value={gst} onChangeText={(t) => setGst(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" hint="Prices include GST; receipts show the split." />
        <TextField label="GSTIN" optional value={gstin} onChangeText={setGstin} autoCapitalize="characters" maxLength={15} />
        <TextField label="Legal name on receipts" optional value={legalName} onChangeText={setLegalName} maxLength={120} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.md },
  centerPad: { padding: spacing.lg, gap: spacing.md, alignItems: 'center' },
  sheet: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  error: { ...typography.label, color: colors.danger },
  bottomPad: { height: spacing.xxl },
  offPill: {
    paddingHorizontal: 9,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
  },
  offPillText: { ...typography.caption, fontSize: 11, color: colors.slateDeep, fontWeight: '800', letterSpacing: 0 },
  popPill: {
    paddingHorizontal: 9,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
  },
  popPillText: { ...typography.caption, fontSize: 11, color: colors.amberDeep, fontWeight: '800', letterSpacing: 0 },
  preview: {
    backgroundColor: colors.waterPale,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 6,
  },
  previewTitle: { ...typography.label, color: colors.waterDeep },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  previewName: { ...typography.body, color: colors.waterInk, fontSize: 14, flex: 1 },
  previewEach: { ...typography.caption, color: colors.slateDeep },
  previewTotal: { ...typography.bodyStrong, color: colors.waterInk, minWidth: 72, textAlign: 'right' },
  previewNote: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0, marginTop: 2 },
  priceGrid: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing.sm + 2,
    gap: 6,
  },
  priceHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  priceHeadText: { ...typography.caption, color: colors.slateDeep, fontWeight: '800', letterSpacing: 0.3 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  priceSize: { flex: 1, ...typography.body, fontSize: 14, color: colors.waterInk },
  priceCell: { width: 92, textAlign: 'center' },
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
});
