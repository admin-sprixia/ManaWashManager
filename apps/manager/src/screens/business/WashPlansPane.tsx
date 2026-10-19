import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { InferResponseType } from 'hono/client';
import { GSTIN_RE, WASH_PLAN_RULE_LIMITS, formatClock, isClockTime, PLAN_SOLD_AT_LABEL } from '@mana/domain';
import { BottomSheet, Button, ChoiceChips, IconCalendar, IconPlus, IconSparkle, TextField, colors, spacing, typography } from '@mana/ui';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api, type ApiResponse } from '../../api/client';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { nth } from './plansShared';
import { useApiData } from '../places/shared';
import { Band, BandRow, CatalogHero, SectionTitle, bpToText, plural, textToBp } from './shared';

type Data = InferResponseType<(typeof api)['business']['plans']['$get'], 200>;
type Rules = Data['rules'];
type RuleKey = keyof typeof WASH_PLAN_RULE_LIMITS;

/**
 * Wash plans (Monthly, Quarterly…): how many washes over how many months, of which service, the
 * discount, and where it's sold (communities, the shop counter, or both). Prices follow each
 * branch's price for that service. Below, the rules community plans run by: paying in parts,
 * deadlines, skips, pauses, refunds and GST. The Plans tab of Services.
 */
export function WashPlansPane() {
  const data = useApiData<Data>(() => api.business.plans.$get(), 'Couldn’t load the wash plans.');
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [rulesOpen, setRulesOpen] = useState(false);

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
                onPress={() => navigation.navigate('BusinessPlanEdit', { planId: p.id })}
              />
            ))}
            <BandRow
              icon={<IconPlus size={18} color={colors.indigo} />}
              iconBg={colors.indigoPale}
              title="Add a plan"
              last
              onPress={() => navigation.navigate('BusinessPlanEdit')}
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
      {data.data ? <RulesSheet rules={data.data.rules} visible={rulesOpen} onClose={() => setRulesOpen(false)} run={data.run} /> : null}
    </View>
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
});
