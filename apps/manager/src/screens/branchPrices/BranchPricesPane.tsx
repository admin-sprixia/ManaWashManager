import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconHome, IconStore, IconUsers, colors, radius, showAlert, showToast, spacing, typography } from '@mana/ui';
import { listPrice, visitCharge, type ModeAdjustment } from '@mana/domain';
import { api, apiErrorMessage } from '../../api/client';
import { NetworkError } from '../../api/network';
import { formatRupees } from '../../utils/format';
import { CARD_SHADOW } from '../business/shared';
import { FlowStrip, ModeCard, Panel, Pill, TONE, partStyles, type FlowStep, type Tone } from '../business/prices/parts';
import { SizePriceSheet } from './SizePriceSheet';
import type { BranchSheet, SheetCell, SheetService } from './types';

type Tab = 'hub' | 'community' | 'home';
const TAB_TONE: Record<Tab, Tone> = { hub: 'hub', community: 'community', home: 'home' };
const SHIFTS = [-10, -5, 0, 5, 10];
const rupees = (p: number) => formatRupees(p);
const bare = (p: number) => formatRupees(p).replace('₹', '');

/**
 * The owner's own prices, laid out like HQ's Base prices: one tab for each way to buy, a grid of
 * services by size for the picked vehicle group, from the branch's price book. Owners change shop
 * prices (by size, inside what HQ allows); community prices follow them by the rule, and home
 * washes add HQ's visit charge.
 */
export function BranchPricesPane({
  sheet,
  groupKey,
  onChanged,
  onStopOffering,
}: {
  sheet: BranchSheet;
  groupKey: string;
  onChanged: () => Promise<void>;
  /** Take an HQ service off this branch's menu; absent when HQ doesn't allow it. */
  onStopOffering?: (service: SheetService) => void;
}) {
  const [tab, setTab] = useState<Tab>('hub');
  const [editing, setEditing] = useState<{ service: SheetService; cell: SheetCell } | null>(null);
  const [shifting, setShifting] = useState<number | null>(null);
  const [booking, setBooking] = useState<string | null>(null);
  const group = sheet.groups.find((g) => g.key === groupKey) ?? null;
  const { policy } = sheet;
  const tone = TONE[TAB_TONE[tab]];

  const rule = useMemo(() => {
    const own = sheet.communityRules.find((r) => r.classKey === groupKey) ?? sheet.communityRules.find((r) => r.classKey == null);
    return own ?? null;
  }, [sheet.communityRules, groupKey]);
  const communityOf = (shop: number) =>
    listPrice({
      base: shop,
      mode: 'doorstep',
      classKey: groupKey,
      adjustments: rule ? [{ ...rule, mode: 'doorstep', classKey: null } satisfies ModeAdjustment] : [],
      zonePercentBp: 0,
      roundToPaise: policy.roundToPaise,
    }).price;

  const now = new Date();
  const calm = { ...sheet.doorstep, busy: [] };
  const visitMin = visitCharge(0, calm, now).total;
  const visitMax = visitCharge(sheet.doorstep.maxKm, calm, now).total;

  if (!group) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No HQ prices for these vehicles yet</Text>
        <Text style={styles.emptyBody}>Once HQ prices a service for them, it shows here.</Text>
      </View>
    );
  }

  const cellOf = (s: SheetService, sizeKey: string) => s.cells.find((c) => c.classKey === groupKey && c.sizeKey === sizeKey) ?? null;
  const services = sheet.services.filter((s) => s.cells.some((c) => c.classKey === groupKey));
  const ownCount = services.reduce((n, s) => n + s.cells.filter((c) => c.classKey === groupKey && c.hub?.own).length, 0);

  // The example on the cards: the most popular service at the smallest size it's sold for.
  const example =
    [...services]
      .sort((a, b) => Number(b.popular) - Number(a.popular))
      .flatMap((s) => group.sizes.map((z) => ({ s, z, c: cellOf(s, z.key) })))
      .find((x) => x.c?.hub) ?? null;
  const exHub = example?.c?.hub?.price ?? null;
  const exCommunity = example?.c?.community?.price ?? null;
  const exampleName = example ? `${example.s.name} · ${example.z.key}` : group.name;
  const ruleLabel = rule?.percentBp ? `${rule.percentBp < 0 ? '−' : '+'}${Math.abs(rule.percentBp) / 100}%` : 'Same';

  const flow: { steps: FlowStep[]; joins: string[] } | null =
    exHub == null
      ? null
      : tab === 'community' && exCommunity != null
        ? {
            steps: [
              { label: 'Your shop', value: rupees(exHub), tone: 'hub' },
              { label: 'Rule', value: ruleLabel, tone: 'community' },
              { label: 'Community', value: rupees(exCommunity), tone: 'community', strong: true },
            ],
            joins: ['→', '='],
          }
        : tab === 'home'
          ? {
              steps: [
                { label: 'Your shop', value: rupees(exHub), tone: 'hub' },
                { label: 'Visit', value: visitMin === visitMax ? rupees(visitMin) : `${rupees(visitMin)}–${rupees(visitMax)}`, tone: 'home' },
                { label: 'Customer pays', value: `${rupees(exHub + visitMin)}+`, tone: 'home', strong: true },
              ],
              joins: ['+', '='],
            }
          : null;

  const shift = (pct: number) => {
    const label = pct === 0 ? 'HQ’s prices' : `${pct > 0 ? pct : -pct}% ${pct > 0 ? 'more' : 'less'} than HQ`;
    showAlert(
      `${group.name}: ${label}?`,
      pct === 0
        ? `Every ${group.name.toLowerCase()} shop price here goes back to HQ’s price. Community prices follow.`
        : `Every ${group.name.toLowerCase()} shop price here becomes ${label}, rounded to ₹1 and kept inside what HQ allows. Community prices follow.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Change prices',
          onPress: () => {
            void (async () => {
              setShifting(pct);
              try {
                const res = await api.services['branch-prices'].shift.$put({ json: { classKey: groupKey, percent: pct === 0 ? null : pct } });
                if (!res.ok) {
                  showToast(await apiErrorMessage(res, 'Couldn’t change the prices.'), 'error');
                  return;
                }
                await onChanged();
                showToast(pct === 0 ? 'Back to HQ’s prices' : `Prices set to ${label}`);
              } catch (e) {
                showToast(e instanceof NetworkError ? 'Changing prices needs a connection.' : 'Couldn’t change the prices.', 'error');
              } finally {
                setShifting(null);
              }
            })();
          },
        },
      ],
    );
  };

  // Every shop price the owner set, across all groups: cleared when the branch changes book.
  const ownEverywhere = sheet.services.reduce((n, s) => n + s.cells.filter((c) => c.hub?.own).length, 0);
  const pickBook = (book: BranchSheet['books'][number]) => {
    if (book.id === sheet.bookId || booking) return;
    if (!policy.branchPicksBook) {
      showToast('Mana Wash HQ picks the price book for this branch.');
      return;
    }
    showAlert(
      `Move to ${book.name} prices?`,
      ownEverywhere > 0
        ? `Every price becomes ${book.name}’s. Your own prices (${ownEverywhere} ${ownEverywhere === 1 ? 'size' : 'sizes'}) are cleared, and community prices follow.`
        : `Every price becomes ${book.name}’s, and community prices follow.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Use ${book.name}`,
          onPress: () => {
            void (async () => {
              setBooking(book.id);
              try {
                const res = await api.services['branch-prices'].book.$put({ json: { priceBookId: book.id } });
                if (!res.ok) {
                  showToast(await apiErrorMessage(res, 'Couldn’t change the price book.'), 'error');
                  return;
                }
                await onChanged();
                showToast(`${book.name} prices now`);
              } catch (e) {
                showToast(e instanceof NetworkError ? 'Changing the price book needs a connection.' : 'Couldn’t change the price book.', 'error');
              } finally {
                setBooking(null);
              }
            })();
          },
        },
      ],
    );
  };

  const saveSize = async (change: { price?: number | null; commission?: number | null }): Promise<string | null> => {
    if (!editing) return null;
    try {
      const res = await api.services['branch-prices'].size.$put({
        json: { serviceId: editing.service.id, classKey: groupKey, sizeKey: editing.cell.sizeKey, ...change },
      });
      if (!res.ok) return apiErrorMessage(res, 'Couldn’t save the price.');
      await onChanged();
      setEditing(null);
      showToast(change.price === null ? 'Back to HQ’s price' : 'Price saved');
      return null;
    } catch (e) {
      return e instanceof NetworkError ? 'Saving needs a connection.' : 'Couldn’t save the price.';
    }
  };

  const sizes = group.sizes;
  const editingSize = editing ? sizes.find((z) => z.key === editing.cell.sizeKey) : null;

  return (
    <>
      <View style={styles.modes} accessibilityRole="tablist">
        <ModeCard
          tone="hub"
          icon={<IconStore size={18} color={tab === 'hub' ? colors.white : TONE.hub.main} />}
          label="At the shop"
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
          caption={`shop ${ruleLabel === 'Same' ? 'price' : ruleLabel}`}
          selected={tab === 'community'}
          onPress={() => setTab('community')}
        />
        <ModeCard
          tone="home"
          icon={<IconHome size={18} color={tab === 'home' ? colors.white : TONE.home.main} />}
          label="Doorstep"
          price={exHub != null ? `${rupees(exHub + visitMin)}+` : '—'}
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

      {tab === 'hub' && sheet.books.length > 1 ? (
        <Panel
          title="Price book"
          subtitle={
            policy.branchPicksBook
              ? `HQ’s books. This branch uses ${sheet.bookName}; pick another to start from its prices.`
              : `This branch uses ${sheet.bookName}. Mana Wash HQ picks the book.`
          }
        >
          <View style={partStyles.pillRow}>
            {sheet.books.map((b) => (
              <Pill
                key={b.id}
                label={booking === b.id ? 'Moving…' : `${b.name}${b.isDefault ? ' · HQ default' : ''}`}
                on={b.id === sheet.bookId}
                onPress={() => pickBook(b)}
              />
            ))}
          </View>
        </Panel>
      ) : null}

      {tab === 'hub' ? (
        policy.branchOverrides ? (
          <Panel
            title={`Move every ${group.name.toLowerCase()} price`}
            subtitle={`From HQ’s ${sheet.bookName} prices. You can go ${policy.maxDecreasePct}% less to ${policy.maxIncreasePct}% more.`}
          >
            <View style={partStyles.pillRow}>
              {SHIFTS.filter((p) => (p < 0 ? -p <= policy.maxDecreasePct : p <= policy.maxIncreasePct)).map((p) => (
                <Pill
                  key={p}
                  label={shifting === p ? 'Saving…' : p === 0 ? 'HQ’s prices' : `${p > 0 ? '+' : '−'}${Math.abs(p)}%`}
                  on={false}
                  onPress={() => (shifting == null ? shift(p) : undefined)}
                />
              ))}
            </View>
            <Text style={partStyles.note}>
              {ownCount > 0 ? `${ownCount} ${ownCount === 1 ? 'price is' : 'prices are'} your own now. ` : 'All prices are HQ’s now. '}
              Or tap one price below to change just that size.
            </Text>
          </Panel>
        ) : (
          <Panel title="HQ’s prices" subtitle="HQ has fixed prices for every branch, so they can’t be changed here." />
        )
      ) : tab === 'community' ? (
        <Panel
          title={ruleLabel === 'Same' ? 'Same as your shop price' : `Your shop price ${ruleLabel}`}
          subtitle="Community prices follow your shop prices by HQ’s community rule. Change a shop price and its community price moves with it. Bigger communities may get HQ’s volume discount on top."
        />
      ) : (
        <Panel
          title="Your shop price + the visit charge"
          subtitle={`HQ sets the visit charge: ${rupees(visitMin)} for the first ${sheet.doorstep.freeKm} km, then ${rupees(sheet.doorstep.perKmPaise)} a km, up to ${sheet.doorstep.maxKm} km (${rupees(visitMax)}). Two cars at one home pay it once.`}
        />
      )}

      {/* A fresh grid per group: groups have different sizes, and Android keeps stale cells otherwise. */}
      <View key={`${groupKey}-${tab}`} style={styles.gridCard}>
        <View style={styles.gridTitleRow}>
          <Text style={styles.gridTitle}>{tab === 'hub' ? 'Shop prices' : tab === 'community' ? 'Community prices' : 'Home wash prices'}</Text>
          <Text style={styles.gridSub}>
            {group.name} · {sheet.bookName} ·{' '}
            {tab === 'hub' ? (policy.branchOverrides ? 'tap a price to change it' : 'set by HQ') : tab === 'community' ? 'by the rule' : 'plus the visit charge'}
          </Text>
        </View>
        <View style={[styles.gridRow, styles.gridHead]}>
          <Text style={[styles.nameCell, styles.headText]}>Service</Text>
          {sizes.map((z) => (
            <View key={z.key} style={styles.cell}>
              <View style={[styles.sizeBadge, { backgroundColor: tone.pale }]}>
                <Text style={[styles.sizeBadgeText, { color: tone.ink }]}>{z.key}</Text>
              </View>
            </View>
          ))}
        </View>
        {services.map((s, i) => (
          <View key={s.id} style={[styles.gridRow, i < services.length - 1 && styles.divider]}>
            <Pressable
              style={styles.nameCell}
              onPress={onStopOffering ? () => onStopOffering(s) : undefined}
              disabled={!onStopOffering}
              accessibilityRole={onStopOffering ? 'button' : undefined}
            >
              <Text style={styles.serviceName} numberOfLines={2}>
                {s.name}
              </Text>
              {s.popular ? <Text style={styles.serviceTag}>Most popular</Text> : null}
            </Pressable>
            {sizes.map((z) => {
              const c = cellOf(s, z.key);
              const value = tab === 'community' ? (c?.community ?? null) : (c?.hub ?? null);
              if (!c || !value) {
                return (
                  <View key={z.key} style={[styles.cell, styles.cellBox, styles.cellOff]}>
                    <Text style={styles.cellOffText}>{tab === 'community' && c?.hub ? 'No' : '—'}</Text>
                  </View>
                );
              }
              const own = c.hub?.own ?? false;
              const shown = tab === 'home' ? `${bare(value.price + visitMin)}+` : value.mixed ? 'Mixed' : bare(value.price);
              const content = (
                <>
                  <Text style={[styles.cellText, { color: own ? colors.amberDeep : tone.ink }]} numberOfLines={1} adjustsFontSizeToFit>
                    {shown}
                  </Text>
                  {own && tab === 'hub' ? (
                    <Text style={styles.cellList} numberOfLines={1}>
                      HQ {bare(value.list)}
                    </Text>
                  ) : null}
                </>
              );
              if (tab !== 'hub') {
                return (
                  <View key={z.key} style={[styles.cell, styles.cellBox, styles.cellRuleBox, own && styles.cellOwnSoft]}>
                    {content}
                  </View>
                );
              }
              return (
                <Pressable
                  key={z.key}
                  onPress={() => setEditing({ service: s, cell: c })}
                  style={({ pressed }) => [
                    styles.cell,
                    styles.cellBox,
                    { backgroundColor: tone.pale, borderColor: tone.line },
                    own && styles.cellOwn,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${s.name}, ${z.name}: ${rupees(value.price)}${own ? `, your price, HQ ${rupees(value.list)}` : ''}`}
                >
                  {content}
                </Pressable>
              );
            })}
          </View>
        ))}
        <View style={styles.legend}>
          <Legend swatch={[styles.legendSwatch, { backgroundColor: TONE.hub.pale, borderColor: TONE.hub.line }]} label="HQ’s price" />
          <Legend swatch={[styles.legendSwatch, styles.cellOwn]} label="Your own price" />
          <Legend swatch={[styles.legendSwatch, styles.cellOff]} label="— not sold for this size" />
        </View>
      </View>
      <Text style={styles.help}>
        Which size each vehicle is: the vehicle size guide. {onStopOffering ? 'Tap a service’s name to stop offering it here.' : ''}
      </Text>

      <SizePriceSheet
        visible={editing != null}
        title={editing && editingSize ? `${editing.service.name} · ${group.name} ${editingSize.key}` : ''}
        vehicles={editingSize?.vehicles.map((v) => v.name) ?? []}
        cell={editing?.cell ?? null}
        policy={policy}
        communityOf={(p) => (editing?.cell.community ? communityOf(p) : null)}
        visitFrom={visitMin}
        onClose={() => setEditing(null)}
        onSave={saveSize}
      />
    </>
  );
}

function Legend({ swatch, label }: { swatch: object[]; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={swatch} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  modes: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md },
  flowWrap: { gap: spacing.xs + 2 },
  flowTitle: { ...typography.label, fontSize: 13, color: colors.slateDeep, paddingHorizontal: spacing.md },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 13, lineHeight: 18, paddingHorizontal: spacing.md },

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
  gridTitleRow: { padding: spacing.md, paddingBottom: spacing.sm },
  gridTitle: { ...typography.heading, fontSize: 17, color: colors.waterInk, letterSpacing: -0.2 },
  gridSub: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, marginTop: 2 },
  gridRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, minHeight: 60 },
  gridHead: { minHeight: 36, paddingVertical: 4 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  headText: { ...typography.caption, color: colors.slateDeep, fontWeight: '800', letterSpacing: 0.4 },
  nameCell: { flex: 1, minWidth: 0, gap: 2 },
  serviceName: { ...typography.bodyStrong, fontSize: 14.5, color: colors.waterInk, fontWeight: '800' },
  serviceTag: { ...typography.caption, fontSize: 11, color: colors.amberDeep, fontWeight: '800', letterSpacing: 0.2 },
  sizeBadge: { minWidth: 30, height: 26, paddingHorizontal: 6, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sizeBadgeText: { ...typography.label, fontWeight: '800', fontSize: 12.5 },
  cell: { width: 70, alignItems: 'center' },
  cellBox: {
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cellOwn: { backgroundColor: '#FFF7E6', borderColor: colors.amber },
  cellOwnSoft: { borderColor: colors.amberLight },
  cellRuleBox: { borderStyle: 'dashed', borderColor: '#C9D0FA', backgroundColor: colors.white },
  cellOff: { borderStyle: 'dashed', backgroundColor: colors.white },
  cellOffText: { ...typography.caption, fontSize: 12.5, fontWeight: '700', color: colors.slate, letterSpacing: 0 },
  cellText: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800' },
  cellList: { ...typography.caption, fontSize: 10, color: colors.slate, letterSpacing: 0 },
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
});
