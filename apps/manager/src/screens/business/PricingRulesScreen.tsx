import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ChoiceChips, IconChevronRight, IconTag, ScreenContainer, ScreenHeader, TextField, colors, radius, spacing, typography } from '@mana/ui';
import { MAX_OVERRIDE_PCT } from '@mana/domain';
import { api } from '../../api/client';
import { formatRupees } from '../../utils/format';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { CatalogHero, useCatalog, type Catalog } from './shared';
import { describeCommunityRule } from './prices/CommunityPricing';
import { Panel, TONE } from './prices/parts';

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessRules'>;

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

/**
 * How much freedom branch owners have with head office's prices. The prices themselves (hub,
 * community and doorstep) are all in Base prices; worked-out prices are rounded to the rupee.
 */
export function PricingRulesScreen({ navigation }: Props) {
  const { catalog, error, load, run } = useCatalog();

  if (!catalog) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title="Pricing rules" onBack={() => navigation.goBack()} />
        </View>
        {error ? (
          <View style={styles.centerPad}>
            <Text style={styles.error}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.indigo} style={styles.loading} />
        )}
      </ScreenContainer>
    );
  }

  const community = catalog.adjustments.find((a) => a.mode === 'doorstep' && a.classId == null) ?? null;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Pricing rules" onBack={() => navigation.goBack()} />
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <CatalogHero eyebrow="Mana Wash HQ" title="Pricing rules" meta="How much freedom branch owners have with your prices." />

          <Pressable
            onPress={() => navigation.navigate('BusinessPrices')}
            style={({ pressed }) => [styles.link, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <View style={styles.linkIcon}>
              <IconTag size={18} color={TONE.hub.main} />
            </View>
            <View style={styles.linkCopy}>
              <Text style={styles.linkTitle}>Prices are in Base prices</Text>
              <Text style={styles.linkBody}>
                Hub prices · community {describeCommunityRule(community).toLowerCase()} · doorstep visit{' '}
                {formatRupees(catalog.away.doorstep.visitFeePaise)}+
              </Text>
            </View>
            <IconChevronRight size={18} color={colors.slate} />
          </Pressable>

          <BranchFreedom catalog={catalog} run={run} />

          <Text style={styles.footNote}>Worked-out prices are rounded to the nearest ₹1, so ₹474.05 becomes ₹474.</Text>
          <View style={styles.bottomPad} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

function BranchFreedom({ catalog, run }: { catalog: Catalog; run: ReturnType<typeof useCatalog>['run'] }) {
  const { policy } = catalog;
  const [overrides, setOverrides] = useState<'yes' | 'no'>(policy.branchOverrides ? 'yes' : 'no');
  const [up, setUp] = useState(String(policy.maxIncreasePct));
  const [down, setDown] = useState(String(policy.maxDecreasePct));
  const [hide, setHide] = useState<'yes' | 'no'>(policy.branchCanHideServices ? 'yes' : 'no');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOverrides(policy.branchOverrides ? 'yes' : 'no');
    setUp(String(policy.maxIncreasePct));
    setDown(String(policy.maxDecreasePct));
    setHide(policy.branchCanHideServices ? 'yes' : 'no');
  }, [policy]);

  const pct = (t: string) => {
    const n = Number(t.trim());
    return t.trim() && Number.isInteger(n) && n >= 0 && n <= MAX_OVERRIDE_PCT ? n : null;
  };

  // An example: the most popular service's hub price for the smallest car (or the first vehicle it's priced for).
  const book = catalog.priceBooks.find((b) => b.isDefault);
  const popular = [...catalog.services].filter((s) => s.active).sort((a, b) => Number(b.popular) - Number(a.popular));
  const sizes = [...catalog.classes]
    .sort((a, b) => Number(b.key === 'car') - Number(a.key === 'car') || a.sortOrder - b.sortOrder)
    .flatMap((c) => [...c.sizes].sort((a, b) => a.sortOrder - b.sortOrder).map((z) => ({ id: z.id, label: `${c.name} ${z.key}` })));
  const example = popular
    .flatMap((s) =>
      sizes.flatMap((z) => {
        const p = catalog.prices.find((x) => x.priceBookId === book?.id && x.serviceId === s.id && x.sizeId === z.id);
        return p ? [{ s, p, size: z.label }] : [];
      }),
    )
    .at(0);
  const upN = pct(up);
  const downN = pct(down);
  const range =
    example?.p && upN != null && downN != null
      ? {
          name: `${example.s.name} · ${example.size}`,
          base: example.p.price,
          low: Math.round((example.p.price * (100 - downN)) / 100 / 100) * 100,
          high: Math.round((example.p.price * (100 + upN)) / 100 / 100) * 100,
        }
      : null;
  const changed =
    (overrides === 'yes') !== policy.branchOverrides ||
    (hide === 'yes') !== policy.branchCanHideServices ||
    (overrides === 'yes' && (upN !== policy.maxIncreasePct || downN !== policy.maxDecreasePct));

  const save = async () => {
    if (overrides === 'yes' && (upN == null || downN == null)) {
      return setError(`Limits are whole percentages from 0 to ${MAX_OVERRIDE_PCT}.`);
    }
    setBusy(true);
    setError(null);
    const message = await run(
      () =>
        api.business.policy.$patch({
          json: {
            branchOverrides: overrides === 'yes',
            ...(overrides === 'yes' ? { maxIncreasePct: upN!, maxDecreasePct: downN! } : {}),
            branchCanHideServices: hide === 'yes',
          },
        }),
      'Saved · every branch updated',
    );
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <>
      <Panel title="Branch owners’ own prices" subtitle="Can an owner change a price at their branch, for example to match a shop nearby?">
        <ChoiceChips label="Owners may set their own prices" options={YES_NO} value={overrides} onChange={setOverrides} />
        {overrides === 'yes' ? (
          <>
            <View style={styles.row}>
              <View style={styles.flex}>
                <TextField label="Up to % more" value={up} onChangeText={(t) => setUp(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} />
              </View>
              <View style={styles.flex}>
                <TextField label="Up to % less" value={down} onChangeText={(t) => setDown(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} />
              </View>
            </View>
            {range ? (
              <View style={styles.example}>
                <Text style={styles.exampleLabel}>{range.name} at {formatRupees(range.base)}</Text>
                <Text style={styles.exampleValue}>
                  an owner can charge {formatRupees(range.low)} to {formatRupees(range.high)}
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          <Text style={styles.help}>Every branch charges your prices exactly. Prices owners set before are kept and come back if you switch this on again.</Text>
        )}
      </Panel>

      <Panel title="Stopping a service" subtitle="Can an owner take one of your services off their branch’s menu, for example when they have no machine for it?">
        <ChoiceChips label="Owners may stop offering a service" options={YES_NO} value={hide} onChange={setHide} />
        <Text style={styles.help}>
          {hide === 'yes'
            ? 'Owners can hide a service at their branch and bring it back later.'
            : 'Every service you switch on for a branch stays on its menu.'}
        </Text>
      </Panel>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.saveWrap}>
        <Button label={changed ? 'Save' : 'Saved'} loading={busy} disabled={!changed} onPress={() => void save()} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.md },
  centerPad: { padding: spacing.lg, gap: spacing.md, alignItems: 'center' },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 13.5, lineHeight: 19 },
  error: { ...typography.label, color: colors.danger, paddingHorizontal: spacing.md },
  pressed: { opacity: 0.7 },
  bottomPad: { height: spacing.xl },
  row: { flexDirection: 'row', gap: spacing.sm },
  saveWrap: { paddingHorizontal: spacing.md },
  footNote: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, paddingHorizontal: spacing.md },

  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    marginHorizontal: spacing.md,
    padding: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: TONE.hub.pale,
    borderWidth: 1,
    borderColor: TONE.hub.line,
  },
  linkIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  linkCopy: { flex: 1, gap: 2, minWidth: 0 },
  linkTitle: { ...typography.bodyStrong, fontSize: 15.5, fontWeight: '800', color: colors.waterInk },
  linkBody: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },

  example: { padding: spacing.sm + 4, borderRadius: radius.lg, backgroundColor: colors.surface, gap: 2 },
  exampleLabel: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  exampleValue: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },
});
