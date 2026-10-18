import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  type ExpensePhotoKind,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_CATEGORY_SETUP,
  EXPENSE_UNIT_LABEL,
  EXPENSE_UNITS,
  formatExpenseQuantity,
  normalizeExpenseQuantity,
  type ExpenseCategory,
  type ExpenseUnit,
} from '@mana/domain';
import {
  BRAND_MARK,
  brandGradients,
  ScreenContainer,
  ScreenHeader,
  BottomSheet,
  showToast,
  IconAlert,
  IconCamera,
  IconCheck,
  IconClose,
  IconCloudOff,
  IconEdit,
  IconTrash,
  IconPlus,
  IconReceipt,
  IconSync,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { PeriodSelect, PERIOD_OPTIONS, type PeriodKey } from '../components/PeriodSelect';
import { rangeLabel, type DateRange } from '../components/RangeCalendar';
import { ReasonSheet } from '../components/ReasonSheet';
import { ExpenseCategoryIcon } from '../components/ExpenseCategoryIcon';
import { api, apiErrorMessage, expensePhotoSource } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { useSync } from '../offline/SyncProvider';
import type { ExpensePaymentMethod } from '../offline/types';
import { formatRupees } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Expenses'>;

export interface ExpenseItem {
  id: string;
  category: string;
  amount: number;
  description: string | null;
  itemName?: string | null;
  quantity?: number | null;
  unit?: string | null;
  date: string;
  createdAt: string;
  createdByUserId: string;
  createdBy: { id: string; name: string };
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: { id: string; name: string } | null;
  paymentMethod?: string;
  /** Cash only: 'drawer' (the shop's box) or 'held' (doorstep cash the person who entered it held). */
  cashSource?: string;
  hasBillPhoto?: boolean;
  hasItemPhoto?: boolean;
  edited?: boolean;
}

export const PAID_WITH: { key: ExpensePaymentMethod; label: string; hint: string }[] = [
  { key: 'cash', label: 'Cash', hint: 'From the drawer' },
  { key: 'upi', label: 'UPI', hint: 'GPay, PhonePe…' },
  { key: 'other', label: 'Other', hint: 'Card, bank…' },
];

export const CATEGORY_TONE: Record<ExpenseCategory, { fg: string; bg: string }> = {
  chemicals: { fg: '#0369A1', bg: '#E0F2FE' },
  labour: { fg: '#5B21B6', bg: '#EDE9FE' },
  electricity: { fg: '#B45309', bg: '#FEF3C7' },
  water: { fg: '#0E7490', bg: '#CFFAFE' },
  maintenance: { fg: '#9D174D', bg: '#FCE7F3' },
  other: { fg: '#475569', bg: '#F1F5F9' },
};

/** Bright versions of each category's colour, for the bar on the night-indigo summary card. */
const CATEGORY_BAR: Record<ExpenseCategory, string> = {
  chemicals: '#38BDF8',
  labour: '#A78BFA',
  electricity: '#FBBF24',
  water: '#22D3EE',
  maintenance: '#F472B6',
  other: '#CBD5E1',
};

/** The list under the summary card: one at a time, so the screen stays short. */
const VIEW_TABS: { key: 'entries' | 'where' | 'items'; label: string }[] = [
  { key: 'entries', label: 'Entries' },
  { key: 'where', label: 'Where it went' },
  { key: 'items', label: 'Items bought' },
];

/** [x, y, radius, opacity] in the summary card's 340 × 200 box. */
const HERO_STARS = [
  [24, 28, 1.3, 0.5],
  [90, 14, 1, 0.4],
  [156, 44, 1.2, 0.35],
  [64, 150, 1.1, 0.3],
  [200, 22, 1.4, 0.55],
] as const;

export const QUICK_ADD = [100, 500, 1000];

const VOID_EXPENSE_REASONS = [
  'Entered twice',
  'Wrong amount',
  'Not a shop expense',
  'Refunded / returned',
];

function asCategory(value: string): ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value)
    ? (value as ExpenseCategory)
    : 'other';
}

export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function periodStart(period: PeriodKey): string {
  const today = isoDaysAgo(0);
  if (period === 'week') return isoDaysAgo(6);
  if (period === 'month') return `${today.slice(0, 8)}01`;
  if (period === 'year') return `${today.slice(0, 5)}01-01`;
  return today;
}

/** The smallest view that shows `date`, so an entry saved for an earlier day never seems to vanish. */
export function viewFor(date: string): { period: PeriodKey; custom: DateRange | null } {
  const today = isoDaysAgo(0);
  for (const period of ['today', 'week', 'month', 'year'] as const) {
    if (date >= periodStart(period)) return { period, custom: null };
  }
  return { period: 'today', custom: { from: date, to: today } };
}

export function formatDay(iso: string): string {
  if (iso === isoDaysAgo(0)) return 'Today';
  if (iso === isoDaysAgo(1)) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function dayParts(iso: string): { weekday: string; day: number } {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y!, (m ?? 1) - 1, d);
  return { weekday: date.toLocaleDateString('en-IN', { weekday: 'short' }), day: d ?? 1 };
}

export function paidLabel(method: string | undefined, cashSource?: string | null): string {
  if (method === 'upi') return 'UPI';
  if (method === 'other') return 'Other';
  return cashSource === 'held' ? 'Doorstep cash' : 'Cash';
}

export function cashSourceLabel(source: string | undefined | null): string {
  return source === 'held' ? 'Doorstep cash they held' : 'Shop cash box';
}

function asUnit(value: string | null | undefined): ExpenseUnit | null {
  return value && (EXPENSE_UNITS as readonly string[]).includes(value)
    ? (value as ExpenseUnit)
    : null;
}

/** "₹130 per L" — price per base unit (ml and g are shown per L and kg). */
export function ratePerUnit(paise: number, quantity: number, unit: ExpenseUnit): string | null {
  const n = normalizeExpenseQuantity(quantity, unit);
  if (!(n.quantity > 0) || !(paise > 0)) return null;
  const perUnit = Math.round(paise / n.quantity / 100) * 100;
  return `${formatRupees(perUnit)} per ${EXPENSE_UNIT_LABEL[n.unit] === 'pcs' ? 'piece' : EXPENSE_UNIT_LABEL[n.unit].replace(/s$/, '')}`;
}

export function parseQuantity(text: string): number | null {
  const n = Number(text.replace(/,/g, ''));
  return text.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

export function ExpensesScreen({ navigation, route }: Props) {
  const { isOwner, canManageTeam } = useAuth();
  const { myItems, version } = useSync();
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [byCategory, setByCategory] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<ExpenseItem | null>(null);
  const [viewing, setViewing] = useState<ExpenseItem | null>(null);
  const [tab, setTab] = useState<'entries' | 'where' | 'items'>('entries');
  const [pendingOpen, setPendingOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.expenses.$get({
        query: customRange
          ? { range: 'custom', from: customRange.from, to: customRange.to }
          : { range: period },
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t load expenses.'));
      const body = await res.json();
      if ('items' in body) {
        setItems(body.items as unknown as ExpenseItem[]);
        setTotal(body.total);
        setByCategory(body.byCategory);
      }
      setError(null);
    } catch (e) {
      setError(
        e instanceof NetworkError
          ? 'Offline — new entries still save on this phone.'
          : (e as Error).message,
      );
    } finally {
      setLoading(false);
    }
  }, [period, customRange]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load, version]);

  // Back from New expense: show the period the new entry falls in, and read it fresh.
  const added = route.params?.added;
  useEffect(() => {
    if (!added) return;
    const inView = customRange ? added >= customRange.from && added <= customRange.to : added >= periodStart(period);
    if (!inView) {
      const next = viewFor(added);
      setPeriod(next.period);
      setCustomRange(next.custom);
    } else {
      void load();
    }
    navigation.setParams({ added: undefined });
    // Only when a new entry comes back; the period itself is handled by `load`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [added]);

  const pending = useMemo(
    () =>
      myItems.flatMap((i) =>
        i.op.kind === 'expense.create' &&
        !items.some((e) => e.id === (i.op.payload as { id: string }).id)
          ? [{ item: i, payload: i.op.payload }]
          : [],
      ),
    [myItems, items],
  );

  const categories = EXPENSE_CATEGORIES.filter((c) => (byCategory[c] ?? 0) > 0).sort(
    (a, b) => (byCategory[b] ?? 0) - (byCategory[a] ?? 0),
  );

  const live = useMemo(() => items.filter((e) => !e.voidedAt), [items]);
  const byMethod = useMemo(() => {
    const out = { cash: 0, upi: 0, other: 0 };
    for (const e of live)
      out[(e.paymentMethod as ExpensePaymentMethod | undefined) ?? 'cash'] += e.amount;
    return out;
  }, [live]);

  // Same product bought several times adds up (500 ml + 2 L = 2.5 L) so the owner sees usage and price.
  const bought = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        category: ExpenseCategory;
        quantity: number;
        unit: ExpenseUnit | null;
        amount: number;
        times: number;
      }
    >();
    for (const e of live) {
      const name = e.itemName?.trim();
      if (!name) continue;
      const unit = asUnit(e.unit);
      const n = unit && e.quantity ? normalizeExpenseQuantity(e.quantity, unit) : null;
      const key = `${name.toLowerCase()}|${n?.unit ?? ''}`;
      const row = map.get(key) ?? {
        name,
        category: asCategory(e.category),
        quantity: 0,
        unit: n?.unit ?? null,
        amount: 0,
        times: 0,
      };
      row.quantity += n?.quantity ?? 0;
      row.amount += e.amount;
      row.times += 1;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [live]);

  const groups = useMemo(() => {
    const out: { date: string; items: ExpenseItem[]; total: number }[] = [];
    for (const e of items) {
      const last = out[out.length - 1];
      const g =
        last && last.date === e.date
          ? last
          : (out[out.length] = { date: e.date, items: [], total: 0 });
      g.items.push(e);
      if (!e.voidedAt) g.total += e.amount;
    }
    return out;
  }, [items]);

  // Only the owner or a manager fixes or deletes an entry; staff ask them.
  const canManage = (e: ExpenseItem) => canManageTeam && !e.voidedAt;

  const periodLabel = customRange
    ? rangeLabel(customRange)
    : (PERIOD_OPTIONS.find((p) => p.key === period)?.label ?? '');

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader
          title="Expenses"
          onBack={() => navigation.goBack()}
          right={
            <Pressable
              onPress={() => navigation.navigate('AddExpense')}
              style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Add expense"
            >
              <IconPlus size={16} color={colors.white} />
              <Text style={styles.addBtnText}>Add</Text>
            </Pressable>
          }
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.indigo}
            colors={[colors.indigo]}
          />
        }
      >
        <PeriodSelect
          value={period}
          onChange={(next) => {
            setCustomRange(null);
            setPeriod(next);
          }}
          menuTitle="Show expenses for"
          custom={{ range: customRange, onApply: setCustomRange }}
        />

        {/* Spending at a glance: total, where it went, and how it was paid */}
        <LinearGradient
          colors={brandGradients.hero.colors as unknown as string[]}
          locations={brandGradients.hero.locations as unknown as number[]}
          start={brandGradients.hero.start}
          end={brandGradients.hero.end}
          style={styles.hero}
        >
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 340 200" preserveAspectRatio="xMidYMid slice">
            {HERO_STARS.map(([x, y, r, o]) => (
              <Circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#FFFFFF" fillOpacity={o} />
            ))}
          </Svg>
          <Svg style={styles.heroMark} width={140} height={140} viewBox="0 0 256 256">
            <G>
              <Path d={BRAND_MARK.drop} fill="#FFFFFF" fillOpacity={0.07} />
              <Path d={BRAND_MARK.arms} fill="#FFFFFF" fillOpacity={0.1} />
              <Path d={BRAND_MARK.centre} fill="#FFFFFF" fillOpacity={0.15} />
            </G>
          </Svg>
          <Text style={styles.heroEyebrow}>
            {isOwner ? 'Shop spending' : 'You logged'} · {periodLabel}
          </Text>
          <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
            {formatRupees(total)}
          </Text>
          <Text style={styles.heroMeta}>
            {live.length} entr{live.length === 1 ? 'y' : 'ies'}
            {categories[0] ? ` · most on ${EXPENSE_CATEGORY_LABEL[categories[0]]}` : ''}
          </Text>
          {categories.length > 0 ? (
            <View style={styles.heroBar}>
              {categories.map((c) => (
                <View key={c} style={{ flex: byCategory[c] ?? 0, backgroundColor: CATEGORY_BAR[c] }} />
              ))}
            </View>
          ) : null}
          <View style={styles.heroChips}>
            {PAID_WITH.map((m) => (
              <View key={m.key} style={styles.heroChip}>
                <Text style={styles.heroChipLabel}>{m.key === 'cash' ? 'Drawer cash' : m.label}</Text>
                <Text style={styles.heroChipValue} numberOfLines={1} adjustsFontSizeToFit>
                  {formatRupees(byMethod[m.key])}
                </Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        {error ? (
          <View style={styles.notice}>
            <IconCloudOff size={15} color={colors.amberDeep} />
            <Text style={styles.noticeText}>{error}</Text>
          </View>
        ) : null}

        {pending.length > 0 ? (
          <View>
            <Pressable
              onPress={() => setPendingOpen((v) => !v)}
              style={({ pressed }) => [styles.syncBar, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <IconSync size={15} color={colors.amberDeep} />
              <Text style={styles.syncBarText}>
                {pending.length} saved on this phone · waiting to sync
              </Text>
              <Text style={styles.syncBarAction}>{pendingOpen ? 'Hide' : 'Show'}</Text>
            </Pressable>
            {pendingOpen ? (
            <View style={styles.band}>
              {pending.map(({ item, payload }, i) => {
                const cat = asCategory(payload.category);
                const failed = item.state === 'failed';
                return (
                  <View
                    key={item.id}
                    style={[styles.row, i < pending.length - 1 && styles.divider]}
                  >
                    <View style={[styles.catIcon, { backgroundColor: CATEGORY_TONE[cat].bg }]}>
                      <ExpenseCategoryIcon category={cat} size={20} color={CATEGORY_TONE[cat].fg} />
                    </View>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {payload.itemName || payload.description || EXPENSE_CATEGORY_LABEL[cat]}
                        {payload.quantity && payload.unit
                          ? ` · ${formatExpenseQuantity(payload.quantity, payload.unit)}`
                          : ''}
                      </Text>
                      <View style={styles.metaLine}>
                        {failed ? (
                          <IconAlert size={12} color={colors.danger} />
                        ) : (
                          <IconCloudOff size={12} color={colors.amberDeep} />
                        )}
                        <Text
                          style={[styles.rowMeta, failed ? styles.failedText : styles.pendingText]}
                          numberOfLines={1}
                        >
                          {failed ? (item.error ?? 'Couldn’t sync') : 'Saved on this phone'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.rowAmount}>{formatRupees(payload.amount)}</Text>
                  </View>
                );
              })}
            </View>
            ) : null}
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.indigo} />
        ) : items.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <IconReceipt size={28} color={colors.indigo} />
            </View>
            <Text style={styles.emptyTitle}>No expenses {period === 'today' ? 'today' : 'in this period'}</Text>
            <Text style={styles.emptyBody}>Bought chemicals or paid a bill? Log it so the profit numbers stay right.</Text>
            <Pressable
              onPress={() => navigation.navigate('AddExpense')}
              style={({ pressed }) => [styles.emptyBtn, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <IconPlus size={15} color={colors.white} />
              <Text style={styles.emptyBtnText}>Add an expense</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* One list at a time, so the screen stays short */}
            <View style={styles.tabs}>
              {VIEW_TABS.filter((t) => t.key === 'entries' || (t.key === 'where' ? categories.length > 0 : bought.length > 0)).map((t) => {
                const on = tab === t.key;
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => setTab(t.key)}
                    style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && !on && styles.pressed]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {tab === 'where' && categories.length > 0 ? (
            <View style={[styles.band, styles.breakdown]}>
              <View style={styles.stack}>
                {categories.map((c) => (
                  <View
                    key={c}
                    style={{ flex: byCategory[c] ?? 0, backgroundColor: CATEGORY_TONE[c].fg }}
                  />
                ))}
              </View>
              {categories.map((c) => {
                const amount = byCategory[c] ?? 0;
                const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
                return (
                  <View key={c} style={styles.catRow}>
                    <View style={[styles.catIconSm, { backgroundColor: CATEGORY_TONE[c].bg }]}>
                      <ExpenseCategoryIcon category={c} size={16} color={CATEGORY_TONE[c].fg} />
                    </View>
                    <View style={styles.catCopy}>
                      <View style={styles.catTop}>
                        <Text style={styles.catName}>{EXPENSE_CATEGORY_LABEL[c]}</Text>
                        <Text style={styles.catAmount}>{formatRupees(amount)}</Text>
                      </View>
                      <View style={styles.catTrackRow}>
                        <View style={styles.catTrack}>
                          <View
                            style={[
                              styles.catFill,
                              { width: `${pct}%`, backgroundColor: CATEGORY_TONE[c].fg },
                            ]}
                          />
                        </View>
                        <Text style={styles.catPct}>{pct}%</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
            ) : tab === 'items' && bought.length > 0 ? (
              <>
                <Text style={styles.tabHint}>Same item bought more than once adds up · price per unit</Text>
            <View style={styles.band}>
              {bought.map((b, i, list) => {
                const tone = CATEGORY_TONE[b.category];
                const rate =
                  b.unit && b.quantity > 0 ? ratePerUnit(b.amount, b.quantity, b.unit) : null;
                return (
                  <View
                    key={`${b.name}|${b.unit ?? ''}`}
                    style={[styles.row, i < list.length - 1 && styles.divider]}
                  >
                    <View style={[styles.catIconSm, { backgroundColor: tone.bg }]}>
                      <ExpenseCategoryIcon category={b.category} size={16} color={tone.fg} />
                    </View>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {b.name}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {b.unit && b.quantity > 0
                          ? `${formatExpenseQuantity(b.quantity, b.unit)} · `
                          : ''}
                        bought {b.times} time{b.times === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <View style={styles.boughtRight}>
                      <Text style={styles.rowAmount}>{formatRupees(b.amount)}</Text>
                      {rate ? <Text style={styles.rateText}>{rate}</Text> : null}
                    </View>
                  </View>
                );
              })}
            </View>
              </>
            ) : (
              <>
                {groups.map((g) => (
            <View key={g.date}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>{formatDay(g.date)}</Text>
                <Text style={styles.dayTotal}>{formatRupees(g.total)}</Text>
              </View>
              <View style={styles.band}>
                {g.items.map((e, i) => {
                  const cat = asCategory(e.category);
                  const voided = Boolean(e.voidedAt);
                  const allowed = canManage(e);
                  const unit = asUnit(e.unit);
                  const qty = unit && e.quantity ? formatExpenseQuantity(e.quantity, unit) : null;
                  const rate = unit && e.quantity ? ratePerUnit(e.amount, e.quantity, unit) : null;
                  const note = e.itemName && e.description ? e.description : null;
                  return (
                    <Pressable
                      key={e.id}
                      onPress={() => setViewing(e)}
                      android_ripple={{ color: colors.waterPale }}
                      accessibilityRole="button"
                      accessibilityHint={
                        allowed ? 'Opens details, photos, edit and delete' : 'Opens details and photos'
                      }
                      style={({ pressed }) => [
                        styles.row,
                        i < g.items.length - 1 && styles.divider,
                        pressed && styles.pressedRow,
                      ]}
                    >
                      <View
                        style={[
                          styles.catIcon,
                          { backgroundColor: voided ? '#F1F5F9' : CATEGORY_TONE[cat].bg },
                        ]}
                      >
                        <ExpenseCategoryIcon
                          category={cat}
                          size={20}
                          color={voided ? colors.slate : CATEGORY_TONE[cat].fg}
                        />
                      </View>
                      <View style={styles.rowCopy}>
                        <View style={styles.titleLine}>
                          <Text
                            style={[styles.rowTitle, styles.titleShrink, voided && styles.strike]}
                            numberOfLines={1}
                          >
                            {e.itemName || e.description || EXPENSE_CATEGORY_LABEL[cat]}
                          </Text>
                          {qty ? (
                            <View
                              style={[
                                styles.qtyPill,
                                {
                                  backgroundColor: voided ? colors.surface : CATEGORY_TONE[cat].bg,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.qtyText,
                                  { color: voided ? colors.slate : CATEGORY_TONE[cat].fg },
                                ]}
                              >
                                {qty}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        {note ? (
                          <Text style={styles.noteLine} numberOfLines={1}>
                            {cat === 'chemicals' ? 'For ' : ''}
                            {note}
                          </Text>
                        ) : null}
                        <View style={styles.metaLine}>
                          <Text
                            style={[
                              styles.catTag,
                              { color: voided ? colors.slate : CATEGORY_TONE[cat].fg },
                            ]}
                          >
                            {EXPENSE_CATEGORY_LABEL[cat]}
                          </Text>
                          {e.edited && !voided ? (
                            <View style={styles.editedTag}>
                              <Text style={styles.editedTagText}>Edited</Text>
                            </View>
                          ) : null}
                          <Text style={styles.rowMeta} numberOfLines={1}>
                            · {paidLabel(e.paymentMethod, e.cashSource)}
                            {canManageTeam ? ` · ${e.createdBy.name}` : ''}
                          </Text>
                        </View>
                        {voided ? (
                          <Text style={styles.voidLine} numberOfLines={2}>
                            Deleted{e.voidedBy ? ` by ${e.voidedBy.name}` : ''}
                            {e.voidReason ? ` — “${e.voidReason}”` : ''}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.boughtRight}>
                        <Text style={[styles.rowAmount, voided && styles.strike]}>
                          {formatRupees(e.amount)}
                        </Text>
                        {rate && !voided ? <Text style={styles.rateText}>{rate}</Text> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
                ))}
                <Text style={styles.footnote}>
                  Tap an entry to see its bill and photo
                  {items.some(canManage) ? ', or edit or delete it with a reason' : ''}. Deleted entries stay visible for the record.
                </Text>
              </>
            )}
          </>
        )}
      </ScrollView>

      <ExpenseDetailSheet
        expense={viewing}
        canManage={viewing != null && canManage(viewing)}
        showEnteredBy={canManageTeam}
        onClose={() => setViewing(null)}
        onEdit={(e) => {
          setViewing(null);
          navigation.navigate('AddExpense', { edit: e });
        }}
        onDelete={(e) => {
          setViewing(null);
          setVoiding(e);
        }}
      />

      <ReasonSheet
        visible={voiding != null}
        title="Delete this expense?"
        subtitle={
          voiding
            ? `${voiding.itemName || voiding.description || EXPENSE_CATEGORY_LABEL[asCategory(voiding.category)]} · ${formatRupees(voiding.amount)}`
            : ''
        }
        confirmLabel="Delete expense"
        quickReasons={VOID_EXPENSE_REASONS}
        onClose={() => setVoiding(null)}
        onConfirm={async (reason) => {
          if (!voiding) return null;
          try {
            const res = await api.expenses[':id'].void.$post({
              param: { id: voiding.id },
              json: { reason },
            });
            if (!res.ok) return apiErrorMessage(res, 'Couldn’t delete this expense.');
            setVoiding(null);
            showToast('Expense deleted');
            await load();
            return null;
          } catch (e) {
            return e instanceof NetworkError
              ? 'Deleting needs a connection.'
              : 'Couldn’t delete this expense.';
          }
        }}
      />
    </ScreenContainer>
  );
}

export function PhotoSlot({
  label,
  hint,
  photo,
  busy,
  onPress,
}: {
  label: string;
  hint: string;
  photo: { uri: string; headers?: Record<string, string> } | null;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.slot, !photo && styles.slotEmpty, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={photo ? `${label} photo, tap to change` : `Add ${label} photo`}
    >
      {photo ? (
        <>
          <Image source={photo} style={styles.slotImage} />
          <View style={styles.slotCheck}>
            <IconCheck size={11} color={colors.white} />
          </View>
          <View style={styles.slotCaption}>
            <Text style={styles.slotCaptionText} numberOfLines={1}>
              {label}
            </Text>
          </View>
        </>
      ) : busy ? (
        <ActivityIndicator color={colors.water} />
      ) : (
        <>
          <View style={styles.slotIcon}>
            <IconCamera size={20} color={colors.waterDeep} />
          </View>
          <Text style={styles.slotLabel}>
            {label} photo <Text style={styles.required}>*</Text>
          </Text>
          <Text style={styles.slotHint} numberOfLines={2}>
            {hint}
          </Text>
        </>
      )}
    </Pressable>
  );
}

export function PhotoViewer({
  source,
  title,
  onClose,
}: {
  source: { uri: string; headers?: Record<string, string> } | null;
  title: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={source != null}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.viewer}>
        {source ? <Image source={source} style={styles.viewerImage} resizeMode="contain" /> : null}
        <View
          style={[
            styles.viewerTop,
            { paddingTop: Math.max(insets.top, StatusBar.currentHeight ?? 0) + spacing.sm },
          ]}
        >
          <Text style={styles.viewerTitle} numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            style={styles.viewerBtn}
            accessibilityLabel="Close"
          >
            <IconClose size={18} color={colors.white} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

interface ExpenseEditEntry {
  id: string;
  reason: string;
  changes: { field: string; from: unknown; to: unknown }[];
  createdAt: string;
  editedBy: { id: string; name: string };
}

const EDIT_FIELD_LABEL: Record<string, string> = {
  category: 'Spent on',
  amount: 'Amount',
  itemName: 'Item',
  quantity: 'Quantity',
  unit: 'Unit',
  description: 'Note',
  paymentMethod: 'Paid with',
  cashSource: 'Paid from',
  date: 'Date',
};

function editValue(field: string, value: unknown): string {
  if (value == null || value === '') return '—';
  if (field === 'amount' && typeof value === 'number') return formatRupees(value);
  if (field === 'category' && typeof value === 'string') return EXPENSE_CATEGORY_LABEL[asCategory(value)];
  if (field === 'paymentMethod' && typeof value === 'string') return paidLabel(value);
  if (field === 'cashSource' && typeof value === 'string') return cashSourceLabel(value);
  if (field === 'date' && typeof value === 'string') return formatDay(value.slice(0, 10));
  if (field === 'unit' && typeof value === 'string') {
    const unit = asUnit(value);
    return unit ? EXPENSE_UNIT_LABEL[unit] : value;
  }
  return String(value);
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${formatDay(isoDate(d))}, ${time}`;
}

function isoDate(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return ist.toISOString().slice(0, 10);
}

function ExpenseDetailSheet({
  expense,
  canManage,
  showEnteredBy,
  onClose,
  onEdit,
  onDelete,
}: {
  expense: ExpenseItem | null;
  canManage: boolean;
  showEnteredBy: boolean;
  onClose: () => void;
  onEdit: (e: ExpenseItem) => void;
  onDelete: (e: ExpenseItem) => void;
}) {
  const [sources, setSources] = useState<
    Record<ExpensePhotoKind, { uri: string; headers: Record<string, string> } | null>
  >({
    bill: null,
    item: null,
  });
  const [viewing, setViewing] = useState<ExpensePhotoKind | null>(null);
  const [edits, setEdits] = useState<ExpenseEditEntry[]>([]);

  useEffect(() => {
    if (!expense) return;
    let cancelled = false;
    setEdits([]);
    void Promise.all([
      expense.hasBillPhoto ? expensePhotoSource(expense.id, 'bill') : null,
      expense.hasItemPhoto ? expensePhotoSource(expense.id, 'item') : null,
    ]).then(([bill, item]) => {
      if (!cancelled) setSources({ bill, item });
    });
    if (expense.edited) {
      api.expenses[':id'].edits
        .$get({ param: { id: expense.id } })
        .then(async (res) => {
          if (!res.ok || cancelled) return;
          const body = await res.json();
          if (!cancelled && 'edits' in body) setEdits(body.edits as ExpenseEditEntry[]);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [expense]);

  if (!expense) return <BottomSheet visible={false} onClose={onClose} title="" />;

  const cat = asCategory(expense.category);
  const setup = EXPENSE_CATEGORY_SETUP[cat];
  const tone = CATEGORY_TONE[cat];
  const unit = asUnit(expense.unit);
  const qty = unit && expense.quantity ? formatExpenseQuantity(expense.quantity, unit) : null;
  const rate =
    unit && expense.quantity ? ratePerUnit(expense.amount, expense.quantity, unit) : null;
  const voided = Boolean(expense.voidedAt);

  const rows: { label: string; value: string }[] = [
    ...(qty ? [{ label: 'Quantity', value: rate ? `${qty} · ${rate}` : qty }] : []),
    { label: 'Paid with', value: paidLabel(expense.paymentMethod) },
    ...((expense.paymentMethod ?? 'cash') === 'cash' ? [{ label: 'Paid from', value: cashSourceLabel(expense.cashSource) }] : []),
    { label: 'Date', value: formatDay(expense.date) },
    ...(expense.description ? [{ label: setup.noteLabel, value: expense.description }] : []),
    ...(showEnteredBy ? [{ label: 'Entered by', value: expense.createdBy.name }] : []),
  ];

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={expense.itemName || expense.description || EXPENSE_CATEGORY_LABEL[cat]}
      subtitle={`${EXPENSE_CATEGORY_LABEL[cat]} · ${formatDay(expense.date)}`}
      footer={
        canManage ? (
          <View style={styles.detailActions}>
            <Pressable
              onPress={() => onDelete(expense)}
              accessibilityRole="button"
              accessibilityLabel="Delete this expense"
              android_ripple={{ color: 'rgba(220,38,38,0.12)' }}
              style={({ pressed }) => [styles.actionBtn, styles.deleteBtn, pressed && styles.pressed]}
            >
              <IconTrash size={18} color={colors.danger} />
              <Text style={[styles.actionLabel, { color: colors.danger }]}>Delete</Text>
            </Pressable>
            <Pressable
              onPress={() => onEdit(expense)}
              accessibilityRole="button"
              accessibilityLabel="Edit this expense"
              style={({ pressed }) => [styles.actionGrow, pressed && styles.pressed]}
            >
              <LinearGradient
                colors={brandGradients.primary.colors as unknown as string[]}
                start={brandGradients.primary.start}
                end={brandGradients.primary.end}
                style={[styles.actionBtn, styles.editBtn]}
              >
                <IconEdit size={18} color={colors.white} />
                <Text style={[styles.actionLabel, { color: colors.white }]}>Edit expense</Text>
              </LinearGradient>
            </Pressable>
          </View>
        ) : undefined
      }
    >
      <View style={[styles.detailHero, { backgroundColor: voided ? colors.surface : tone.bg }]}>
        <View style={styles.detailIcon}>
          <ExpenseCategoryIcon category={cat} size={24} color={voided ? colors.slate : tone.fg} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.detailAmount, voided && styles.strike]}>
            {formatRupees(expense.amount)}
          </Text>
          <Text style={[styles.detailMeta, { color: voided ? colors.slate : tone.fg }]}>
            {qty ? `${qty} · ` : ''}
            {paidLabel(expense.paymentMethod, expense.cashSource)}
          </Text>
        </View>
        {voided ? (
          <View style={styles.voidChip}>
            <Text style={styles.voidChipText}>Deleted</Text>
          </View>
        ) : expense.edited ? (
          <View style={styles.editedChip}>
            <IconEdit size={12} color="#0369A1" />
            <Text style={styles.editedChipText}>Edited</Text>
          </View>
        ) : null}
      </View>

      {voided ? (
        <View style={styles.voidBand}>
          <IconAlert size={14} color={colors.danger} />
          <Text style={styles.voidBandText}>
            Deleted{expense.voidedBy ? ` by ${expense.voidedBy.name}` : ''}
            {expense.voidReason ? ` — “${expense.voidReason}”` : ''}
          </Text>
        </View>
      ) : null}

      <View style={styles.slotRow}>
        {(['bill', 'item'] as const).map((kind) => {
          const src = sources[kind];
          const label = kind === 'bill' ? setup.billPhotoLabel : setup.itemPhotoLabel;
          const has = kind === 'bill' ? expense.hasBillPhoto : expense.hasItemPhoto;
          return has && src ? (
            <PhotoSlot
              key={kind}
              label={label}
              hint=""
              photo={src}
              onPress={() => setViewing(kind)}
            />
          ) : (
            <View key={kind} style={[styles.slot, styles.slotMissing]}>
              <IconCamera size={18} color={colors.slate} />
              <Text style={styles.slotHint}>
                {has ? 'Loading…' : `No ${label.toLowerCase()} photo`}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.detailRows}>
        {rows.map((r, i) => (
          <View key={r.label} style={[styles.detailRow, i < rows.length - 1 && styles.divider]}>
            <Text style={styles.detailLabel}>{r.label}</Text>
            <Text style={styles.detailValue}>{r.value}</Text>
          </View>
        ))}
      </View>

      {edits.length > 0 ? (
        <View style={styles.historyCard}>
          <Text style={styles.historyTitle}>Changes</Text>
          {edits.map((ed, i) => (
            <View key={ed.id} style={[styles.historyItem, i > 0 && styles.historyGap]}>
              <View style={styles.historyDot} />
              <View style={styles.flex}>
                <Text style={styles.historyWho}>
                  {ed.editedBy.name} · {whenLabel(ed.createdAt)}
                </Text>
                {ed.changes.map((ch) => (
                  <Text key={ch.field} style={styles.historyChange}>
                    {EDIT_FIELD_LABEL[ch.field] ?? ch.field}: {editValue(ch.field, ch.from)} →{' '}
                    <Text style={styles.historyTo}>{editValue(ch.field, ch.to)}</Text>
                  </Text>
                ))}
                <Text style={styles.historyReason}>“{ed.reason}”</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <PhotoViewer
        source={viewing ? sources[viewing] : null}
        title={
          viewing === 'bill' ? `${setup.billPhotoLabel} photo` : `${setup.itemPhotoLabel} photo`
        }
        onClose={() => setViewing(null)}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.lg },
  pressed: { opacity: 0.8 },
  pressedRow: { backgroundColor: colors.surface },
  loader: { marginTop: spacing.lg },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.water,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md - 2,
    height: 36,
  },
  addBtnText: { ...typography.label, color: colors.white },

  hero: {
    marginHorizontal: spacing.md,
    borderRadius: radius.xl,
    padding: spacing.md + 2,
    gap: 2,
    overflow: 'hidden',
  },
  heroMark: { position: 'absolute', right: -22, top: -14 },
  heroBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: spacing.sm + 2,
    gap: 2,
  },
  heroChips: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  heroChip: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    gap: 1,
  },
  heroChipLabel: { ...typography.caption, fontSize: 11, color: 'rgba(255,255,255,0.75)', letterSpacing: 0.3 },
  heroChipValue: { ...typography.bodyStrong, fontSize: 15.5, color: colors.white, fontWeight: '800' },
  syncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.lg,
    backgroundColor: colors.amberPale,
    borderWidth: 1,
    borderColor: colors.amberLight,
  },
  syncBarText: { ...typography.caption, flex: 1, fontSize: 12.5, color: colors.amberDeep, letterSpacing: 0, fontWeight: '700' },
  syncBarAction: { ...typography.label, fontSize: 13, color: colors.amberDeep, fontWeight: '800' },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    padding: 4,
    gap: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tab: { flex: 1, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.indigo },
  tabText: { ...typography.label, fontSize: 13, color: colors.slateDeep },
  tabTextOn: { color: colors.white, fontWeight: '800' },
  tabHint: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0, paddingHorizontal: spacing.md, marginBottom: -spacing.sm },
  emptyCard: {
    marginHorizontal: spacing.md,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    gap: spacing.sm,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  heroEyebrow: { ...typography.label, fontSize: 14, color: 'rgba(255,255,255,0.88)' },
  heroValue: {
    ...typography.display,
    fontSize: 42,
    color: colors.white,
    letterSpacing: -1,
    marginTop: 2,
  },
  heroMeta: { ...typography.label, fontSize: 13.5, color: 'rgba(255,255,255,0.9)' },

  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#FDE68A',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginTop: -spacing.sm,
  },
  noticeText: {
    ...typography.caption,
    color: colors.amberDeep,
    flex: 1,
    letterSpacing: 0,
    fontSize: 13,
  },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.heading,
    fontSize: 17,
    color: colors.waterInk,
    letterSpacing: -0.2,
  },
  dayTotal: { ...typography.bodyStrong, fontSize: 14, color: colors.slateDeep },
  band: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  breakdown: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.sm + 4 },
  stack: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  catIconSm: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catCopy: { flex: 1, gap: 5 },
  catTop: { flexDirection: 'row', justifyContent: 'space-between' },
  catName: { ...typography.bodyStrong, fontSize: 14.5, color: colors.waterInk },
  catAmount: { ...typography.bodyStrong, fontSize: 14.5, color: colors.waterInk },
  catTrackRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  catTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  catFill: { height: '100%', borderRadius: 3 },
  catPct: {
    ...typography.caption,
    fontSize: 11.5,
    color: colors.slate,
    fontWeight: '700',
    letterSpacing: 0,
    width: 34,
    textAlign: 'right',
  },


  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
    backgroundColor: colors.white,
  },
  catIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: { flex: 1, gap: 3 },
  rowTitle: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15.5, fontWeight: '700' },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  catTag: { ...typography.caption, fontSize: 12, fontWeight: '800', letterSpacing: 0 },
  rowMeta: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slate,
    letterSpacing: 0,
    flexShrink: 1,
  },
  pendingText: { color: colors.amberDeep, fontWeight: '700' },
  failedText: { color: colors.danger, fontWeight: '700' },
  voidLine: { ...typography.caption, color: colors.danger, letterSpacing: 0, fontSize: 12 },
  rowAmount: { ...typography.heading, fontSize: 16, color: colors.waterInk },
  strike: { textDecorationLine: 'line-through', color: colors.slate },

  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: { ...typography.heading, fontSize: 18, color: colors.waterInk },
  emptyBody: {
    ...typography.body,
    color: colors.slateDeep,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.water,
    marginTop: spacing.sm,
  },
  emptyBtnText: { ...typography.label, fontSize: 14, color: colors.white },
  footnote: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slate,
    paddingHorizontal: spacing.md,
    letterSpacing: 0,
    lineHeight: 18,
  },


  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  titleShrink: { flexShrink: 1 },
  qtyPill: { paddingHorizontal: 7, height: 20, borderRadius: 10, justifyContent: 'center' },
  qtyText: { ...typography.caption, fontSize: 11.5, fontWeight: '800', letterSpacing: 0 },
  noteLine: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slateDeep,
    fontStyle: 'italic',
    letterSpacing: 0,
  },
  boughtRight: { alignItems: 'flex-end', gap: 2 },
  rateText: {
    ...typography.caption,
    fontSize: 11.5,
    color: colors.slate,
    fontWeight: '600',
    letterSpacing: 0,
  },
  flex: { flex: 1 },
  required: { color: colors.danger, fontWeight: '800' },
  slotRow: { flexDirection: 'row', gap: spacing.sm },
  slot: {
    flex: 1,
    height: 104,
    borderRadius: radius.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.surface,
  },
  slotEmpty: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#93C5FD',
    backgroundColor: '#F0F9FF',
    paddingHorizontal: spacing.sm,
  },
  slotMissing: { borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm },
  slotIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  slotLabel: { ...typography.bodyStrong, fontSize: 13.5, color: colors.waterInk },
  slotHint: {
    ...typography.caption,
    fontSize: 11,
    color: colors.slate,
    letterSpacing: 0,
    textAlign: 'center',
  },
  slotImage: { ...StyleSheet.absoluteFillObject },
  slotCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.teal,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    backgroundColor: 'rgba(8,47,73,0.55)',
  },
  slotCaptionText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.white,
    fontWeight: '800',
    letterSpacing: 0,
  },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerImage: { flex: 1 },
  viewerTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  viewerTitle: { ...typography.bodyStrong, color: colors.white, flex: 1 },
  viewerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  detailIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E0F2FE',
  },
  editedChipText: { ...typography.caption, fontSize: 12, fontWeight: '800', color: '#0369A1', letterSpacing: 0 },
  editedTag: {
    paddingHorizontal: 6,
    height: 17,
    borderRadius: 6,
    backgroundColor: '#E0F2FE',
    justifyContent: 'center',
    marginLeft: 4,
  },
  editedTagText: { ...typography.caption, fontSize: 10.5, fontWeight: '800', color: '#0369A1', letterSpacing: 0 },
  detailActions: { flexDirection: 'row', gap: spacing.sm },
  actionGrow: { flex: 1 },
  actionBtn: {
    height: 54,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: spacing.lg,
  },
  deleteBtn: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  editBtn: { flex: 1 },
  actionLabel: { ...typography.bodyStrong, fontSize: 15.5 },
  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  historyTitle: { ...typography.label, fontSize: 13, color: colors.slateDeep, marginBottom: spacing.sm },
  historyItem: { flexDirection: 'row', gap: spacing.sm },
  historyGap: { marginTop: spacing.md },
  historyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#0369A1', marginTop: 6 },
  historyWho: { ...typography.bodyStrong, fontSize: 13.5, color: colors.waterInk },
  historyChange: { ...typography.body, fontSize: 13, color: colors.slateDeep, marginTop: 2 },
  historyTo: { fontWeight: '700', color: colors.waterInk },
  historyReason: { ...typography.caption, fontSize: 12.5, color: colors.slate, marginTop: 4, fontStyle: 'italic', letterSpacing: 0 },
  detailAmount: {
    ...typography.display,
    fontSize: 32,
    color: colors.waterInk,
    letterSpacing: -0.5,
  },
  detailMeta: { ...typography.label, fontSize: 13.5, color: colors.slateDeep },
  voidChip: {
    paddingHorizontal: 10,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
  },
  voidChipText: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '800',
    color: colors.danger,
    letterSpacing: 0,
  },
  voidBand: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderRadius: radius.sm,
    padding: spacing.sm + 2,
  },
  voidBandText: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.danger,
    letterSpacing: 0,
    flex: 1,
    lineHeight: 17,
  },
  detailRows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  detailLabel: { ...typography.body, fontSize: 14, color: colors.slateDeep },
  detailValue: {
    ...typography.bodyStrong,
    fontSize: 14,
    color: colors.waterInk,
    flexShrink: 1,
    textAlign: 'right',
  },
});
