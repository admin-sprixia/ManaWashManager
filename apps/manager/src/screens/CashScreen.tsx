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
import { cashDifference, closeNeedsNote, MIN_REASON_LENGTH } from '@mana/domain';
import {
  BRAND_MARK,
  BottomSheet,
  ScreenContainer,
  ScreenHeader,
  Button,
  showToast,
  IconAlert,
  IconCalendar,
  IconCash,
  IconCheck,
  IconClock,
  IconDrawer,
  IconEdit,
  IconMinus,
  IconPlus,
  IconReceipt,
  IconSync,
  brandGradients,
  colors,
  radius,
  shadow,
  spacing,
  typography,
} from '@mana/ui';
import { EdgeGroup, EdgeRow, Pill } from '../components/EdgeList';
import { PeriodSelect, type PeriodKey } from '../components/PeriodSelect';
import { ReasonSheet } from '../components/ReasonSheet';
import { CalendarSheet } from '../components/CalendarSheet';
import { MoneyInput } from '../components/cash/MoneyInput';
import { DoorstepCashCard, hasDoorstepCash, type DoorstepDay } from '../components/cash/DoorstepCashCard';
import type { DateRange } from '../components/RangeCalendar';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { formatDateTime, formatDay, formatRupees, istDate, parseRupees } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Cash'>;

interface CashDay {
  date: string;
  status: 'not_started' | 'open' | 'closed';
  openingFloat: number | null;
  floatSetBy: string | null;
  suggestedFloat: number | null;
  cashIn: number;
  cashJobs: number;
  cashExpenses: number;
  cashExpenseCount: number;
  doorstep: DoorstepDay;
  expected: number;
  counted: number | null;
  difference: number | null;
  note: string | null;
  /** Doorstep cash still with the team when the day closed. */
  heldAtClose: number | null;
  closedBy: string | null;
  closedAt: string | null;
  changedSinceClose: number;
  reopenedBy: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  /** Closes of this day that were reopened, newest first. */
  earlierCloses?: EarlierClose[];
}

interface EarlierClose {
  expected: number | null;
  counted: number | null;
  difference: number | null;
  note: string | null;
  closedBy: string | null;
  closedAt: string;
  reopenedBy: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
}

interface HistoryDay {
  date: string;
  status: 'closed' | 'open';
  expected: number | null;
  counted: number | null;
  difference: number | null;
  note: string | null;
  heldAtClose: number | null;
  closedBy: string | null;
  reopenedBy: string | null;
}

const HISTORY_OPTIONS: { key: PeriodKey; label: string; hint: string }[] = [
  { key: 'week', label: 'Last 7 days', hint: 'Rolling week, including today' },
  { key: 'month', label: 'This month', hint: 'From the 1st' },
  { key: 'year', label: 'This year', hint: 'From 1 January' },
];

const QUICK_REASONS = ['Wrong change given', 'Payment marked wrong', 'Expense not added', 'Owner took cash'];

/** Notes and coins for "count by notes", in rupees. Coins are entered as one rupee total. */
const NOTES = [500, 200, 100, 50, 20, 10] as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Same alert colours as Inventory — red when cash is short, amber when over, teal when it matches. */
const HERO_MISSING = ['#B91C1C', '#7F1D1D', '#450A0A'];
const HERO_EXTRA = ['#F59E0B', '#D97706', '#92400E'];
const HERO_MATCH = ['#0F766E', '#0B4F4A', '#062B28'];

type DotTone = 'match' | 'off' | 'open';
const DOT_COLOR: Record<DotTone, string> = {
  match: colors.teal,
  off: colors.danger,
  open: colors.amber,
};

/** [x, y, radius, opacity] in the hero's 340 × 200 box. */
const STARS = [
  [24, 30, 1.3, 0.5],
  [88, 16, 1, 0.4],
  [160, 46, 1.2, 0.35],
  [70, 150, 1.1, 0.3],
  [198, 20, 1.4, 0.55],
] as const;

function weekdayOf(date: string): string {
  return new Date(`${date}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'short' });
}

function differenceText(diff: number): string {
  if (diff === 0) return 'Matches';
  return diff < 0 ? `${formatRupees(-diff)} missing` : `${formatRupees(diff)} extra`;
}

function differenceTone(diff: number): 'teal' | 'danger' | 'amber' {
  return diff === 0 ? 'teal' : diff < 0 ? 'danger' : 'amber';
}

/** Big date block for history rows: "02" over "Oct". */
function DateBlock({ date }: { date: string }) {
  const month = MONTHS[Number(date.slice(5, 7)) - 1] ?? '';
  return (
    <View style={styles.dateBlock}>
      <Text style={styles.dateDay}>{date.slice(8, 10)}</Text>
      <Text style={styles.dateMonth}>{month}</Text>
    </View>
  );
}

/** One part of the drawer's sum, inside the hero: morning cash, cash from washes, cash spent. */
function SumChip({
  label,
  value,
  sub,
  sign,
  onPress,
}: {
  label: string;
  value: number;
  sub?: string;
  sign?: '+' | '−';
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.sumChip, pressed && styles.sumChipPressed]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `${label} ${formatRupees(value)}, change` : undefined}
    >
      <View style={styles.sumChipHead}>
        <Text style={styles.sumChipLabel} numberOfLines={1}>
          {label}
        </Text>
        {onPress ? <IconEdit size={11} color="rgba(255,255,255,0.75)" /> : null}
      </View>
      <Text style={styles.sumChipValue} numberOfLines={1} adjustsFontSizeToFit>
        {sign ? `${sign}` : ''}
        {formatRupees(value)}
      </Text>
      {sub ? (
        <Text style={styles.sumChipSub} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Tap + / − for each note; coins as one total. Adds them up into the closing count. */
function NoteCounter({
  counts,
  coins,
  onCount,
  onCoins,
}: {
  counts: Record<number, number>;
  coins: string;
  onCount: (note: number, n: number) => void;
  onCoins: (t: string) => void;
}) {
  return (
    <View style={styles.notes}>
      {NOTES.map((note) => {
        const n = counts[note] ?? 0;
        return (
          <View key={note} style={[styles.noteCell, n > 0 && styles.noteCellOn]}>
            <Text style={[styles.noteFace, n > 0 && styles.noteFaceOn]}>₹{note}</Text>
            <View style={styles.noteStepper}>
              <Pressable
                onPress={() => onCount(note, Math.max(0, n - 1))}
                disabled={n === 0}
                hitSlop={6}
                style={({ pressed }) => [styles.stepBtn, n === 0 && styles.stepBtnOff, pressed && styles.pressed]}
                accessibilityLabel={`One less ₹${note} note`}
              >
                <IconMinus size={13} color={colors.indigo} />
              </Pressable>
              <TextInput
                style={styles.noteCount}
                value={n ? String(n) : ''}
                onChangeText={(t) => onCount(note, Math.min(9999, Number(t.replace(/\D/g, '')) || 0))}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.slate}
                maxLength={4}
                accessibilityLabel={`₹${note} notes`}
              />
              <Pressable
                onPress={() => onCount(note, Math.min(9999, n + 1))}
                hitSlop={6}
                style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
                accessibilityLabel={`One more ₹${note} note`}
              >
                <IconPlus size={13} color={colors.indigo} />
              </Pressable>
            </View>
          </View>
        );
      })}
      <View style={[styles.noteCell, styles.coinCell, coins.trim() ? styles.noteCellOn : null]}>
        <Text style={[styles.noteFace, coins.trim() ? styles.noteFaceOn : null]}>Coins</Text>
        <View style={styles.coinField}>
          <Text style={styles.coinRupee}>₹</Text>
          <TextInput
            style={styles.coinInput}
            value={coins}
            onChangeText={(t) => onCoins(t.replace(/[^\d]/g, ''))}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={colors.slate}
            maxLength={6}
            accessibilityLabel="Coins total in rupees"
          />
        </View>
      </View>
    </View>
  );
}

/**
 * Daily cash drawer in two steps: morning cash in, then a counted close at night, with cash
 * washes and cash expenses tracked in between. Everything for the day sits on one screen: the
 * drawer card does the sum, and one panel below changes with the step. Anyone on shift can run
 * it; a mismatch needs a note, and only the owner can reopen. Past days open in a sheet.
 */
export function CashScreen({ navigation, route }: Props) {
  const { isOwner } = useAuth();
  const [date, setDate] = useState(route.params?.date ?? istDate(0));
  const [day, setDay] = useState<CashDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [floatText, setFloatText] = useState('');
  const [editingFloat, setEditingFloat] = useState(false);
  const [countText, setCountText] = useState('');
  const [byNotes, setByNotes] = useState(false);
  const [noteCounts, setNoteCounts] = useState<Record<number, number>>({});
  const [coinsText, setCoinsText] = useState('');
  const [note, setNote] = useState('');
  const [leaveHeld, setLeaveHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dayLogOpen, setDayLogOpen] = useState(false);
  const [historyPeriod, setHistoryPeriod] = useState<PeriodKey>('week');
  const [historyRange, setHistoryRange] = useState<DateRange | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [week, setWeek] = useState<Record<string, HistoryDay>>({});
  const [history, setHistory] = useState<{
    days: HistoryDay[];
    totals: { short: number; over: number };
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.cash.day.$get({ query: { date } });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t load the cash drawer.'));
      const data = (await res.json()) as CashDay;
      setDay(data);
      setFloatText(
        data.openingFloat != null
          ? String(data.openingFloat / 100)
          : data.suggestedFloat != null
            ? String(data.suggestedFloat / 100)
            : '',
      );
      setError(null);
    } catch (e) {
      setError(
        e instanceof NetworkError ? 'The cash drawer needs a connection. Pull down to retry.' : (e as Error).message,
      );
    } finally {
      setLoading(false);
    }
  }, [date]);

  const today = istDate(0);
  const yesterday = istDate(1);
  const [yesterdayOpen, setYesterdayOpen] = useState(false);
  // A day whose morning cash was entered but never closed — usually a forgotten close.
  const checkYesterday = useCallback(async () => {
    if (date !== today) return;
    try {
      const res = await api.cash.day.$get({ query: { date: yesterday } });
      if (!res.ok) return;
      const data = (await res.json()) as CashDay;
      setYesterdayOpen(data.status === 'open');
    } catch {
      // Offline: the main card already says so.
    }
  }, [date, today, yesterday]);

  const loadHistory = useCallback(async () => {
    if (!isOwner) return;
    try {
      const res = await api.cash.history.$get({
        query: historyRange ? { range: 'custom', from: historyRange.from, to: historyRange.to } : { range: historyPeriod },
      });
      if (!res.ok) return;
      const data = await res.json();
      if ('days' in data) setHistory({ days: data.days, totals: data.totals });
    } catch {
      // The day card already shows the offline state.
    }
  }, [isOwner, historyPeriod, historyRange]);

  const resetCount = () => {
    setCountText('');
    setNoteCounts({});
    setCoinsText('');
    setByNotes(false);
    setNote('');
    setLeaveHeld(false);
  };

  useEffect(() => {
    setLoading(true);
    resetCount();
    setFormError(null);
    setEditingFloat(false);
    setDayLogOpen(false);
    void load();
  }, [load]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    void checkYesterday();
  }, [checkYesterday]);

  // Owner: how each of the last 7 days ended, for the dots on the day strip.
  const loadWeek = useCallback(async () => {
    if (!isOwner) return;
    try {
      const res = await api.cash.history.$get({ query: { range: 'week' } });
      if (!res.ok) return;
      const data = await res.json();
      if ('days' in data) setWeek(Object.fromEntries(data.days.map((d) => [d.date, d])));
    } catch {
      // Offline: the strip just has no dots.
    }
  }, [isOwner]);

  useEffect(() => {
    void loadWeek();
  }, [loadWeek]);

  const stripDays = useMemo(() => {
    const quick = isOwner ? Array.from({ length: 7 }, (_, i) => istDate(i)) : [today, yesterday];
    return quick.includes(date) ? quick : [...quick, date];
  }, [isOwner, today, yesterday, date]);

  const dayTone = (d: string): DotTone | null => {
    if (d === date && day) {
      if (day.status === 'closed') return (day.difference ?? 0) === 0 ? 'match' : 'off';
      if (day.status === 'open') return 'open';
      return null;
    }
    const w = week[d];
    if (w) return w.status === 'open' ? 'open' : (w.difference ?? 0) === 0 ? 'match' : 'off';
    if (d === yesterday && yesterdayOpen) return 'open';
    return null;
  };

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), loadHistory(), checkYesterday(), loadWeek()]);
    setRefreshing(false);
  };

  const run = async (fn: () => Promise<{ ok: boolean; res: Parameters<typeof apiErrorMessage>[0] }>, success: string) => {
    setBusy(true);
    setFormError(null);
    try {
      const { ok, res } = await fn();
      if (!ok) {
        setFormError(await apiErrorMessage(res, 'Couldn’t save.'));
        return false;
      }
      showToast(success);
      await Promise.all([load(), loadHistory(), loadWeek()]);
      return true;
    } catch (e) {
      setFormError(e instanceof NetworkError ? 'This needs a connection. Try again when you’re back online.' : 'Couldn’t save.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const floatPaise = parseRupees(floatText);
  const floatOk = floatPaise != null && !Number.isNaN(floatPaise);
  const saveFloat = () =>
    floatOk &&
    void run(async () => {
      const res = await api.cash.day.float.$put({ json: { date, amount: floatPaise } });
      return { ok: res.ok, res };
    }, 'Day started').then((ok) => ok && setEditingFloat(false));

  // Counting by notes fills the total; typing a total yourself switches it back off.
  const notesTotal =
    NOTES.reduce((sum, n) => sum + n * (noteCounts[n] ?? 0), 0) + (Number(coinsText) || 0);
  const setNoteCount = (n: number, count: number) => {
    const next = { ...noteCounts, [n]: count };
    setNoteCounts(next);
    const total = NOTES.reduce((sum, x) => sum + x * (next[x] ?? 0), 0) + (Number(coinsText) || 0);
    setCountText(total ? String(total) : '');
    setFormError(null);
  };
  const setCoins = (t: string) => {
    setCoinsText(t);
    const total = NOTES.reduce((sum, x) => sum + x * (noteCounts[x] ?? 0), 0) + (Number(t) || 0);
    setCountText(total ? String(total) : '');
    setFormError(null);
  };

  const counted = parseRupees(countText);
  const countOk = counted != null && !Number.isNaN(counted);
  const diff = day && countOk ? cashDifference(day.expected, counted) : null;
  const needsNote = diff != null && closeNeedsNote(diff);
  const noteOk = !needsNote || note.trim().length >= MIN_REASON_LENGTH;
  const held = day?.doorstep.held ?? 0;
  const heldOk = held === 0 || leaveHeld;
  const closeDay = () =>
    countOk &&
    noteOk &&
    heldOk &&
    void run(async () => {
      const res = await api.cash.day.close.$post({
        json: { date, counted, ...(note.trim() ? { note: note.trim() } : {}), ...(held > 0 ? { leaveHeld: true } : {}) },
      });
      return { ok: res.ok, res };
    }, 'Day closed');

  const closedDiff = day?.status === 'closed' ? (day.difference ?? 0) : null;
  // While counting, or after close: tint the top card when the amount is short or over.
  const heroDiff = day?.status === 'closed' ? closedDiff : day?.status === 'open' ? diff : null;
  const g = brandGradients.hero;
  const heroColors =
    heroDiff == null
      ? (g.colors as unknown as string[])
      : heroDiff === 0
        ? HERO_MATCH
        : heroDiff < 0
          ? HERO_MISSING
          : HERO_EXTRA;
  const dayLabel = date === today ? 'Today' : date === yesterday ? 'Yesterday' : weekdayOf(date);
  const statusLabel = day?.status === 'closed' ? 'Closed' : day?.status === 'open' ? 'Open' : day ? 'Not started' : '';
  const logCount = (day?.earlierCloses?.length ?? 0) || (day?.reopenedBy ? 1 : 0);
  const showDoorstep = hasDoorstepCash(day?.doorstep);
  const reloadAll = async () => {
    await Promise.all([load(), loadHistory(), loadWeek()]);
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader
          title="Cash drawer"
          onBack={() => navigation.goBack()}
          right={
            isOwner ? (
              <View style={styles.headerActions}>
                <Pressable
                  onPress={() => setCalendarOpen(true)}
                  hitSlop={6}
                  style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Pick a day on the calendar"
                >
                  <IconCalendar size={18} color={colors.indigo} />
                </Pressable>
                <Pressable
                  onPress={() => setHistoryOpen(true)}
                  hitSlop={6}
                  style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Past days"
                >
                  <IconClock size={18} color={colors.indigo} />
                </Pressable>
              </View>
            ) : undefined
          }
        />
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.indigo} colors={[colors.indigo]} />
        }
      >
        {/* Day strip */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
          {stripDays.map((d) => {
            const on = d === date;
            const tone = dayTone(d);
            return (
              <Pressable
                key={d}
                onPress={() => setDate(d)}
                style={({ pressed }) => [styles.dayTile, on && styles.dayTileOn, pressed && !on && styles.pressed]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={formatDay(d)}
              >
                <Text style={[styles.dayWeek, on && styles.dayTextOn]}>
                  {d === today ? 'Today' : d === yesterday ? 'Yest.' : weekdayOf(d)}
                </Text>
                <Text style={[styles.dayNum, on && styles.dayTextOn]}>{Number(d.slice(8, 10))}</Text>
                <View style={[styles.dayDot, tone && { backgroundColor: DOT_COLOR[tone] }, on && !tone && styles.dayDotOnEmpty]} />
              </Pressable>
            );
          })}
        </ScrollView>

        {date === today && yesterdayOpen ? (
          <Pressable onPress={() => setDate(yesterday)} style={({ pressed }) => [styles.banner, pressed && styles.pressed]}>
            <IconAlert size={16} color={colors.amberDeep} />
            <Text style={styles.bannerText}>
              <Text style={styles.bannerStrong}>Yesterday wasn’t closed.</Text> Count it so totals stay right.
            </Text>
            <Text style={styles.bannerAction}>Close it</Text>
          </Pressable>
        ) : null}

        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.indigo} />
        ) : error || !day ? (
          <View style={[styles.panel, shadow('sm'), styles.errorBox]}>
            <IconSync size={22} color={colors.indigo} />
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <>
            {/* The drawer: the amount and how it adds up, in one card */}
            <LinearGradient
              colors={heroColors}
              locations={heroDiff == null ? (g.locations as unknown as number[]) : undefined}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={[styles.hero, shadow('md')]}
            >
              <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 340 200" preserveAspectRatio="xMidYMid slice">
                {STARS.map(([x, y, r, o]) => (
                  <Circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#FFFFFF" fillOpacity={o} />
                ))}
              </Svg>
              <Svg style={styles.watermark} width={150} height={150} viewBox="0 0 256 256">
                <G>
                  <Path d={BRAND_MARK.drop} fill="#FFFFFF" fillOpacity={0.07} />
                  <Path d={BRAND_MARK.arms} fill="#FFFFFF" fillOpacity={0.1} />
                  <Path d={BRAND_MARK.centre} fill="#FFFFFF" fillOpacity={0.15} />
                </G>
              </Svg>

              <View style={styles.heroTop}>
                <Text style={styles.heroDate}>
                  {dayLabel} · {formatDay(date)}
                </Text>
                <View style={styles.statusChip}>
                  <View
                    style={[
                      styles.statusDot,
                      day.status === 'open' && styles.statusDotOpen,
                      day.status === 'closed' && styles.statusDotClosed,
                    ]}
                  />
                  <Text style={styles.statusText}>{statusLabel}</Text>
                </View>
              </View>

              {day.status === 'not_started' ? (
                <View style={styles.heroBody}>
                  <Text style={styles.heroLabel}>Let’s open the drawer</Text>
                  <Text style={styles.heroValueSmall}>Count the cash box to start the day</Text>
                </View>
              ) : (
                <>
                  <View style={styles.heroBody}>
                    <Text style={styles.heroLabel}>{day.status === 'open' ? 'Should be in the box now' : 'Counted at close'}</Text>
                    <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
                      {formatRupees(day.status === 'open' ? day.expected : (day.counted ?? 0))}
                    </Text>
                    {day.status === 'closed' ? (
                      <Text style={styles.heroSub}>
                        {differenceText(closedDiff ?? 0)} · expected {formatRupees(day.expected)}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.sumRow}>
                    <SumChip
                      label="Morning"
                      value={day.openingFloat ?? 0}
                      sub={day.floatSetBy ?? undefined}
                      onPress={day.status === 'open' ? () => setEditingFloat(true) : undefined}
                    />
                    <Text style={styles.sumOp}>+</Text>
                    <SumChip label={showDoorstep ? 'At shop' : 'Washes'} value={day.cashIn} sub={`${day.cashJobs} paid in cash`} />
                    {showDoorstep ? (
                      <>
                        <Text style={styles.sumOp}>+</Text>
                        <SumChip label="Doorstep" value={day.doorstep.handedIn} sub="handed in" />
                      </>
                    ) : null}
                    <Text style={styles.sumOp}>−</Text>
                    <SumChip label="Spent" value={day.cashExpenses} sub={`${day.cashExpenseCount} expense${day.cashExpenseCount === 1 ? '' : 's'}`} />
                  </View>
                </>
              )}
            </LinearGradient>

            {showDoorstep ? (
              <DoorstepCashCard
                doorstep={day.doorstep}
                isToday={date === today}
                dayStatus={day.status}
                dayOpen={day.status === 'open'}
                isOwner={isOwner}
                onChanged={reloadAll}
              />
            ) : null}

            {/* One panel that changes with the step */}
            {day.status === 'not_started' || editingFloat ? (
              <View style={[styles.panel, shadow('sm')]}>
                <View style={styles.panelHead}>
                  <View style={[styles.panelIcon, { backgroundColor: colors.indigoPale }]}>
                    <IconDrawer size={18} color={colors.indigo} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.panelTitle}>{editingFloat ? 'Change morning cash' : 'Morning cash'}</Text>
                    <Text style={styles.panelLead}>Count the notes and coins in the box before the first wash.</Text>
                  </View>
                </View>
                <MoneyInput value={floatText} onChange={setFloatText} placeholder="0" autoFocus={editingFloat} />
                {day.suggestedFloat != null && day.status === 'not_started' ? (
                  <Text style={styles.helper}>Filled in from last night’s count. Change it if it’s different.</Text>
                ) : null}
                {formError ? <Text style={styles.formError}>{formError}</Text> : null}
                <View style={styles.actionsRow}>
                  {editingFloat ? <Button label="Cancel" variant="ghost" onPress={() => setEditingFloat(false)} /> : null}
                  <View style={styles.flex}>
                    <Button label={editingFloat ? 'Save' : 'Start the day'} size="lg" loading={busy} disabled={!floatOk} onPress={saveFloat} />
                  </View>
                </View>
              </View>
            ) : day.status === 'open' ? (
              <View style={[styles.panel, shadow('sm')]}>
                <View style={styles.panelHead}>
                  <View style={[styles.panelIcon, { backgroundColor: colors.tealPale }]}>
                    <IconCash size={18} color={colors.tealDeep} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.panelTitle}>Count the box</Text>
                    <Text style={styles.panelLead}>Cash only — UPI goes to the bank.</Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      const next = !byNotes;
                      setByNotes(next);
                      if (next && !notesTotal) setCountText('');
                    }}
                    style={({ pressed }) => [styles.modeChip, byNotes && styles.modeChipOn, pressed && styles.pressed]}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: byNotes }}
                  >
                    <Text style={[styles.modeChipText, byNotes && styles.modeChipTextOn]}>By notes</Text>
                  </Pressable>
                </View>

                {byNotes ? (
                  <NoteCounter counts={noteCounts} coins={coinsText} onCount={setNoteCount} onCoins={setCoins} />
                ) : null}

                <MoneyInput
                  value={countText}
                  onChange={(t) => {
                    setCountText(t);
                    if (byNotes) {
                      setByNotes(false);
                      setNoteCounts({});
                      setCoinsText('');
                    }
                    setFormError(null);
                  }}
                  placeholder="0"
                  right={
                    diff != null ? (
                      <View
                        style={[
                          styles.diffBadge,
                          diff === 0 ? styles.diffBadgeOk : diff < 0 ? styles.diffBadgeShort : styles.diffBadgeOver,
                        ]}
                      >
                        {diff === 0 ? <IconCheck size={12} color={colors.white} /> : <IconAlert size={12} color={colors.white} />}
                        <Text style={styles.diffBadgeText} numberOfLines={1}>
                          {differenceText(diff)}
                        </Text>
                      </View>
                    ) : null
                  }
                />

                {needsNote ? (
                  <View style={styles.noteBlock}>
                    <Text style={styles.fieldLabel}>Count once more. Still different? Say why:</Text>
                    <View style={styles.reasons}>
                      {QUICK_REASONS.map((r) => {
                        const on = note === r;
                        return (
                          <Pressable
                            key={r}
                            onPress={() => setNote(on ? '' : r)}
                            style={({ pressed }) => [styles.reason, on && styles.reasonOn, pressed && styles.pressed]}
                          >
                            {on ? <IconCheck size={12} color={colors.white} /> : null}
                            <Text style={[styles.reasonText, on && styles.reasonTextOn]}>{r}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <TextInput
                      style={styles.noteInput}
                      value={note}
                      onChangeText={setNote}
                      placeholder="Or write what happened"
                      placeholderTextColor={colors.slate}
                      maxLength={300}
                      multiline
                    />
                  </View>
                ) : null}
                {held > 0 ? (
                  <View style={styles.heldBlock}>
                    <View style={styles.diffBand}>
                      <IconAlert size={15} color={colors.amberDeep} />
                      <Text style={styles.diffText}>
                        {formatRupees(held)} doorstep cash is still with the team. Take it above first so the box is right.
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setLeaveHeld((v) => !v)}
                      style={({ pressed }) => [styles.carryRow, pressed && styles.pressed]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: leaveHeld }}
                    >
                      <View style={[styles.checkbox, leaveHeld && styles.checkboxOn]}>
                        {leaveHeld ? <IconCheck size={12} color={colors.white} /> : null}
                      </View>
                      <Text style={styles.carryText}>Close anyway: they’ll hand it in later and it carries over</Text>
                    </Pressable>
                  </View>
                ) : null}
                {formError ? <Text style={styles.formError}>{formError}</Text> : null}
                <Button label="Close the day" size="lg" loading={busy} disabled={!countOk || !noteOk || !heldOk} onPress={closeDay} />
              </View>
            ) : (
              <View style={[styles.panel, shadow('sm')]}>
                <View style={styles.closedGrid}>
                  <View style={[styles.closedCell, { backgroundColor: colors.indigoPale }]}>
                    <Text style={styles.closedLabel}>Should have been</Text>
                    <Text style={styles.closedValue}>{formatRupees(day.expected)}</Text>
                  </View>
                  <View style={[styles.closedCell, { backgroundColor: colors.tealPale }]}>
                    <Text style={styles.closedLabel}>Counted</Text>
                    <Text style={styles.closedValue}>{formatRupees(day.counted ?? 0)}</Text>
                  </View>
                </View>
                <View style={styles.closedMeta}>
                  <View style={styles.flex}>
                    <Text style={styles.closedBy}>{day.closedBy ? `Closed by ${day.closedBy}` : 'Closed'}</Text>
                    {day.closedAt ? <Text style={styles.helper}>{formatDateTime(day.closedAt)}</Text> : null}
                  </View>
                  <Pill label={differenceText(closedDiff ?? 0)} tone={differenceTone(closedDiff ?? 0)} />
                </View>
                {day.note ? <Text style={styles.noteQuote}>“{day.note}”</Text> : null}
                {day.heldAtClose ? (
                  <View style={styles.diffBand}>
                    <IconAlert size={15} color={colors.amberDeep} />
                    <Text style={styles.diffText}>
                      {formatRupees(day.heldAtClose)} doorstep cash was still with the team at close. It carries over until it’s handed in.
                    </Text>
                  </View>
                ) : null}
                {day.changedSinceClose !== 0 ? (
                  <View style={styles.diffBand}>
                    <IconAlert size={15} color={colors.amberDeep} />
                    <Text style={styles.diffText}>
                      A cash payment, handover or expense changed after closing ({day.changedSinceClose > 0 ? '+' : '−'}
                      {formatRupees(Math.abs(day.changedSinceClose))}).{isOwner ? ' Reopen to recount.' : ' Tell the owner.'}
                    </Text>
                  </View>
                ) : null}
                {isOwner ? (
                  <Button label="Reopen day" variant="secondary" onPress={() => setReopening(true)} />
                ) : (
                  <Text style={styles.helper}>Only the owner can reopen a closed day.</Text>
                )}
              </View>
            )}

            {/* Reopens and earlier counts of this day, folded away */}
            {logCount > 0 ? (
              <View>
                <Pressable onPress={() => setDayLogOpen((v) => !v)} style={({ pressed }) => [styles.logToggle, pressed && styles.pressed]}>
                  <IconSync size={13} color={colors.slateDeep} />
                  <Text style={styles.logToggleText}>
                    {dayLogOpen ? 'Hide' : 'Show'} this day’s history ({logCount})
                  </Text>
                </Pressable>
                {dayLogOpen ? (
                  <View style={styles.log}>
                    {day.reopenedBy && !day.earlierCloses?.length ? (
                      <Text style={styles.logText}>
                        Reopened by {day.reopenedBy}
                        {day.reopenedAt ? ` · ${formatDateTime(day.reopenedAt)}` : ''}
                        {day.reopenReason ? ` — “${day.reopenReason}”` : ''}
                      </Text>
                    ) : null}
                    {day.earlierCloses?.map((e) => (
                      <Text key={e.closedAt} style={styles.logText}>
                        Earlier close{e.closedBy ? ` by ${e.closedBy}` : ''} · {formatDateTime(e.closedAt)}: counted{' '}
                        {formatRupees(e.counted ?? 0)}
                        {e.difference ? ` (${differenceText(e.difference)})` : ''}
                        {e.note ? ` — “${e.note}”` : ''}
                        {e.reopenedBy ? `. Reopened by ${e.reopenedBy}` : ''}
                        {e.reopenedAt ? ` · ${formatDateTime(e.reopenedAt)}` : ''}
                        {e.reopenReason ? ` — “${e.reopenReason}”` : ''}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Owner: past days, in a sheet so the day stays on one screen */}
      <BottomSheet visible={historyOpen} onClose={() => setHistoryOpen(false)} title="Past days" subtitle="How each day’s count ended. Tap one to open it.">
        <PeriodSelect
          value={historyPeriod}
          onChange={(next) => {
            setHistoryRange(null);
            setHistoryPeriod(next);
          }}
          options={HISTORY_OPTIONS}
          menuTitle="Show past days for"
          custom={{ range: historyRange, onApply: setHistoryRange }}
        />
        <View style={styles.legend}>
          {(['match', 'off', 'open'] as const).map((t) => (
            <View key={t} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: DOT_COLOR[t] }]} />
              <Text style={styles.legendText}>{t === 'match' ? 'Matched' : t === 'off' ? 'Different' : 'Not closed'}</Text>
            </View>
          ))}
        </View>
        {history && history.days.length > 0 ? (
          <>
            {history.totals.short < 0 || history.totals.over > 0 ? (
              <View style={styles.totalsRow}>
                {history.totals.short < 0 ? (
                  <View style={[styles.totalChip, styles.totalChipShort]}>
                    <Text style={styles.totalChipLabel}>Missing</Text>
                    <Text style={[styles.totalChipValue, styles.minus]}>{formatRupees(-history.totals.short)}</Text>
                  </View>
                ) : null}
                {history.totals.over > 0 ? (
                  <View style={[styles.totalChip, styles.totalChipOver]}>
                    <Text style={styles.totalChipLabel}>Extra</Text>
                    <Text style={[styles.totalChipValue, styles.extra]}>{formatRupees(history.totals.over)}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <EdgeGroup>
              {history.days.map((d) => (
                <EdgeRow
                  key={d.date}
                  icon={<DateBlock date={d.date} />}
                  iconBg={d.date === date ? colors.indigoPale : colors.surface}
                  title={formatDay(d.date)}
                  subtitle={
                    d.status === 'open'
                      ? 'Not closed yet'
                      : [
                          d.counted != null ? `Counted ${formatRupees(d.counted)}` : null,
                          d.closedBy ? `by ${d.closedBy}` : null,
                          d.heldAtClose ? `${formatRupees(d.heldAtClose)} still with the team` : null,
                          d.note ? `“${d.note}”` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                  }
                  right={
                    d.status === 'open' ? (
                      <Pill label="NOT CLOSED" tone="slate" />
                    ) : (
                      <Pill label={differenceText(d.difference ?? 0)} tone={differenceTone(d.difference ?? 0)} />
                    )
                  }
                  onPress={() => {
                    setHistoryOpen(false);
                    setDate(d.date);
                  }}
                />
              ))}
            </EdgeGroup>
          </>
        ) : (
          <View style={styles.emptyHistory}>
            <IconReceipt size={22} color={colors.slate} />
            <Text style={styles.emptyHistoryText}>No days recorded in this period yet.</Text>
          </View>
        )}
      </BottomSheet>

      <CalendarSheet
        visible={calendarOpen}
        mode="plain"
        value={date}
        max={today}
        min={istDate(365)}
        title="Pick a day"
        subtitle="Open any day’s cash drawer to check or fix it."
        onClose={() => setCalendarOpen(false)}
        onSelect={(d) => {
          setCalendarOpen(false);
          setDate(d);
        }}
      />

      <ReasonSheet
        visible={reopening}
        title="Reopen this day?"
        subtitle={`${formatDay(date)} · the count is kept in the day’s history`}
        confirmLabel="Reopen day"
        quickReasons={['Recount needed', 'Payment corrected after close', 'Expense added late']}
        onClose={() => setReopening(false)}
        onConfirm={async (reason) => {
          try {
            const res = await api.cash.day.reopen.$post({ json: { date, reason } });
            if (!res.ok) return apiErrorMessage(res, 'Couldn’t reopen.');
            setReopening(false);
            showToast('Day reopened');
            await Promise.all([load(), loadHistory(), loadWeek()]);
            return null;
          } catch (e) {
            return e instanceof NetworkError ? 'This needs a connection.' : 'Couldn’t reopen.';
          }
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  headerPad: { paddingHorizontal: spacing.md },
  headerActions: { flexDirection: 'row', gap: spacing.sm },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.indigoPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm + 4 },
  loader: { marginTop: spacing.xl },

  // Day strip
  dayRow: { gap: spacing.sm, paddingVertical: 2 },
  dayTile: {
    width: 52,
    paddingVertical: 8,
    borderRadius: radius.lg,
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayTileOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  dayWeek: { ...typography.caption, fontSize: 10.5, color: colors.slate, letterSpacing: 0 },
  dayNum: { ...typography.heading, fontSize: 17, color: colors.ink },
  dayTextOn: { color: colors.white },
  dayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'transparent' },
  dayDotOnEmpty: { backgroundColor: 'transparent' },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.lg,
    backgroundColor: colors.amberPale,
    borderWidth: 1,
    borderColor: colors.amberLight,
  },
  bannerText: { ...typography.caption, flex: 1, fontSize: 12.5, color: colors.amberDeep, letterSpacing: 0 },
  bannerStrong: { fontWeight: '800' },
  bannerAction: { ...typography.label, fontSize: 13, color: colors.amberDeep, fontWeight: '800' },

  // Drawer card
  hero: { borderRadius: radius.xl, padding: spacing.md + 2, gap: spacing.md, overflow: 'hidden' },
  watermark: { position: 'absolute', right: -24, top: -16 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroDate: { ...typography.label, fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.6)' },
  statusDotOpen: { backgroundColor: colors.amberLight },
  statusDotClosed: { backgroundColor: colors.tealLight },
  statusText: { ...typography.caption, fontSize: 12, color: colors.white, fontWeight: '700', letterSpacing: 0 },
  heroBody: { gap: 2 },
  heroLabel: { ...typography.label, fontSize: 13.5, color: 'rgba(255,255,255,0.8)' },
  heroValue: { ...typography.display, fontSize: 42, color: colors.white, letterSpacing: -1 },
  heroValueSmall: { ...typography.heading, fontSize: 20, color: colors.white },
  heroSub: { ...typography.label, fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  sumRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sumOp: { ...typography.heading, fontSize: 16, color: 'rgba(255,255,255,0.7)' },
  sumChip: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    gap: 1,
  },
  sumChipPressed: { backgroundColor: 'rgba(255,255,255,0.2)' },
  sumChipHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sumChipLabel: { ...typography.caption, fontSize: 11, color: 'rgba(255,255,255,0.75)', letterSpacing: 0.3 },
  sumChipValue: { ...typography.bodyStrong, fontSize: 15.5, color: colors.white, fontWeight: '800' },
  sumChipSub: { ...typography.caption, fontSize: 10.5, color: 'rgba(255,255,255,0.6)', letterSpacing: 0 },

  // Step panel
  panel: { backgroundColor: colors.white, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm + 4 },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  panelIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  panelTitle: { ...typography.bodyStrong, fontSize: 16.5, color: colors.ink, fontWeight: '800' },
  panelLead: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  modeChip: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  modeChipOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  modeChipText: { ...typography.caption, fontSize: 12.5, color: colors.indigo, fontWeight: '700', letterSpacing: 0 },
  modeChipTextOn: { color: colors.white },
  diffBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: radius.pill,
    maxWidth: '60%',
  },
  diffBadgeOk: { backgroundColor: colors.teal },
  diffBadgeShort: { backgroundColor: colors.danger },
  diffBadgeOver: { backgroundColor: colors.amber },
  diffBadgeText: { ...typography.caption, fontSize: 12, color: colors.white, fontWeight: '800', letterSpacing: 0 },

  // Count by notes
  notes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  noteCell: {
    flexBasis: '30%',
    flexGrow: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 8,
    gap: 6,
  },
  noteCellOn: { borderColor: colors.indigoMist, backgroundColor: colors.indigoPale },
  coinCell: { flexBasis: '30%' },
  noteFace: { ...typography.label, fontSize: 13, color: colors.slateDeep, fontWeight: '800' },
  noteFaceOn: { color: colors.indigo },
  noteStepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOff: { opacity: 0.4 },
  noteCount: { ...typography.bodyStrong, flex: 1, textAlign: 'center', fontSize: 16, color: colors.ink, paddingVertical: 0 },
  coinField: { flexDirection: 'row', alignItems: 'center', height: 28, gap: 4 },
  coinRupee: { ...typography.bodyStrong, fontSize: 15, color: colors.slateDeep },
  coinInput: { ...typography.bodyStrong, flex: 1, fontSize: 16, color: colors.ink, paddingVertical: 0 },

  noteBlock: { gap: spacing.sm },
  fieldLabel: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  reasonOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  reasonText: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  reasonTextOn: { color: colors.white, fontWeight: '700' },
  noteInput: {
    ...typography.body,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 14.5,
  },
  formError: { ...typography.caption, fontSize: 13, color: colors.danger, letterSpacing: 0 },
  helper: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  // Closed
  closedGrid: { flexDirection: 'row', gap: spacing.sm },
  closedCell: { flex: 1, borderRadius: radius.md, padding: spacing.sm + 4, gap: 2 },
  closedLabel: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, letterSpacing: 0 },
  closedValue: { ...typography.heading, fontSize: 20, color: colors.ink },
  closedMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  closedBy: { ...typography.bodyStrong, fontSize: 14.5, color: colors.ink, fontWeight: '700' },
  noteQuote: {
    ...typography.body,
    fontSize: 14,
    fontStyle: 'italic',
    color: colors.slateDeep,
    paddingLeft: spacing.sm + 2,
    borderLeftWidth: 3,
    borderLeftColor: colors.indigoMist,
  },
  diffBand: {
    flexDirection: 'row',
    gap: 6,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.amberPale,
  },
  diffText: { ...typography.caption, flex: 1, fontSize: 12.5, color: colors.amberDeep, letterSpacing: 0 },
  heldBlock: { gap: spacing.sm },
  carryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  carryText: { ...typography.caption, flex: 1, fontSize: 12.5, color: colors.ink, letterSpacing: 0 },

  logToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingVertical: 4 },
  logToggleText: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, fontWeight: '700' },
  log: { gap: spacing.sm, paddingTop: spacing.xs },
  logText: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 18 },

  errorBox: { alignItems: 'center' },
  errorText: { ...typography.body, fontSize: 14, color: colors.slateDeep, textAlign: 'center' },

  // Past days sheet
  legend: { flexDirection: 'row', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  totalsRow: { flexDirection: 'row', gap: spacing.sm },
  totalChip: { flex: 1, borderRadius: radius.md, padding: spacing.sm + 2, gap: 2 },
  totalChipShort: { backgroundColor: colors.dangerPale },
  totalChipOver: { backgroundColor: colors.amberPale },
  totalChipLabel: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, letterSpacing: 0 },
  totalChipValue: { ...typography.heading, fontSize: 18 },
  minus: { color: colors.danger },
  extra: { color: colors.amberDeep },
  dateBlock: { alignItems: 'center' },
  dateDay: { ...typography.heading, fontSize: 15, color: colors.ink, lineHeight: 17 },
  dateMonth: { ...typography.caption, fontSize: 10, color: colors.slate, letterSpacing: 0 },
  emptyHistory: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  emptyHistoryText: { ...typography.caption, fontSize: 13, color: colors.slate, letterSpacing: 0 },
});
