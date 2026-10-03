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
import LinearGradient from 'react-native-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  EXPENSE_UNIT_LABEL,
  STOCK_SUGGESTIONS,
  STOCK_UNITS,
  STOCK_UNIT_LABEL,
  entryUnitsFor,
  formatStock,
  roundStock,
  stockKey,
  stockLevel,
  toStockQuantity,
  type ExpenseUnit,
  type StockLevel,
  type StockUnit,
} from '@mana/domain';
import { ScreenContainer } from '../components/ScreenContainer';
import { ScreenHeader } from '../components/ScreenHeader';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { showToast } from '../components/Toast';
import { showAlert } from '../components/AppAlert';
import {
  IconAlert,
  IconBox,
  IconCheck,
  IconCloudOff,
  IconEdit,
  IconMinus,
  IconPlus,
  IconTrash,
} from '../components/Icons';
import { colors, gradients, radius, spacing, typography } from '../theme';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { useSync } from '../offline/SyncProvider';
import { useShop, type StockItemView } from '../offline/ShopProvider';
import { newId } from '../utils/id';
import { formatDateTime } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Inventory'>;

type MoveKind = 'use' | 'in' | 'count';

const LEVEL_TONE: Record<StockLevel, { fg: string; bg: string; bar: string; label: string }> = {
  out: { fg: colors.danger, bg: '#FEE2E2', bar: colors.danger, label: 'Out' },
  low: { fg: colors.amberDeep, bg: '#FEF3C7', bar: colors.amber, label: 'Low' },
  ok: { fg: colors.tealDeep, bg: '#CCFBF1', bar: colors.teal, label: 'OK' },
};

const MOVE_COPY: Record<
  MoveKind,
  { tab: string; title: string; question: string; button: string }
> = {
  use: {
    tab: 'Used',
    title: 'Log what was used',
    question: 'How much was used?',
    button: 'Save — used',
  },
  in: { tab: 'Added', title: 'Add stock', question: 'How much was added?', button: 'Save — added' },
  count: {
    tab: 'Count',
    title: 'Count the shelf',
    question: 'How much is on the shelf right now?',
    button: 'Save count',
  },
};

const QUICK_USE: Record<StockUnit, [number, ExpenseUnit][]> = {
  l: [
    [100, 'ml'],
    [250, 'ml'],
    [500, 'ml'],
    [1, 'l'],
  ],
  kg: [
    [100, 'g'],
    [250, 'g'],
    [500, 'g'],
    [1, 'kg'],
  ],
  pcs: [
    [1, 'pcs'],
    [2, 'pcs'],
    [5, 'pcs'],
    [10, 'pcs'],
  ],
};

function parseAmount(text: string): number | null {
  const n = Number(text.replace(/,/g, '').trim());
  return text.trim() && Number.isFinite(n) && n >= 0 ? n : null;
}

/** How full the bar looks: the alert level sits at a third, so "low" reads low at a glance. */
function fillRatio(balance: number, lowAt: number | null): { fill: number; mark: number | null } {
  const scale = Math.max(lowAt ? lowAt * 3 : 0, balance, 0.0001);
  return { fill: Math.max(0, Math.min(1, balance / scale)), mark: lowAt ? lowAt / scale : null };
}

/** L, kg or pcs — the unit stock is kept in, offered for counts and alert levels. */
function bigUnit(unit: StockUnit): ExpenseUnit {
  const units = entryUnitsFor(unit);
  return units[units.length - 1]!;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function InventoryScreen({ navigation }: Props) {
  const { isOwner } = useAuth();
  const { online } = useSync();
  const { stock, lowStock, refreshStock } = useShop();
  const [loading, setLoading] = useState(stock.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [moving, setMoving] = useState<{ item: StockItemView; kind: MoveKind } | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [form, setForm] = useState<{ item: StockItemView | null; name?: string } | null>(null);

  useEffect(() => {
    void refreshStock().finally(() => setLoading(false));
  }, [refreshStock]);

  const sorted = useMemo(() => {
    const rank: Record<StockLevel, number> = { out: 0, low: 1, ok: 2 };
    return [...stock].sort((a, b) => rank[a.level] - rank[b.level] || a.name.localeCompare(b.name));
  }, [stock]);
  const needs = sorted.filter((s) => s.level !== 'ok');
  const fine = sorted.filter((s) => s.level === 'ok');
  const outCount = stock.filter((s) => s.level === 'out').length;
  const usedItems = stock.filter((s) => s.usedWeek > 0).length;
  const noAlert = stock.filter((s) => s.lowAt == null).length;
  const viewing = viewingId ? (stock.find((s) => s.id === viewingId) ?? null) : null;

  const renderRow = (item: StockItemView, i: number) => {
    const tone = LEVEL_TONE[item.level];
    const { fill, mark } = fillRatio(item.balance, item.lowAt);
    return (
      <Pressable
        key={item.id}
        onPress={() => setViewingId(item.id)}
        style={({ pressed }) => [
          styles.row,
          i > 0 && styles.rowDivider,
          pressed && styles.pressedRow,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${formatStock(item.balance, item.unit)} left`}
      >
        <View style={[styles.rowIcon, { backgroundColor: tone.bg }]}>
          <IconBox size={19} color={tone.fg} />
        </View>
        <View style={styles.rowCopy}>
          <View style={styles.rowTop}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.name}
            </Text>
            <Text
              style={[
                styles.rowBalance,
                { color: item.level === 'ok' ? colors.waterInk : tone.fg },
              ]}
            >
              {formatStock(item.balance, item.unit)}
            </Text>
          </View>
          <View style={styles.track}>
            <View
              style={[styles.trackFill, { width: `${fill * 100}%`, backgroundColor: tone.bar }]}
            />
            {mark != null ? <View style={[styles.trackMark, { left: `${mark * 100}%` }]} /> : null}
          </View>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {item.pending ? <Text style={styles.pendingText}>Not synced · </Text> : null}
            {item.level !== 'ok' ? (
              <Text style={{ color: tone.fg, fontWeight: '800' }}>{tone.label} · </Text>
            ) : null}
            {item.lowAt != null ? `Alert at ${formatStock(item.lowAt, item.unit)}` : 'No alert set'}
            {item.usedWeek > 0 ? ` · used ${formatStock(item.usedWeek, item.unit)} this week` : ''}
          </Text>
          {item.giftsOwed > 0 ? (
            <Text style={styles.giftWaiting} numberOfLines={1}>
              {plural(item.giftsOwed, 'customer')} waiting for {formatStock(item.giftsOwedQuantity, item.unit)} as a
              welcome gift
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => setMoving({ item, kind: 'use' })}
          hitSlop={8}
          style={({ pressed }) => [styles.useBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Log ${item.name} used`}
        >
          <IconMinus size={14} color={colors.waterDeep} />
          <Text style={styles.useBtnText}>Use</Text>
        </Pressable>
      </Pressable>
    );
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader
          title="Inventory"
          onBack={() => navigation.goBack()}
          right={
            isOwner ? (
              <Pressable
                onPress={() => setForm({ item: null })}
                style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Add stock item"
              >
                <IconPlus size={16} color={colors.white} />
                <Text style={styles.addBtnText}>Item</Text>
              </Pressable>
            ) : undefined
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
              void refreshStock().finally(() => setRefreshing(false));
            }}
            tintColor={colors.water}
            colors={[colors.water]}
          />
        }
      >
        <LinearGradient
          colors={(lowStock > 0 ? ['#F59E0B', '#D97706'] : gradients.hero) as unknown as string[]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.hero}
        >
          <View pointerEvents="none" style={styles.orbLarge} />
          <View pointerEvents="none" style={styles.orbSmall} />
          <Text style={styles.heroEyebrow}>Stock on the shelf</Text>
          <Text style={styles.heroValue}>
            {stock.length === 0
              ? 'Nothing yet'
              : lowStock > 0
                ? `${lowStock} running low`
                : 'All stocked up'}
          </Text>
          <Text style={styles.heroMeta}>
            {stock.length === 0
              ? 'Track shampoo, wax, cloths, bill books…'
              : lowStock > 0
                ? 'Buy these soon so the shop never runs out'
                : `${plural(stock.length, 'item')} above their alert level`}
          </Text>
          <View style={styles.heroSplit}>
            <View style={styles.heroCell}>
              <Text style={styles.heroCellValue}>{stock.length}</Text>
              <Text style={styles.heroCellLabel}>Items</Text>
            </View>
            <View style={[styles.heroCell, styles.heroCellDivider]}>
              <Text style={styles.heroCellValue}>{outCount}</Text>
              <Text style={styles.heroCellLabel}>Out of stock</Text>
            </View>
            <View style={[styles.heroCell, styles.heroCellDivider]}>
              <Text style={styles.heroCellValue}>{usedItems}</Text>
              <Text style={styles.heroCellLabel}>Used this week</Text>
            </View>
          </View>
        </LinearGradient>

        {!online ? (
          <View style={styles.notice}>
            <IconCloudOff size={15} color={colors.amberDeep} />
            <Text style={styles.noticeText}>
              Offline — what you log saves on this phone and syncs later.
            </Text>
          </View>
        ) : null}

        {loading && stock.length === 0 ? (
          <ActivityIndicator style={styles.loader} color={colors.water} />
        ) : stock.length === 0 ? (
          <View style={styles.emptyBox}>
            <View style={styles.emptyIcon}>
              <IconBox size={30} color={colors.waterDeep} />
            </View>
            <Text style={styles.emptyTitle}>Start tracking stock</Text>
            <Text style={styles.emptyBody}>
              {isOwner
                ? 'Add what the shop keeps on the shelf and set an alert level. Purchases from Expenses add to it; staff log what they use.'
                : 'The owner hasn’t added any stock items yet. Ask them to set it up.'}
            </Text>
            {isOwner ? (
              <View style={styles.ideaWrap}>
                {STOCK_SUGGESTIONS.map((s) => (
                  <Pressable
                    key={s.name}
                    onPress={() => setForm({ item: null, name: s.name })}
                    style={({ pressed }) => [styles.ideaChip, pressed && styles.pressed]}
                  >
                    <IconPlus size={12} color={colors.waterDeep} />
                    <Text style={styles.ideaText}>{s.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : (
          <>
            {needs.length > 0 ? (
              <View>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Buy soon</Text>
                  <Text style={styles.sectionMeta}>{plural(needs.length, 'item')}</Text>
                </View>
                <View style={[styles.band, styles.bandWarn]}>{needs.map(renderRow)}</View>
              </View>
            ) : null}
            {fine.length > 0 ? (
              <View>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>In stock</Text>
                  <Text style={styles.sectionMeta}>{plural(fine.length, 'item')}</Text>
                </View>
                <View style={styles.band}>{fine.map(renderRow)}</View>
              </View>
            ) : null}
            {isOwner && noAlert > 0 ? (
              <Pressable
                onPress={() => {
                  const first = stock.find((s) => s.lowAt == null);
                  if (first) setForm({ item: first });
                }}
                style={({ pressed }) => [styles.tipBand, pressed && styles.pressedRow]}
              >
                <IconAlert size={16} color={colors.waterDeep} />
                <Text style={styles.tipText}>
                  {plural(noAlert, 'item')} {noAlert === 1 ? 'has' : 'have'} no alert level. Set one
                  so you’re warned before it runs out.
                </Text>
              </Pressable>
            ) : null}
            <Text style={styles.footnote}>
              Buying: save an expense with “Add to stock” on — it adds to the item with the same
              name. Using: tap Use.
              {isOwner
                ? ' Counting: open an item and tap Count to fix the balance to what’s really there.'
                : ''}
            </Text>
          </>
        )}
      </ScrollView>

      <MoveSheet
        target={moving}
        isOwner={isOwner}
        onClose={() => setMoving(null)}
        onDone={() => {
          setMoving(null);
          void refreshStock();
        }}
      />

      <ItemSheet
        item={viewing}
        isOwner={isOwner}
        onClose={() => setViewingId(null)}
        onMove={(kind) => {
          if (!viewing) return;
          setViewingId(null);
          setMoving({ item: viewing, kind });
        }}
        onEdit={() => {
          if (!viewing) return;
          setViewingId(null);
          setForm({ item: viewing });
        }}
        onRemoved={() => {
          setViewingId(null);
          void refreshStock();
        }}
      />

      <ItemFormSheet
        target={form}
        existing={stock}
        onClose={() => setForm(null)}
        onSaved={() => {
          setForm(null);
          void refreshStock();
        }}
      />
    </ScreenContainer>
  );
}

function UnitChips({
  units,
  value,
  onChange,
}: {
  units: ExpenseUnit[];
  value: ExpenseUnit;
  onChange: (u: ExpenseUnit) => void;
}) {
  if (units.length < 2) {
    return <Text style={styles.unitSolo}>{EXPENSE_UNIT_LABEL[value]}</Text>;
  }
  return (
    <View style={styles.unitRow}>
      {units.map((u) => {
        const on = u === value;
        return (
          <Pressable
            key={u}
            onPress={() => onChange(u)}
            style={[styles.unitChip, on && styles.unitChipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.unitText, on && styles.unitTextOn]}>{EXPENSE_UNIT_LABEL[u]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Used / Added / Count for one item. Queued offline like every other entry. */
function MoveSheet({
  target,
  isOwner,
  onClose,
  onDone,
}: {
  target: { item: StockItemView; kind: MoveKind } | null;
  isOwner: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { submit } = useSync();
  const item = target?.item ?? null;
  const [kind, setKind] = useState<MoveKind>('use');
  const [text, setText] = useState('');
  const [unit, setUnit] = useState<ExpenseUnit>('ml');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickKind = useCallback(
    (k: MoveKind) => {
      setKind(k);
      setText('');
      setError(null);
      if (item) setUnit(k === 'use' ? entryUnitsFor(item.unit)[0]! : bigUnit(item.unit));
    },
    [item],
  );

  useEffect(() => {
    if (!target) return;
    setNote('');
    setSaving(false);
    pickKind(target.kind);
  }, [target, pickKind]);

  if (!item) return <BottomSheet visible={false} onClose={onClose} title="" />;

  const amount = parseAmount(text);
  const q = amount != null ? toStockQuantity(amount, unit, item.unit) : null;
  const after =
    q == null
      ? null
      : roundStock(kind === 'use' ? Math.max(0, item.balance - q) : kind === 'in' ? item.balance + q : q);
  const afterLevel = after == null ? null : stockLevel(after, item.lowAt);
  const valid = q != null && (kind === 'count' ? q >= 0 : q > 0);
  const kinds: MoveKind[] = isOwner ? ['use', 'in', 'count'] : ['use'];

  const save = async () => {
    if (!valid || amount == null) return;
    setSaving(true);
    setError(null);
    const result = await submit({
      kind: 'stock.move',
      payload: {
        id: newId(),
        itemId: item.id,
        kind,
        quantity: amount,
        unit,
        note: note.trim() || undefined,
      },
      meta: { itemName: item.name },
    });
    setSaving(false);
    if (result.status === 'rejected') {
      setError(result.message);
      return;
    }
    showToast(
      result.status === 'queued'
        ? 'Saved on this phone — syncs when online'
        : `${item.name}: ${formatStock(after ?? 0, item.unit)} left`,
    );
    onDone();
  };

  return (
    <BottomSheet
      visible={target != null}
      onClose={onClose}
      title={MOVE_COPY[kind].title}
      subtitle={`${item.name} · ${formatStock(item.balance, item.unit)} now`}
      dismissable={!saving}
      footer={
        <Button
          label={valid ? MOVE_COPY[kind].button : 'Enter an amount'}
          onPress={() => void save()}
          disabled={!valid}
          loading={saving}
        />
      }
    >
      {kinds.length > 1 ? (
        <View style={styles.segment}>
          {kinds.map((k) => {
            const on = k === kind;
            return (
              <Pressable
                key={k}
                onPress={() => pickKind(k)}
                style={[styles.segmentBtn, on && styles.segmentBtnOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                  {MOVE_COPY[k].tab}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Text style={styles.fieldLabel}>{MOVE_COPY[kind].question}</Text>
      <View style={styles.qtyRow}>
        <TextInput
          style={styles.qtyInput}
          value={text}
          onChangeText={(t) => setText(t.replace(/[^0-9.]/g, ''))}
          placeholder="0"
          placeholderTextColor={colors.slate}
          keyboardType="decimal-pad"
          autoFocus
          maxLength={8}
        />
        <UnitChips units={entryUnitsFor(item.unit)} value={unit} onChange={setUnit} />
      </View>

      {kind === 'use' ? (
        <View style={styles.quickRow}>
          {QUICK_USE[item.unit].map(([n, u]) => (
            <Pressable
              key={`${n}${u}`}
              onPress={() => {
                setUnit(u);
                setText(String(n));
              }}
              style={({ pressed }) => [styles.quickChip, pressed && styles.pressed]}
            >
              <Text style={styles.quickText}>
                {n} {EXPENSE_UNIT_LABEL[u]}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {after != null && afterLevel ? (
        <View style={[styles.preview, { backgroundColor: LEVEL_TONE[afterLevel].bg }]}>
          <Text style={styles.previewLabel}>Balance</Text>
          <Text style={styles.previewValue}>
            {formatStock(item.balance, item.unit)} → {formatStock(after, item.unit)}
          </Text>
          {afterLevel !== 'ok' ? (
            <Text style={[styles.previewWarn, { color: LEVEL_TONE[afterLevel].fg }]}>
              {afterLevel === 'out'
                ? kind === 'use' && q != null && q > item.balance
                  ? 'More than the books show. It’ll show empty — do a count if this is right.'
                  : 'This empties it. Buy more soon.'
                : `Under the alert level (${formatStock(item.lowAt ?? 0, item.unit)}). Buy more soon.`}
            </Text>
          ) : null}
          {kind === 'count' && q != null ? (
            <Text style={styles.previewNote}>
              {q === item.balance
                ? 'Matches the books.'
                : `${q > item.balance ? 'More' : 'Less'} than the books by ${formatStock(Math.abs(q - item.balance), item.unit)}.`}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.noteWrap}>
        <Text style={styles.fieldLabel}>Note (optional)</Text>
        <TextInput
          style={styles.noteInput}
          value={note}
          onChangeText={setNote}
          placeholder={
            kind === 'use'
              ? 'e.g. Foam wash, bay 2'
              : kind === 'count'
                ? 'e.g. Weekly count'
                : 'e.g. From the old stock'
          }
          placeholderTextColor={colors.slate}
          maxLength={120}
        />
      </View>

      {error ? (
        <View style={styles.errorRow}>
          <IconAlert size={15} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

interface MoveRow {
  id: string;
  kind: string;
  quantity: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
}

const MOVE_LABEL: Record<string, string> = {
  in: 'Bought / added',
  use: 'Used',
  count: 'Counted',
  void: 'Expense voided',
};

/** One item: balance, alert level, recent history, and the owner's actions. */
function ItemSheet({
  item,
  isOwner,
  onClose,
  onMove,
  onEdit,
  onRemoved,
}: {
  item: StockItemView | null;
  isOwner: boolean;
  onClose: () => void;
  onMove: (kind: MoveKind) => void;
  onEdit: () => void;
  onRemoved: () => void;
}) {
  const [moves, setMoves] = useState<MoveRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const itemId = item?.id ?? null;

  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    setMoves(null);
    setError(null);
    void (async () => {
      try {
        const res = await api.stock[':id'].moves.$get({ param: { id: itemId } });
        if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t load the history.'));
        const body = await res.json();
        if (!cancelled && 'moves' in body) setMoves(body.moves as unknown as MoveRow[]);
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof NetworkError ? 'History needs a connection.' : (e as Error).message,
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (!item) return <BottomSheet visible={false} onClose={onClose} title="" />;
  const tone = LEVEL_TONE[item.level];
  const { fill, mark } = fillRatio(item.balance, item.lowAt);

  const remove = () =>
    showAlert(
      `Remove ${item.name}?`,
      'It leaves the stock list. Its history is kept, and purchases with this name will start a new item.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                const res = await api.stock[':id'].$delete({ param: { id: item.id } });
                if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t remove it.'));
                showToast(`${item.name} removed`);
                onRemoved();
              } catch (e) {
                showToast(
                  e instanceof NetworkError ? 'Removing needs a connection.' : (e as Error).message,
                );
              }
            })();
          },
        },
      ],
      { icon: <IconTrash size={26} color={colors.danger} /> },
    );

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={item.name}
      subtitle={STOCK_UNIT_LABEL[item.unit]}
      footer={
        <View style={styles.footerRow}>
          <View style={styles.flex}>
            <Button
              label="Used"
              variant="secondary"
              icon={<IconMinus size={16} color={colors.waterDeep} />}
              onPress={() => onMove('use')}
            />
          </View>
          {isOwner ? (
            <>
              <View style={styles.flex}>
                <Button
                  label="Add"
                  variant="secondary"
                  icon={<IconPlus size={16} color={colors.waterDeep} />}
                  onPress={() => onMove('in')}
                />
              </View>
              <View style={styles.flex}>
                <Button
                  label="Count"
                  icon={<IconCheck size={16} color={colors.white} />}
                  onPress={() => onMove('count')}
                />
              </View>
            </>
          ) : null}
        </View>
      }
    >
      <View style={styles.detailHead}>
        <View style={styles.flex}>
          <Text style={styles.detailBalance}>{formatStock(item.balance, item.unit)}</Text>
          <Text style={styles.detailMeta}>
            on the shelf{item.pending ? ' · not synced yet' : ''}
          </Text>
        </View>
        <View style={[styles.levelChip, { backgroundColor: tone.bg }]}>
          <Text style={[styles.levelChipText, { color: tone.fg }]}>
            {item.level === 'ok' ? 'In stock' : tone.label}
          </Text>
        </View>
      </View>
      <View style={styles.trackLg}>
        <View style={[styles.trackFill, { width: `${fill * 100}%`, backgroundColor: tone.bar }]} />
        {mark != null ? <View style={[styles.trackMark, { left: `${mark * 100}%` }]} /> : null}
      </View>

      <View style={styles.detailRows}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Alert at</Text>
          <Text style={styles.detailValue}>
            {item.lowAt != null ? formatStock(item.lowAt, item.unit) : 'Not set'}
          </Text>
        </View>
        <View style={[styles.detailRow, styles.rowDivider]}>
          <Text style={styles.detailLabel}>Used in the last 7 days</Text>
          <Text style={styles.detailValue}>{formatStock(item.usedWeek, item.unit)}</Text>
        </View>
        {item.usedWeek > 0 && item.balance > 0 ? (
          <View style={[styles.detailRow, styles.rowDivider]}>
            <Text style={styles.detailLabel}>Lasts about</Text>
            <Text style={styles.detailValue}>
              {plural(Math.max(1, Math.floor(item.balance / (item.usedWeek / 7))), 'more day')}
            </Text>
          </View>
        ) : null}
      </View>

      {isOwner ? (
        <View style={styles.ownerRow}>
          <Pressable
            onPress={onEdit}
            style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <IconEdit size={15} color={colors.waterDeep} />
            <Text style={styles.linkText}>Edit name / alert</Text>
          </Pressable>
          <Pressable
            onPress={remove}
            style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <IconTrash size={15} color={colors.danger} />
            <Text style={[styles.linkText, { color: colors.danger }]}>Remove</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.historyTitle}>History</Text>
      {error ? (
        <Text style={styles.historyEmpty}>{error}</Text>
      ) : moves == null ? (
        <ActivityIndicator color={colors.water} />
      ) : moves.length === 0 ? (
        <Text style={styles.historyEmpty}>Nothing logged yet.</Text>
      ) : (
        <View style={styles.history}>
          {moves.map((m, i) => {
            const up = m.quantity >= 0;
            return (
              <View key={m.id} style={[styles.historyRow, i > 0 && styles.rowDivider]}>
                <View style={styles.flex}>
                  <Text style={styles.historyKind}>{MOVE_LABEL[m.kind] ?? m.kind}</Text>
                  <Text style={styles.historyMeta} numberOfLines={1}>
                    {m.createdBy.name} · {formatDateTime(m.createdAt)}
                    {m.note ? ` · ${m.note}` : ''}
                  </Text>
                </View>
                <View style={styles.historyRight}>
                  <Text
                    style={[styles.historyQty, { color: up ? colors.tealDeep : colors.waterInk }]}
                  >
                    {up ? '+' : '−'}
                    {formatStock(Math.abs(m.quantity), item.unit)}
                  </Text>
                  <Text style={styles.historyAfter}>
                    → {formatStock(m.balanceAfter, item.unit)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </BottomSheet>
  );
}

/** Owner: add a new item (name, unit, what's on the shelf, alert level) or edit one. */
function ItemFormSheet({
  target,
  existing,
  onClose,
  onSaved,
}: {
  target: { item: StockItemView | null; name?: string } | null;
  existing: StockItemView[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = target?.item ?? null;
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<StockUnit>('l');
  const [openingText, setOpeningText] = useState('');
  const [openingUnit, setOpeningUnit] = useState<ExpenseUnit>('l');
  const [lowText, setLowText] = useState('');
  const [lowUnit, setLowUnit] = useState<ExpenseUnit>('l');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    const item = target.item;
    const suggestion = STOCK_SUGGESTIONS.find((s) => s.name === target.name);
    const u = item?.unit ?? suggestion?.unit ?? 'l';
    const big = bigUnit(u);
    setName(item?.name ?? target.name ?? '');
    setUnit(u);
    setOpeningText('');
    setOpeningUnit(big);
    setLowText(
      item?.lowAt != null ? String(item.lowAt) : suggestion ? String(suggestion.lowAt) : '',
    );
    setLowUnit(big);
    setSaving(false);
    setError(null);
  }, [target]);

  const changeUnit = (u: StockUnit) => {
    setUnit(u);
    const big = bigUnit(u);
    setOpeningUnit(big);
    setLowUnit(big);
  };

  const trimmed = name.trim();
  const duplicate = existing.some(
    (s) => s.id !== editing?.id && stockKey(s.name) === stockKey(trimmed),
  );
  const opening = parseAmount(openingText);
  const low = parseAmount(lowText);
  const openingQty = opening != null ? toStockQuantity(opening, openingUnit, unit) : null;
  const lowQty = low != null ? toStockQuantity(low, lowUnit, unit) : null;
  const missing = [
    trimmed.length < 2 ? 'Name' : null,
    !editing && openingText.trim() === '' ? 'On the shelf now' : null,
    lowText.trim() === '' ? 'Alert level' : null,
  ].filter((x): x is string => x != null);
  const canSave = missing.length === 0 && !duplicate;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = editing
        ? await api.stock[':id'].$patch({
            param: { id: editing.id },
            json: { name: trimmed, lowAt: lowQty },
          })
        : await api.stock.$post({
            json: { name: trimmed, unit, lowAt: lowQty, opening: openingQty ?? 0 },
          });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t save the item.'));
      showToast(editing ? 'Saved' : `${trimmed} added to stock`);
      onSaved();
    } catch (e) {
      setError(
        e instanceof NetworkError ? 'Setting up items needs a connection.' : (e as Error).message,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={target != null}
      onClose={onClose}
      title={editing ? 'Edit item' : 'Add stock item'}
      subtitle={
        editing
          ? `Kept in ${STOCK_UNIT_LABEL[editing.unit].toLowerCase()}`
          : 'Something the shop keeps and uses up.'
      }
      dismissable={!saving}
      footer={
        <>
          <Button
            label={
              canSave
                ? editing
                  ? 'Save changes'
                  : 'Add to stock'
                : duplicate
                  ? 'Name already in stock'
                  : `${plural(missing.length, 'thing')} left`
            }
            onPress={() => void save()}
            disabled={!canSave}
            loading={saving}
          />
          {!canSave && missing.length > 0 ? (
            <Text style={styles.footMissing}>Still needed: {missing.join(', ')}</Text>
          ) : null}
        </>
      }
    >
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>
          Name <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={[styles.textInput, duplicate && styles.inputBad]}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Foam shampoo"
          placeholderTextColor={colors.slate}
          maxLength={60}
          autoFocus={!editing && !target?.name}
        />
        <Text style={[styles.fieldHint, duplicate && { color: colors.danger }]}>
          {duplicate
            ? 'There’s already an item with this name.'
            : 'Use the same name you write on expenses, so purchases add up here.'}
        </Text>
      </View>

      {!editing ? (
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>
            Counted in <Text style={styles.required}>*</Text>
          </Text>
          <View style={styles.segment}>
            {STOCK_UNITS.map((u) => {
              const on = u === unit;
              return (
                <Pressable
                  key={u}
                  onPress={() => changeUnit(u)}
                  style={[styles.segmentBtn, on && styles.segmentBtnOn]}
                >
                  <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                    {STOCK_UNIT_LABEL[u]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.fieldHint}>
            Liquids in litres (ml works too), powders in kg, cloths and bill books in pieces.
          </Text>
        </View>
      ) : null}

      {!editing ? (
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>
            On the shelf now <Text style={styles.required}>*</Text>
          </Text>
          <View style={styles.qtyRow}>
            <TextInput
              style={styles.qtyInputSm}
              value={openingText}
              onChangeText={(t) => setOpeningText(t.replace(/[^0-9.]/g, ''))}
              placeholder="0"
              placeholderTextColor={colors.slate}
              keyboardType="decimal-pad"
              maxLength={8}
            />
            <UnitChips units={entryUnitsFor(unit)} value={openingUnit} onChange={setOpeningUnit} />
          </View>
          <Text style={styles.fieldHint}>Type 0 if you have none yet.</Text>
        </View>
      ) : null}

      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>
          Warn me when it’s down to <Text style={styles.required}>*</Text>
        </Text>
        <View style={styles.qtyRow}>
          <TextInput
            style={styles.qtyInputSm}
            value={lowText}
            onChangeText={(t) => setLowText(t.replace(/[^0-9.]/g, ''))}
            placeholder="0"
            placeholderTextColor={colors.slate}
            keyboardType="decimal-pad"
            maxLength={8}
          />
          <UnitChips units={entryUnitsFor(unit)} value={lowUnit} onChange={setLowUnit} />
        </View>
        <Text style={styles.fieldHint}>
          {lowQty != null && lowQty > 0
            ? `At ${formatStock(lowQty, unit)} or less it moves to “Buy soon” and More shows a badge.`
            : 'Enough to last until the next purchase arrives — about a week’s use.'}
        </Text>
      </View>

      {error ? (
        <View style={styles.errorRow}>
          <IconAlert size={15} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
    fontSize: 34,
    color: colors.white,
    letterSpacing: -0.8,
    marginTop: 2,
  },
  heroMeta: { ...typography.label, fontSize: 13.5, color: 'rgba(255,255,255,0.92)' },
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
    color: 'rgba(255,255,255,0.88)',
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
  band: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  bandWarn: { borderColor: '#FDE68A' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
    backgroundColor: colors.white,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: { flex: 1, gap: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  rowTitle: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 15.5,
    fontWeight: '700',
    flex: 1,
  },
  rowBalance: { ...typography.bodyStrong, fontSize: 15.5, fontWeight: '800' },
  rowMeta: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  pendingText: { color: colors.amberDeep, fontWeight: '700' },
  giftWaiting: { ...typography.caption, fontSize: 12, color: '#C2410C', fontWeight: '700', letterSpacing: 0 },
  track: { height: 6, borderRadius: 3, backgroundColor: '#E2E8F0', overflow: 'hidden' },
  trackLg: { height: 10, borderRadius: 5, backgroundColor: '#E2E8F0', overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 5 },
  trackMark: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: colors.waterInk,
    opacity: 0.45,
  },
  useBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
  },
  useBtnText: { ...typography.label, fontSize: 13, color: colors.waterDeep },
  tipBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    backgroundColor: '#F0F9FF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#BAE6FD',
  },
  tipText: {
    ...typography.caption,
    fontSize: 13,
    color: colors.waterDeep,
    letterSpacing: 0,
    flex: 1,
    lineHeight: 18,
  },
  footnote: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slate,
    paddingHorizontal: spacing.md,
    letterSpacing: 0,
    lineHeight: 18,
  },

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
  ideaWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  ideaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  ideaText: {
    ...typography.caption,
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.waterDeep,
    letterSpacing: 0,
  },

  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBtnOn: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  segmentText: { ...typography.label, fontSize: 13.5, color: colors.slateDeep },
  segmentTextOn: { color: colors.waterDeep, fontWeight: '800' },
  fieldBlock: { gap: 6 },
  fieldLabel: { ...typography.caption, color: colors.slateDeep },
  fieldHint: {
    ...typography.caption,
    fontSize: 12,
    color: colors.slate,
    letterSpacing: 0,
    lineHeight: 17,
  },
  required: { color: colors.danger, fontWeight: '800' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  qtyInput: {
    ...typography.display,
    flex: 1,
    fontSize: 36,
    color: colors.waterInk,
    paddingVertical: 4,
    paddingHorizontal: 0,
    borderBottomWidth: 2,
    borderBottomColor: colors.water,
  },
  qtyInputSm: {
    ...typography.heading,
    flex: 1,
    fontSize: 20,
    color: colors.waterInk,
    height: 46,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  unitRow: { flexDirection: 'row', gap: 6 },
  unitSolo: {
    ...typography.label,
    fontSize: 15,
    color: colors.slateDeep,
    paddingHorizontal: spacing.sm,
  },
  unitChip: {
    minWidth: 44,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitChipOn: { backgroundColor: colors.waterDeep, borderColor: colors.waterDeep },
  unitText: { ...typography.label, fontSize: 13, color: colors.slateDeep },
  unitTextOn: { color: colors.white, fontWeight: '800' },
  quickRow: { flexDirection: 'row', gap: spacing.sm },
  quickChip: {
    flex: 1,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  quickText: { ...typography.label, fontSize: 12.5, color: colors.waterDeep },
  preview: { borderRadius: radius.md, padding: spacing.sm + 4, gap: 3 },
  previewLabel: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '800',
    color: colors.slateDeep,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  previewValue: { ...typography.heading, fontSize: 18, color: colors.waterInk },
  previewWarn: { ...typography.caption, fontSize: 12.5, fontWeight: '700', letterSpacing: 0 },
  previewNote: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  noteWrap: { gap: 6 },
  noteInput: {
    ...typography.body,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.waterInk,
    backgroundColor: colors.white,
  },
  textInput: {
    ...typography.body,
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.waterInk,
    backgroundColor: colors.white,
    fontSize: 16,
  },
  inputBad: { borderColor: colors.danger },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: {
    ...typography.caption,
    fontSize: 13,
    color: colors.danger,
    letterSpacing: 0,
    flex: 1,
  },
  footMissing: {
    ...typography.caption,
    fontSize: 12,
    color: colors.amberDeep,
    textAlign: 'center',
    letterSpacing: 0,
    fontWeight: '700',
  },
  footerRow: { flexDirection: 'row', gap: spacing.sm },

  detailHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  detailBalance: {
    ...typography.display,
    fontSize: 34,
    color: colors.waterInk,
    letterSpacing: -0.6,
  },
  detailMeta: { ...typography.label, fontSize: 13, color: colors.slateDeep },
  levelChip: { paddingHorizontal: 12, height: 28, borderRadius: 14, justifyContent: 'center' },
  levelChipText: { ...typography.caption, fontSize: 12.5, fontWeight: '800', letterSpacing: 0 },
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
  detailValue: { ...typography.bodyStrong, fontSize: 14, color: colors.waterInk },
  ownerRow: { flexDirection: 'row', gap: spacing.lg },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  linkText: { ...typography.label, fontSize: 13.5, color: colors.waterDeep },
  historyTitle: { ...typography.heading, fontSize: 16, color: colors.waterInk },
  historyEmpty: { ...typography.caption, fontSize: 13, color: colors.slate, letterSpacing: 0 },
  history: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  historyKind: { ...typography.bodyStrong, fontSize: 14, color: colors.waterInk },
  historyMeta: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  historyRight: { alignItems: 'flex-end', gap: 1 },
  historyQty: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '800' },
  historyAfter: { ...typography.caption, fontSize: 11.5, color: colors.slate, letterSpacing: 0 },
});
