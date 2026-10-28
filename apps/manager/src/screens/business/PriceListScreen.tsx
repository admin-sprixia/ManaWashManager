import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  BottomSheet,
  Button,
  IconHome,
  IconStore,
  IconUsers,
  ScreenContainer,
  ScreenHeader,
  colors,
  radius,
  shadow,
  showAlert,
  spacing,
  typography,
} from '@mana/ui';
import { MAX_SERVICE_PRICE_PAISE, communityPrice, listPrice, visitCharge } from '@mana/domain';
import { api } from '../../api/client';
import { formatRupees, parseRupees } from '../../utils/format';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { CARD_SHADOW, CatalogHero, paiseToText, plural, useCatalog } from './shared';
import { CommunityPricing, describeCommunityRule } from './prices/CommunityPricing';
import { HomeVisitPricing } from './prices/HomeVisitPricing';
import { FlowStrip, ModeCard, Pill, TONE, type FlowStep, type Tone } from './prices/parts';

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessPrices'>;

type Mode = 'hub' | 'doorstep';
/** Hub prices, community prices (stored as the "doorstep" column), and home visits. */
type Tab = 'hub' | 'community' | 'home';
const cellKey = (serviceId: string, sizeId: string, mode: Mode = 'hub') => `${serviceId}|${sizeId}|${mode}`;
const TAB_TONE: Record<Tab, Tone> = { hub: 'hub', community: 'community', home: 'home' };
const rupees = (paise: number) => formatRupees(paise);

/**
 * Base prices, one place for every way a car is washed:
 *   Hub        one price per service per vehicle size (per price book) — everything starts here.
 *   Community  a size's own community price, or the hub price with the community rule; bigger
 *              communities can earn a volume discount.
 *   Doorstep   the hub price plus one visit charge per home visit (fee, distance, busy times).
 * Grid edits collect here and go out in one save, so every branch's menu is rebuilt once.
 */
export function PriceListScreen({ navigation }: Props) {
  const { catalog, error, load, run } = useCatalog();
  const [bookId, setBookId] = useState<string | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('hub');
  /** Unsaved edits: cell → price in paise; null = not priced (hub) or back to the rule (community). */
  const [draft, setDraft] = useState<Map<string, number | null>>(new Map());
  const [editing, setEditing] = useState<{ serviceId: string; sizeId: string; mode: Mode } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!catalog) return;
    if (!bookId || !catalog.priceBooks.some((b) => b.id === bookId)) {
      setBookId(catalog.priceBooks.find((b) => b.isDefault)?.id ?? catalog.priceBooks[0]?.id ?? null);
    }
    if (!classId || !catalog.classes.some((c) => c.id === classId)) {
      setClassId(catalog.classes.find((c) => c.category === 'car')?.id ?? catalog.classes[0]?.id ?? null);
    }
  }, [catalog, bookId, classId]);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (draft.size === 0 || saving) return;
        e.preventDefault();
        showAlert('Discard unsaved prices?', `${draft.size} price${draft.size === 1 ? '' : 's'} haven’t been saved.`, [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]);
      }),
    [navigation, draft, saving],
  );

  const saved = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of catalog?.prices ?? []) {
      if (p.priceBookId !== bookId) continue;
      map.set(cellKey(p.serviceId, p.sizeId), p.price);
      if (p.doorstepPrice != null) map.set(cellKey(p.serviceId, p.sizeId, 'doorstep'), p.doorstepPrice);
    }
    return map;
  }, [catalog, bookId]);

  if (!catalog || !bookId || !classId) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title="Base prices" onBack={() => navigation.goBack()} />
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

  const cls = catalog.classes.find((c) => c.id === classId)!;
  const services = catalog.services.filter((s) => s.active && s.classIds.includes(classId));
  const book = catalog.priceBooks.find((b) => b.id === bookId)!;
  const valueOf = (serviceId: string, sizeId: string, m: Mode = 'hub'): number | null => {
    const key = cellKey(serviceId, sizeId, m);
    return draft.has(key) ? draft.get(key)! : (saved.get(key) ?? null);
  };
  const communityRule =
    catalog.adjustments.find((a) => a.mode === 'doorstep' && a.classId === classId) ??
    catalog.adjustments.find((a) => a.mode === 'doorstep' && a.classId == null);
  /** A community price nobody set: the hub price with the community rule. */
  const rulePrice = (base: number) =>
    listPrice({
      base,
      mode: 'doorstep',
      classKey: cls.key,
      adjustments: communityRule ? [{ ...communityRule, classKey: null }] : [],
      zonePercentBp: 0,
      roundToPaise: catalog.policy.roundToPaise,
    }).price;

  /** Sizes no vehicle uses and nothing is priced at (a bike size left empty) stay out of the grid. */
  const sizes = cls.sizes.filter(
    (z) => catalog.bodyTypes.some((b) => b.active && b.sizeId === z.id) || services.some((s) => valueOf(s.id, z.id) != null),
  );
  // Only the sizes each service is for (set in Services) take a price.
  const forSize = (s: (typeof services)[number], sizeId: string) => s.sizeIds.includes(sizeId);
  const gridMode: Mode = tab === 'community' ? 'doorstep' : 'hub';
  const communityOf = (serviceId: string, sizeId: string) => {
    const base = valueOf(serviceId, sizeId);
    return base == null ? null : rulePrice(base);
  };

  // An example for the cards at the top: the most popular service at the smallest priced size.
  const firstSize = sizes.find((z) => services.some((s) => forSize(s, z.id) && valueOf(s.id, z.id) != null)) ?? null;
  const example = firstSize
    ? ([...services]
        .filter((s) => forSize(s, firstSize.id) && valueOf(s.id, firstSize.id) != null)
        .sort((a, b) => Number(b.popular) - Number(a.popular))[0] ?? null)
    : null;
  const exHub = example && firstSize ? valueOf(example.id, firstSize.id) : null;
  const exCommunity = example && firstSize && example.places.community ? communityOf(example.id, firstSize.id) : null;
  const visit = catalog.away.doorstep;
  const calm = { ...visit, busy: [] };
  const now = new Date();
  const visitMin = visitCharge(0, calm, now).total;
  const visitMax = visitCharge(visit.maxKm, calm, now).total;
  const exHome = example?.places.doorstep && exHub != null ? exHub + visitMin : null;
  const joinBp = catalog.away.joinDiscountBp;
  const exampleName = example && firstSize ? `${example.name} · ${firstSize.key}` : cls.name;

  const flow: { steps: FlowStep[]; joins: string[] } | null =
    exHub == null
      ? null
      : tab === 'community' && exCommunity != null && example && firstSize
        ? {
            steps: [
              { label: 'Hub', value: rupees(exHub), tone: 'hub' },
              { label: 'Rule', value: shortRule(communityRule?.percentBp ?? 0), tone: 'community' },
              { label: 'Community', value: rupees(exCommunity), tone: 'community', strong: true },
              ...(joinBp
                ? [{ label: 'Every flat', value: rupees(communityPrice(exCommunity, exHub, joinBp)), tone: 'community' as const }]
                : []),
            ],
            joins: ['→', '=', '→'],
          }
        : tab === 'home' && exHome != null
          ? {
              steps: [
                { label: 'Hub', value: rupees(exHub), tone: 'hub' },
                { label: 'Visit', value: visitMin === visitMax ? rupees(visitMin) : `${rupees(visitMin)}–${rupees(visitMax)}`, tone: 'home' },
                {
                  label: 'Customer pays',
                  value: visitMin === visitMax ? rupees(exHub + visitMin) : `${rupees(exHub + visitMin)}–${rupees(exHub + visitMax)}`,
                  tone: 'home',
                  strong: true,
                },
              ],
              joins: ['+', '='],
            }
          : null;

  const switchBook = (next: string) => {
    if (next === bookId) return;
    if (draft.size === 0) return setBookId(next);
    showAlert('Discard unsaved prices?', 'Save or discard them before switching price book.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          setDraft(new Map());
          setBookId(next);
        },
      },
    ]);
  };

  const setCell = (serviceId: string, sizeId: string, m: Mode, price: number | null) => {
    setDraft((prev) => {
      const next = new Map(prev);
      const key = cellKey(serviceId, sizeId, m);
      if ((saved.get(key) ?? null) === price) next.delete(key);
      else next.set(key, price);
      // A size no longer offered has no community price either.
      if (m === 'hub' && price == null) {
        const away = cellKey(serviceId, sizeId, 'doorstep');
        if (saved.has(away)) next.set(away, null);
        else next.delete(away);
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const cells = new Map<string, { serviceId: string; sizeId: string; price: number | null; doorstepPrice?: number | null }>();
    for (const [key, price] of draft) {
      const [serviceId, sizeId, m] = key.split('|') as [string, string, Mode];
      const pair = `${serviceId}|${sizeId}`;
      const entry = cells.get(pair) ?? { serviceId, sizeId, price: valueOf(serviceId, sizeId) };
      if (m === 'doorstep') entry.doorstepPrice = price;
      cells.set(pair, entry);
    }
    const entries = [...cells.values()];
    const message = await run(
      () => api.business.prices.$put({ json: { priceBookId: bookId, entries } }),
      `${entries.length} price${entries.length === 1 ? '' : 's'} saved · branches selling them are updated`,
    );
    setSaving(false);
    if (message) setSaveError(message);
    else setDraft(new Map());
  };

  const editingService = editing ? catalog.services.find((s) => s.id === editing.serviceId) : null;
  const editingSize = editing ? cls.sizes.find((z) => z.id === editing.sizeId) : null;
  const editingBase = editing ? valueOf(editing.serviceId, editing.sizeId) : null;
  const tone = TONE[TAB_TONE[tab]];

  const grid =
    services.length === 0 ? (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No services for {cls.name.toLowerCase()}</Text>
        <Text style={styles.emptyBody}>Add them in Services first.</Text>
      </View>
    ) : (
      <View style={styles.gridCard}>
        <View style={styles.gridTitleRow}>
          <View style={styles.flex}>
            <Text style={styles.gridTitle}>{tab === 'hub' ? 'Hub prices' : 'Community prices'}</Text>
            <Text style={styles.gridSub}>
              {cls.name} · {book.name} · {tab === 'hub' ? 'tap a price to change it' : 'worked out by the rule above'}
            </Text>
          </View>
        </View>
        <View style={[styles.gridRow, styles.gridHead]}>
          <Text style={[styles.nameCell, styles.headText]}>Service</Text>
          {sizes.map((z) => (
            <View key={z.id} style={styles.cell}>
              <View style={[styles.sizeBadge, { backgroundColor: tone.pale }]}>
                <Text style={[styles.sizeBadgeText, { color: tone.ink }]}>{z.key}</Text>
              </View>
            </View>
          ))}
        </View>
        {services.map((s, i) => (
          <View key={s.id} style={[styles.gridRow, i < services.length - 1 && styles.divider]}>
            <View style={styles.nameCell}>
              <Text style={styles.serviceName} numberOfLines={2}>
                {s.name}
              </Text>
              {s.popular ? <Text style={styles.serviceTag}>Most popular</Text> : null}
            </View>
            {sizes.map((z) => {
              if (!forSize(s, z.id)) {
                return (
                  <View key={z.id} style={[styles.cell, styles.cellBox, styles.cellOff]} accessibilityLabel={`${s.name} isn’t for ${z.name}`}>
                    <Text style={styles.cellOffText}>—</Text>
                  </View>
                );
              }
              const base = valueOf(s.id, z.id);
              const notHere = gridMode === 'doorstep' && !s.places.community;
              if (gridMode === 'doorstep' && (notHere || base == null)) {
                return (
                  <View
                    key={z.id}
                    style={[styles.cell, styles.cellBox, styles.cellOff]}
                    accessibilityLabel={notHere ? `${s.name} isn’t done at communities` : `${s.name} has no hub price for ${z.name}`}
                  >
                    <Text style={styles.cellOffText}>{notHere ? 'No' : '—'}</Text>
                  </View>
                );
              }
              if (gridMode === 'doorstep') {
                return (
                  <View
                    key={z.id}
                    style={[styles.cell, styles.cellBox, styles.cellRuleBox]}
                    accessibilityLabel={`${s.name}, ${z.name}, community: ${formatRupees(rulePrice(base!))} by the rule`}
                  >
                    <Text style={[styles.cellText, { color: tone.ink }]} numberOfLines={1} adjustsFontSizeToFit>
                      {formatRupees(rulePrice(base!)).replace('₹', '')}
                    </Text>
                  </View>
                );
              }
              const value = base;
              const byRule = false;
              const changed = draft.has(cellKey(s.id, z.id, gridMode));
              return (
                <Pressable
                  key={z.id}
                  onPress={() => setEditing({ serviceId: s.id, sizeId: z.id, mode: gridMode })}
                  style={({ pressed }) => [
                    styles.cell,
                    styles.cellBox,
                    value != null && !byRule && { backgroundColor: tone.pale, borderColor: tone.line },
                    byRule && styles.cellRuleBox,
                    changed && styles.cellChanged,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${s.name}, ${z.name}, ${gridMode === 'hub' ? 'hub' : 'community'}: ${value == null ? 'not priced' : formatRupees(value)}${byRule ? ' by the rule' : ''}`}
                >
                  <Text
                    style={[styles.cellText, { color: tone.ink }, value == null && styles.cellEmpty, byRule && styles.cellRule]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {value == null ? 'Add' : formatRupees(value).replace('₹', '')}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
        <View style={styles.legend}>
          {tab === 'hub' ? (
            <>
              <Legend swatch={[styles.legendSwatch, { backgroundColor: tone.pale, borderColor: tone.line }]} label="Price" />
              <Legend swatch={[styles.legendSwatch, styles.cellOff]} label="— not for this size" />
            </>
          ) : (
            <>
              <Legend swatch={[styles.legendSwatch, styles.cellRuleBox]} label={`By the rule (${describeCommunityRule(communityRule).toLowerCase()})`} />
              <Legend swatch={[styles.legendSwatch, styles.cellOff]} label="No: not at communities" />
            </>
          )}
          {draft.size ? <Legend swatch={[styles.legendSwatch, styles.cellChanged]} label="Not saved yet" /> : null}
        </View>
      </View>
    );

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Base prices" onBack={() => navigation.goBack()} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <CatalogHero
          eyebrow="Mana Wash HQ"
          title="Base prices"
          meta={
            draft.size > 0
              ? `${plural(draft.size, 'unsaved change')} · save to update every branch`
              : 'What every wash costs: at the shop, at communities and at homes.'
          }
          alert={draft.size > 0}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vehicleRow}>
          {catalog.classes.map((c) => (
            <Pill key={c.id} label={c.name} on={c.id === classId} tone={TAB_TONE[tab]} onPress={() => setClassId(c.id)} />
          ))}
        </ScrollView>

        <View style={styles.modes} accessibilityRole="tablist">
          <ModeCard
            tone="hub"
            icon={<IconStore size={18} color={tab === 'hub' ? colors.white : TONE.hub.main} />}
            label="Hub"
            price={exHub != null ? rupees(exHub) : '—'}
            caption={exampleName}
            selected={tab === 'hub'}
            onPress={() => setTab('hub')}
          />
          <ModeCard
            tone="community"
            icon={<IconUsers size={18} color={tab === 'community' ? colors.white : TONE.community.main} />}
            label="Community"
            price={exCommunity != null ? rupees(exCommunity) : '—'}
            caption="per car, wash day"
            selected={tab === 'community'}
            onPress={() => setTab('community')}
          />
          <ModeCard
            tone="home"
            icon={<IconHome size={18} color={tab === 'home' ? colors.white : TONE.home.main} />}
            label="Doorstep"
            price={exHome != null ? `${rupees(exHome)}+` : '—'}
            caption={`+ visit ${rupees(visitMin)}–${rupees(visitMax)}`}
            selected={tab === 'home'}
            onPress={() => setTab('home')}
          />
        </View>

        {flow ? (
          <View style={styles.flowWrap}>
            <Text style={styles.flowTitle}>How {exampleName} adds up</Text>
            <FlowStrip steps={flow.steps} joins={flow.joins} />
          </View>
        ) : null}

        {catalog.priceBooks.length > 1 && tab !== 'home' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vehicleRow}>
            {catalog.priceBooks.map((b) => (
              <Pill
                key={b.id}
                label={b.isDefault ? `${b.name} · default` : b.name}
                on={b.id === bookId}
                tone={TAB_TONE[tab]}
                onPress={() => switchBook(b.id)}
              />
            ))}
          </ScrollView>
        ) : null}

        {tab === 'hub' ? (
          <>
            {grid}
            <Text style={styles.help}>
              Home washes are charged these prices too, plus the visit charge. Which size each vehicle is: the vehicle size guide.
            </Text>
          </>
        ) : tab === 'community' ? (
          <>
            <CommunityPricing
              catalog={catalog}
              run={run}
              classId={classId}
              example={exCommunity != null && exHub != null ? { name: exampleName, price: exCommunity, hub: exHub } : null}
            />
            {grid}
          </>
        ) : (
          <HomeVisitPricing catalog={catalog} run={run} classId={classId} hubPrice={(serviceId, sizeId) => valueOf(serviceId, sizeId)} />
        )}
        {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
        <View style={styles.bottomPad} />
      </ScrollView>

      {draft.size > 0 ? (
        <View style={styles.saveBar}>
          <Button label="Discard" variant="ghost" disabled={saving} onPress={() => setDraft(new Map())} />
          <View style={styles.flex}>
            <Button label={`Save ${draft.size} price${draft.size === 1 ? '' : 's'}`} loading={saving} onPress={() => void save()} />
          </View>
        </View>
      ) : null}

      <CellSheet
        visible={editing != null}
        title={editingService && editingSize ? `${editingService.name} · ${editingSize.name}` : ''}
        away={editing?.mode === 'doorstep' ? 'Community' : null}
        value={editing ? valueOf(editing.serviceId, editing.sizeId, editing.mode) : null}
        rule={editing?.mode === 'doorstep' && editingBase != null ? rulePrice(editingBase) : null}
        onClose={() => setEditing(null)}
        onDone={(price) => {
          if (editing) setCell(editing.serviceId, editing.sizeId, editing.mode, price);
          setEditing(null);
        }}
      />
    </ScreenContainer>
  );
}

/** "−10%", "Same", "+15%". */
const shortRule = (bp: number) => (bp > 0 ? `+${bp / 100}%` : 'Same');

function Legend({ swatch, label }: { swatch: object[]; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={swatch} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function CellSheet({
  visible,
  title,
  away,
  value,
  rule,
  onClose,
  onDone,
}: {
  visible: boolean;
  title: string;
  /** "Community" when editing the community price; null for the hub price. */
  away: string | null;
  value: number | null;
  /** What the community price is by the rule, when none is set. */
  rule: number | null;
  onClose: () => void;
  onDone: (price: number | null) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setText(paiseToText(value));
    setError(null);
  }, [visible, value]);

  const done = () => {
    const p = parseRupees(text);
    if (p == null) return onDone(null);
    if (Number.isNaN(p)) return setError('Enter the price in rupees, like 450.');
    if (p > MAX_SERVICE_PRICE_PAISE) return setError(`That looks too large (over ${formatRupees(MAX_SERVICE_PRICE_PAISE)}).`);
    onDone(p);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={away ? `${away} price for this size` : 'Hub price for this size'}
      footer={
        <View style={styles.footer}>
          <Button label="Done" size="lg" onPress={done} />
          {value != null ? (
            <Button
              label={away ? `Follow the ${away.toLowerCase()} rule${rule != null ? ` (${formatRupees(rule)})` : ''}` : 'Not offered for this size'}
              variant="ghost"
              onPress={() => onDone(null)}
            />
          ) : null}
        </View>
      }
    >
      <View style={styles.inputRow}>
        <Text style={styles.rupee}>₹</Text>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(t) => {
            setText(t);
            if (error) setError(null);
          }}
          keyboardType="numeric"
          placeholder={away ? (rule != null ? `${rule / 100} by the rule` : 'By the rule') : 'Not offered'}
          placeholderTextColor={colors.slate}
          autoFocus
          maxLength={7}
          onSubmitEditing={done}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.md },
  centerPad: { padding: spacing.lg, gap: spacing.md, alignItems: 'center' },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 13, lineHeight: 18, paddingHorizontal: spacing.md },
  pressed: { opacity: 0.7 },
  bottomPad: { height: 120 },
  error: { ...typography.label, color: colors.danger, paddingHorizontal: spacing.md },

  vehicleRow: { gap: spacing.xs + 2, paddingHorizontal: spacing.md },
  modes: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md },
  flowWrap: { gap: spacing.xs + 2 },
  flowTitle: { ...typography.label, fontSize: 13, color: colors.slateDeep, paddingHorizontal: spacing.md },

  sizeBadge: { minWidth: 30, height: 26, paddingHorizontal: 6, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sizeBadgeText: { ...typography.label, fontWeight: '800', fontSize: 12.5 },

  empty: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...CARD_SHADOW,
  },
  emptyTitle: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk, fontWeight: '800' },
  emptyBody: { ...typography.body, fontSize: 14, color: colors.slateDeep, lineHeight: 20 },

  gridCard: {
    marginHorizontal: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  gridTitleRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, paddingBottom: spacing.sm },
  gridTitle: { ...typography.heading, fontSize: 17, color: colors.waterInk, letterSpacing: -0.2 },
  gridSub: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, marginTop: 2 },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    minHeight: 60,
  },
  gridHead: { minHeight: 36, paddingVertical: 4 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  headText: { ...typography.caption, color: colors.slateDeep, fontWeight: '800', letterSpacing: 0.4 },
  nameCell: { flex: 1, minWidth: 0, gap: 2 },
  serviceName: { ...typography.bodyStrong, fontSize: 14.5, color: colors.waterInk, fontWeight: '800' },
  serviceTag: { ...typography.caption, fontSize: 11, color: colors.amberDeep, fontWeight: '800', letterSpacing: 0.2 },
  cell: { width: 66, alignItems: 'center' },
  cellBox: {
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cellChanged: { borderColor: colors.amber, backgroundColor: '#FFFBEB' },
  cellRuleBox: { borderStyle: 'dashed', borderColor: '#C9D0FA', backgroundColor: colors.white },
  cellOff: { borderStyle: 'dashed', backgroundColor: colors.white },
  cellOffText: { ...typography.caption, fontSize: 12.5, fontWeight: '700', color: colors.slate, letterSpacing: 0 },
  cellText: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800' },
  cellEmpty: { color: colors.slate, fontWeight: '700', fontSize: 13 },
  cellRule: { color: colors.slateDeep, fontWeight: '600' },

  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm + 4,
    padding: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 18, height: 14, borderRadius: 4, borderWidth: 1, borderColor: colors.border },
  legendText: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },

  saveBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    ...shadow('lg'),
  },
  footer: { gap: spacing.xs },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  rupee: { ...typography.heading, color: colors.slateDeep, marginRight: spacing.xs },
  input: { flex: 1, fontSize: 20, fontWeight: '700', color: colors.waterInk, paddingVertical: spacing.sm + 4 },
});
