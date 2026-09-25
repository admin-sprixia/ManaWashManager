import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, type ExpenseCategory } from '@mana/domain';
import { ScreenContainer } from '../components/ScreenContainer';
import { ScreenHeader } from '../components/ScreenHeader';
import { PeriodSelect, type PeriodKey } from '../components/PeriodSelect';
import { SectionLabel } from '../components/EdgeList';
import { BottomSheet } from '../components/BottomSheet';
import { ReasonSheet } from '../components/ReasonSheet';
import { Button } from '../components/Button';
import { showToast } from '../components/Toast';
import { IconCloudOff, IconPlus, IconReceipt } from '../components/Icons';
import { ExpenseCategoryIcon } from '../components/ExpenseCategoryIcon';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { useSync } from '../offline/SyncProvider';
import { newId } from '../utils/id';
import { formatRupees } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Expenses'>;

interface ExpenseItem {
  id: string;
  category: string;
  amount: number;
  description: string | null;
  date: string;
  createdAt: string;
  createdByUserId: string;
  createdBy: { id: string; name: string };
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: { id: string; name: string } | null;
}

const CATEGORY_TONE: Record<ExpenseCategory, { fg: string; bg: string }> = {
  chemicals: { fg: '#0369A1', bg: '#E0F2FE' },
  labour: { fg: '#5B21B6', bg: '#EDE9FE' },
  electricity: { fg: '#B45309', bg: '#FEF3C7' },
  water: { fg: '#0E7490', bg: '#CFFAFE' },
  maintenance: { fg: '#9D174D', bg: '#FCE7F3' },
  other: { fg: '#475569', bg: '#F1F5F9' },
};

const VOID_EXPENSE_REASONS = ['Entered twice', 'Wrong amount', 'Not a shop expense', 'Refunded / returned'];

function asCategory(value: string): ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value) ? (value as ExpenseCategory) : 'other';
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatDay(iso: string): string {
  if (iso === isoDaysAgo(0)) return 'Today';
  if (iso === isoDaysAgo(1)) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function ExpensesScreen({ navigation }: Props) {
  const { user, isOwner } = useAuth();
  const { myItems, submit, version } = useSync();
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [items, setItems] = useState<ExpenseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [byCategory, setByCategory] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<ExpenseItem | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.expenses.$get({ query: { range: period } });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t load expenses.'));
      const body = await res.json();
      if ('items' in body) {
        setItems(body.items as unknown as ExpenseItem[]);
        setTotal(body.total);
        setByCategory(body.byCategory);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof NetworkError ? 'Offline — new entries still save on this phone.' : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load, version]);

  const pending = useMemo(
    () =>
      myItems.flatMap((i) =>
        i.op.kind === 'expense.create' && !items.some((e) => e.id === (i.op.payload as { id: string }).id)
          ? [{ item: i, payload: i.op.payload }]
          : [],
      ),
    [myItems, items],
  );

  const categories = EXPENSE_CATEGORIES.filter((c) => (byCategory[c] ?? 0) > 0).sort(
    (a, b) => (byCategory[b] ?? 0) - (byCategory[a] ?? 0),
  );

  const canVoid = (e: ExpenseItem) => {
    if (e.voidedAt) return false;
    if (isOwner) return true;
    return e.createdByUserId === user?.id && e.date === isoDaysAgo(0);
  };

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
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.water}
            colors={[colors.water]}
          />
        }
      >
        <View style={styles.periodWrap}>
          <PeriodSelect value={period} onChange={setPeriod} />
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroLabel}>{isOwner ? 'Shop spending' : 'You logged'}</Text>
          <Text style={styles.heroValue}>{formatRupees(total)}</Text>
          {categories.length > 0 ? (
            <>
              <View style={styles.stack}>
                {categories.map((c) => (
                  <View key={c} style={{ flex: byCategory[c] ?? 0, backgroundColor: CATEGORY_TONE[c].fg }} />
                ))}
              </View>
              <View style={styles.legend}>
                {categories.map((c) => (
                  <View key={c} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: CATEGORY_TONE[c].fg }]} />
                    <Text style={styles.legendText}>
                      {EXPENSE_CATEGORY_LABEL[c]} <Text style={styles.legendAmount}>{formatRupees(byCategory[c] ?? 0)}</Text>
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </View>

        {error ? (
          <View style={styles.notice}>
            <IconCloudOff size={15} color={colors.amberDeep} />
            <Text style={styles.noticeText}>{error}</Text>
          </View>
        ) : null}

        {pending.length > 0 ? (
          <>
            <SectionLabel>Waiting to sync</SectionLabel>
            <View style={styles.list}>
              {pending.map(({ item, payload }, i) => {
                const cat = asCategory(payload.category);
                return (
                  <View key={item.id} style={[styles.row, i < pending.length - 1 && styles.divider]}>
                    <View style={[styles.catIcon, { backgroundColor: CATEGORY_TONE[cat].bg }]}>
                      <ExpenseCategoryIcon category={cat} size={20} color={CATEGORY_TONE[cat].fg} />
                    </View>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {payload.description || EXPENSE_CATEGORY_LABEL[cat]}
                      </Text>
                      <Text style={[styles.rowMeta, item.state === 'failed' && styles.failedText]}>
                        {item.state === 'failed' ? item.error ?? 'Couldn’t sync' : 'Saved on this phone'}
                      </Text>
                    </View>
                    <Text style={styles.rowAmount}>{formatRupees(payload.amount)}</Text>
                  </View>
                );
              })}
            </View>
          </>
        ) : null}

        <SectionLabel>{isOwner ? 'All entries' : 'Your entries'}</SectionLabel>
        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.water} />
        ) : items.length === 0 ? (
          <View style={styles.emptyBox}>
            <View style={styles.emptyIcon}>
              <IconReceipt size={26} color={colors.water} />
            </View>
            <Text style={styles.emptyTitle}>No expenses in this period</Text>
            <Text style={styles.emptyBody}>Bought chemicals or paid a bill? Tap Add to log it.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {items.map((e, i) => {
              const cat = asCategory(e.category);
              const voided = Boolean(e.voidedAt);
              const allowed = canVoid(e);
              return (
                <Pressable
                  key={e.id}
                  onPress={allowed ? () => setVoiding(e) : undefined}
                  disabled={!allowed}
                  android_ripple={allowed ? { color: colors.waterPale } : undefined}
                  style={({ pressed }) => [styles.row, i < items.length - 1 && styles.divider, pressed && styles.pressedRow]}
                >
                  <View style={[styles.catIcon, { backgroundColor: voided ? '#F1F5F9' : CATEGORY_TONE[cat].bg }]}>
                    <ExpenseCategoryIcon category={cat} size={20} color={voided ? colors.slate : CATEGORY_TONE[cat].fg} />
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={[styles.rowTitle, voided && styles.strike]} numberOfLines={1}>
                      {e.description || EXPENSE_CATEGORY_LABEL[cat]}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {EXPENSE_CATEGORY_LABEL[cat]} · {formatDay(e.date)}
                      {isOwner ? ` · ${e.createdBy.name}` : ''}
                    </Text>
                    {voided ? (
                      <Text style={styles.voidLine} numberOfLines={2}>
                        Voided{e.voidedBy ? ` by ${e.voidedBy.name}` : ''}
                        {e.voidReason ? ` — “${e.voidReason}”` : ''}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.rowAmount, voided && styles.strike]}>{formatRupees(e.amount)}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {items.some(canVoid) ? <Text style={styles.footnote}>Tap an entry to void it with a reason.</Text> : null}
      </ScrollView>

      <AddExpenseSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onSave={async (payload) => {
          const result = await submit({ kind: 'expense.create', payload: { id: newId(), ...payload } });
          if (result.status === 'rejected') return result.message;
          setAdding(false);
          showToast(
            result.status === 'queued' ? 'Expense saved offline — will sync automatically' : 'Expense added',
            result.status === 'queued' ? 'offline' : 'success',
          );
          if (result.status === 'sent') void load();
          return null;
        }}
      />

      <ReasonSheet
        visible={voiding != null}
        title="Void this expense?"
        subtitle={voiding ? `${voiding.description || EXPENSE_CATEGORY_LABEL[asCategory(voiding.category)]} · ${formatRupees(voiding.amount)}` : ''}
        confirmLabel="Void expense"
        quickReasons={VOID_EXPENSE_REASONS}
        onClose={() => setVoiding(null)}
        onConfirm={async (reason) => {
          if (!voiding) return null;
          try {
            const res = await api.expenses[':id'].void.$post({ param: { id: voiding.id }, json: { reason } });
            if (!res.ok) return apiErrorMessage(res, 'Couldn’t void this expense.');
            setVoiding(null);
            showToast('Expense voided');
            await load();
            return null;
          } catch (e) {
            return e instanceof NetworkError ? 'Voiding needs a connection.' : 'Couldn’t void this expense.';
          }
        }}
      />
    </ScreenContainer>
  );
}

function AddExpenseSheet({
  visible,
  onClose,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (p: { category: ExpenseCategory; amount: number; description?: string; date: string }) => Promise<string | null>;
}) {
  const [category, setCategory] = useState<ExpenseCategory>('chemicals');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [daysAgo, setDaysAgo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setCategory('chemicals');
      setAmount('');
      setNote('');
      setDaysAgo(0);
      setError(null);
      setBusy(false);
    }
  }, [visible]);

  const rupees = Number(amount.replace(/,/g, ''));
  const paise = Number.isFinite(rupees) ? Math.round(rupees * 100) : 0;
  const valid = paise > 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    const message = await onSave({
      category,
      amount: paise,
      description: note.trim() || undefined,
      date: isoDaysAgo(daysAgo),
    });
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title="Add expense"
      subtitle="Saved against your name for the owner’s records."
      footer={
        <Button
          label={valid ? `Save ${formatRupees(paise)}` : 'Save expense'}
          size="lg"
          loading={busy}
          disabled={!valid}
          onPress={() => void save()}
        />
      }
    >
      <View style={styles.amountField}>
        <Text style={styles.rupee}>₹</Text>
        <TextInput
          style={styles.amountInput}
          value={amount}
          onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))}
          placeholder="0"
          placeholderTextColor={colors.slate}
          keyboardType="decimal-pad"
          autoFocus
          maxLength={9}
        />
      </View>

      <View style={styles.catGrid}>
        {EXPENSE_CATEGORIES.map((c) => {
          const on = category === c;
          const tone = CATEGORY_TONE[c];
          return (
            <Pressable
              key={c}
              onPress={() => setCategory(c)}
              style={({ pressed }) => [
                styles.catTile,
                on && { borderColor: tone.fg, backgroundColor: tone.bg },
                pressed && styles.pressed,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <View style={[styles.catBadge, { backgroundColor: on ? colors.white : tone.bg }]}>
                <ExpenseCategoryIcon category={c} size={20} color={tone.fg} />
              </View>
              <Text style={[styles.catLabel, on && { color: tone.fg }]}>{EXPENSE_CATEGORY_LABEL[c]}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Note (optional)</Text>
        <TextInput
          style={styles.input}
          value={note}
          onChangeText={setNote}
          placeholder="e.g. 5L foam shampoo from Ravi Traders"
          placeholderTextColor={colors.slate}
          maxLength={200}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>When</Text>
        <View style={styles.daySegment}>
          {['Today', 'Yesterday', '2 days ago'].map((label, i) => {
            const on = daysAgo === i;
            return (
              <Pressable
                key={label}
                onPress={() => setDaysAgo(i)}
                style={[styles.dayBtn, on && styles.dayBtnOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.dayText, on && styles.dayTextOn]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {error ? <Text style={styles.sheetError}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl },
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
    paddingVertical: spacing.sm,
    ...shadow('sm'),
  },
  addBtnText: { ...typography.label, color: colors.white },
  periodWrap: { marginTop: spacing.md },
  hero: {
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 2,
    gap: spacing.sm,
  },
  heroLabel: { ...typography.caption, color: colors.slateDeep, textTransform: 'uppercase', letterSpacing: 0.8 },
  heroValue: { ...typography.display, color: colors.waterInk, fontSize: 32 },
  stack: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0, fontSize: 13 },
  legendAmount: { fontWeight: '700', color: colors.waterInk },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.amberLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  noticeText: { ...typography.caption, color: colors.amberDeep, flex: 1, letterSpacing: 0, fontSize: 13 },
  list: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
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
  catIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  rowMeta: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  failedText: { color: colors.danger },
  voidLine: { ...typography.caption, color: colors.danger, letterSpacing: 0 },
  rowAmount: { ...typography.bodyStrong, color: colors.waterInk },
  strike: { textDecorationLine: 'line-through', color: colors.slate },
  emptyBox: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { ...typography.bodyStrong, color: colors.waterInk },
  emptyBody: { ...typography.body, color: colors.slateDeep, textAlign: 'center', fontSize: 14 },
  footnote: { ...typography.caption, color: colors.slate, textAlign: 'center', marginTop: spacing.md, letterSpacing: 0 },
  amountField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
  },
  rupee: { ...typography.display, color: colors.slate, fontSize: 34, marginRight: 4 },
  amountInput: { ...typography.display, color: colors.waterInk, fontSize: 40, minWidth: 80, textAlign: 'center', padding: 0 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  catTile: {
    width: '31.5%',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 4,
    backgroundColor: colors.white,
  },
  catBadge: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  catLabel: { ...typography.label, color: colors.waterInk, fontSize: 12 },
  field: { gap: 6 },
  fieldLabel: { ...typography.caption, color: colors.slateDeep },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    fontSize: 16,
    color: colors.waterInk,
    backgroundColor: colors.surface,
  },
  daySegment: { flexDirection: 'row', backgroundColor: colors.waterPale, borderRadius: radius.md, padding: 4, gap: 4 },
  dayBtn: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm + 2, borderRadius: radius.sm },
  dayBtnOn: { backgroundColor: colors.white, ...shadow('sm') },
  dayText: { ...typography.label, color: colors.slateDeep },
  dayTextOn: { color: colors.waterDeep },
  sheetError: { ...typography.label, color: colors.danger, textTransform: 'none' },
});
