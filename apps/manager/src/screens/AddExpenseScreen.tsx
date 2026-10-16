import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  MAX_PHOTO_BYTES,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_CATEGORY_SETUP,
  EXPENSE_UNIT_LABEL,
  EXPENSE_UNITS,
  defaultExpenseUnit,
  formatExpenseQuantity,
  STOCK_CATEGORIES,
  STOCK_UNIT_LABEL,
  formatStock,
  roundStock,
  stockKey,
  stockUnitOf,
  toStockQuantity,
  type ExpenseCategory,
  type ExpensePhotoKind,
  type ExpenseUnit,
  type StockUnit,
} from '@mana/domain';
import {
  BRAND_MARK,
  brandGradients,
  ScreenContainer,
  Button,
  showToast,
  IconAlert,
  IconBackspace,
  IconBox,
  IconCalendar,
  IconCamera,
  IconCash,
  IconCheck,
  IconChevronLeft,
  IconClose,
  IconEdit,
  IconLock,
  IconMinus,
  IconPlus,
  IconReceipt,
  IconUpi,
  IconWallet,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { CalendarSheet } from '../components/CalendarSheet';
import { ExpenseCategoryIcon } from '../components/ExpenseCategoryIcon';
import { ReasonSheet } from '../components/ReasonSheet';
import { pickPhotos } from '../utils/photoPicker';
import { api, apiErrorMessage, expensePhotoSource } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { useSync } from '../offline/SyncProvider';
import { useShop } from '../offline/ShopProvider';
import { deleteLocalCopy, keepLocalCopy } from '../offline/photoFiles';
import type { ExpensePaymentMethod, LocalPhoto } from '../offline/types';
import { newId } from '../utils/id';
import { formatRupees } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';
import {
  CATEGORY_TONE,
  PAID_WITH,
  PhotoViewer,
  QUICK_ADD,
  dayParts,
  formatDay,
  isoDaysAgo,
  paidLabel,
  parseQuantity,
  ratePerUnit,
} from './ExpensesScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'AddExpense'>;
type Step = 0 | 1 | 2;
type PhotoSource = { uri: string; headers?: Record<string, string> };

/** The fields an owner or manager can change on a saved expense. */
interface ExpensePatch {
  category?: ExpenseCategory;
  amount?: number;
  itemName?: string;
  quantity?: number | null;
  unit?: ExpenseUnit | null;
  description?: string | null;
  paymentMethod?: ExpensePaymentMethod;
  date?: string;
}

const STEP_TITLES = ['Amount and category', 'What was bought', 'Proof and payment'] as const;
const KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'back'],
] as const;
type Key = (typeof KEY_ROWS)[number][number];
const EDIT_REASONS = ['Wrong amount', 'Wrong item', 'Wrong date', 'Typing mistake'];

/** How each way of paying looks on step 3. */
const PAY_TONE: Record<ExpensePaymentMethod, { fg: string; bg: string }> = {
  cash: { fg: '#047857', bg: '#D1FAE5' },
  upi: { fg: '#6D28D9', bg: '#EDE9FE' },
  other: { fg: '#B45309', bg: '#FEF3C7' },
};

/** One-tap quantities for each unit, the amounts the shop usually buys. */
function presetsFor(unit: ExpenseUnit): number[] {
  switch (unit) {
    case 'ml':
      return [250, 500, 1000];
    case 'g':
      return [250, 500, 1000];
    case 'l':
    case 'kg':
      return [1, 2, 5, 20];
    case 'kwh':
      return [50, 100, 200];
    case 'tankers':
      return [1, 2, 3];
    default:
      return [1, 2, 5, 10];
  }
}

/** The last week, newest first, for the date strip. */
function lastDays(count: number): string[] {
  return Array.from({ length: count }, (_, i) => isoDaysAgo(i));
}

const STARS = [
  [22, 30, 1.2, 0.5],
  [74, 12, 0.9, 0.4],
  [128, 50, 1.1, 0.3],
  [196, 22, 1.3, 0.45],
  [262, 58, 0.9, 0.35],
  [300, 16, 1, 0.4],
  [40, 92, 0.8, 0.3],
  [236, 104, 1, 0.3],
  [96, 150, 1, 0.3],
  [330, 176, 1.2, 0.35],
  [18, 214, 0.9, 0.3],
  [170, 236, 0.8, 0.25],
  [286, 268, 1, 0.3],
  [60, 306, 1.1, 0.3],
] as const;

function asUnit(value: string | null | undefined): ExpenseUnit | null {
  return value && (EXPENSE_UNITS as readonly string[]).includes(value) ? (value as ExpenseUnit) : null;
}

function asCategory(value: string): ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value) ? (value as ExpenseCategory) : 'other';
}

/** How much one tap of + / − changes a quantity: whole units, or 100 for ml and g. */
function stepFor(unit: ExpenseUnit): number {
  return unit === 'ml' || unit === 'g' ? 100 : 1;
}

/** ₹ with Indian digit grouping, keeping a half-typed decimal ("12.") as typed. */
function amountDisplay(amount: string): string {
  if (!amount) return '0';
  const [whole, frac] = amount.split('.');
  return Number(whole || '0').toLocaleString('en-IN') + (frac != null ? `.${frac}` : '');
}

/**
 * The app's own number pad, so the phone keyboard never pushes the screen around. Same soft round
 * keys as the PIN pad at sign-in, so the whole app types numbers the same way.
 */
function AmountPad({ onKey }: { onKey: (k: Key) => void }) {
  return (
    <View style={styles.pad}>
      {KEY_ROWS.map((row) => (
        <View key={row.join('')} style={styles.padRow}>
          {row.map((k) => {
            const ghost = k === 'back' || k === '.';
            return (
              <Pressable
                key={k}
                onPress={() => onKey(k)}
                style={({ pressed }) => [styles.padKey, ghost && styles.padKeyGhost, pressed && styles.padKeyPressed]}
                accessibilityRole="button"
                accessibilityLabel={k === 'back' ? 'Delete' : k === '.' ? 'Point' : k}
              >
                {k === 'back' ? (
                  <IconBackspace size={24} color={colors.indigo} />
                ) : (
                  <Text style={[styles.padText, k === '.' && styles.padDot]}>{k}</Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** A card with a small coloured icon and a title — every block on steps 2 and 3. */
function Section({
  title,
  icon,
  tint,
  right,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tint: { fg: string; bg: string };
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.cardIcon, { backgroundColor: tint.bg }]}>{icon}</View>
        <Text style={styles.cardTitle}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

/** One proof photo: a big dashed tile to take it, then the picture itself with a retake button. */
function ProofTile({
  label,
  hint,
  photo,
  busy,
  locked,
  tone,
  onTake,
  onView,
}: {
  label: string;
  hint: string;
  photo: PhotoSource | null;
  busy: boolean;
  locked: boolean;
  tone: { fg: string; bg: string };
  onTake: () => void;
  onView: () => void;
}) {
  if (photo) {
    return (
      <Pressable
        onPress={onView}
        style={({ pressed }) => [styles.proof, styles.proofFilled, pressed && styles.pressed]}
        accessibilityRole="imagebutton"
        accessibilityLabel={`${label} photo, tap to view`}
      >
        <Image source={photo} style={styles.proofImage} />
        <LinearGradient colors={['rgba(6,10,34,0)', 'rgba(6,10,34,0.78)']} style={styles.proofShade} />
        <View style={styles.proofBadge}>
          {locked ? <IconLock size={11} color={colors.white} /> : <IconCheck size={12} color={colors.white} />}
        </View>
        <View style={styles.proofCaption}>
          <Text style={styles.proofCaptionText} numberOfLines={1}>
            {label}
          </Text>
          {!locked ? (
            <Pressable onPress={onTake} hitSlop={8} style={styles.retake} accessibilityLabel={`Retake ${label} photo`}>
              <IconCamera size={13} color={colors.white} />
              <Text style={styles.retakeText}>Retake</Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    );
  }
  if (locked) {
    return (
      <View style={[styles.proof, styles.proofLocked]}>
        <IconLock size={20} color={colors.slate} />
        <Text style={styles.proofHintDark}>No {label.toLowerCase()} photo</Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onTake}
      disabled={busy}
      style={({ pressed }) => [styles.proof, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Add ${label} photo`}
    >
      <LinearGradient
        colors={brandGradients.hero.colors as unknown as string[]}
        locations={brandGradients.hero.locations as unknown as number[]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.proofGlow, { backgroundColor: tone.fg }]} />
      {busy ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <>
          <View style={styles.proofCam}>
            <IconCamera size={24} color={colors.white} />
          </View>
          <Text style={styles.proofLabel}>{label} photo</Text>
          <Text style={styles.proofHint} numberOfLines={2}>
            {hint}
          </Text>
          <View style={styles.proofTap}>
            <Text style={styles.proofTapText}>Tap to take</Text>
          </View>
        </>
      )}
    </Pressable>
  );
}

/**
 * A new expense on its own screen, in three short steps: the amount and category (typed on the
 * app's own number pad), what was bought, then the two proof photos, how it was paid and when.
 * The steps so far stay in a summary at the top and the next action stays pinned at the bottom,
 * so nothing is pushed off the screen by the keyboard. Same rules as before: both photos, offline
 * saving, and purchases can go straight into stock.
 *
 * Opened with an expense, it edits it instead (owners and managers only): the same steps filled
 * in, photos kept as they were taken, and a reason asked before saving. Editing needs a connection.
 */
export function AddExpenseScreen({ navigation, route }: Props) {
  const original = route.params?.edit ?? null;
  const editing = original != null;
  const { isOwner } = useAuth();
  const { submit } = useSync();
  const { stock, refreshStock } = useShop();
  const insets = useSafeAreaInsets();
  const today = isoDaysAgo(0);
  const yesterday = isoDaysAgo(1);

  const startCategory = original ? asCategory(original.category) : null;
  const [step, setStep] = useState<Step>(0);
  const [expenseId] = useState(() => original?.id ?? newId());
  const [category, setCategory] = useState<ExpenseCategory | null>(startCategory);
  const [amount, setAmount] = useState(original ? String(original.amount / 100) : '');
  const [item, setItem] = useState(original?.itemName ?? '');
  const [qty, setQty] = useState(original?.quantity ? String(original.quantity) : '');
  const [unit, setUnit] = useState<ExpenseUnit>(
    asUnit(original?.unit) ??
      (startCategory ? defaultExpenseUnit(startCategory, original?.itemName ?? '') : EXPENSE_CATEGORY_SETUP.chemicals.units[0]!),
  );
  const [unitTouched, setUnitTouched] = useState(asUnit(original?.unit) != null);
  const [stockOn, setStockOn] = useState<boolean | null>(null);
  const [date, setDate] = useState(original?.date ?? today);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>(
    (original?.paymentMethod as ExpensePaymentMethod | undefined) ?? 'cash',
  );
  const [billPhoto, setBillPhoto] = useState<LocalPhoto | null>(null);
  const [itemPhoto, setItemPhoto] = useState<LocalPhoto | null>(null);
  const [savedPhotos, setSavedPhotos] = useState<Record<ExpensePhotoKind, PhotoSource | null>>({ bill: null, item: null });
  const [photoBusy, setPhotoBusy] = useState<ExpensePhotoKind | null>(null);
  const [viewing, setViewing] = useState<ExpensePhotoKind | null>(null);
  const [note, setNote] = useState(original?.description ?? '');
  const [noteOpen, setNoteOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(false);
  const photos = useRef<{ bill: LocalPhoto | null; item: LocalPhoto | null }>({ bill: null, item: null });
  photos.current = { bill: billPhoto, item: itemPhoto };

  // Leaving without saving throws away the photo copies kept on this phone.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', () => {
        if (saved.current) return;
        if (photos.current.bill) void deleteLocalCopy(photos.current.bill.uri);
        if (photos.current.item) void deleteLocalCopy(photos.current.item.uri);
      }),
    [navigation],
  );

  // When editing, show the photos that were taken (they can't be changed).
  useEffect(() => {
    if (!original) return;
    let cancelled = false;
    void Promise.all([
      original.hasBillPhoto ? expensePhotoSource(original.id, 'bill') : null,
      original.hasItemPhoto ? expensePhotoSource(original.id, 'item') : null,
    ]).then(([bill, itm]) => {
      if (!cancelled) setSavedPhotos({ bill, item: itm });
    });
    return () => {
      cancelled = true;
    };
  }, [original]);

  const cat: ExpenseCategory = category ?? 'chemicals';
  const setup = EXPENSE_CATEGORY_SETUP[cat];
  const tone = CATEGORY_TONE[cat];
  const rupees = Number(amount || '0');
  const paise = Number.isFinite(rupees) ? Math.round(rupees * 100) : 0;
  const quantity = parseQuantity(qty);
  const rate = quantity ? ratePerUnit(paise, quantity, unit) : null;

  const stockUnit = stockUnitOf(unit);
  const stockable = STOCK_CATEGORIES.includes(cat) && stockUnit != null;
  const stockMatch = item.trim() ? (stock.find((s) => stockKey(s.name) === stockKey(item)) ?? null) : null;
  const stockClash = stockMatch != null && stockMatch.unit !== stockUnit;
  // On by default for chemicals, or when the item is already tracked.
  const addToStock = !editing && stockable && !stockClash && (stockOn ?? (cat === 'chemicals' || stockMatch != null));
  const stockQty = stockMatch && quantity ? toStockQuantity(quantity, unit, stockMatch.unit) : null;
  const stockAfter = stockMatch && stockQty != null ? roundStock(stockMatch.balance + stockQty) : null;

  // What an edit changes, field by field; only these are sent.
  const patch = useMemo<ExpensePatch>(() => {
    if (!original) return {};
    const p: ExpensePatch = {};
    if (category && category !== original.category) p.category = category;
    if (paise !== original.amount) p.amount = paise;
    if (item.trim() !== (original.itemName ?? '')) p.itemName = item.trim();
    const newQty = quantity ?? null;
    const newUnit = quantity ? unit : null;
    if (newQty !== (original.quantity ?? null) || newUnit !== (original.unit ?? null)) {
      p.quantity = newQty;
      p.unit = newUnit;
    }
    if ((note.trim() || null) !== (original.description ?? null)) p.description = note.trim() || null;
    if (paymentMethod !== (original.paymentMethod ?? 'cash')) p.paymentMethod = paymentMethod;
    if (date !== original.date) p.date = date;
    return p;
  }, [original, category, paise, item, quantity, unit, note, paymentMethod, date]);
  const changedCount = Object.keys(patch).filter((k) => k !== 'unit' || !('quantity' in patch)).length;

  const stepReady = [
    paise > 0 && category != null,
    item.trim().length > 0 && (!setup.quantityRequired || quantity != null),
    editing ? changedCount > 0 : billPhoto != null && itemPhoto != null,
  ];
  const stepMissing = useMemo(
    () =>
      [
        [paise > 0 ? null : 'the amount', category ? null : 'a category'],
        [item.trim() ? null : setup.itemLabel.toLowerCase(), setup.quantityRequired && !quantity ? 'the quantity' : null],
        editing
          ? ['a change — nothing is different yet']
          : [billPhoto ? null : `${setup.billPhotoLabel.toLowerCase()} photo`, itemPhoto ? null : `${setup.itemPhotoLabel.toLowerCase()} photo`],
      ].map((list) => list.filter((m): m is string => m != null)),
    [paise, category, item, setup, quantity, billPhoto, itemPhoto, editing],
  );

  const onKey = (k: Key) => {
    setError(null);
    setAmount((a) => {
      if (k === 'back') return a.slice(0, -1);
      if (k === '.') return a.includes('.') ? a : a ? `${a}.` : '0.';
      const [whole, frac] = a.split('.');
      if (frac != null && frac.length >= 2) return a;
      if (frac == null && (whole ?? '').length >= 7) return a;
      return a === '0' ? k : a + k;
    });
  };

  const bump = (by: number) => setAmount(String(Math.round((rupees + by) * 100) / 100));

  const pickCategory = (c: ExpenseCategory) => {
    if (c !== category) {
      // A suggestion from the old category ("Foam shampoo") makes no sense under the new one.
      const keepItem = item && category && !EXPENSE_CATEGORY_SETUP[category].itemSuggestions.includes(item) ? item : '';
      setItem(keepItem);
      setUnit(defaultExpenseUnit(c, keepItem));
      setUnitTouched(false);
      setStockOn(null);
    }
    setCategory(c);
  };

  const pickItem = (name: string) => {
    setItem(name);
    if (!unitTouched) setUnit(defaultExpenseUnit(cat, name));
  };

  const nudgeQty = (dir: 1 | -1) => {
    const next = Math.max(0, (quantity ?? 0) + dir * stepFor(unit));
    setQty(next ? String(Math.round(next * 1000) / 1000) : '');
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
    const contentType: LocalPhoto['contentType'] = asset.type === 'image/png' ? 'image/png' : 'image/jpeg';
    setPhotoBusy(kind);
    setError(null);
    try {
      const uri = await keepLocalCopy(asset.uri, `${expenseId}-${kind}-${Date.now()}`, contentType === 'image/png' ? 'png' : 'jpg');
      if (current) void deleteLocalCopy(current.uri);
      (kind === 'bill' ? setBillPhoto : setItemPhoto)({ uri, contentType });
    } catch {
      setError('Couldn’t save that photo.');
    } finally {
      setPhotoBusy(null);
    }
  };

  const save = async () => {
    if (!category || !billPhoto || !itemPhoto || !stepReady.every(Boolean)) return;
    setBusy(true);
    setError(null);
    const result = await submit({
      kind: 'expense.create',
      payload: {
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
      },
    });
    setBusy(false);
    if (result.status === 'rejected') {
      setError(result.message);
      return;
    }
    saved.current = true;
    const stockNow =
      result.status === 'sent'
        ? (result.data as { stock?: { name: string; unit: string; balance: number } | null } | null)?.stock
        : null;
    const dayNote = date === today ? '' : date === yesterday ? ' for yesterday' : ` for ${formatDay(date)}`;
    showToast(
      result.status === 'queued'
        ? `Expense saved offline${dayNote} — will sync automatically`
        : stockNow
          ? `Expense added${dayNote} · ${stockNow.name} now ${formatStock(stockNow.balance, stockNow.unit as StockUnit)} in stock`
          : `Expense added${dayNote}`,
      result.status === 'queued' ? 'offline' : 'success',
    );
    if (result.status === 'sent') void refreshStock();
    navigation.navigate('Expenses', { added: date });
  };

  const saveEdit = async (reason: string): Promise<string | null> => {
    if (!original) return null;
    try {
      const res = await api.expenses[':id'].$patch({ param: { id: original.id }, json: { ...patch, reason } });
      if (!res.ok) return apiErrorMessage(res, 'Couldn’t save the changes.');
      saved.current = true;
      setReasonOpen(false);
      showToast('Expense updated', 'success');
      void refreshStock();
      navigation.navigate('Expenses', { added: date });
      return null;
    } catch (e) {
      return e instanceof NetworkError ? 'Editing needs a connection.' : 'Couldn’t save the changes.';
    }
  };

  const back = () => (step === 0 ? navigation.goBack() : setStep((s) => (s - 1) as Step));
  const next = () => {
    if (!stepReady[step]) return;
    if (step < 2) setStep((s) => (s + 1) as Step);
    else if (editing) setReasonOpen(true);
    else void save();
  };

  const viewingPhoto: PhotoSource | null = viewing
    ? (viewing === 'bill' ? billPhoto : itemPhoto) ?? savedPhotos[viewing]
    : null;
  const olderDay = !lastDays(7).includes(date);
  const accent = category ? tone.fg : colors.indigoMist;

  const receiptRows: { label: string; value: string }[] = [
    { label: 'Item', value: item.trim() || '—' },
    ...(quantity ? [{ label: 'Quantity', value: rate ? `${formatExpenseQuantity(quantity, unit)} · ${rate}` : formatExpenseQuantity(quantity, unit) }] : []),
    { label: 'Spent on', value: EXPENSE_CATEGORY_LABEL[cat] },
    { label: 'Paid with', value: paidLabel(paymentMethod) },
    { label: 'Date', value: formatDay(date) },
  ];

  return (
    <ScreenContainer noPadding edges={['bottom']}>
      {/* Night header: back, the step, progress — and on step 1, the amount itself */}
      <LinearGradient
        colors={brandGradients.hero.colors as unknown as string[]}
        locations={brandGradients.hero.locations as unknown as number[]}
        start={brandGradients.hero.start}
        end={brandGradients.hero.end}
        style={[styles.hero, step === 0 && styles.heroGrow, { paddingTop: insets.top + spacing.sm }]}
      >
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          {STARS.map(([x, y, r, o]) => (
            <Circle key={`${x}-${y}`} cx={x} cy={y + insets.top} r={r} fill="#FFFFFF" fillOpacity={o} />
          ))}
        </Svg>
        <Svg style={[styles.heroMark, { top: insets.top - 10 }]} width={150} height={150} viewBox="0 0 256 256">
          <G>
            <Path d={BRAND_MARK.drop} fill="#FFFFFF" fillOpacity={0.06} />
            <Path d={BRAND_MARK.arms} fill="#FFFFFF" fillOpacity={0.09} />
            <Path d={BRAND_MARK.centre} fill="#FFFFFF" fillOpacity={0.13} />
          </G>
        </Svg>

        <View style={styles.headerRow}>
          <Pressable onPress={back} hitSlop={8} style={({ pressed }) => [styles.glassBtn, pressed && styles.pressed]} accessibilityLabel="Back">
            <IconChevronLeft size={20} color={colors.white} />
          </Pressable>
          <View style={styles.flex}>
            <Text style={styles.heroTitle}>{editing ? 'Edit expense' : 'New expense'}</Text>
            <Text style={styles.heroStep}>
              Step {step + 1} of 3 · {STEP_TITLES[step]}
            </Text>
          </View>
        </View>
        <View style={styles.progress}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: i <= step ? '100%' : '0%', backgroundColor: i <= step ? accent : 'transparent' }]} />
            </View>
          ))}
        </View>

        {step === 0 ? (
          <View style={styles.amountBox}>
            <Text style={styles.amountEyebrow}>Amount paid</Text>
            <Text style={[styles.amountText, !paise && styles.amountEmpty]} numberOfLines={1} adjustsFontSizeToFit>
              <Text style={styles.amountRupee}>₹</Text>
              {amountDisplay(amount)}
            </Text>
            <View style={styles.quickRow}>
              {QUICK_ADD.map((n) => (
                <Pressable key={n} onPress={() => bump(n)} style={({ pressed }) => [styles.glassChip, pressed && styles.pressed]} accessibilityLabel={`Add ${n} rupees`}>
                  <Text style={styles.glassChipText}>+₹{n.toLocaleString('en-IN')}</Text>
                </Pressable>
              ))}
              {amount ? (
                <Pressable onPress={() => setAmount('')} style={({ pressed }) => [styles.glassChip, styles.clearChip, pressed && styles.pressed]} accessibilityLabel="Clear amount">
                  <Text style={styles.glassChipText}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setStep(0)} style={({ pressed }) => [styles.summary, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Change amount or category">
            <View style={[styles.summaryIcon, { backgroundColor: tone.bg }]}>
              <ExpenseCategoryIcon category={cat} size={16} color={tone.fg} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.summaryAmount}>{formatRupees(paise)}</Text>
              <Text style={styles.summaryText} numberOfLines={1}>
                {EXPENSE_CATEGORY_LABEL[cat]}
                {step === 2 && item.trim() ? ` · ${item.trim()}${quantity ? ` ${formatExpenseQuantity(quantity, unit)}` : ''}` : ''}
              </Text>
            </View>
            <View style={styles.summaryEdit}>
              <IconEdit size={13} color={colors.white} />
              <Text style={styles.summaryEditText}>Change</Text>
            </View>
          </Pressable>
        )}
      </LinearGradient>

      {/* Body: one step at a time */}
      {step === 0 ? (
        <View style={styles.body}>
          <View style={styles.catBlock}>
            <Text style={styles.catTitle}>What was it for?</Text>
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
                      { backgroundColor: on ? t.fg : colors.white, borderColor: on ? t.fg : colors.border },
                      pressed && !on && styles.pressed,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <View style={[styles.catIcon, { backgroundColor: on ? 'rgba(255,255,255,0.2)' : t.bg }]}>
                      <ExpenseCategoryIcon category={c} size={18} color={on ? colors.white : t.fg} />
                    </View>
                    <Text style={[styles.catText, { color: on ? colors.white : colors.ink }]} numberOfLines={1}>
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

          <AmountPad onKey={onKey} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
          {step === 1 ? (
            <>
              <Section
                title={setup.itemLabel}
                tint={tone}
                icon={<ExpenseCategoryIcon category={cat} size={16} color={tone.fg} />}
              >
                <View style={[styles.input, item.trim() ? styles.inputFilled : null]}>
                  <TextInput
                    style={styles.inputText}
                    value={item}
                    onChangeText={pickItem}
                    placeholder={setup.itemPlaceholder}
                    placeholderTextColor={colors.slate}
                    autoCapitalize="sentences"
                    maxLength={80}
                  />
                  {item ? (
                    <Pressable onPress={() => pickItem('')} hitSlop={8} style={styles.clearInput} accessibilityLabel="Clear">
                      <IconClose size={12} color={colors.slateDeep} />
                    </Pressable>
                  ) : null}
                </View>
                <Text style={styles.subLabel}>Often bought</Text>
                <View style={styles.pillWrap}>
                  {setup.itemSuggestions.map((sug) => {
                    const on = item === sug;
                    return (
                      <Pressable
                        key={sug}
                        onPress={() => pickItem(on ? '' : sug)}
                        style={({ pressed }) => [styles.pill, on && { backgroundColor: tone.fg, borderColor: tone.fg }, pressed && !on && styles.pressed]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        {on ? <IconCheck size={13} color={colors.white} /> : null}
                        <Text style={[styles.pillText, on && styles.pillTextOn]} numberOfLines={1}>
                          {sug}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Section>

              <Section
                title={setup.quantityRequired ? 'How much' : 'How much (optional)'}
                tint={{ fg: colors.indigo, bg: colors.indigoPale }}
                icon={<IconBox size={16} color={colors.indigo} />}
              >
                <View style={styles.qtyStage}>
                  <Pressable
                    onPress={() => nudgeQty(-1)}
                    disabled={!quantity}
                    style={({ pressed }) => [styles.qtyBtn, !quantity && styles.off, pressed && styles.pressed]}
                    accessibilityLabel="Less"
                  >
                    <IconMinus size={20} color={colors.indigo} />
                  </Pressable>
                  <View style={styles.qtyValue}>
                    <TextInput
                      style={styles.qtyInput}
                      value={qty}
                      onChangeText={(t) => setQty(t.replace(/[^\d.]/g, ''))}
                      placeholder="0"
                      placeholderTextColor={colors.indigoMist}
                      keyboardType="decimal-pad"
                      maxLength={8}
                    />
                    <Text style={styles.qtyUnit}>{EXPENSE_UNIT_LABEL[unit]}</Text>
                  </View>
                  <Pressable onPress={() => nudgeQty(1)} style={({ pressed }) => [styles.qtyBtn, styles.qtyBtnPlus, pressed && styles.pressed]} accessibilityLabel="More">
                    <IconPlus size={20} color={colors.white} />
                  </Pressable>
                </View>
                <View style={styles.presetRow}>
                  {presetsFor(unit).map((n) => {
                    const on = quantity === n;
                    return (
                      <Pressable
                        key={n}
                        onPress={() => setQty(String(n))}
                        style={({ pressed }) => [styles.preset, on && styles.presetOn, pressed && !on && styles.pressed]}
                        accessibilityLabel={formatExpenseQuantity(n, unit)}
                      >
                        <Text style={[styles.presetText, on && styles.presetTextOn]}>{formatExpenseQuantity(n, unit)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {setup.units.length > 1 ? (
                  <View style={styles.segment}>
                    {setup.units.map((u) => {
                      const on = unit === u;
                      return (
                        <Pressable
                          key={u}
                          onPress={() => {
                            setUnit(u);
                            setUnitTouched(true);
                          }}
                          style={({ pressed }) => [styles.segmentItem, styles.segmentSmall, on && styles.segmentOn, pressed && !on && styles.pressed]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                        >
                          <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{EXPENSE_UNIT_LABEL[u]}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {rate ? (
                  <View style={styles.rateLine}>
                    <IconCheck size={13} color={colors.tealDeep} />
                    <Text style={styles.rateText}>
                      {formatExpenseQuantity(quantity!, unit)} for {formatRupees(paise)} = <Text style={styles.rateStrong}>{rate}</Text>
                    </Text>
                  </View>
                ) : null}
              </Section>

              {stockable && !editing ? (
                <Pressable
                  onPress={() => !stockClash && setStockOn(!addToStock)}
                  style={[styles.card, styles.stockRow, addToStock && styles.stockRowOn]}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: addToStock, disabled: stockClash }}
                >
                  <View style={[styles.cardIcon, addToStock ? styles.stockIconOn : { backgroundColor: colors.indigoPale }]}>
                    <IconBox size={16} color={addToStock ? colors.white : colors.indigo} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.stockTitle}>Add to stock</Text>
                    <Text style={[styles.stockHint, stockClash && { color: colors.amberDeep }]} numberOfLines={2}>
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
                    trackColor={{ false: colors.border, true: colors.indigoMist }}
                    thumbColor={addToStock ? colors.indigo : colors.white}
                  />
                </Pressable>
              ) : null}
              {editing && stockable ? (
                <View style={styles.infoLine}>
                  <IconBox size={14} color={colors.slateDeep} />
                  <Text style={styles.infoText}>If this went into stock, stock is corrected when the item or quantity changes.</Text>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <Section
                title={editing ? 'Proof photos' : 'Two photos, so every rupee can be checked'}
                tint={tone}
                icon={<IconCamera size={16} color={tone.fg} />}
              >
                <View style={styles.photoRow}>
                  {(['bill', 'item'] as const).map((kind) => {
                    const local = kind === 'bill' ? billPhoto : itemPhoto;
                    const label = kind === 'bill' ? setup.billPhotoLabel : setup.itemPhotoLabel;
                    return (
                      <ProofTile
                        key={kind}
                        label={label}
                        hint={kind === 'bill' ? 'Total and shop name readable' : setup.itemPhotoHint}
                        photo={local ?? savedPhotos[kind]}
                        busy={photoBusy === kind}
                        locked={editing}
                        tone={tone}
                        onTake={() => void takePhoto(kind)}
                        onView={() => setViewing(kind)}
                      />
                    );
                  })}
                </View>
                {editing ? (
                  <View style={styles.infoLine}>
                    <IconLock size={12} color={colors.slateDeep} />
                    <Text style={styles.infoText}>Photos stay exactly as they were taken.</Text>
                  </View>
                ) : null}
              </Section>

              <Section title="Paid with" tint={{ fg: colors.tealDeep, bg: '#DDF5EF' }} icon={<IconWallet size={16} color={colors.tealDeep} />}>
                <View style={styles.payRow}>
                  {PAID_WITH.map((m) => {
                    const on = paymentMethod === m.key;
                    const t = PAY_TONE[m.key];
                    return (
                      <Pressable
                        key={m.key}
                        onPress={() => setPaymentMethod(m.key)}
                        style={({ pressed }) => [styles.payCard, on && styles.payCardOn, pressed && !on && styles.pressed]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityHint={m.hint}
                      >
                        <View style={[styles.payIcon, { backgroundColor: t.bg }]}>
                          {m.key === 'cash' ? <IconCash size={20} color={t.fg} /> : m.key === 'upi' ? <IconUpi size={20} color={t.fg} /> : <IconWallet size={20} color={t.fg} />}
                        </View>
                        <Text style={styles.payLabel}>{m.label}</Text>
                        <Text style={styles.payHint} numberOfLines={1}>
                          {m.hint}
                        </Text>
                        {on ? (
                          <View style={styles.payCheck}>
                            <IconCheck size={11} color={colors.white} />
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </Section>

              <Section title="When was it paid?" tint={{ fg: colors.indigo, bg: colors.indigoPale }} icon={<IconCalendar size={16} color={colors.indigo} />}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayStrip}>
                  {lastDays(7).map((d, i) => {
                    const on = date === d;
                    const parts = dayParts(d);
                    return (
                      <Pressable
                        key={d}
                        onPress={() => setDate(d)}
                        style={({ pressed }) => [styles.dayChip, on && styles.dayChipOn, pressed && !on && styles.pressed]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={formatDay(d)}
                      >
                        <Text style={[styles.dayWeek, on && styles.dayTextOn]}>{i === 0 ? 'Today' : parts.weekday}</Text>
                        <Text style={[styles.dayNum, on && styles.dayTextOn]}>{parts.day}</Text>
                      </Pressable>
                    );
                  })}
                  <Pressable
                    onPress={() => setCalendarOpen(true)}
                    style={({ pressed }) => [styles.dayChip, styles.dayMore, olderDay && styles.dayChipOn, pressed && !olderDay && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Pick an older date"
                  >
                    <IconCalendar size={16} color={olderDay ? colors.white : colors.indigo} />
                    <Text style={[styles.dayWeek, olderDay && styles.dayTextOn]}>
                      {olderDay ? `${dayParts(date).weekday} ${dayParts(date).day}` : 'Older'}
                    </Text>
                  </Pressable>
                </ScrollView>
                {noteOpen || note ? (
                  <View style={styles.input}>
                    <IconEdit size={16} color={colors.slate} />
                    <TextInput
                      style={styles.inputText}
                      value={note}
                      onChangeText={setNote}
                      placeholder={`${setup.noteLabel} (optional) — ${setup.notePlaceholder}`}
                      placeholderTextColor={colors.slate}
                      maxLength={200}
                      autoFocus={noteOpen && !note}
                    />
                  </View>
                ) : (
                  <Pressable onPress={() => setNoteOpen(true)} style={({ pressed }) => [styles.addNote, pressed && styles.pressed]} accessibilityRole="button">
                    <IconPlus size={14} color={colors.indigo} />
                    <Text style={styles.addNoteText}>Add a note</Text>
                  </Pressable>
                )}
              </Section>

              {/* Receipt-style review of everything before saving */}
              <View style={styles.receipt}>
                <View style={styles.receiptHead}>
                  <View style={[styles.receiptIcon, { backgroundColor: tone.bg }]}>
                    <IconReceipt size={18} color={tone.fg} />
                  </View>
                  <Text style={styles.receiptTitle}>{editing ? 'After your changes' : 'Check before saving'}</Text>
                  {editing && changedCount > 0 ? (
                    <View style={styles.changedPill}>
                      <Text style={styles.changedPillText}>
                        {changedCount} change{changedCount === 1 ? '' : 's'}
                      </Text>
                    </View>
                  ) : null}
                </View>
                {receiptRows.map((r) => (
                  <View key={r.label} style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>{r.label}</Text>
                    <Text style={styles.receiptValue} numberOfLines={1}>
                      {r.value}
                    </Text>
                  </View>
                ))}
                <View style={styles.tear}>
                  <View style={[styles.notch, styles.notchLeft]} />
                  <View style={styles.dashes} />
                  <View style={[styles.notch, styles.notchRight]} />
                </View>
                <View style={styles.receiptTotal}>
                  <Text style={styles.receiptTotalLabel}>Total</Text>
                  <Text style={styles.receiptTotalValue}>{formatRupees(paise)}</Text>
                </View>
              </View>
            </>
          )}
        </ScrollView>
      )}

      {/* Pinned footer: what's still needed, and the next step */}
      <View style={[styles.footer, step === 0 && styles.footerFlat]}>
        {error ? (
          <View style={styles.errorRow}>
            <IconAlert size={14} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : !stepReady[step] ? (
          <Text style={styles.missing} numberOfLines={1}>
            {editing && step === 2 ? 'Nothing changed yet' : `Still needed: ${stepMissing[step]!.join(' · ')}`}
          </Text>
        ) : null}
        <Button
          label={step < 2 ? 'Next' : editing ? 'Save changes' : `Save ${formatRupees(paise)}`}
          size="lg"
          loading={busy}
          disabled={!stepReady[step]}
          onPress={next}
        />
      </View>

      <CalendarSheet
        visible={calendarOpen}
        mode="plain"
        value={date}
        max={today}
        min={isoDaysAgo(isOwner ? 365 : 31)}
        title="When was it paid?"
        subtitle={isOwner ? 'Pick the date on the bill.' : 'Pick the date on the bill — up to 31 days back.'}
        onClose={() => setCalendarOpen(false)}
        onSelect={(d) => {
          setDate(d);
          setCalendarOpen(false);
        }}
      />
      <PhotoViewer
        source={viewingPhoto}
        title={viewing === 'bill' ? `${setup.billPhotoLabel} photo` : `${setup.itemPhotoLabel} photo`}
        onClose={() => setViewing(null)}
      />
      <ReasonSheet
        visible={reasonOpen}
        title="Why the change?"
        subtitle={`${changedCount} change${changedCount === 1 ? '' : 's'} · saved in the staff report`}
        confirmLabel="Save changes"
        confirmVariant="primary"
        quickReasons={EDIT_REASONS}
        onClose={() => setReasonOpen(false)}
        onConfirm={saveEdit}
      />
    </ScreenContainer>
  );
}

const CARD_SHADOW = {
  shadowColor: '#0C1442',
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.72 },
  off: { opacity: 0.35 },

  // Night header
  hero: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm + 2,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
  },
  // Step 1: the header takes the spare height, so the amount sits big in the middle of it.
  heroGrow: { flex: 1, minHeight: 190 },
  heroMark: { position: 'absolute', right: -24 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  glassBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { ...typography.heading, fontSize: 19, color: colors.white },
  heroStep: { ...typography.caption, fontSize: 12.5, color: 'rgba(255,255,255,0.68)', letterSpacing: 0 },
  progress: { flexDirection: 'row', gap: 6 },
  progressTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  progressFill: { height: 5, borderRadius: 3 },
  amountBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 2 },
  amountEyebrow: {
    ...typography.caption,
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  amountText: { ...typography.display, fontSize: 56, color: colors.white, letterSpacing: -1, marginVertical: 2 },
  amountEmpty: { color: 'rgba(255,255,255,0.35)' },
  amountRupee: { fontSize: 32, color: 'rgba(255,255,255,0.7)' },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  glassChip: {
    paddingHorizontal: 14,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
  },
  glassChipText: { ...typography.label, fontSize: 13, color: colors.white, fontWeight: '700' },
  clearChip: { backgroundColor: 'rgba(248,113,113,0.18)', borderColor: 'rgba(248,113,113,0.4)' },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    padding: spacing.sm + 2,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  summaryIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  summaryAmount: { ...typography.heading, fontSize: 18, color: colors.white },
  summaryText: { ...typography.caption, fontSize: 12.5, color: 'rgba(255,255,255,0.72)', letterSpacing: 0 },
  summaryEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  summaryEditText: { ...typography.caption, fontSize: 12, color: colors.white, fontWeight: '700', letterSpacing: 0 },

  // Cards
  card: {
    backgroundColor: colors.white,
    borderRadius: 22,
    padding: spacing.md,
    gap: spacing.sm + 2,
    ...CARD_SHADOW,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...typography.bodyStrong, flex: 1, fontSize: 15, color: colors.ink, fontWeight: '800' },
  catBlock: { gap: spacing.sm + 2 },
  catTitle: { ...typography.bodyStrong, fontSize: 15, color: colors.ink, fontWeight: '800' },

  // Step 1
  body: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md, backgroundColor: colors.white },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  catTile: {
    flexBasis: '31%',
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: 1,
  },
  catIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  catText: { ...typography.label, fontSize: 13, fontWeight: '700' },
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
  pad: { gap: 10, paddingBottom: spacing.sm, paddingTop: 2, width: '100%', maxWidth: 360, alignSelf: 'center' },
  padRow: { flexDirection: 'row', justifyContent: 'space-between' },
  padKey: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  padKeyGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  padKeyPressed: { opacity: 0.6, transform: [{ scale: 0.96 }] },
  padText: { ...typography.title, fontSize: 28, color: colors.waterInk, fontWeight: '600' },
  padDot: { fontSize: 30, lineHeight: 30 },

  // Steps 2 and 3
  scrollBody: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg, gap: spacing.md },
  hint: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0, marginTop: -4 },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 52,
    paddingHorizontal: spacing.md,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  inputText: { ...typography.body, flex: 1, fontSize: 16, color: colors.ink, paddingVertical: 0 },
  inputFilled: { borderColor: colors.indigo, backgroundColor: colors.white },
  clearInput: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  subLabel: {
    ...typography.caption,
    fontSize: 11.5,
    color: colors.slate,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
    marginTop: 2,
  },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  pillText: { ...typography.label, fontSize: 13.5, color: colors.ink, fontWeight: '600' },
  pillTextOn: { color: colors.white, fontWeight: '800' },
  qtyStage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm + 2,
    borderRadius: 20,
    backgroundColor: '#F5F7FF',
  },
  presetRow: { flexDirection: 'row', gap: spacing.sm },
  preset: {
    flex: 1,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  presetOn: { borderColor: colors.indigo, backgroundColor: colors.indigoPale },
  presetText: { ...typography.label, fontSize: 14, color: colors.ink, fontWeight: '700' },
  presetTextOn: { color: colors.indigo, fontWeight: '800' },
  segmentSmall: { height: 34 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  qtyBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnPlus: { backgroundColor: colors.indigo },
  qtyValue: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  qtyInput: { ...typography.display, minWidth: 36, fontSize: 38, color: colors.ink, textAlign: 'center', paddingVertical: 0, paddingHorizontal: 0 },
  qtyUnit: { ...typography.label, fontSize: 16, color: colors.slateDeep, fontWeight: '700' },
  rateLine: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E6F7F2',
  },
  rateText: { ...typography.caption, fontSize: 12.5, color: colors.tealDeep, letterSpacing: 0 },
  rateStrong: { fontWeight: '800' },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  stockRowOn: { backgroundColor: colors.indigoPale },
  stockIconOn: { backgroundColor: colors.indigo },
  stockTitle: { ...typography.bodyStrong, fontSize: 14.5, color: colors.ink, fontWeight: '800' },
  stockHint: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  infoLine: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  infoText: { ...typography.caption, flex: 1, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  photoRow: { flexDirection: 'row', gap: spacing.sm + 2 },
  proof: {
    flex: 1,
    height: 176,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: spacing.sm,
    overflow: 'hidden',
  },
  proofFilled: { padding: 0 },
  proofLocked: { backgroundColor: colors.surface },
  proofGlow: { position: 'absolute', width: 140, height: 140, borderRadius: 70, top: -40, right: -50, opacity: 0.35 },
  proofImage: { ...StyleSheet.absoluteFillObject, width: undefined, height: undefined },
  proofShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 64 },
  proofBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proofCaption: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  proofCaptionText: { ...typography.label, flex: 1, fontSize: 13, color: colors.white, fontWeight: '800' },
  retake: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  retakeText: { ...typography.caption, fontSize: 11.5, color: colors.white, fontWeight: '700', letterSpacing: 0 },
  proofCam: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  proofLabel: { ...typography.label, fontSize: 14, color: colors.white, fontWeight: '800' },
  proofHint: { ...typography.caption, fontSize: 11.5, color: 'rgba(255,255,255,0.62)', textAlign: 'center', letterSpacing: 0 },
  proofHintDark: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, textAlign: 'center', letterSpacing: 0 },
  proofTap: {
    marginTop: 2,
    paddingHorizontal: 10,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.white,
    justifyContent: 'center',
  },
  proofTapText: { ...typography.caption, fontSize: 11, color: colors.indigo, fontWeight: '800', letterSpacing: 0 },
  payRow: { flexDirection: 'row', gap: spacing.sm },
  payCard: {
    flex: 1,
    padding: spacing.sm + 2,
    gap: 4,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  payCardOn: { borderColor: colors.indigo, backgroundColor: '#F5F7FF' },
  payIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  payLabel: { ...typography.bodyStrong, fontSize: 15, color: colors.ink, fontWeight: '800' },
  payHint: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, letterSpacing: 0 },
  payCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.indigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayStrip: { gap: spacing.sm, paddingVertical: 2 },
  dayChip: {
    width: 62,
    height: 70,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dayChipOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  dayMore: { width: 76, gap: 6 },
  dayWeek: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, fontWeight: '700', letterSpacing: 0 },
  dayNum: { ...typography.heading, fontSize: 22, color: colors.ink },
  dayTextOn: { color: colors.white },
  segment: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: radius.pill,
  },
  segmentOn: { backgroundColor: colors.indigo },
  segmentText: { ...typography.label, fontSize: 13.5, color: colors.slateDeep },
  segmentTextOn: { color: colors.white, fontWeight: '800' },
  addNote: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 2 },
  addNoteText: { ...typography.label, fontSize: 13.5, color: colors.indigo, fontWeight: '700' },

  // Receipt
  receipt: { backgroundColor: colors.white, borderRadius: 22, paddingTop: spacing.md, ...CARD_SHADOW },
  receiptHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  receiptIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  receiptTitle: { ...typography.bodyStrong, flex: 1, fontSize: 15, color: colors.ink, fontWeight: '800' },
  changedPill: { paddingHorizontal: 10, height: 24, borderRadius: 12, backgroundColor: '#E0F2FE', justifyContent: 'center' },
  changedPillText: { ...typography.caption, fontSize: 12, color: '#0369A1', fontWeight: '800', letterSpacing: 0 },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 6 },
  receiptLabel: { ...typography.body, fontSize: 13.5, color: colors.slateDeep },
  receiptValue: { ...typography.bodyStrong, flexShrink: 1, fontSize: 13.5, color: colors.ink, textAlign: 'right' },
  tear: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  notch: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.surface },
  notchLeft: { marginLeft: -10 },
  notchRight: { marginRight: -10 },
  dashes: { flex: 1, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, marginHorizontal: 6 },
  receiptTotal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  receiptTotalLabel: { ...typography.label, fontSize: 14, color: colors.slateDeep, fontWeight: '700' },
  receiptTotalValue: { ...typography.display, fontSize: 26, color: colors.ink, letterSpacing: -0.5 },

  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.md,
    gap: 6,
    backgroundColor: colors.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    ...CARD_SHADOW,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  footerFlat: { elevation: 0, shadowOpacity: 0 },
  missing: { ...typography.caption, fontSize: 12.5, color: colors.amberDeep, letterSpacing: 0, textAlign: 'center' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  errorText: { ...typography.caption, fontSize: 12.5, color: colors.danger, letterSpacing: 0, flexShrink: 1 },
});
