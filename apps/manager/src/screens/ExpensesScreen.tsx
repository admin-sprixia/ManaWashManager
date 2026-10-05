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
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  MAX_PHOTO_BYTES,
  type ExpensePhotoKind,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_CATEGORY_SETUP,
  EXPENSE_UNIT_LABEL,
  EXPENSE_UNITS,
  defaultExpenseUnit,
  formatExpenseQuantity,
  normalizeExpenseQuantity,
  STOCK_CATEGORIES,
  STOCK_UNIT_LABEL,
  formatStock,
  roundStock,
  stockKey,
  stockUnitOf,
  toStockQuantity,
  type ExpenseCategory,
  type ExpenseUnit,
  type StockUnit,
} from '@mana/domain';
import {
  ScreenContainer,
  ScreenHeader,
  BottomSheet,
  Button,
  showToast,
  IconAlert,
  IconBox,
  IconCalendar,
  IconCamera,
  IconCash,
  IconCheck,
  IconClose,
  IconCloudOff,
  IconEdit,
  IconPlus,
  IconReceipt,
  IconSync,
  IconUpi,
  IconWallet,
  colors,
  gradients,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { PeriodSelect, PERIOD_OPTIONS, type PeriodKey } from '../components/PeriodSelect';
import { rangeLabel, type DateRange } from '../components/RangeCalendar';
import { CalendarSheet } from '../components/CalendarSheet';
import { ReasonSheet } from '../components/ReasonSheet';
import { pickPhotos } from '../utils/photoPicker';
import { ExpenseCategoryIcon } from '../components/ExpenseCategoryIcon';
import { api, apiErrorMessage, expensePhotoSource } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { useSync } from '../offline/SyncProvider';
import { useShop } from '../offline/ShopProvider';
import { deleteLocalCopy, keepLocalCopy } from '../offline/photoFiles';
import type { ExpensePayload, ExpensePaymentMethod, LocalPhoto } from '../offline/types';
import { newId } from '../utils/id';
import { formatRupees } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Expenses'>;

interface ExpenseItem {
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
  hasBillPhoto?: boolean;
  hasItemPhoto?: boolean;
}

const PAID_WITH: { key: ExpensePaymentMethod; label: string; hint: string }[] = [
  { key: 'cash', label: 'Cash', hint: 'From the drawer' },
  { key: 'upi', label: 'UPI', hint: 'GPay, PhonePe…' },
  { key: 'other', label: 'Other', hint: 'Card, bank…' },
];

const CATEGORY_TONE: Record<ExpenseCategory, { fg: string; bg: string }> = {
  chemicals: { fg: '#0369A1', bg: '#E0F2FE' },
  labour: { fg: '#5B21B6', bg: '#EDE9FE' },
  electricity: { fg: '#B45309', bg: '#FEF3C7' },
  water: { fg: '#0E7490', bg: '#CFFAFE' },
  maintenance: { fg: '#9D174D', bg: '#FCE7F3' },
  other: { fg: '#475569', bg: '#F1F5F9' },
};

const QUICK_ADD = [100, 500, 1000];

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

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function periodStart(period: PeriodKey): string {
  const today = isoDaysAgo(0);
  if (period === 'week') return isoDaysAgo(6);
  if (period === 'month') return `${today.slice(0, 8)}01`;
  if (period === 'year') return `${today.slice(0, 5)}01-01`;
  return today;
}

/** The smallest view that shows `date`, so an entry saved for an earlier day never seems to vanish. */
function viewFor(date: string): { period: PeriodKey; custom: DateRange | null } {
  const today = isoDaysAgo(0);
  for (const period of ['today', 'week', 'month', 'year'] as const) {
    if (date >= periodStart(period)) return { period, custom: null };
  }
  return { period: 'today', custom: { from: date, to: today } };
}

function formatDay(iso: string): string {
  if (iso === isoDaysAgo(0)) return 'Today';
  if (iso === isoDaysAgo(1)) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function dayParts(iso: string): { weekday: string; day: number } {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y!, (m ?? 1) - 1, d);
  return { weekday: date.toLocaleDateString('en-IN', { weekday: 'short' }), day: d ?? 1 };
}

function paidLabel(method: string | undefined): string {
  return method === 'upi' ? 'UPI' : method === 'other' ? 'Other' : 'Cash';
}

function asUnit(value: string | null | undefined): ExpenseUnit | null {
  return value && (EXPENSE_UNITS as readonly string[]).includes(value)
    ? (value as ExpenseUnit)
    : null;
}

/** "₹130 per L" — price per base unit (ml and g are shown per L and kg). */
function ratePerUnit(paise: number, quantity: number, unit: ExpenseUnit): string | null {
  const n = normalizeExpenseQuantity(quantity, unit);
  if (!(n.quantity > 0) || !(paise > 0)) return null;
  const perUnit = Math.round(paise / n.quantity / 100) * 100;
  return `${formatRupees(perUnit)} per ${EXPENSE_UNIT_LABEL[n.unit] === 'pcs' ? 'piece' : EXPENSE_UNIT_LABEL[n.unit].replace(/s$/, '')}`;
}

function parseQuantity(text: string): number | null {
  const n = Number(text.replace(/,/g, ''));
  return text.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

export function ExpensesScreen({ navigation }: Props) {
  const { user, isOwner } = useAuth();
  const { myItems, submit, version } = useSync();
  const { refreshStock } = useShop();
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [byCategory, setByCategory] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<ExpenseItem | null>(null);
  const [viewing, setViewing] = useState<ExpenseItem | null>(null);

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

  const canVoid = (e: ExpenseItem) => {
    if (e.voidedAt) return false;
    if (isOwner) return true;
    return e.createdByUserId === user?.id && e.date === isoDaysAgo(0);
  };

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
              onPress={() => setAdding(true)}
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
            tintColor={colors.water}
            colors={[colors.water]}
          />
        }
      >
        <View>
          <PeriodSelect
            value={period}
            onChange={(next) => {
              setCustomRange(null);
              setPeriod(next);
            }}
            menuTitle="Show expenses for"
            custom={{ range: customRange, onApply: setCustomRange }}
          />

          <LinearGradient
            colors={gradients.hero as unknown as string[]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={styles.hero}
          >
            <View pointerEvents="none" style={styles.orbLarge} />
            <View pointerEvents="none" style={styles.orbSmall} />
            <Text style={styles.heroEyebrow}>
              {isOwner ? 'Shop spending' : 'You logged'} · {periodLabel}
            </Text>
            <Text style={styles.heroValue}>{formatRupees(total)}</Text>
            <Text style={styles.heroMeta}>
              {live.length} entr{live.length === 1 ? 'y' : 'ies'}
              {categories[0] ? ` · most on ${EXPENSE_CATEGORY_LABEL[categories[0]]}` : ''}
            </Text>
            <View style={styles.heroSplit}>
              {PAID_WITH.map((m, i) => (
                <View key={m.key} style={[styles.heroCell, i > 0 && styles.heroCellDivider]}>
                  <Text style={styles.heroCellValue}>{formatRupees(byMethod[m.key])}</Text>
                  <Text style={styles.heroCellLabel}>
                    {m.key === 'cash' ? 'Cash from drawer' : m.label}
                  </Text>
                </View>
              ))}
            </View>
          </LinearGradient>
        </View>

        {error ? (
          <View style={styles.notice}>
            <IconCloudOff size={15} color={colors.amberDeep} />
            <Text style={styles.noticeText}>{error}</Text>
          </View>
        ) : null}

        {categories.length > 0 ? (
          <View>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Where it went</Text>
              <Text style={styles.sectionMeta}>
                {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}
              </Text>
            </View>
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
          </View>
        ) : null}

        {bought.length > 0 ? (
          <View>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Items bought</Text>
              <Text style={styles.sectionMeta}>Quantity · price per unit</Text>
            </View>
            <View style={styles.band}>
              {bought.slice(0, 8).map((b, i, list) => {
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
          </View>
        ) : null}

        {pending.length > 0 ? (
          <View>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Waiting to sync</Text>
              <View style={styles.syncChip}>
                <IconSync size={12} color={colors.amberDeep} />
                <Text style={styles.syncChipText}>{pending.length}</Text>
              </View>
            </View>
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
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.water} />
        ) : items.length === 0 ? (
          <View style={styles.emptyBox}>
            <View style={styles.emptyIcon}>
              <IconReceipt size={28} color={colors.waterDeep} />
            </View>
            <Text style={styles.emptyTitle}>
              No expenses {period === 'today' ? 'today' : 'in this period'}
            </Text>
            <Text style={styles.emptyBody}>
              Bought chemicals or paid a bill? Log it so the profit numbers stay right.
            </Text>
            <Pressable
              onPress={() => setAdding(true)}
              style={({ pressed }) => [styles.emptyBtn, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <IconPlus size={15} color={colors.white} />
              <Text style={styles.emptyBtnText}>Add an expense</Text>
            </Pressable>
          </View>
        ) : (
          groups.map((g) => (
            <View key={g.date}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>{formatDay(g.date)}</Text>
                <Text style={styles.dayTotal}>{formatRupees(g.total)}</Text>
              </View>
              <View style={styles.band}>
                {g.items.map((e, i) => {
                  const cat = asCategory(e.category);
                  const voided = Boolean(e.voidedAt);
                  const allowed = canVoid(e);
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
                        allowed ? 'Opens details, photos and void' : 'Opens details and photos'
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
                          <Text style={styles.rowMeta} numberOfLines={1}>
                            · {paidLabel(e.paymentMethod)}
                            {isOwner ? ` · ${e.createdBy.name}` : ''}
                          </Text>
                        </View>
                        {voided ? (
                          <Text style={styles.voidLine} numberOfLines={2}>
                            Voided{e.voidedBy ? ` by ${e.voidedBy.name}` : ''}
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
          ))
        )}
        {items.length > 0 ? (
          <Text style={styles.footnote}>
            Tap an entry to see its bill and photo
            {items.some(canVoid) ? ', or void it with a reason' : ''}. Voided entries stay visible
            for the record.
          </Text>
        ) : null}
      </ScrollView>

      <AddExpenseSheet
        visible={adding}
        isOwner={isOwner}
        onClose={() => setAdding(false)}
        onSave={async (payload) => {
          const result = await submit({ kind: 'expense.create', payload });
          if (result.status === 'rejected') return result.message;
          setAdding(false);
          const stock =
            result.status === 'sent'
              ? (
                  result.data as {
                    stock?: { name: string; unit: string; balance: number } | null;
                  } | null
                )?.stock
              : null;
          const date = payload.date ?? isoDaysAgo(0);
          const inView = customRange
            ? date >= customRange.from && date <= customRange.to
            : date >= periodStart(period);
          const dayNote =
            date === isoDaysAgo(0)
              ? ''
              : date === isoDaysAgo(1)
                ? ' for yesterday'
                : ` for ${formatDay(date)}`;
          showToast(
            result.status === 'queued'
              ? `Expense saved offline${dayNote} — will sync automatically`
              : stock
                ? `Expense added${dayNote} · ${stock.name} now ${formatStock(stock.balance, stock.unit as StockUnit)} in stock`
                : `Expense added${dayNote}`,
            result.status === 'queued' ? 'offline' : 'success',
          );
          if (!inView) {
            const next = viewFor(date);
            setPeriod(next.period);
            setCustomRange(next.custom);
          } else if (result.status === 'sent') {
            void load();
          }
          if (result.status === 'sent') void refreshStock();
          return null;
        }}
      />

      <ExpenseDetailSheet
        expense={viewing}
        canVoid={viewing != null && canVoid(viewing)}
        isOwner={isOwner}
        onClose={() => setViewing(null)}
        onVoid={(e) => {
          setViewing(null);
          setVoiding(e);
        }}
      />

      <ReasonSheet
        visible={voiding != null}
        title="Void this expense?"
        subtitle={
          voiding
            ? `${voiding.itemName || voiding.description || EXPENSE_CATEGORY_LABEL[asCategory(voiding.category)]} · ${formatRupees(voiding.amount)}`
            : ''
        }
        confirmLabel="Void expense"
        quickReasons={VOID_EXPENSE_REASONS}
        onClose={() => setVoiding(null)}
        onConfirm={async (reason) => {
          if (!voiding) return null;
          try {
            const res = await api.expenses[':id'].void.$post({
              param: { id: voiding.id },
              json: { reason },
            });
            if (!res.ok) return apiErrorMessage(res, 'Couldn’t void this expense.');
            setVoiding(null);
            showToast('Expense voided');
            await load();
            return null;
          } catch (e) {
            return e instanceof NetworkError
              ? 'Voiding needs a connection.'
              : 'Couldn’t void this expense.';
          }
        }}
      />
    </ScreenContainer>
  );
}

function PhotoSlot({
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

function PhotoViewer({
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

function AddExpenseSheet({
  visible,
  isOwner,
  onClose,
  onSave,
}: {
  visible: boolean;
  isOwner: boolean;
  onClose: () => void;
  onSave: (p: ExpensePayload) => Promise<string | null>;
}) {
  const today = isoDaysAgo(0);
  const [expenseId, setExpenseId] = useState(newId);
  const [category, setCategory] = useState<ExpenseCategory>('chemicals');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [item, setItem] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState<ExpenseUnit>(EXPENSE_CATEGORY_SETUP.chemicals.units[0]!);
  const [unitTouched, setUnitTouched] = useState(false);
  const [date, setDate] = useState(today);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('cash');
  const [billPhoto, setBillPhoto] = useState<LocalPhoto | null>(null);
  const [itemPhoto, setItemPhoto] = useState<LocalPhoto | null>(null);
  const [photoBusy, setPhotoBusy] = useState<ExpensePhotoKind | null>(null);
  const [viewing, setViewing] = useState<ExpensePhotoKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<'item' | 'qty' | 'note' | null>(null);
  const [stockOn, setStockOn] = useState<boolean | null>(null);
  const { stock } = useShop();

  useEffect(() => {
    if (visible) {
      setExpenseId(newId());
      setCategory('chemicals');
      setAmount('');
      setNote('');
      setItem('');
      setQty('');
      setUnit(EXPENSE_CATEGORY_SETUP.chemicals.units[0]!);
      setUnitTouched(false);
      setDate(isoDaysAgo(0));
      setPaymentMethod('cash');
      setBillPhoto(null);
      setItemPhoto(null);
      setStockOn(null);
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const setup = EXPENSE_CATEGORY_SETUP[category];
  const rupees = Number(amount.replace(/,/g, ''));
  const paise = Number.isFinite(rupees) ? Math.round(rupees * 100) : 0;
  const valid = paise > 0;
  const tone = CATEGORY_TONE[category];
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => isoDaysAgo(i)), []);
  const quantity = parseQuantity(qty);
  const rate = quantity ? ratePerUnit(paise, quantity, unit) : null;
  const minDate = isoDaysAgo(isOwner ? 365 : 31);

  const stockUnit = stockUnitOf(unit);
  const stockable = STOCK_CATEGORIES.includes(category) && stockUnit != null;
  const stockMatch = item.trim()
    ? (stock.find((s) => stockKey(s.name) === stockKey(item)) ?? null)
    : null;
  const stockClash = stockMatch != null && stockMatch.unit !== stockUnit;
  // On by default for chemicals, or when the item is already tracked.
  const addToStock =
    stockable && !stockClash && (stockOn ?? (category === 'chemicals' || stockMatch != null));
  const stockQty = stockMatch && quantity ? toStockQuantity(quantity, unit, stockMatch.unit) : null;
  const stockAfter =
    stockMatch && stockQty != null ? roundStock(stockMatch.balance + stockQty) : null;

  const missing = [
    !valid && 'Amount',
    !item.trim() && setup.itemLabel,
    setup.quantityRequired && !quantity && 'Quantity',
    !billPhoto && `${setup.billPhotoLabel} photo`,
    !itemPhoto && `${setup.itemPhotoLabel} photo`,
  ].filter((m): m is string => Boolean(m));
  const canSave = missing.length === 0;

  const close = () => {
    if (billPhoto) void deleteLocalCopy(billPhoto.uri);
    if (itemPhoto) void deleteLocalCopy(itemPhoto.uri);
    onClose();
  };

  const pickCategory = (c: ExpenseCategory) => {
    if (c === category) return;
    // A suggestion from the old category ("Foam shampoo") makes no sense under the new one.
    const keepItem = item && !setup.itemSuggestions.includes(item) ? item : '';
    setCategory(c);
    setItem(keepItem);
    setUnit(defaultExpenseUnit(c, keepItem));
    setUnitTouched(false);
    if (note && setup.noteSuggestions.includes(note)) setNote('');
  };

  const pickItem = (name: string) => {
    setItem(name);
    if (!unitTouched) setUnit(defaultExpenseUnit(category, name));
  };

  const takePhoto = async (kind: ExpensePhotoKind) => {
    const current = kind === 'bill' ? billPhoto : itemPhoto;
    const label = kind === 'bill' ? setup.billPhotoLabel : setup.itemPhotoLabel;
    const res = await pickPhotos(
      `${current ? 'Change' : 'Add'} ${label.toLowerCase()} photo`,
      kind === 'bill' ? 'Make sure the total and shop name are readable.' : setup.itemPhotoHint,
    );
    if (!res || res.didCancel) return;
    const asset = res.assets?.[0];
    if (res.errorCode || !asset?.uri) {
      setError(res.errorMessage ?? 'Couldn’t get that photo.');
      return;
    }
    if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) {
      setError('That photo is too large even after shrinking. Try again a little further away.');
      return;
    }
    const contentType: LocalPhoto['contentType'] =
      asset.type === 'image/png' ? 'image/png' : 'image/jpeg';
    setPhotoBusy(kind);
    setError(null);
    try {
      const uri = await keepLocalCopy(
        asset.uri,
        `${expenseId}-${kind}-${Date.now()}`,
        contentType === 'image/png' ? 'png' : 'jpg',
      );
      if (current) void deleteLocalCopy(current.uri);
      (kind === 'bill' ? setBillPhoto : setItemPhoto)({ uri, contentType });
    } catch {
      setError('Couldn’t save that photo.');
    } finally {
      setPhotoBusy(null);
    }
  };

  const save = async () => {
    if (!canSave || !billPhoto || !itemPhoto) return;
    setBusy(true);
    setError(null);
    const message = await onSave({
      id: expenseId,
      category,
      amount: paise,
      description: note.trim() || undefined,
      itemName: item.trim(),
      ...(quantity ? { quantity, unit } : {}),
      ...(addToStock && quantity ? { addToStock: true } : {}),
      date,
      paymentMethod,
      billPhoto,
      itemPhoto,
    });
    setBusy(false);
    if (message) setError(message);
  };

  const bump = (by: number) => {
    const current = Number.isFinite(rupees) ? rupees : 0;
    setAmount(String(Math.round((current + by) * 100) / 100));
  };

  const viewingPhoto = viewing === 'bill' ? billPhoto : viewing === 'item' ? itemPhoto : null;

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      dismissable={!busy}
      title="Add expense"
      subtitle={
        isOwner
          ? 'Counts against the shop’s profit.'
          : 'Saved against your name for the owner’s records.'
      }
      footer={
        <>
          <Button
            label={
              canSave
                ? `Save ${formatRupees(paise)}`
                : `${missing.length} thing${missing.length === 1 ? '' : 's'} left`
            }
            size="lg"
            loading={busy}
            disabled={!canSave}
            onPress={() => void save()}
          />
          {canSave ? (
            <Text style={styles.footSummary} numberOfLines={1}>
              {item.trim()}
              {quantity ? ` · ${formatExpenseQuantity(quantity, unit)}` : ''} ·{' '}
              {paidLabel(paymentMethod)} · {formatDay(date)}
            </Text>
          ) : (
            <Text style={styles.footMissing} numberOfLines={2}>
              Still needed: {missing.join(' · ')}
            </Text>
          )}
        </>
      }
    >
      <View style={styles.amountBlock}>
        <View style={[styles.amountBadge, { backgroundColor: tone.bg }]}>
          <ExpenseCategoryIcon category={category} size={22} color={tone.fg} />
        </View>
        <View style={styles.amountRow}>
          <Text style={[styles.rupee, valid && { color: colors.waterInk }]}>₹</Text>
          <TextInput
            style={styles.amountInput}
            value={amount}
            onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))}
            placeholder="0"
            placeholderTextColor={colors.border}
            keyboardType="decimal-pad"
            autoFocus
            maxLength={9}
          />
        </View>
        <View style={[styles.amountLine, { backgroundColor: valid ? tone.fg : colors.border }]} />
        <View style={styles.quickRow}>
          {QUICK_ADD.map((n) => (
            <Pressable
              key={n}
              onPress={() => bump(n)}
              style={({ pressed }) => [styles.quickChip, pressed && styles.chipPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Add ${n} rupees`}
            >
              <Text style={styles.quickText}>+₹{n.toLocaleString('en-IN')}</Text>
            </Pressable>
          ))}
          {amount ? (
            <Pressable
              onPress={() => setAmount('')}
              style={({ pressed }) => [
                styles.quickChip,
                styles.clearChip,
                pressed && styles.chipPressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>
          What was it for? <Text style={styles.required}>*</Text>
        </Text>
        <View style={styles.catGrid}>
          {EXPENSE_CATEGORIES.map((c) => {
            const on = category === c;
            const t = CATEGORY_TONE[c];
            return (
              <Pressable
                key={c}
                onPress={() => pickCategory(c)}
                style={({ pressed }) => [
                  styles.catTile,
                  on && { borderColor: t.fg, backgroundColor: t.fg },
                  pressed && !on && styles.chipPressed,
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <View
                  style={[
                    styles.catBadge,
                    { backgroundColor: on ? 'rgba(255,255,255,0.22)' : t.bg },
                  ]}
                >
                  <ExpenseCategoryIcon category={c} size={20} color={on ? colors.white : t.fg} />
                </View>
                <Text style={[styles.catLabel, on && styles.catLabelOn]}>
                  {EXPENSE_CATEGORY_LABEL[c]}
                </Text>
                {on ? (
                  <View style={styles.catCheck}>
                    <IconCheck size={10} color={t.fg} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.itemSection}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>
            {setup.itemLabel} <Text style={styles.required}>*</Text>
          </Text>
          <View style={[styles.noteField, focus === 'item' && styles.noteFocus]}>
            <ExpenseCategoryIcon
              category={category}
              size={17}
              color={focus === 'item' ? tone.fg : colors.slate}
            />
            <TextInput
              style={styles.noteInput}
              value={item}
              onChangeText={pickItem}
              onFocus={() => setFocus('item')}
              onBlur={() => setFocus(null)}
              placeholder={setup.itemPlaceholder}
              placeholderTextColor={colors.slate}
              autoCapitalize="sentences"
              maxLength={80}
            />
            {item.trim() ? <IconCheck size={15} color={colors.teal} /> : null}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.ideaRow}
          >
            {setup.itemSuggestions.map((s) => {
              const on = item === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => pickItem(on ? '' : s)}
                  style={({ pressed }) => [
                    styles.ideaChip,
                    on && { backgroundColor: tone.bg, borderColor: tone.fg },
                    pressed && styles.chipPressed,
                  ]}
                >
                  <Text style={[styles.ideaText, on && { color: tone.fg }]}>{s}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>
            Quantity{' '}
            {setup.quantityRequired ? <Text style={styles.required}>*</Text> : '(optional)'}
          </Text>
          <View style={styles.qtyRow}>
            <View style={[styles.qtyField, focus === 'qty' && styles.noteFocus]}>
              <TextInput
                style={styles.qtyInput}
                value={qty}
                onChangeText={(t) => setQty(t.replace(/[^\d.]/g, ''))}
                onFocus={() => setFocus('qty')}
                onBlur={() => setFocus(null)}
                placeholder="0"
                placeholderTextColor={colors.slate}
                keyboardType="decimal-pad"
                maxLength={8}
              />
              <Text style={styles.qtyUnit}>{EXPENSE_UNIT_LABEL[unit]}</Text>
            </View>
            <View style={styles.unitRow}>
              {setup.units.map((u) => {
                const on = unit === u;
                return (
                  <Pressable
                    key={u}
                    onPress={() => {
                      setUnit(u);
                      setUnitTouched(true);
                    }}
                    style={({ pressed }) => [
                      styles.unitChip,
                      on && { backgroundColor: tone.fg, borderColor: tone.fg },
                      pressed && !on && styles.chipPressed,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.unitText, on && styles.unitTextOn]}>
                      {EXPENSE_UNIT_LABEL[u]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {rate ? (
            <View style={styles.rateLine}>
              <IconCheck size={13} color={colors.tealDeep} />
              <Text style={styles.rateLineText}>
                {formatExpenseQuantity(quantity!, unit)} for {formatRupees(paise)} ={' '}
                <Text style={styles.rateStrong}>{rate}</Text>
              </Text>
            </View>
          ) : (
            <Text style={styles.fieldHint}>
              {category === 'electricity'
                ? 'Units from the bill (kWh), or litres of diesel.'
                : category === 'labour'
                  ? 'How many days or hours were paid for.'
                  : category === 'water'
                    ? 'Number of tankers, or litres.'
                    : 'Helps you see how much you use and what you pay per unit.'}
            </Text>
          )}
        </View>

        {stockable ? (
          <Pressable
            onPress={() => !stockClash && setStockOn(!addToStock)}
            style={[styles.stockRow, addToStock && styles.stockRowOn]}
            accessibilityRole="switch"
            accessibilityState={{ checked: addToStock, disabled: stockClash }}
          >
            <View style={[styles.stockIcon, addToStock && styles.stockIconOn]}>
              <IconBox size={17} color={addToStock ? colors.white : colors.waterDeep} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.stockTitle}>Add to stock</Text>
              <Text
                style={[styles.stockHint, stockClash && { color: colors.amberDeep }]}
                numberOfLines={2}
              >
                {stockClash && stockMatch
                  ? `${stockMatch.name} is counted in ${STOCK_UNIT_LABEL[stockMatch.unit].toLowerCase()} — pick a matching unit to add it.`
                  : !item.trim()
                    ? 'Adds this quantity to Inventory.'
                    : stockMatch
                      ? stockAfter != null
                        ? `${stockMatch.name}: ${formatStock(stockMatch.balance, stockMatch.unit)} → ${formatStock(stockAfter, stockMatch.unit)}`
                        : `Adds to ${stockMatch.name} (${formatStock(stockMatch.balance, stockMatch.unit)} now)`
                      : `Starts a new stock item “${item.trim()}”.`}
              </Text>
            </View>
            <Switch
              value={addToStock}
              disabled={stockClash}
              onValueChange={setStockOn}
              trackColor={{ false: colors.border, true: '#7DD3FC' }}
              thumbColor={addToStock ? colors.water : colors.white}
            />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.field}>
        <View style={styles.labelRow}>
          <Text style={styles.fieldLabel}>
            Proof <Text style={styles.required}>*</Text>
          </Text>
          <Text style={[styles.proofCount, billPhoto && itemPhoto ? styles.proofDone : null]}>
            {[billPhoto, itemPhoto].filter(Boolean).length}/2 photos
          </Text>
        </View>
        <View style={styles.slotRow}>
          <PhotoSlot
            label={setup.billPhotoLabel}
            hint="Total and shop name readable"
            photo={billPhoto}
            busy={photoBusy === 'bill'}
            onPress={() => (billPhoto ? setViewing('bill') : void takePhoto('bill'))}
          />
          <PhotoSlot
            label={setup.itemPhotoLabel}
            hint={setup.itemPhotoHint}
            photo={itemPhoto}
            busy={photoBusy === 'item'}
            onPress={() => (itemPhoto ? setViewing('item') : void takePhoto('item'))}
          />
        </View>
        {billPhoto || itemPhoto ? (
          <View style={styles.retakeRow}>
            {billPhoto ? (
              <Pressable
                onPress={() => void takePhoto('bill')}
                hitSlop={6}
                style={styles.retakeBtn}
              >
                <IconCamera size={13} color={colors.waterDeep} />
                <Text style={styles.retakeText}>Retake {setup.billPhotoLabel.toLowerCase()}</Text>
              </Pressable>
            ) : (
              <View style={styles.flex} />
            )}
            {itemPhoto ? (
              <Pressable
                onPress={() => void takePhoto('item')}
                hitSlop={6}
                style={styles.retakeBtn}
              >
                <IconCamera size={13} color={colors.waterDeep} />
                <Text style={styles.retakeText}>Retake {setup.itemPhotoLabel.toLowerCase()}</Text>
              </Pressable>
            ) : (
              <View style={styles.flex} />
            )}
          </View>
        ) : (
          <Text style={styles.fieldHint}>
            Both photos are needed so the owner can check every rupee spent.
          </Text>
        )}
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Paid with</Text>
        <View style={styles.payRow}>
          {PAID_WITH.map((m) => {
            const on = paymentMethod === m.key;
            const iconColor = on ? colors.white : colors.slateDeep;
            return (
              <Pressable
                key={m.key}
                onPress={() => setPaymentMethod(m.key)}
                style={({ pressed }) => [
                  styles.payTile,
                  on && styles.payTileOn,
                  pressed && !on && styles.chipPressed,
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                {m.key === 'cash' ? (
                  <IconCash size={20} color={iconColor} />
                ) : m.key === 'upi' ? (
                  <IconUpi size={20} color={iconColor} />
                ) : (
                  <IconWallet size={20} color={iconColor} />
                )}
                <Text style={[styles.payLabel, on && styles.payLabelOn]}>{m.label}</Text>
                <Text style={[styles.payHint, on && styles.payHintOn]}>{m.hint}</Text>
              </Pressable>
            );
          })}
        </View>
        {paymentMethod === 'cash' ? (
          <Text style={styles.fieldHint}>Taken out of that day’s cash drawer count.</Text>
        ) : null}
      </View>

      <View style={styles.field}>
        <View style={styles.labelRow}>
          <Text style={styles.fieldLabel}>When</Text>
          <Text style={styles.whenValue}>{formatDay(date)}</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.dayRow}
        >
          {days.map((d, i) => {
            const on = date === d;
            const { weekday, day } = dayParts(d);
            return (
              <Pressable
                key={d}
                onPress={() => setDate(d)}
                style={({ pressed }) => [
                  styles.dayTile,
                  on && styles.dayTileOn,
                  pressed && !on && styles.chipPressed,
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.dayWeek, on && styles.dayTextOn]}>
                  {i === 0 ? 'Today' : i === 1 ? 'Yest.' : weekday}
                </Text>
                <Text style={[styles.dayNum, on && styles.dayTextOn]}>{day}</Text>
              </Pressable>
            );
          })}
          {!days.includes(date) ? (
            <Pressable
              onPress={() => setCalendarOpen(true)}
              style={[styles.dayTile, styles.dayTileOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: true }}
            >
              <Text style={[styles.dayWeek, styles.dayTextOn]}>{dayParts(date).weekday}</Text>
              <Text style={[styles.dayNum, styles.dayTextOn]}>{dayParts(date).day}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setCalendarOpen(true)}
            style={({ pressed }) => [styles.dayTile, styles.calTile, pressed && styles.chipPressed]}
            accessibilityRole="button"
            accessibilityLabel="Pick another date"
          >
            <IconCalendar size={18} color={colors.waterDeep} />
            <Text style={styles.calText}>Calendar</Text>
          </Pressable>
        </ScrollView>
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{setup.noteLabel} (optional)</Text>
        <View style={[styles.noteField, focus === 'note' && styles.noteFocus]}>
          <IconEdit size={16} color={focus === 'note' ? colors.water : colors.slate} />
          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={setNote}
            onFocus={() => setFocus('note')}
            onBlur={() => setFocus(null)}
            placeholder={setup.notePlaceholder}
            placeholderTextColor={colors.slate}
            maxLength={200}
          />
        </View>
        {setup.noteSuggestions.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.ideaRow}
          >
            {setup.noteSuggestions.map((idea) => {
              const on = note === idea;
              return (
                <Pressable
                  key={idea}
                  onPress={() => setNote(on ? '' : idea)}
                  style={({ pressed }) => [
                    styles.ideaChip,
                    on && { backgroundColor: tone.bg, borderColor: tone.fg },
                    pressed && styles.chipPressed,
                  ]}
                >
                  <Text style={[styles.ideaText, on && { color: tone.fg }]}>{idea}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {error ? (
        <View style={styles.errorRow}>
          <IconAlert size={14} color={colors.danger} />
          <Text style={styles.sheetError}>{error}</Text>
        </View>
      ) : null}

      <CalendarSheet
        visible={calendarOpen}
        mode="plain"
        value={date}
        max={today}
        min={minDate}
        title="When was it paid?"
        subtitle={
          isOwner ? 'Pick the date on the bill.' : 'Pick the date on the bill — up to 31 days back.'
        }
        onClose={() => setCalendarOpen(false)}
        onSelect={(d) => {
          setDate(d);
          setCalendarOpen(false);
        }}
      />
      <PhotoViewer
        source={viewingPhoto ? { uri: viewingPhoto.uri } : null}
        title={
          viewing === 'bill' ? `${setup.billPhotoLabel} photo` : `${setup.itemPhotoLabel} photo`
        }
        onClose={() => setViewing(null)}
      />
    </BottomSheet>
  );
}

function ExpenseDetailSheet({
  expense,
  canVoid,
  isOwner,
  onClose,
  onVoid,
}: {
  expense: ExpenseItem | null;
  canVoid: boolean;
  isOwner: boolean;
  onClose: () => void;
  onVoid: (e: ExpenseItem) => void;
}) {
  const [sources, setSources] = useState<
    Record<ExpensePhotoKind, { uri: string; headers: Record<string, string> } | null>
  >({
    bill: null,
    item: null,
  });
  const [viewing, setViewing] = useState<ExpensePhotoKind | null>(null);

  useEffect(() => {
    if (!expense) return;
    let cancelled = false;
    void Promise.all([
      expense.hasBillPhoto ? expensePhotoSource(expense.id, 'bill') : null,
      expense.hasItemPhoto ? expensePhotoSource(expense.id, 'item') : null,
    ]).then(([bill, item]) => {
      if (!cancelled) setSources({ bill, item });
    });
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
    { label: 'Date', value: formatDay(expense.date) },
    ...(expense.description ? [{ label: setup.noteLabel, value: expense.description }] : []),
    ...(isOwner ? [{ label: 'Entered by', value: expense.createdBy.name }] : []),
  ];

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={expense.itemName || expense.description || EXPENSE_CATEGORY_LABEL[cat]}
      subtitle={`${EXPENSE_CATEGORY_LABEL[cat]} · ${formatDay(expense.date)}`}
      footer={
        canVoid ? (
          <Button
            label="Void this expense"
            variant="danger"
            size="lg"
            onPress={() => onVoid(expense)}
          />
        ) : undefined
      }
    >
      <View style={styles.detailHead}>
        <View style={[styles.amountBadge, { backgroundColor: voided ? colors.surface : tone.bg }]}>
          <ExpenseCategoryIcon category={cat} size={22} color={voided ? colors.slate : tone.fg} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.detailAmount, voided && styles.strike]}>
            {formatRupees(expense.amount)}
          </Text>
          {qty ? <Text style={styles.detailMeta}>{qty}</Text> : null}
        </View>
        {voided ? (
          <View style={styles.voidChip}>
            <Text style={styles.voidChipText}>Voided</Text>
          </View>
        ) : null}
      </View>

      {voided ? (
        <View style={styles.voidBand}>
          <IconAlert size={14} color={colors.danger} />
          <Text style={styles.voidBandText}>
            Voided{expense.voidedBy ? ` by ${expense.voidedBy.name}` : ''}
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
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md + 4,
    overflow: 'hidden',
  },
  orbLarge: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255,255,255,0.12)',
    top: -80,
    right: -60,
  },
  orbSmall: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(94,234,212,0.18)',
    bottom: -40,
    left: -30,
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
  heroSplit: {
    flexDirection: 'row',
    marginTop: spacing.md + 4,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.45)',
  },
  heroCell: { flex: 1, gap: 2 },
  heroCellDivider: {
    paddingLeft: spacing.md,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(255,255,255,0.45)',
  },
  heroCellValue: { ...typography.heading, fontSize: 18, color: colors.white },
  heroCellLabel: {
    ...typography.caption,
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '700',
    letterSpacing: 0,
  },

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
  sectionMeta: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
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

  syncChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FEF3C7',
  },
  syncChipText: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '800',
    color: colors.amberDeep,
    letterSpacing: 0,
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

  emptyBox: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
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

  amountBlock: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xs },
  amountBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  rupee: { ...typography.display, color: colors.slate, fontSize: 36, marginRight: 4 },
  amountInput: {
    ...typography.display,
    color: colors.waterInk,
    fontSize: 48,
    minWidth: 70,
    textAlign: 'center',
    padding: 0,
    letterSpacing: -1,
  },
  amountLine: { width: 160, height: 2, borderRadius: 1 },
  quickRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  quickChip: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickText: { ...typography.label, fontSize: 13, color: colors.waterDeep },
  clearChip: { backgroundColor: colors.surface },
  clearText: { ...typography.label, fontSize: 13, color: colors.slateDeep },
  chipPressed: { backgroundColor: colors.surface, opacity: 0.85 },

  field: { gap: 8 },
  fieldLabel: { ...typography.caption, color: colors.slateDeep },
  fieldHint: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  catTile: {
    width: '31.5%',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 4,
    backgroundColor: colors.white,
  },
  catBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catLabel: { ...typography.label, color: colors.waterInk, fontSize: 12.5 },
  catLabelOn: { color: colors.white, fontWeight: '800' },
  catCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payRow: { flexDirection: 'row', gap: spacing.sm },
  payTile: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  payTileOn: { backgroundColor: colors.waterInk, borderColor: colors.waterInk },
  payLabel: { ...typography.bodyStrong, fontSize: 14, color: colors.waterInk },
  payLabelOn: { color: colors.white },
  payHint: { ...typography.caption, fontSize: 10.5, color: colors.slate, letterSpacing: 0 },
  payHintOn: { color: 'rgba(255,255,255,0.75)' },
  dayRow: { gap: spacing.sm, paddingRight: spacing.sm },
  dayTile: {
    width: 58,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  dayTileOn: { backgroundColor: colors.water, borderColor: colors.water },
  dayWeek: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    color: colors.slate,
    letterSpacing: 0,
  },
  dayNum: { ...typography.heading, fontSize: 18, color: colors.waterInk },
  dayTextOn: { color: colors.white },
  noteField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 50,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  noteFocus: { borderColor: colors.water, backgroundColor: colors.white },
  noteInput: { flex: 1, fontSize: 15.5, color: colors.waterInk, paddingVertical: 0 },
  ideaRow: { gap: 6, paddingRight: spacing.sm },
  ideaChip: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    justifyContent: 'center',
  },
  ideaText: {
    ...typography.caption,
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.slateDeep,
    letterSpacing: 0,
  },
  itemSection: {
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  qtyField: {
    width: 120,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 50,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm + 4,
  },
  qtyInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: colors.waterInk,
    paddingVertical: 0,
  },
  qtyUnit: { ...typography.label, fontSize: 13, color: colors.slateDeep },
  unitRow: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  unitChip: {
    minWidth: 44,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitText: { ...typography.label, fontSize: 13, color: colors.slateDeep },
  unitTextOn: { color: colors.white, fontWeight: '800' },
  rateLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rateLineText: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slateDeep,
    letterSpacing: 0,
  },
  rateStrong: { fontWeight: '800', color: colors.tealDeep },
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
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  stockRowOn: { borderColor: '#7DD3FC', backgroundColor: '#F0F9FF' },
  stockIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stockIconOn: { backgroundColor: colors.water },
  stockTitle: { ...typography.bodyStrong, fontSize: 14.5, color: colors.waterInk },
  stockHint: {
    ...typography.caption,
    fontSize: 12,
    color: colors.slateDeep,
    letterSpacing: 0,
    lineHeight: 16,
  },
  required: { color: colors.danger, fontWeight: '800' },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  proofCount: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '800',
    color: colors.amberDeep,
    letterSpacing: 0,
  },
  proofDone: { color: colors.tealDeep },
  slotRow: { flexDirection: 'row', gap: spacing.sm },
  slot: {
    flex: 1,
    height: 132,
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
  retakeRow: { flexDirection: 'row', gap: spacing.sm },
  retakeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 30,
  },
  retakeText: { ...typography.label, fontSize: 12.5, color: colors.waterDeep },
  whenValue: { ...typography.label, fontSize: 13, color: colors.waterDeep },
  calTile: {
    backgroundColor: colors.waterPale,
    borderColor: colors.waterPale,
    gap: 4,
    justifyContent: 'center',
  },
  calText: {
    ...typography.caption,
    fontSize: 10.5,
    fontWeight: '800',
    color: colors.waterDeep,
    letterSpacing: 0,
  },
  footMissing: {
    ...typography.caption,
    fontSize: 12,
    color: colors.amberDeep,
    textAlign: 'center',
    letterSpacing: 0,
    fontWeight: '700',
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
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
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
  footSummary: {
    ...typography.caption,
    fontSize: 12,
    color: colors.slate,
    textAlign: 'center',
    letterSpacing: 0,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sheetError: { ...typography.label, color: colors.danger, textTransform: 'none', flexShrink: 1 },
});
