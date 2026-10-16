import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import {
  GSTIN_RE,
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
} from '@mana/domain';
import {
  BottomSheet,
  Button,
  ChoiceChips,
  IconCalendar,
  IconPlus,
  IconSparkle,
  ScreenContainer,
  ScreenHeader,
  TextField,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { api, type ApiResponse } from '../../api/client';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { useApiData } from '../places/shared';
import {
  Band,
  BandRow,
  CatalogHero,
  SectionTitle,
  bpToText,
  plural,
  textToBp,
  useCatalog,
  type Catalog,
} from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'WashPlans'>;
type Data = InferResponseType<(typeof api)['business']['plans']['$get'], 200>;
type Plan = Data['plans'][number];
type Rules = Data['rules'];
type RuleKey = keyof typeof WASH_PLAN_RULE_LIMITS;

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

/**
 * Wash plans for places (Monthly, Quarterly…): how many washes over how many months, of which
 * service, and the discount. Prices follow each branch's price for that service. Below, the
 * rules every plan runs by: paying in parts, deadlines, skips, pauses, refunds and GST.
 */
export function WashPlansScreen({ navigation }: Props) {
  const data = useApiData<Data>(() => api.business.plans.$get(), 'Couldn’t load the wash plans.');
  const { catalog } = useCatalog();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const services = (catalog?.services ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }));
  const plans = data.data?.plans ?? [];
  const activePlans = plans.filter((p) => p.active).length;
  const rules = data.data?.rules;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Wash plans" onBack={() => navigation.goBack()} />
      </View>
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
            eyebrow="Communities"
            title="Wash plans"
            meta="Members buy washes over months at a discount. They pay online before the first wash."
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
                  p.serviceName,
                  p.discountBp ? `${bpToText(p.discountBp)}% off` : null,
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

          <SectionTitle>Rules</SectionTitle>
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
    </ScreenContainer>
  );
}

/** What one vehicle of each size pays for the plan at the default price book's list prices. */
function planPreview(catalog: Catalog, serviceId: string, priceMode: PlacePriceMode, washes: number, discountBp: number) {
  const book = catalog.priceBooks.find((b) => b.isDefault);
  if (!book) return [];
  const classKey = new Map(catalog.classes.map((c) => [c.id, c.key]));
  const adjustments = catalog.adjustments.map((a) => ({ ...a, classKey: a.classId ? (classKey.get(a.classId) ?? null) : null }));
  return catalog.classes.flatMap((cls) =>
    cls.sizes.flatMap((size) => {
      const base = catalog.prices.find((p) => p.priceBookId === book.id && p.serviceId === serviceId && p.sizeId === size.id)?.price;
      if (base == null || base <= 0) return [];
      const perWash = listPrice({ base, mode: priceMode, classKey: cls.key, adjustments, zonePercentBp: 0, roundToPaise: catalog.policy.roundToPaise }).price;
      return [{ key: size.id, name: cls.sizes.length > 1 ? size.name : cls.name, perWash, total: washPlanPrice(perWash, washes, discountBp) }];
    }),
  );
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
    setError(null);
    setBusy(false);
  }, [visible, plan, services]);

  const previewWashes = Math.min(WASH_PLAN_MAX_WASHES, Math.max(1, Number(washes) || 1));
  const previewBp = Math.min(WASH_PLAN_MAX_DISCOUNT_BP, Math.max(0, textToBp(discount) ?? 0));
  const preview = useMemo(
    () => (catalog && serviceId ? planPreview(catalog, serviceId, priceMode, previewWashes, previewBp) : []),
    [catalog, serviceId, priceMode, previewWashes, previewBp],
  );

  const save = async () => {
    const w = Number(washes);
    const m = Number(months);
    const bp = textToBp(discount);
    if (!name.trim()) return setError('Name the plan, like “Monthly”.');
    if (!serviceId) return setError('Pick the service each wash is.');
    if (!Number.isInteger(w) || w < 1 || w > WASH_PLAN_MAX_WASHES) return setError(`Washes is 1 to ${WASH_PLAN_MAX_WASHES}.`);
    if (!Number.isInteger(m) || m < 1 || m > WASH_PLAN_MAX_MONTHS) return setError(`Months is 1 to ${WASH_PLAN_MAX_MONTHS}.`);
    if (bp == null || bp < 0 || bp > WASH_PLAN_MAX_DISCOUNT_BP) return setError(`The discount is 0 to ${bpToText(WASH_PLAN_MAX_DISCOUNT_BP)}%.`);
    const values = { name: name.trim(), catalogServiceId: serviceId, washes: w, months: m, discountBp: bp, allowParts: parts === 'yes', popular: popular === 'yes' };
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
        <ChoiceChips label="Each wash is" options={services} value={serviceId} onChange={setServiceId} />
        <View style={styles.row}>
          <View style={styles.flex}>
            <TextField label="Washes" value={washes} onChangeText={(t) => setWashes(t.replace(/\D/g, ''))} keyboardType="number-pad" />
          </View>
          <View style={styles.flex}>
            <TextField label="Months" value={months} onChangeText={(t) => setMonths(t.replace(/\D/g, ''))} keyboardType="number-pad" />
          </View>
        </View>
        <TextField label="Discount (%)" optional value={discount} onChangeText={(t) => setDiscount(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder="0" />
        {preview.length ? (
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>What members pay</Text>
            {preview.map((p) => (
              <View key={p.key} style={styles.previewRow}>
                <Text style={styles.previewName} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={styles.previewEach}>{formatInr(Math.round(p.total / previewWashes))} a wash</Text>
                <Text style={styles.previewTotal}>{formatInr(p.total)}</Text>
              </View>
            ))}
            <Text style={styles.previewNote}>
              From the default price list{priceMode === 'doorstep' ? ' with the community extra' : ''}. Branches with their own prices may differ.
            </Text>
          </View>
        ) : null}
        <ChoiceChips label="Pay in parts" options={YES_NO} value={parts} onChange={setParts} />
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
});
