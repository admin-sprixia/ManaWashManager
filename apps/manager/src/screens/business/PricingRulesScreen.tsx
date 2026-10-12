import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  BottomSheet,
  Button,
  ChoiceChips,
  EdgeGroup,
  EdgeRow,
  EdgePanel,
  IconMapPin,
  IconPlus,
  IconRupee,
  Notice,
  Pill,
  ScreenContainer,
  ScreenHeader,
  SectionLabel,
  TextField,
  colors,
  spacing,
  typography,
} from '@mana/ui';
import {
  MAX_ADJUSTMENT_BP,
  MAX_ADJUSTMENT_FIXED_PAISE,
  MAX_OVERRIDE_PCT,
  MIN_ADJUSTMENT_BP,
  PRICE_ZONE_NAME_MAX,
  ROUND_TO_CHOICES_PAISE,
  type DeliveryMode,
} from '@mana/domain';
import { api } from '../../api/client';
import { formatRupees, parseRupees } from '../../utils/format';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { bpToText, formatPercent, paiseToText, textToBp, useCatalog, type Catalog } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessRules'>;
type Adjustment = Catalog['adjustments'][number];
type Zone = Catalog['zones'][number];

const modeTitle = (mode: DeliveryMode, homeWash: boolean) =>
  mode === 'hub' ? 'At the shop extra' : homeWash ? 'Doorstep extra' : 'Community extra';
const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

function describeAdjustment(a: Pick<Adjustment, 'percentBp' | 'fixedPaise' | 'minExtraPaise'>): string {
  const parts: string[] = [];
  if (a.percentBp) parts.push(formatPercent(a.percentBp));
  if (a.fixedPaise) parts.push(`${a.fixedPaise > 0 ? '+' : '−'}${formatRupees(Math.abs(a.fixedPaise))}`);
  if (a.minExtraPaise) parts.push(`at least ${formatRupees(a.minExtraPaise)}`);
  return parts.join(', ') || 'No extra';
}

/** How list prices are worked out from base prices, and how far branches may move them. */
export function PricingRulesScreen({ navigation }: Props) {
  const { catalog, error, load, run } = useCatalog();
  const [adjusting, setAdjusting] = useState<{ mode: DeliveryMode; classId: string | null } | null>(null);
  const [zone, setZone] = useState<Zone | 'new' | null>(null);

  if (!catalog) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title="Pricing rules" onBack={() => navigation.goBack()} />
        </View>
        {error ? (
          <View style={styles.pad}>
            <Notice tone="danger">{error}</Notice>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.water} style={styles.loading} />
        )}
      </ScreenContainer>
    );
  }

  const className = (id: string | null) => (id == null ? 'All vehicles' : (catalog.classes.find((c) => c.id === id)?.name ?? 'Vehicles'));
  const ruleFor = (mode: DeliveryMode, classId: string | null) =>
    catalog.adjustments.find((a) => a.mode === mode && a.classId === classId) ?? null;
  const editingRule = adjusting ? ruleFor(adjusting.mode, adjusting.classId) : null;

  const modeSection = (mode: DeliveryMode) => {
    const rules = catalog.adjustments.filter((a) => a.mode === mode).sort((a, b) => (a.classId == null ? -1 : b.classId == null ? 1 : 0));
    const free = catalog.classes.filter((c) => !rules.some((r) => r.classId === c.id));
    return (
      <>
        <SectionLabel>{modeTitle(mode, catalog.homeWash)}</SectionLabel>
        <EdgeGroup>
          {rules.map((r) => (
            <EdgeRow
              key={r.id}
              icon={<IconRupee size={18} color={colors.waterDeep} />}
              title={className(r.classId)}
              subtitle={describeAdjustment(r)}
              onPress={() => setAdjusting({ mode, classId: r.classId })}
            />
          ))}
          {!rules.some((r) => r.classId == null) ? (
            <EdgeRow
              icon={<IconPlus size={18} color={colors.waterDeep} />}
              title="Add an extra for all vehicles"
              onPress={() => setAdjusting({ mode, classId: null })}
            />
          ) : null}
          {rules.length > 0
            ? free.map((c) => (
                <EdgeRow
                  key={c.id}
                  icon={<IconPlus size={18} color={colors.slate} />}
                  title={`Different extra for ${c.name.toLowerCase()}`}
                  tone="muted"
                  onPress={() => setAdjusting({ mode, classId: c.id })}
                />
              ))
            : null}
        </EdgeGroup>
      </>
    );
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Pricing rules" onBack={() => navigation.goBack()} />
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[styles.help, styles.pad]}>
            Each price is worked out in this order: base price → {catalog.homeWash ? 'doorstep' : 'community'} or shop extra →
            the branch’s zone → rounded. A branch’s own price comes last, within the limits below.
          </Text>

          {modeSection('doorstep')}
          {catalog.adjustments.some((a) => a.mode === 'hub') ? (
            modeSection('hub')
          ) : (
            <View style={[styles.pad, styles.linkPad]}>
              <Button
                label="Add an extra for washes at the shop"
                variant="ghost"
                onPress={() => setAdjusting({ mode: 'hub', classId: null })}
              />
            </View>
          )}

          <SectionLabel>Price zones</SectionLabel>
          <Text style={[styles.help, styles.pad]}>
            A zone moves every price up or down for the branches in it — say −10% in small towns. Pick each branch’s zone in
            Branches and price books.
          </Text>
          <EdgeGroup>
            {catalog.zones.map((z) => {
              const branches = catalog.branches.filter((b) => b.priceZoneId === z.id).length;
              return (
                <EdgeRow
                  key={z.id}
                  icon={<IconMapPin size={18} color={z.active ? colors.tealDeep : colors.slate} />}
                  iconBg="#CCFBF1"
                  title={z.name}
                  subtitle={`${formatPercent(z.percentBp)} · ${branches} branch${branches === 1 ? '' : 'es'}`}
                  tone={z.active ? 'default' : 'muted'}
                  right={z.active ? undefined : <Pill label="OFF" tone="slate" />}
                  onPress={() => setZone(z)}
                />
              );
            })}
            <EdgeRow icon={<IconPlus size={18} color={colors.waterDeep} />} title="Add a zone" onPress={() => setZone('new')} />
          </EdgeGroup>

          <SectionLabel>Branch prices</SectionLabel>
          <PolicyPanel catalog={catalog} run={run} />
          <View style={styles.bottomPad} />
        </ScrollView>
      </KeyboardAvoidingView>

      <AdjustmentSheet
        visible={adjusting != null}
        title={adjusting ? `${modeTitle(adjusting.mode, catalog.homeWash)} · ${className(adjusting.classId)}` : ''}
        rule={editingRule}
        onClose={() => setAdjusting(null)}
        onSave={async (values) => {
          if (!adjusting) return null;
          const message = await run(
            () => api.business.adjustments.$put({ json: { ...adjusting, ...values } }),
            'Saved · every branch updated',
          );
          if (!message) setAdjusting(null);
          return message;
        }}
        onRemove={
          editingRule && adjusting
            ? async () => {
                const message = await run(() => api.business.adjustments.$delete({ json: adjusting }), 'Removed · every branch updated');
                if (!message) setAdjusting(null);
                return message;
              }
            : undefined
        }
      />
      <ZoneSheet
        visible={zone != null}
        zone={zone === 'new' ? null : zone}
        onClose={() => setZone(null)}
        onSave={async (values) => {
          const message = await run(
            () =>
              zone && zone !== 'new'
                ? api.business.zones[':id'].$patch({ param: { id: zone.id }, json: values })
                : api.business.zones.$post({ json: { name: values.name, percentBp: values.percentBp } }),
            zone && zone !== 'new' ? 'Zone saved' : 'Zone added',
          );
          if (!message) setZone(null);
          return message;
        }}
      />
    </ScreenContainer>
  );
}

function PolicyPanel({ catalog, run }: { catalog: Catalog; run: ReturnType<typeof useCatalog>['run'] }) {
  const { policy } = catalog;
  const [overrides, setOverrides] = useState<'yes' | 'no'>(policy.branchOverrides ? 'yes' : 'no');
  const [up, setUp] = useState(String(policy.maxIncreasePct));
  const [down, setDown] = useState(String(policy.maxDecreasePct));
  const [hide, setHide] = useState<'yes' | 'no'>(policy.branchCanHideServices ? 'yes' : 'no');
  const [round, setRound] = useState(String(policy.roundToPaise));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOverrides(policy.branchOverrides ? 'yes' : 'no');
    setUp(String(policy.maxIncreasePct));
    setDown(String(policy.maxDecreasePct));
    setHide(policy.branchCanHideServices ? 'yes' : 'no');
    setRound(String(policy.roundToPaise));
  }, [policy]);

  const pct = (t: string) => {
    const n = Number(t.trim());
    return Number.isInteger(n) && n >= 0 && n <= MAX_OVERRIDE_PCT ? n : null;
  };

  const save = async () => {
    const maxIncreasePct = pct(up);
    const maxDecreasePct = pct(down);
    if (overrides === 'yes' && (maxIncreasePct == null || maxDecreasePct == null)) {
      return setError(`Limits are whole percentages from 0 to ${MAX_OVERRIDE_PCT}.`);
    }
    setBusy(true);
    setError(null);
    const message = await run(
      () =>
        api.business.policy.$patch({
          json: {
            branchOverrides: overrides === 'yes',
            ...(overrides === 'yes' ? { maxIncreasePct: maxIncreasePct!, maxDecreasePct: maxDecreasePct! } : {}),
            branchCanHideServices: hide === 'yes',
            roundToPaise: Number(round),
          },
        }),
      'Saved · every branch updated',
    );
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <EdgePanel>
      <ChoiceChips label="Branches may set their own prices" options={YES_NO} value={overrides} onChange={setOverrides} />
      {overrides === 'yes' ? (
        <View style={styles.row}>
          <View style={styles.flex}>
            <TextField label="Up to % more" value={up} onChangeText={(t) => setUp(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} />
          </View>
          <View style={styles.flex}>
            <TextField label="Up to % less" value={down} onChangeText={(t) => setDown(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} />
          </View>
        </View>
      ) : (
        <Text style={styles.help}>Branches charge the list price. Prices they set before are kept and come back if you switch this on again.</Text>
      )}
      <ChoiceChips label="Branches may stop offering a service" options={YES_NO} value={hide} onChange={setHide} />
      <ChoiceChips
        label="Round prices to the nearest"
        options={ROUND_TO_CHOICES_PAISE.map((p) => ({ value: String(p), label: formatRupees(p) }))}
        value={round}
        onChange={setRound}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Save branch price rules" loading={busy} onPress={() => void save()} />
    </EdgePanel>
  );
}

function AdjustmentSheet({
  visible,
  title,
  rule,
  onClose,
  onSave,
  onRemove,
}: {
  visible: boolean;
  title: string;
  rule: Adjustment | null;
  onClose: () => void;
  onSave: (values: { percentBp: number; fixedPaise: number; minExtraPaise: number }) => Promise<string | null>;
  onRemove?: () => Promise<string | null>;
}) {
  const [percent, setPercent] = useState('');
  const [fixed, setFixed] = useState('');
  const [min, setMin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setPercent(rule ? bpToText(rule.percentBp) : '15');
    setFixed(paiseToText(rule?.fixedPaise || null));
    setMin(paiseToText(rule?.minExtraPaise || null));
    setError(null);
    setBusy(false);
  }, [visible, rule]);

  const act = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    const message = await fn();
    setBusy(false);
    if (message) setError(message);
  };

  const save = () => {
    const percentBp = textToBp(percent);
    const fixedText = fixed.trim();
    const fixedPaise = fixedText ? Math.round(Number(fixedText) * 100) : 0;
    const minExtraPaise = parseRupees(min) ?? 0;
    if (percentBp == null || percentBp < MIN_ADJUSTMENT_BP || percentBp > MAX_ADJUSTMENT_BP) {
      return setError(`The percentage is from ${MIN_ADJUSTMENT_BP / 100} to ${MAX_ADJUSTMENT_BP / 100}.`);
    }
    if (!Number.isFinite(fixedPaise) || Math.abs(fixedPaise) > MAX_ADJUSTMENT_FIXED_PAISE) {
      return setError(`The fixed amount is up to ${formatRupees(MAX_ADJUSTMENT_FIXED_PAISE)}.`);
    }
    if (Number.isNaN(minExtraPaise) || minExtraPaise > MAX_ADJUSTMENT_FIXED_PAISE) return setError('Enter the minimum in rupees.');
    void act(() => onSave({ percentBp, fixedPaise, minExtraPaise }));
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={title}
      footer={
        <View style={styles.footer}>
          <Button label="Save" size="lg" loading={busy} onPress={save} />
          {onRemove ? <Button label="Remove this extra" variant="ghost" disabled={busy} onPress={() => void act(onRemove)} /> : null}
        </View>
      }
    >
      <TextField
        label="Percentage of the base price"
        value={percent}
        onChangeText={(t) => setPercent(t.replace(/[^\d.-]/g, ''))}
        keyboardType="numbers-and-punctuation"
        hint="15 adds 15%. A minus number gives a discount."
      />
      <TextField
        label="Plus a fixed amount (₹)"
        optional
        value={fixed}
        onChangeText={(t) => setFixed(t.replace(/[^\d.-]/g, ''))}
        keyboardType="numbers-and-punctuation"
      />
      <TextField
        label="Extra is at least (₹)"
        optional
        value={min}
        onChangeText={(t) => setMin(t.replace(/[^\d.]/g, ''))}
        keyboardType="decimal-pad"
        hint="So a cheap service still covers the trip."
        error={error}
      />
    </BottomSheet>
  );
}

function ZoneSheet({
  visible,
  zone,
  onClose,
  onSave,
}: {
  visible: boolean;
  zone: Zone | null;
  onClose: () => void;
  onSave: (values: { name: string; percentBp: number; active: boolean }) => Promise<string | null>;
}) {
  const [name, setName] = useState('');
  const [percent, setPercent] = useState('');
  const [active, setActive] = useState<'yes' | 'no'>('yes');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setName(zone?.name ?? '');
    setPercent(zone ? bpToText(zone.percentBp) : '');
    setActive(zone?.active === false ? 'no' : 'yes');
    setError(null);
    setBusy(false);
  }, [visible, zone]);

  const save = async () => {
    const percentBp = textToBp(percent);
    if (!name.trim()) return setError('Enter the zone name.');
    if (percentBp == null || percentBp < -5000 || percentBp > 10000) return setError('The change is from −50% to +100%.');
    setBusy(true);
    setError(null);
    const message = await onSave({ name: name.trim(), percentBp, active: active === 'yes' });
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={zone ? zone.name : 'New price zone'}
      footer={<Button label={zone ? 'Save' : 'Add zone'} size="lg" loading={busy} onPress={() => void save()} />}
    >
      <TextField label="Name" placeholder="Small towns" value={name} onChangeText={setName} maxLength={PRICE_ZONE_NAME_MAX} autoCapitalize="words" />
      <TextField
        label="Change every price by (%)"
        placeholder="-10"
        value={percent}
        onChangeText={(t) => setPercent(t.replace(/[^\d.-]/g, ''))}
        keyboardType="numbers-and-punctuation"
        hint="−10 makes everything 10% cheaper; 10 makes it 10% dearer."
      />
      {zone ? <ChoiceChips label="In use" options={YES_NO} value={active} onChange={setActive} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.sm },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  linkPad: { marginTop: spacing.sm },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.md },
  footer: { gap: spacing.xs },
  error: { ...typography.label, color: colors.danger },
  bottomPad: { height: spacing.xxl },
});
