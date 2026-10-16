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
import Svg, { Circle, G, Path } from 'react-native-svg';
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
import {
  BRAND_MARK,
  brandGradients,
  ScreenContainer,
  ScreenHeader,
  BottomSheet,
  Button,
  showToast,
  showAlert,
  IconAlert,
  IconBox,
  IconCheck,
  IconCloudOff,
  IconEdit,
  IconGift,
  IconMinus,
  IconPlus,
  IconReceipt,
  IconTrash,
  colors,
  radius,
  shadow,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { useSync } from '../offline/SyncProvider';
import { useShop, type StockItemView } from '../offline/ShopProvider';
import { newId } from '../utils/id';
import { formatDateTime, formatRupees } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Inventory'>;

type MoveKind = 'use' | 'in' | 'count';

const LEVEL_TONE: Record<StockLevel, { fg: string; bg: string; bar: string; label: string }> = {
  out: { fg: colors.danger, bg: '#FEE2E2', bar: colors.danger, label: 'Out' },
  low: { fg: colors.amberDeep, bg: '#FEF3C7', bar: colors.amber, label: 'Low' },
  ok: { fg: colors.tealDeep, bg: '#CCFBF1', bar: colors.teal, label: 'In stock' },
};

/** Top card turns amber when something is low, red when anything is out — same idea as Cash drawer. */
const HERO_OUT = ['#B91C1C', '#7F1D1D', '#450A0A'] as const;
const HERO_LOW = ['#F59E0B', '#D97706', '#92400E'] as const;
const HERO_OK = ['#0F766E', '#0B4F4A', '#062B28'] as const;

const MOVE_COPY: Record<MoveKind, { tab: string; title: string; question: string; button: string }> = {
  use: { tab: 'Used', title: 'Log what was used', question: 'How much was used?', button: 'Save — used' },
  in: { tab: 'Added', title: 'Add stock', question: 'How much was added?', button: 'Save — added' },
  count: { tab: 'Count', title: 'Count the shelf', question: 'How much is on the shelf now?', button: 'Save count' },
};

/** How each kind of history line looks. */
const MOVE_META: Record<string, { label: string; fg: string; bg: string }> = {
  in: { label: 'Added', fg: colors.tealDeep, bg: '#DDF5EF' },
  use: { label: 'Used', fg: colors.indigo, bg: colors.indigoPale },
  count: { label: 'Counted', fg: colors.amberDeep, bg: '#FEF3C7' },
  void: { label: 'Taken back off', fg: colors.danger, bg: '#FEE2E2' },
  gift: { label: 'Welcome gift', fg: '#BE185D', bg: '#FCE7F3' },
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

const STARS = [
  [24, 26, 1.2, 0.5],
  [88, 12, 0.9, 0.4],
  [150, 40, 1.1, 0.3],
  [214, 18, 1.2, 0.45],
  [40, 86, 0.8, 0.3],
  [190, 96, 1, 0.3],
  [118, 132, 0.9, 0.25],
] as const;

const CARD_SHADOW = {
  shadowColor: '#0C1442',
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

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

/** Roughly how many days the shelf lasts at last week's pace, if it was used. */
function daysLeft(item: StockItemView): number | null {
  if (item.usedWeek <= 0 || item.balance <= 0) return null;
  return Math.max(1, Math.floor(item.balance / (item.usedWeek / 7)));
}

/** The level bar with the alert mark. */
function Gauge({ item, height = 8 }: { item: StockItemView; height?: number }) {
  const tone = LEVEL_TONE[item.level];
  const { fill, mark } = fillRatio(item.balance, item.lowAt);
  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <View style={[styles.trackFill, { width: `${fill * 100}%`, backgroundColor: tone.bar, borderRadius: height / 2 }]} />
      {mark != null ? <View style={[styles.trackMark, { left: `${mark * 100}%`, height: height + 6, top: -3 }]} /> : null}
    </View>
  );
}

/**
 * Stock on the shelf. Purchases come in from Expenses ("Add to stock"), staff log what they use,
 * the owner counts the shelf to fix the balance. Items below their alert level move to "Buy soon".
 */
export function InventoryScreen({ navigation }: Props) {
  const { isOwner } = useAuth();
  const { online } = useSync();
  const { stock, lowStock, refreshStock } = useShop();
  const [loading, setLoading] = useState(stock.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [moving, setMoving] = useState<{ item: StockItemView; kind: MoveKind } | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [form, setForm] = useState<{ item: StockItemView | null; name?: string } | null>(null);
  const [tab, setTab] = useState<'needs' | 'ok'>('needs');

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
  const lowCount = stock.filter((s) => s.level === 'low').length;
  const usedItems = stock.filter((s) => s.usedWeek > 0).length;
  const noAlert = stock.filter((s) => s.lowAt == null).length;
  const viewing = viewingId ? (stock.find((s) => s.id === viewingId) ?? null) : null;
  const list = tab === 'needs' ? needs : fine;

  useEffect(() => {
    if (stock.length === 0) return;
    if (tab === 'needs' && needs.length === 0 && fine.length > 0) setTab('ok');
    if (tab === 'ok' && fine.length === 0 && needs.length > 0) setTab('needs');
  }, [stock.length, needs.length, fine.length, tab]);

  /** One row in the list — same shape as Expenses, not a coloured grid tile. */
  const renderRow = (item: StockItemView, index: number, list: StockItemView[]) => {
    const tone = LEVEL_TONE[item.level];
    const days = daysLeft(item);
    const meta = [
      item.pending ? 'Not synced' : null,
      days != null ? `Lasts ~${plural(days, 'day')}` : item.lowAt != null ? `Alert at ${formatStock(item.lowAt, item.unit)}` : 'No alert set',
      item.giftsOwed > 0 ? `${plural(item.giftsOwed, 'gift')} waiting` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <Pressable
        key={item.id}
        onPress={() => setViewingId(item.id)}
        android_ripple={{ color: colors.waterPale }}
        style={({ pressed }) => [styles.row, index < list.length - 1 && styles.rowDivider, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${formatStock(item.balance, item.unit)} left`}
        accessibilityHint="Opens details"
      >
        <View style={[styles.rowIcon, { backgroundColor: tone.bg }]}>
          <IconBox size={18} color={tone.fg} />
        </View>
        <View style={styles.rowCopy}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.name}
            </Text>
            {item.level !== 'ok' ? (
              <View style={[styles.levelPill, { backgroundColor: tone.bg }]}>
                <Text style={[styles.levelPillText, { color: tone.fg }]}>{tone.label}</Text>
              </View>
            ) : null}
          </View>
          <Gauge item={item} height={5} />
          <Text style={[styles.rowMeta, item.giftsOwed > 0 && styles.giftMeta]} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.rowBalance, item.level !== 'ok' && { color: tone.fg }]} numberOfLines={1}>
            {formatStock(item.balance, item.unit)}
          </Text>
          <Pressable
            onPress={() => setMoving({ item, kind: 'use' })}
            hitSlop={8}
            style={({ pressed }) => [styles.useChip, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Log ${item.name} used`}
          >
            <IconMinus size={14} color={colors.indigo} />
          </Pressable>
        </View>
      </Pressable>
    );
  };

  const g = brandGradients.hero;
  const heroColors =
    stock.length === 0
      ? (g.colors as unknown as string[])
      : outCount > 0
        ? (HERO_OUT as unknown as string[])
        : lowStock > 0
          ? (HERO_LOW as unknown as string[])
          : (HERO_OK as unknown as string[]);
  const heroEyebrow = 'Stock on the shelf';
  const heroValue =
    stock.length === 0
      ? 'Nothing yet'
      : outCount > 0
        ? `${lowStock} to buy`
        : lowStock > 0
          ? `${lowStock} running low`
          : 'All stocked up';
  const heroMeta =
    stock.length === 0
      ? 'Track shampoo, wax, cloths, bill books…'
      : outCount > 0
        ? `${plural(outCount, 'item')} out · ${plural(lowCount, 'item')} low`
        : lowStock > 0
          ? 'Buy these soon so the shop never runs out'
          : `${plural(stock.length, 'item')} above their alert level`;

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
            tintColor={colors.indigo}
            colors={[colors.indigo]}
          />
        }
      >
        {/* The shelf at a glance — amber when low, red when anything is out (like Cash drawer) */}
        <LinearGradient
          colors={heroColors}
          locations={stock.length === 0 || (outCount === 0 && lowStock === 0) ? (g.locations as unknown as number[]) : undefined}
          start={g.start}
          end={g.end}
          style={[styles.hero, shadow('md')]}
        >
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 340 200" preserveAspectRatio="xMidYMid slice">
            {STARS.map(([x, y, r, o]) => (
              <Circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#FFFFFF" fillOpacity={o} />
            ))}
          </Svg>
          <Svg style={styles.heroMark} width={150} height={150} viewBox="0 0 256 256">
            <G>
              <Path d={BRAND_MARK.drop} fill="#FFFFFF" fillOpacity={0.07} />
              <Path d={BRAND_MARK.arms} fill="#FFFFFF" fillOpacity={0.1} />
              <Path d={BRAND_MARK.centre} fill="#FFFFFF" fillOpacity={0.15} />
            </G>
          </Svg>
          <Text style={styles.heroEyebrow}>{heroEyebrow}</Text>
          <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
            {heroValue}
          </Text>
          <Text style={styles.heroMeta}>{heroMeta}</Text>
          {stock.length > 0 ? (
            <View style={styles.heroBar}>
              {fine.length > 0 ? <View style={[styles.heroSeg, { flex: fine.length, backgroundColor: colors.teal }]} /> : null}
              {lowCount > 0 ? <View style={[styles.heroSeg, { flex: lowCount, backgroundColor: colors.amberLight }]} /> : null}
              {outCount > 0 ? <View style={[styles.heroSeg, { flex: outCount, backgroundColor: '#FCA5A5' }]} /> : null}
            </View>
          ) : null}
          <View style={styles.heroChips}>
            {[
              { label: 'Items', value: stock.length, dot: null as string | null },
              {
                label: outCount > 0 ? 'Out' : 'Buy soon',
                value: outCount > 0 ? outCount : lowStock,
                dot: outCount > 0 ? '#FCA5A5' : lowStock > 0 ? colors.amberLight : null,
              },
              { label: 'Used this week', value: usedItems, dot: null },
            ].map((c) => (
              <View key={c.label} style={styles.heroChip}>
                <View style={styles.heroChipTop}>
                  {c.dot ? <View style={[styles.heroDot, { backgroundColor: c.dot }]} /> : null}
                  <Text style={styles.heroChipLabel}>{c.label}</Text>
                </View>
                <Text style={styles.heroChipValue}>{c.value}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        {!online ? (
          <View style={styles.notice}>
            <IconCloudOff size={15} color={colors.amberDeep} />
            <Text style={styles.noticeText}>Offline — what you log saves on this phone and syncs later.</Text>
          </View>
        ) : null}

        {loading && stock.length === 0 ? (
          <ActivityIndicator style={styles.loader} color={colors.indigo} />
        ) : stock.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <IconBox size={28} color={colors.indigo} />
            </View>
            <Text style={styles.emptyTitle}>Start tracking stock</Text>
            <Text style={styles.emptyBody}>
              {isOwner
                ? 'Save an expense with “Add to stock” on and it appears here. Or add what’s already on the shelf:'
                : 'Nothing is tracked yet. Purchases saved with “Add to stock” show up here.'}
            </Text>
            {isOwner ? (
              <View style={styles.ideaWrap}>
                {STOCK_SUGGESTIONS.map((s) => (
                  <Pressable
                    key={s.name}
                    onPress={() => setForm({ item: null, name: s.name })}
                    style={({ pressed }) => [styles.ideaChip, pressed && styles.pressed]}
                  >
                    <IconPlus size={12} color={colors.indigo} />
                    <Text style={styles.ideaText}>{s.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.tabs}>
              {(
                [
                  { key: 'needs' as const, label: outCount > 0 ? 'Buy now' : 'Buy soon', count: needs.length },
                  { key: 'ok' as const, label: 'In stock', count: fine.length },
                ] as const
              ).map((t) => {
                const on = tab === t.key;
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => setTab(t.key)}
                    style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && !on && styles.pressed]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.tabText, on && styles.tabTextOn]}>
                      {t.label}
                      {t.count > 0 ? ` · ${t.count}` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {list.length === 0 ? (
              <View style={styles.emptyCard}>
                <View style={styles.emptyIcon}>
                  {tab === 'needs' ? <IconCheck size={28} color={colors.tealDeep} /> : <IconBox size={28} color={colors.indigo} />}
                </View>
                <Text style={styles.emptyTitle}>{tab === 'needs' ? 'Nothing to buy' : 'No items in stock'}</Text>
                <Text style={styles.emptyBody}>
                  {tab === 'needs'
                    ? 'Everything is above its alert level.'
                    : 'Items under their alert level are on Buy soon.'}
                </Text>
              </View>
            ) : (
              <View style={styles.band}>{list.map((item, i) => renderRow(item, i, list))}</View>
            )}

            {isOwner && noAlert > 0 && tab === 'ok' ? (
              <Pressable
                onPress={() => {
                  const first = stock.find((s) => s.lowAt == null);
                  if (first) setForm({ item: first });
                }}
                style={({ pressed }) => [styles.tipCard, pressed && styles.pressed]}
              >
                <View style={styles.tipIcon}>
                  <IconAlert size={16} color={colors.indigo} />
                </View>
                <Text style={styles.tipText}>
                  {plural(noAlert, 'item')} {noAlert === 1 ? 'has' : 'have'} no alert level. Set one so you’re
                  warned before it runs out.
                </Text>
              </Pressable>
            ) : null}
            <View style={styles.howCard}>
              <View style={styles.howRow}>
                <View style={[styles.howIcon, { backgroundColor: '#DDF5EF' }]}>
                  <IconReceipt size={14} color={colors.tealDeep} />
                </View>
                <Text style={styles.howText}>
                  <Text style={styles.howStrong}>Buying</Text> — save an expense with “Add to stock” on.
                </Text>
              </View>
              <View style={styles.howRow}>
                <View style={[styles.howIcon, { backgroundColor: colors.indigoPale }]}>
                  <IconMinus size={14} color={colors.indigo} />
                </View>
                <Text style={styles.howText}>
                  <Text style={styles.howStrong}>Using</Text> — tap Use on the item.
                </Text>
              </View>
              {isOwner ? (
                <View style={styles.howRow}>
                  <View style={[styles.howIcon, { backgroundColor: '#FEF3C7' }]}>
                    <IconCheck size={14} color={colors.amberDeep} />
                  </View>
                  <Text style={styles.howText}>
                    <Text style={styles.howStrong}>Counting</Text> — open an item, tap Count to match the shelf.
                  </Text>
                </View>
              ) : null}
            </View>
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
    <View style={styles.unitSeg}>
      {units.map((u) => {
        const on = u === value;
        return (
          <Pressable
            key={u}
            onPress={() => onChange(u)}
            style={[styles.unitBtn, on && styles.unitBtnOn]}
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

/** A big number field with its unit picker underneath, used by every sheet here. */
function AmountField({
  value,
  onChange,
  units,
  unit,
  onUnit,
  autoFocus,
}: {
  value: string;
  onChange: (t: string) => void;
  units: ExpenseUnit[];
  unit: ExpenseUnit;
  onUnit: (u: ExpenseUnit) => void;
  autoFocus?: boolean;
}) {
  return (
    <View style={styles.amountStage}>
      <View style={styles.amountRow}>
        <TextInput
          style={styles.amountInput}
          value={value}
          onChangeText={(t) => onChange(t.replace(/[^0-9.]/g, ''))}
          placeholder="0"
          placeholderTextColor={colors.indigoMist}
          keyboardType="decimal-pad"
          autoFocus={autoFocus}
          maxLength={8}
        />
        <Text style={styles.amountUnit}>{EXPENSE_UNIT_LABEL[unit]}</Text>
      </View>
      <UnitChips units={units} value={unit} onChange={onUnit} />
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
    q == null ? null : roundStock(kind === 'use' ? Math.max(0, item.balance - q) : kind === 'in' ? item.balance + q : q);
  const afterLevel = after == null ? null : stockLevel(after, item.lowAt);
  const valid = q != null && (kind === 'count' ? q >= 0 : q > 0);
  const kinds: MoveKind[] = isOwner ? ['use', 'in', 'count'] : ['use'];

  const save = async () => {
    if (!valid || amount == null) return;
    setSaving(true);
    setError(null);
    const result = await submit({
      kind: 'stock.move',
      payload: { id: newId(), itemId: item.id, kind, quantity: amount, unit, note: note.trim() || undefined },
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
      subtitle={`${item.name} · ${formatStock(item.balance, item.unit)} on the shelf`}
      dismissable={!saving}
      footer={
        <Button
          label={valid ? MOVE_COPY[kind].button : 'Enter an amount'}
          size="lg"
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
                {k === 'use' ? (
                  <IconMinus size={14} color={on ? colors.white : colors.slateDeep} />
                ) : k === 'in' ? (
                  <IconPlus size={14} color={on ? colors.white : colors.slateDeep} />
                ) : (
                  <IconCheck size={14} color={on ? colors.white : colors.slateDeep} />
                )}
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{MOVE_COPY[k].tab}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Text style={styles.fieldLabel}>{MOVE_COPY[kind].question}</Text>
      <AmountField
        value={text}
        onChange={setText}
        units={entryUnitsFor(item.unit)}
        unit={unit}
        onUnit={setUnit}
        autoFocus
      />

      {kind === 'use' ? (
        <View style={styles.quickRow}>
          {QUICK_USE[item.unit].map(([n, u]) => {
            const on = text === String(n) && unit === u;
            return (
              <Pressable
                key={`${n}${u}`}
                onPress={() => {
                  setUnit(u);
                  setText(String(n));
                }}
                style={({ pressed }) => [styles.quickChip, on && styles.quickChipOn, pressed && styles.pressed]}
              >
                <Text style={[styles.quickText, on && styles.quickTextOn]}>
                  {n} {EXPENSE_UNIT_LABEL[u]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {after != null && afterLevel ? (
        <View style={[styles.preview, { backgroundColor: LEVEL_TONE[afterLevel].bg }]}>
          <View style={styles.previewRow}>
            <View style={styles.flex}>
              <Text style={styles.previewLabel}>Now</Text>
              <Text style={styles.previewNow}>{formatStock(item.balance, item.unit)}</Text>
            </View>
            <Text style={[styles.previewArrow, { color: LEVEL_TONE[afterLevel].fg }]}>→</Text>
            <View style={[styles.flex, styles.alignEnd]}>
              <Text style={styles.previewLabel}>After</Text>
              <Text style={[styles.previewAfter, { color: LEVEL_TONE[afterLevel].fg }]}>
                {formatStock(after, item.unit)}
              </Text>
            </View>
          </View>
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

      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>Note (optional)</Text>
        <TextInput
          style={styles.textInput}
          value={note}
          onChangeText={setNote}
          placeholder={kind === 'use' ? 'Foam wash, bay 2' : kind === 'count' ? 'Weekly count' : 'From the old stock'}
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
  /** The purchase this came from, if it came in through Expenses. */
  expense?: { id: string; amount: number; date: string; paymentMethod: string; voidedAt: string | null } | null;
}

function paidLabel(method: string): string {
  return method === 'upi' ? 'UPI' : method === 'other' ? 'Other' : 'Cash';
}

/** One history line: what happened, who, when — and for purchases, the expense it came from. */
function HistoryRow({ move, unit, last }: { move: MoveRow; unit: StockUnit; last: boolean }) {
  const meta = MOVE_META[move.kind] ?? MOVE_META.count!;
  const up = move.quantity >= 0;
  const fromExpense = move.kind === 'in' && move.expense;
  const icon =
    move.kind === 'in' ? (
      fromExpense ? <IconReceipt size={14} color={meta.fg} /> : <IconPlus size={14} color={meta.fg} />
    ) : move.kind === 'use' ? (
      <IconMinus size={14} color={meta.fg} />
    ) : move.kind === 'gift' ? (
      <IconGift size={14} color={meta.fg} />
    ) : move.kind === 'void' ? (
      <IconTrash size={13} color={meta.fg} />
    ) : (
      <IconCheck size={14} color={meta.fg} />
    );
  return (
    <View style={styles.histRow}>
      <View style={styles.histRail}>
        <View style={[styles.histIcon, { backgroundColor: meta.bg }]}>{icon}</View>
        {!last ? <View style={styles.histLine} /> : null}
      </View>
      <View style={[styles.flex, styles.histBody]}>
        <View style={styles.histTop}>
          <Text style={styles.histKind} numberOfLines={1}>
            {fromExpense ? 'Bought' : move.kind === 'void' && move.note ? move.note : meta.label}
          </Text>
          <Text style={[styles.histQty, { color: up ? colors.tealDeep : colors.ink }]}>
            {up ? '+' : '−'}
            {formatStock(Math.abs(move.quantity), unit)}
          </Text>
        </View>
        <Text style={styles.histMeta} numberOfLines={1}>
          {move.createdBy.name} · {formatDateTime(move.createdAt)} · leaves {formatStock(move.balanceAfter, unit)}
        </Text>
        {fromExpense && move.expense ? (
          <View style={styles.expenseTag}>
            <IconReceipt size={12} color={move.expense.voidedAt ? colors.slate : colors.tealDeep} />
            <Text style={[styles.expenseTagText, move.expense.voidedAt ? styles.strike : null]}>
              From expense · {formatRupees(move.expense.amount)} · {paidLabel(move.expense.paymentMethod)}
            </Text>
            {move.expense.voidedAt ? <Text style={styles.expenseDeleted}>Deleted</Text> : null}
          </View>
        ) : move.note && move.kind !== 'void' && move.note !== 'Bought' ? (
          <Text style={styles.histNote} numberOfLines={2}>
            “{move.note}”
          </Text>
        ) : null}
      </View>
    </View>
  );
}

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
        if (!cancelled) setError(e instanceof NetworkError ? 'History needs a connection.' : (e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (!item) return <BottomSheet visible={false} onClose={onClose} title="" />;
  const tone = LEVEL_TONE[item.level];
  const days = daysLeft(item);
  const spent = (moves ?? [])
    .filter((m) => m.kind === 'in' && m.expense && !m.expense.voidedAt)
    .reduce((sum, m) => sum + (m.expense?.amount ?? 0), 0);

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
                showToast(e instanceof NetworkError ? 'Removing needs a connection.' : (e as Error).message);
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
      subtitle={`Counted in ${STOCK_UNIT_LABEL[item.unit].toLowerCase()}`}
      footer={
        <View style={styles.footerRow}>
          <Pressable
            onPress={() => onMove('use')}
            style={({ pressed }) => [styles.actBtn, styles.actGhost, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <IconMinus size={16} color={colors.indigo} />
            <Text style={[styles.actText, { color: colors.indigo }]}>Used</Text>
          </Pressable>
          {isOwner ? (
            <>
              <Pressable
                onPress={() => onMove('in')}
                style={({ pressed }) => [styles.actBtn, styles.actGhost, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <IconPlus size={16} color={colors.indigo} />
                <Text style={[styles.actText, { color: colors.indigo }]}>Add</Text>
              </Pressable>
              <Pressable onPress={() => onMove('count')} style={({ pressed }) => [styles.flex, pressed && styles.pressed]} accessibilityRole="button">
                <LinearGradient
                  colors={brandGradients.primary.colors as unknown as string[]}
                  start={brandGradients.primary.start}
                  end={brandGradients.primary.end}
                  style={styles.actBtn}
                >
                  <IconCheck size={16} color={colors.white} />
                  <Text style={[styles.actText, { color: colors.white }]}>Count</Text>
                </LinearGradient>
              </Pressable>
            </>
          ) : null}
        </View>
      }
    >
      <View style={[styles.detailHero, { backgroundColor: tone.bg }]}>
        <View style={styles.detailTop}>
          <View style={styles.flex}>
            <Text style={styles.detailLabel}>On the shelf{item.pending ? ' · not synced yet' : ''}</Text>
            <Text style={[styles.detailBalance, { color: item.level === 'ok' ? colors.ink : tone.fg }]}>
              {formatStock(item.balance, item.unit)}
            </Text>
          </View>
          <View style={styles.detailChip}>
            <Text style={[styles.levelPillText, { color: tone.fg }]}>{tone.label}</Text>
          </View>
        </View>
        <Gauge item={item} height={10} />
        <Text style={[styles.detailHint, { color: tone.fg }]}>
          {item.lowAt != null ? `Alert at ${formatStock(item.lowAt, item.unit)} — the line on the bar` : 'No alert level set'}
        </Text>
      </View>

      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Used, 7 days</Text>
          <Text style={styles.statValue}>{formatStock(item.usedWeek, item.unit)}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Lasts about</Text>
          <Text style={styles.statValue}>{days != null ? plural(days, 'day') : '—'}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Spent (recent)</Text>
          <Text style={styles.statValue}>{spent > 0 ? formatRupees(spent) : '—'}</Text>
        </View>
      </View>

      {item.giftsOwed > 0 ? (
        <View style={styles.giftBand}>
          <IconGift size={15} color="#BE185D" />
          <Text style={styles.giftBandText}>
            {plural(item.giftsOwed, 'customer')} waiting for {formatStock(item.giftsOwedQuantity, item.unit)} as a welcome gift.
          </Text>
        </View>
      ) : null}

      {isOwner ? (
        <View style={styles.ownerRow}>
          <Pressable onPress={onEdit} style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]} accessibilityRole="button">
            <IconEdit size={14} color={colors.indigo} />
            <Text style={styles.linkText}>Edit name / alert</Text>
          </Pressable>
          <Pressable onPress={remove} style={({ pressed }) => [styles.linkBtn, styles.linkDanger, pressed && styles.pressed]} accessibilityRole="button">
            <IconTrash size={14} color={colors.danger} />
            <Text style={[styles.linkText, { color: colors.danger }]}>Remove</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.historyTitle}>History</Text>
      {error ? (
        <Text style={styles.historyEmpty}>{error}</Text>
      ) : moves == null ? (
        <ActivityIndicator color={colors.indigo} />
      ) : moves.length === 0 ? (
        <Text style={styles.historyEmpty}>Nothing logged yet.</Text>
      ) : (
        <View style={styles.historyCard}>
          {moves.map((m, i) => (
            <HistoryRow key={m.id} move={m} unit={item.unit} last={i === moves.length - 1} />
          ))}
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
    setLowText(item?.lowAt != null ? String(item.lowAt) : suggestion ? String(suggestion.lowAt) : '');
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
  const duplicate = existing.some((s) => s.id !== editing?.id && stockKey(s.name) === stockKey(trimmed));
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
        ? await api.stock[':id'].$patch({ param: { id: editing.id }, json: { name: trimmed, lowAt: lowQty } })
        : await api.stock.$post({ json: { name: trimmed, unit, lowAt: lowQty, opening: openingQty ?? 0 } });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t save the item.'));
      showToast(editing ? 'Saved' : `${trimmed} added to stock`);
      onSaved();
    } catch (e) {
      setError(e instanceof NetworkError ? 'Setting up items needs a connection.' : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={target != null}
      onClose={onClose}
      title={editing ? 'Edit item' : 'Add stock item'}
      subtitle={editing ? `Counted in ${STOCK_UNIT_LABEL[editing.unit].toLowerCase()}` : 'Something the shop keeps and uses up.'}
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
            size="lg"
            onPress={() => void save()}
            disabled={!canSave}
            loading={saving}
          />
          {!canSave && missing.length > 0 ? <Text style={styles.footMissing}>Still needed: {missing.join(', ')}</Text> : null}
        </>
      }
    >
      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>
          Name <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={[styles.textInput, trimmed.length >= 2 && !duplicate && styles.inputOk, duplicate && styles.inputBad]}
          value={name}
          onChangeText={setName}
          placeholder="Foam shampoo"
          placeholderTextColor={colors.slate}
          maxLength={60}
          autoFocus={!editing && !target?.name}
        />
        <Text style={[styles.fieldHint, duplicate && { color: colors.danger }]}>
          {duplicate ? 'There’s already an item with this name.' : 'Use the same name you write on expenses, so purchases add up here.'}
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
                <Pressable key={u} onPress={() => changeUnit(u)} style={[styles.segmentBtn, on && styles.segmentBtnOn]}>
                  <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{STOCK_UNIT_LABEL[u]}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.fieldHint}>Liquids in litres, powders in kg, cloths and bill books in pieces.</Text>
        </View>
      ) : null}

      {!editing ? (
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>
            On the shelf now <Text style={styles.required}>*</Text>
          </Text>
          <AmountField value={openingText} onChange={setOpeningText} units={entryUnitsFor(unit)} unit={openingUnit} onUnit={setOpeningUnit} />
          <Text style={styles.fieldHint}>Type 0 if you have none yet.</Text>
        </View>
      ) : null}

      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>
          Warn me when it’s down to <Text style={styles.required}>*</Text>
        </Text>
        <AmountField value={lowText} onChange={setLowText} units={entryUnitsFor(unit)} unit={lowUnit} onUnit={setLowUnit} />
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
  alignEnd: { alignItems: 'flex-end' },
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.lg },
  pressed: { opacity: 0.75 },
  loader: { marginTop: spacing.lg },
  strike: { textDecorationLine: 'line-through' },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.indigo,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md - 2,
    height: 36,
  },
  addBtnText: { ...typography.label, color: colors.white, fontWeight: '700' },

  // Hero — same shape as Expenses / Cash drawer
  hero: {
    marginHorizontal: spacing.md,
    borderRadius: radius.xl,
    padding: spacing.md + 2,
    gap: 4,
    overflow: 'hidden',
  },
  heroMark: { position: 'absolute', right: -22, top: -14 },
  heroEyebrow: { ...typography.label, fontSize: 14, color: 'rgba(255,255,255,0.88)' },
  heroValue: {
    ...typography.display,
    fontSize: 42,
    color: colors.white,
    letterSpacing: -1,
  },
  heroMeta: { ...typography.label, fontSize: 13.5, color: 'rgba(255,255,255,0.9)' },
  heroBar: {
    flexDirection: 'row',
    gap: 3,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  heroSeg: { height: 8 },
  heroChips: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  heroChip: {
    flex: 1,
    padding: spacing.sm + 2,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  heroChipTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroDot: { width: 7, height: 7, borderRadius: 4 },
  heroChipLabel: { ...typography.caption, fontSize: 11, color: 'rgba(255,255,255,0.75)', letterSpacing: 0.3 },
  heroChipValue: { ...typography.bodyStrong, fontSize: 18, color: colors.white, fontWeight: '800', marginTop: 2 },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    padding: spacing.sm + 4,
    borderRadius: 14,
    backgroundColor: colors.amberPale,
    borderWidth: 1,
    borderColor: colors.amberLight,
  },
  noticeText: { ...typography.caption, flex: 1, fontSize: 12.5, color: colors.amberDeep, letterSpacing: 0 },

  // Empty
  emptyCard: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderRadius: 22,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    ...CARD_SHADOW,
  },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.indigoPale, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { ...typography.heading, fontSize: 18, color: colors.ink },
  emptyBody: { ...typography.body, fontSize: 13.5, color: colors.slateDeep, textAlign: 'center' },
  ideaWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.sm },
  ideaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  ideaText: { ...typography.label, fontSize: 13, color: colors.ink, fontWeight: '600' },

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

  band: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
    backgroundColor: colors.white,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: { flex: 1, gap: 5, minWidth: 0 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: {
    ...typography.bodyStrong,
    flexShrink: 1,
    color: colors.waterInk,
    fontSize: 15.5,
    fontWeight: '700',
  },
  levelPill: { paddingHorizontal: 8, height: 20, borderRadius: 10, justifyContent: 'center' },
  levelPillText: { ...typography.caption, fontSize: 11, fontWeight: '800', letterSpacing: 0 },
  rowMeta: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slate,
    letterSpacing: 0,
  },
  giftMeta: { color: '#BE185D', fontWeight: '700' },
  rowRight: { alignItems: 'flex-end', gap: 6 },
  rowBalance: { ...typography.heading, fontSize: 16, color: colors.waterInk },
  useChip: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.indigoPale,
  },
  track: { backgroundColor: colors.surface, position: 'relative', borderRadius: 3, overflow: 'hidden' },
  trackFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  trackMark: { position: 'absolute', width: 2, borderRadius: 1, backgroundColor: colors.ink, opacity: 0.4, marginLeft: -1 },

  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    marginHorizontal: spacing.md,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.indigoPale,
  },
  tipIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  tipText: { ...typography.body, flex: 1, fontSize: 13, color: colors.indigo },
  howCard: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: spacing.md,
    gap: spacing.sm + 2,
    ...CARD_SHADOW,
  },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  howIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  howText: { ...typography.body, flex: 1, fontSize: 13, color: colors.slateDeep },
  howStrong: { fontWeight: '800', color: colors.ink },

  // Sheets: shared fields
  fieldBlock: { gap: 6 },
  fieldLabel: { ...typography.caption, fontSize: 13, color: colors.slateDeep, fontWeight: '700', letterSpacing: 0 },
  fieldHint: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  required: { color: colors.danger },
  textInput: {
    ...typography.body,
    height: 50,
    paddingHorizontal: spacing.md,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: 16,
    color: colors.ink,
  },
  inputOk: { borderColor: colors.indigo, backgroundColor: colors.white },
  inputBad: { borderColor: colors.danger },
  footMissing: { ...typography.caption, fontSize: 12, color: colors.amberDeep, textAlign: 'center', marginTop: 6, letterSpacing: 0 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { ...typography.caption, flex: 1, fontSize: 12.5, color: colors.danger, letterSpacing: 0 },
  segment: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: radius.pill, backgroundColor: colors.surface },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: radius.pill,
  },
  segmentBtnOn: { backgroundColor: colors.indigo },
  segmentText: { ...typography.label, fontSize: 13.5, color: colors.slateDeep },
  segmentTextOn: { color: colors.white, fontWeight: '800' },
  amountStage: { padding: spacing.sm + 2, gap: spacing.sm, borderRadius: 20, backgroundColor: '#F5F7FF', alignItems: 'center' },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  amountInput: { ...typography.display, minWidth: 60, fontSize: 40, color: colors.ink, textAlign: 'center', paddingVertical: 0 },
  amountUnit: { ...typography.label, fontSize: 17, color: colors.slateDeep, fontWeight: '700' },
  unitSeg: { flexDirection: 'row', gap: 6 },
  unitBtn: { paddingHorizontal: 16, height: 32, borderRadius: 16, backgroundColor: colors.white, justifyContent: 'center' },
  unitBtnOn: { backgroundColor: colors.indigo },
  unitText: { ...typography.label, fontSize: 13.5, color: colors.slateDeep, fontWeight: '600' },
  unitTextOn: { color: colors.white, fontWeight: '800' },
  unitSolo: { ...typography.label, fontSize: 13, color: colors.slateDeep },
  quickRow: { flexDirection: 'row', gap: spacing.sm },
  quickChip: {
    flex: 1,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickChipOn: { borderColor: colors.indigo, backgroundColor: colors.indigoPale },
  quickText: { ...typography.label, fontSize: 13.5, color: colors.ink, fontWeight: '700' },
  quickTextOn: { color: colors.indigo, fontWeight: '800' },
  preview: { borderRadius: 18, padding: spacing.md, gap: 6 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  previewLabel: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, letterSpacing: 0 },
  previewNow: { ...typography.heading, fontSize: 18, color: colors.slateDeep },
  previewArrow: { ...typography.heading, fontSize: 20 },
  previewAfter: { ...typography.heading, fontSize: 22 },
  previewWarn: { ...typography.caption, fontSize: 12.5, fontWeight: '700', letterSpacing: 0 },
  previewNote: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },

  // Item sheet
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  actBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 52, borderRadius: 18, paddingHorizontal: spacing.md },
  actGhost: { flex: 1, backgroundColor: colors.indigoPale },
  actText: { ...typography.bodyStrong, fontSize: 15 },
  detailHero: { borderRadius: 20, padding: spacing.md, gap: spacing.sm },
  detailTop: { flexDirection: 'row', alignItems: 'center' },
  detailLabel: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  detailBalance: { ...typography.display, fontSize: 34, letterSpacing: -0.5 },
  detailChip: { paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.75)', justifyContent: 'center' },
  detailHint: { ...typography.caption, fontSize: 12, fontWeight: '600', letterSpacing: 0 },
  statRow: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, padding: spacing.sm + 2, borderRadius: 16, backgroundColor: colors.surface, gap: 2 },
  statLabel: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, letterSpacing: 0 },
  statValue: { ...typography.heading, fontSize: 16, color: colors.ink },
  giftBand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm + 2, borderRadius: 14, backgroundColor: '#FCE7F3' },
  giftBandText: { ...typography.caption, flex: 1, fontSize: 12.5, color: '#9D174D', letterSpacing: 0 },
  ownerRow: { flexDirection: 'row', gap: spacing.sm },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.indigoPale,
  },
  linkDanger: { backgroundColor: '#FEF2F2' },
  linkText: { ...typography.label, fontSize: 13, color: colors.indigo, fontWeight: '700' },
  historyTitle: { ...typography.heading, fontSize: 16, color: colors.ink, marginTop: spacing.xs },
  historyEmpty: { ...typography.body, fontSize: 13.5, color: colors.slate },
  historyCard: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: spacing.md, paddingBottom: spacing.xs },
  histRow: { flexDirection: 'row', gap: spacing.sm + 2 },
  histRail: { alignItems: 'center', width: 30 },
  histIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  histLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  histBody: { paddingBottom: spacing.md, gap: 2 },
  histTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  histKind: { ...typography.bodyStrong, flex: 1, fontSize: 14, color: colors.ink, fontWeight: '700' },
  histQty: { ...typography.heading, fontSize: 15 },
  histMeta: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  histNote: { ...typography.caption, fontSize: 12, color: colors.slate, fontStyle: 'italic', letterSpacing: 0 },
  expenseTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 4,
    paddingHorizontal: 9,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E6F7F2',
  },
  expenseTagText: { ...typography.caption, fontSize: 11.5, color: colors.tealDeep, fontWeight: '700', letterSpacing: 0 },
  expenseDeleted: { ...typography.caption, fontSize: 11, color: colors.danger, fontWeight: '800', letterSpacing: 0 },
});
