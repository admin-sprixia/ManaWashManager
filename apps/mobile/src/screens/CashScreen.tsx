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
import { cashDifference, closeNeedsNote, MIN_REASON_LENGTH } from '@mana/domain';
import { ScreenContainer } from '../components/ScreenContainer';
import { ScreenHeader } from '../components/ScreenHeader';
import { EdgeGroup, EdgeRow, Pill } from '../components/EdgeList';
import { PeriodSelect, type PeriodKey } from '../components/PeriodSelect';
import { ReasonSheet } from '../components/ReasonSheet';
import { CalendarSheet } from '../components/CalendarSheet';
import type { DateRange } from '../components/RangeCalendar';
import { Button } from '../components/Button';
import { showToast } from '../components/Toast';
import {
  IconAlert,
  IconCalendar,
  IconCash,
  IconCheck,
  IconDrawer,
  IconReceipt,
  IconSync,
} from '../components/Icons';
import { colors, gradients, radius, shadow, spacing, typography } from '../theme';
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
  expected: number;
  counted: number | null;
  difference: number | null;
  note: string | null;
  closedBy: string | null;
  closedAt: string | null;
  changedSinceClose: number;
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
  closedBy: string | null;
  reopenedBy: string | null;
}

const HISTORY_OPTIONS: { key: PeriodKey; label: string; hint: string }[] = [
  { key: 'week', label: 'Last 7 days', hint: 'Rolling week, including today' },
  { key: 'month', label: 'This month', hint: 'From the 1st' },
  { key: 'year', label: 'This year', hint: 'From 1 January' },
];

const QUICK_REASONS = [
  'Wrong change given',
  'Payment marked wrong',
  'Expense not added',
  'Owner took cash',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const HERO_MISSING = ['#F87171', '#DC2626', '#991B1B'];
const HERO_EXTRA = ['#FCD34D', '#F59E0B', '#B45309'];
const HERO_MATCH = [colors.tealLight, colors.teal, colors.tealDeep];

type DotTone = 'match' | 'off' | 'open';
const DOT_COLOR: Record<DotTone, string> = {
  match: colors.teal,
  off: colors.danger,
  open: colors.amber,
};

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

function HeroStep({
  n,
  label,
  state,
}: {
  n: number;
  label: string;
  state: 'done' | 'current' | 'next';
}) {
  return (
    <View style={[styles.heroStep, state === 'next' && styles.heroStepNext]}>
      <View style={[styles.heroStepDot, state === 'done' && styles.heroStepDotDone]}>
        {state === 'done' ? (
          <IconCheck size={11} color={colors.waterDeep} />
        ) : (
          <Text style={styles.heroStepNum}>{n}</Text>
        )}
      </View>
      <Text style={styles.heroStepLabel}>{label}</Text>
    </View>
  );
}

function SumRow({
  icon,
  iconBg,
  label,
  sub,
  value,
  sign,
  onEdit,
  last,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  sub?: string;
  value: number;
  sign?: '+' | '−';
  onEdit?: () => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.sumRow, !last && styles.sumDivider]}>
      <View style={[styles.sumIcon, { backgroundColor: iconBg }]}>{icon}</View>
      <View style={styles.flex}>
        <Text style={styles.sumLabel}>{label}</Text>
        {sub ? <Text style={styles.sumSub}>{sub}</Text> : null}
      </View>
      {onEdit ? (
        <Pressable
          onPress={onEdit}
          hitSlop={8}
          style={({ pressed }) => [styles.editPill, pressed && styles.pressed]}
        >
          <Text style={styles.editPillText}>Edit</Text>
        </Pressable>
      ) : null}
      <Text style={[styles.sumValue, sign === '+' && styles.plus, sign === '−' && styles.minus]}>
        {sign ? `${sign} ` : ''}
        {formatRupees(value)}
      </Text>
    </View>
  );
}

function MoneyInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (t: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const filled = value.trim().length > 0;
  return (
    <View style={[styles.moneyField, filled && styles.moneyFieldFilled]}>
      <Text style={[styles.moneyRupee, filled && styles.moneyRupeeFilled]}>₹</Text>
      <TextInput
        style={styles.moneyInput}
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholder={placeholder}
        placeholderTextColor={colors.slate}
        autoFocus={autoFocus}
        maxLength={9}
      />
    </View>
  );
}

function CardHead({
  icon,
  iconBg,
  title,
  lead,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  lead?: string;
}) {
  return (
    <View style={styles.cardHead}>
      <View style={[styles.cardIcon, { backgroundColor: iconBg }]}>{icon}</View>
      <View style={styles.flex}>
        <Text style={styles.cardTitle}>{title}</Text>
        {lead ? <Text style={styles.cardLead}>{lead}</Text> : null}
      </View>
    </View>
  );
}

/**
 * Daily cash drawer in two steps: morning cash in, then a counted close at night, with cash
 * washes and cash expenses tracked in between. Anyone on shift can run it; a mismatch needs a note, and only the owner can reopen.
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
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
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
        e instanceof NetworkError
          ? 'The cash drawer needs a connection. Pull down to retry.'
          : (e as Error).message,
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
        query: historyRange
          ? { range: 'custom', from: historyRange.from, to: historyRange.to }
          : { range: historyPeriod },
      });
      if (!res.ok) return;
      const data = await res.json();
      if ('days' in data) setHistory({ days: data.days, totals: data.totals });
    } catch {
      // The day card already shows the offline state.
    }
  }, [isOwner, historyPeriod, historyRange]);

  useEffect(() => {
    setLoading(true);
    setCountText('');
    setNote('');
    setFormError(null);
    setEditingFloat(false);
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

  const run = async (
    fn: () => Promise<{ ok: boolean; res: Parameters<typeof apiErrorMessage>[0] }>,
    success: string,
  ) => {
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
      setFormError(
        e instanceof NetworkError
          ? 'This needs a connection. Try again when you’re back online.'
          : 'Couldn’t save.',
      );
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

  const counted = parseRupees(countText);
  const countOk = counted != null && !Number.isNaN(counted);
  const diff = day && countOk ? cashDifference(day.expected, counted) : null;
  const needsNote = diff != null && closeNeedsNote(diff);
  const noteOk = !needsNote || note.trim().length >= MIN_REASON_LENGTH;
  const closeDay = () =>
    countOk &&
    noteOk &&
    void run(async () => {
      const res = await api.cash.day.close.$post({
        json: { date, counted, ...(note.trim() ? { note: note.trim() } : {}) },
      });
      return { ok: res.ok, res };
    }, 'Day closed');

  const closedDiff = day?.status === 'closed' ? (day.difference ?? 0) : null;
  const heroColors =
    closedDiff == null
      ? (gradients.hero as unknown as string[])
      : closedDiff === 0
        ? HERO_MATCH
        : closedDiff < 0
          ? HERO_MISSING
          : HERO_EXTRA;
  const dayLabel = date === today ? 'Today' : date === yesterday ? 'Yesterday' : 'Past day';
  const statusLabel =
    day?.status === 'closed'
      ? 'Closed'
      : day?.status === 'open'
        ? 'Open'
        : day
          ? 'Not started'
          : '';

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Cash drawer" onBack={() => navigation.goBack()} />
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.water}
            colors={[colors.water]}
          />
        }
      >
        {/* Day strip: quick days, plus a calendar for the owner */}
        <View style={styles.dayBand}>
          <View style={styles.dayBandHead}>
            <Text style={styles.dayBandTitle}>{formatDay(date)}</Text>
            <Text style={styles.dayBandMeta}>
              {isOwner ? 'Tap a day or open the calendar' : 'Today or a forgotten yesterday'}
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dayRow}
          >
            {stripDays.map((d) => {
              const on = d === date;
              const tone = dayTone(d);
              return (
                <Pressable
                  key={d}
                  onPress={() => setDate(d)}
                  style={({ pressed }) => [
                    styles.dayTile,
                    on && styles.dayTileOn,
                    pressed && !on && styles.pressed,
                  ]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={formatDay(d)}
                >
                  <Text style={[styles.dayWeek, on && styles.dayTextOn]}>
                    {d === today ? 'Today' : d === yesterday ? 'Yest.' : weekdayOf(d)}
                  </Text>
                  <Text style={[styles.dayNum, on && styles.dayTextOn]}>
                    {Number(d.slice(8, 10))}
                  </Text>
                  <View
                    style={[
                      styles.dayDot,
                      tone && { backgroundColor: DOT_COLOR[tone] },
                      on && tone && styles.dayDotOn,
                    ]}
                  />
                </Pressable>
              );
            })}
            {isOwner ? (
              <Pressable
                onPress={() => setCalendarOpen(true)}
                style={({ pressed }) => [styles.dayTile, styles.calTile, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Pick a day on the calendar"
              >
                <IconCalendar size={18} color={colors.waterDeep} />
                <Text style={styles.calText}>Calendar</Text>
              </Pressable>
            ) : null}
          </ScrollView>
          {isOwner ? (
            <View style={styles.legend}>
              {(['match', 'off', 'open'] as const).map((t) => (
                <View key={t} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: DOT_COLOR[t] }]} />
                  <Text style={styles.legendText}>
                    {t === 'match' ? 'Matched' : t === 'off' ? 'Different' : 'Not closed'}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {date === today && yesterdayOpen ? (
          <View style={styles.banner}>
            <View style={styles.bannerIcon}>
              <IconAlert size={18} color={colors.amberDeep} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.bannerTitle}>Yesterday wasn’t closed</Text>
              <Text style={styles.bannerSub}>
                {formatDay(yesterday)} · count it so totals stay right
              </Text>
            </View>
            <Pressable
              onPress={() => setDate(yesterday)}
              hitSlop={8}
              style={({ pressed }) => [styles.bannerButton, pressed && styles.pressed]}
            >
              <Text style={styles.bannerButtonText}>Close it</Text>
            </Pressable>
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.water} />
        ) : error || !day ? (
          <View style={[styles.card, shadow('sm'), styles.errorBox]}>
            <View style={[styles.cardIcon, { backgroundColor: colors.waterPale }]}>
              <IconSync size={20} color={colors.waterDeep} />
            </View>
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <>
            {/* Hero summary */}
            <LinearGradient
              colors={heroColors}
              start={{ x: 0, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={[styles.hero, shadow('md')]}
            >
              <View pointerEvents="none" style={styles.orbLarge} />
              <View pointerEvents="none" style={styles.orbSmall} />
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
                <>
                  <Text style={styles.heroLabel}>Let’s open the drawer</Text>
                  <Text style={styles.heroValueSmall}>Count the cash box to start</Text>
                </>
              ) : day.status === 'open' ? (
                <>
                  <Text style={styles.heroLabel}>Should be in the box now</Text>
                  <Text style={styles.heroValue}>{formatRupees(day.expected)}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.heroLabel}>Counted at close</Text>
                  <Text style={styles.heroValue}>{formatRupees(day.counted ?? 0)}</Text>
                  <Text style={styles.heroSub}>
                    {differenceText(closedDiff ?? 0)} · expected {formatRupees(day.expected)}
                  </Text>
                </>
              )}

              <View style={styles.heroSteps}>
                <HeroStep
                  n={1}
                  label="Morning cash"
                  state={day.status === 'not_started' ? 'current' : 'done'}
                />
                <View
                  style={[styles.heroLine, day.status !== 'not_started' && styles.heroLineDone]}
                />
                <HeroStep
                  n={2}
                  label="Close the day"
                  state={
                    day.status === 'closed' ? 'done' : day.status === 'open' ? 'current' : 'next'
                  }
                />
              </View>
            </LinearGradient>

            {/* Morning cash */}
            {day.status === 'not_started' || editingFloat ? (
              <View style={[styles.card, shadow('sm')]}>
                <CardHead
                  icon={<IconDrawer size={20} color={colors.waterDeep} />}
                  iconBg={colors.waterPale}
                  title={editingFloat ? 'Change morning cash' : 'Morning cash'}
                  lead="Count the notes and coins in the box before the first wash."
                />
                <MoneyInput
                  value={floatText}
                  onChange={setFloatText}
                  placeholder="0"
                  autoFocus={editingFloat}
                />
                {day.suggestedFloat != null && day.status === 'not_started' ? (
                  <View style={styles.hintChip}>
                    <IconSync size={13} color={colors.waterDeep} />
                    <Text style={styles.hintChipText}>
                      Filled in from last night’s count. Change it if it’s different.
                    </Text>
                  </View>
                ) : null}
                {formError ? <Text style={styles.formError}>{formError}</Text> : null}
                <View style={styles.actionsRow}>
                  {editingFloat ? (
                    <Button label="Cancel" variant="ghost" onPress={() => setEditingFloat(false)} />
                  ) : null}
                  <View style={styles.flex}>
                    <Button
                      label={editingFloat ? 'Save' : 'Start the day'}
                      size="lg"
                      loading={busy}
                      disabled={!floatOk}
                      onPress={saveFloat}
                    />
                  </View>
                </View>
              </View>
            ) : null}

            {/* How the expected amount adds up */}
            {day.status === 'open' && !editingFloat ? (
              <View style={[styles.card, shadow('sm')]}>
                <Text style={styles.overline}>HOW IT ADDS UP</Text>
                <View>
                  <SumRow
                    icon={<IconDrawer size={17} color={colors.waterDeep} />}
                    iconBg={colors.waterPale}
                    label="Morning cash"
                    sub={day.floatSetBy ? `Counted by ${day.floatSetBy}` : undefined}
                    value={day.openingFloat ?? 0}
                    onEdit={() => setEditingFloat(true)}
                  />
                  <SumRow
                    icon={<IconCash size={17} color={colors.tealDeep} />}
                    iconBg="#CCFBF1"
                    label="Cash from washes"
                    sub={`${day.cashJobs} cash payment${day.cashJobs === 1 ? '' : 's'}`}
                    value={day.cashIn}
                    sign="+"
                  />
                  <SumRow
                    icon={<IconReceipt size={17} color={colors.danger} />}
                    iconBg="#FEE2E2"
                    label="Cash spent"
                    sub={`${day.cashExpenseCount} expense${day.cashExpenseCount === 1 ? '' : 's'}`}
                    value={day.cashExpenses}
                    sign="−"
                    last
                  />
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Should be in the box</Text>
                  <Text style={styles.totalValue}>{formatRupees(day.expected)}</Text>
                </View>
                <Text style={styles.helper}>
                  UPI and card payments go to the bank, so they aren’t counted here.
                </Text>
              </View>
            ) : null}

            {/* Closing count */}
            {day.status === 'open' && !editingFloat ? (
              <View style={[styles.card, shadow('sm')]}>
                <CardHead
                  icon={<IconCash size={20} color={colors.tealDeep} />}
                  iconBg="#CCFBF1"
                  title="Closing count"
                  lead="Count all the cash in the box and type the total."
                />
                <MoneyInput
                  value={countText}
                  onChange={(t) => {
                    setCountText(t);
                    setFormError(null);
                  }}
                  placeholder="0"
                />
                {diff != null ? (
                  <View
                    style={[
                      styles.result,
                      diff === 0
                        ? styles.resultOk
                        : diff < 0
                          ? styles.resultShort
                          : styles.resultOver,
                    ]}
                  >
                    <View
                      style={[
                        styles.resultIcon,
                        {
                          backgroundColor:
                            diff === 0 ? colors.teal : diff < 0 ? colors.danger : colors.amber,
                        },
                      ]}
                    >
                      {diff === 0 ? (
                        <IconCheck size={16} color={colors.white} />
                      ) : (
                        <IconAlert size={16} color={colors.white} />
                      )}
                    </View>
                    <View style={styles.flex}>
                      <Text
                        style={[
                          styles.resultTitle,
                          diff === 0
                            ? styles.resultTitleOk
                            : diff < 0
                              ? styles.resultTitleShort
                              : styles.resultTitleOver,
                        ]}
                      >
                        {diff === 0 ? 'Perfect, it matches' : differenceText(diff)}
                      </Text>
                      <Text style={styles.resultSub}>
                        {diff === 0
                          ? 'You can close the day.'
                          : 'Count once more. If it’s still different, say why below.'}
                      </Text>
                    </View>
                  </View>
                ) : null}
                {needsNote ? (
                  <View style={styles.noteBlock}>
                    <Text style={styles.fieldLabel}>Why is it different?</Text>
                    <View style={styles.reasons}>
                      {QUICK_REASONS.map((r) => {
                        const on = note === r;
                        return (
                          <Pressable
                            key={r}
                            onPress={() => setNote(on ? '' : r)}
                            style={({ pressed }) => [
                              styles.reason,
                              on && styles.reasonOn,
                              pressed && styles.pressed,
                            ]}
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
                {formError ? <Text style={styles.formError}>{formError}</Text> : null}
                <Button
                  label="Close the day"
                  size="lg"
                  loading={busy}
                  disabled={!countOk || !noteOk}
                  onPress={closeDay}
                />
              </View>
            ) : null}

            {/* Closed day */}
            {day.status === 'closed' ? (
              <View style={[styles.card, shadow('sm')]}>
                <View style={styles.statRow}>
                  <View style={styles.stat}>
                    <Text style={styles.statLabel}>Should have been</Text>
                    <Text style={styles.statValue}>{formatRupees(day.expected)}</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statLabel}>Counted</Text>
                    <Text style={styles.statValue}>{formatRupees(day.counted ?? 0)}</Text>
                  </View>
                </View>
                <View style={styles.closedMeta}>
                  <View style={styles.flex}>
                    <Text style={styles.closedBy}>
                      {day.closedBy ? `Closed by ${day.closedBy}` : 'Closed'}
                    </Text>
                    {day.closedAt ? (
                      <Text style={styles.helper}>{formatDateTime(day.closedAt)}</Text>
                    ) : null}
                  </View>
                  <Pill
                    label={differenceText(closedDiff ?? 0)}
                    tone={differenceTone(closedDiff ?? 0)}
                  />
                </View>
                {day.note ? (
                  <View style={styles.noteQuote}>
                    <Text style={styles.noteQuoteText}>“{day.note}”</Text>
                  </View>
                ) : null}
                {day.changedSinceClose !== 0 ? (
                  <View style={styles.diffBand}>
                    <IconAlert size={16} color={colors.amberDeep} />
                    <Text style={styles.diffText}>
                      A cash payment or expense changed after closing (
                      {day.changedSinceClose > 0 ? '+' : '−'}
                      {formatRupees(Math.abs(day.changedSinceClose))}).
                      {isOwner ? ' Reopen to recount.' : ' Tell the owner.'}
                    </Text>
                  </View>
                ) : null}
                {isOwner ? (
                  <Button
                    label="Reopen day"
                    variant="secondary"
                    onPress={() => setReopening(true)}
                  />
                ) : (
                  <Text style={styles.helper}>Only the owner can reopen a closed day.</Text>
                )}
              </View>
            ) : null}

            {day.reopenedBy ? (
              <View style={styles.reopened}>
                <IconSync size={14} color={colors.slateDeep} />
                <Text style={styles.reopenedText}>
                  Reopened by {day.reopenedBy}
                  {day.reopenedAt ? ` · ${formatDateTime(day.reopenedAt)}` : ''}
                  {day.reopenReason ? ` — “${day.reopenReason}”` : ''}
                </Text>
              </View>
            ) : null}
          </>
        )}

        {isOwner ? (
          <View style={styles.history}>
            <View style={styles.historyHead}>
              <Text style={styles.historyTitle}>Past days</Text>
              {history ? (
                <Text style={styles.historyCount}>
                  {history.days.length} day{history.days.length === 1 ? '' : 's'}
                </Text>
              ) : null}
            </View>
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
            {history && history.days.length > 0 ? (
              <>
                {history.totals.short < 0 || history.totals.over > 0 ? (
                  <View style={styles.totalsRow}>
                    {history.totals.short < 0 ? (
                      <View style={[styles.totalChip, styles.totalChipShort]}>
                        <Text style={styles.totalChipLabel}>Missing</Text>
                        <Text style={[styles.totalChipValue, styles.minus]}>
                          {formatRupees(-history.totals.short)}
                        </Text>
                      </View>
                    ) : null}
                    {history.totals.over > 0 ? (
                      <View style={[styles.totalChip, styles.totalChipOver]}>
                        <Text style={styles.totalChipLabel}>Extra</Text>
                        <Text style={[styles.totalChipValue, styles.extra]}>
                          {formatRupees(history.totals.over)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
                <EdgeGroup>
                  {history.days.map((d) => (
                    <EdgeRow
                      key={d.date}
                      icon={<DateBlock date={d.date} />}
                      iconBg={d.date === date ? colors.waterPale : colors.surface}
                      title={formatDay(d.date)}
                      subtitle={
                        d.status === 'open'
                          ? 'Not closed yet'
                          : [
                              d.counted != null ? `Counted ${formatRupees(d.counted)}` : null,
                              d.closedBy ? `by ${d.closedBy}` : null,
                              d.note ? `“${d.note}”` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                      }
                      right={
                        d.status === 'open' ? (
                          <Pill label="NOT CLOSED" tone="slate" />
                        ) : (
                          <Pill
                            label={differenceText(d.difference ?? 0)}
                            tone={differenceTone(d.difference ?? 0)}
                          />
                        )
                      }
                      onPress={() => setDate(d.date)}
                    />
                  ))}
                </EdgeGroup>
              </>
            ) : (
              <View style={styles.emptyHistory}>
                <IconDrawer size={22} color={colors.slate} />
                <Text style={styles.emptyHistoryText}>No days recorded in this period yet.</Text>
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>

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
        subtitle={`${formatDay(date)} · the count will be cleared`}
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
  pressed: { opacity: 0.7 },
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.md, paddingTop: spacing.xs },
  dayBand: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.sm + 4,
    gap: spacing.sm,
  },
  dayBandHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  dayBandTitle: { ...typography.heading, fontSize: 16, color: colors.waterInk },
  dayBandMeta: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  dayRow: { gap: spacing.sm, paddingHorizontal: spacing.md },
  dayTile: {
    width: 58,
    height: 70,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dayTileOn: { backgroundColor: colors.waterInk, borderColor: colors.waterInk },
  dayWeek: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    color: colors.slate,
    letterSpacing: 0,
  },
  dayNum: { ...typography.heading, fontSize: 20, color: colors.waterInk },
  dayTextOn: { color: colors.white },
  dayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'transparent' },
  dayDotOn: { borderWidth: 1, borderColor: colors.white },
  calTile: { backgroundColor: colors.waterPale, borderColor: colors.waterPale, gap: 4 },
  calText: {
    ...typography.caption,
    fontSize: 10.5,
    fontWeight: '800',
    color: colors.waterDeep,
    letterSpacing: 0,
  },
  legend: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, letterSpacing: 0 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: colors.amberLight,
    marginHorizontal: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.sm + 4,
  },
  bannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTitle: { ...typography.bodyStrong, fontSize: 15, color: colors.amberDeep },
  bannerSub: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0, marginTop: 2 },
  bannerButton: {
    backgroundColor: colors.amberDeep,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 6,
    height: 34,
    justifyContent: 'center',
  },
  bannerButtonText: { ...typography.label, color: colors.white, fontSize: 13, fontWeight: '700' },
  loader: { marginTop: spacing.xxl },
  hero: {
    marginHorizontal: spacing.md,
    borderRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.md + 4,
    overflow: 'hidden',
  },
  orbLarge: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.12)',
    top: -70,
    right: -50,
  },
  orbSmall: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(255,255,255,0.08)',
    bottom: -40,
    left: -30,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  heroDate: { ...typography.label, fontSize: 14, color: 'rgba(255,255,255,0.9)' },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.white },
  statusDotOpen: { backgroundColor: colors.tealLight },
  statusDotClosed: { backgroundColor: colors.white },
  statusText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.white,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  heroLabel: { ...typography.label, fontSize: 14, color: 'rgba(255,255,255,0.85)' },
  heroValue: {
    ...typography.display,
    fontSize: 44,
    color: colors.white,
    marginTop: 2,
    letterSpacing: -1,
  },
  heroValueSmall: { ...typography.title, fontSize: 24, color: colors.white, marginTop: 4 },
  heroSub: { ...typography.label, fontSize: 14, color: 'rgba(255,255,255,0.9)', marginTop: 2 },
  heroSteps: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg },
  heroStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 4,
    paddingRight: 12,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  heroStepNext: { backgroundColor: 'rgba(255,255,255,0.1)' },
  heroStepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroStepDotDone: { backgroundColor: colors.white },
  heroStepNum: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: 0,
  },
  heroStepLabel: {
    ...typography.caption,
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.white,
    letterSpacing: 0,
  },
  heroLine: {
    flex: 1,
    height: 2,
    marginHorizontal: 6,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  heroLineDone: { backgroundColor: colors.white },
  card: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { ...typography.heading, fontSize: 18, color: colors.waterInk },
  cardLead: {
    ...typography.caption,
    fontSize: 13,
    lineHeight: 18,
    color: colors.slateDeep,
    letterSpacing: 0,
    marginTop: 2,
  },
  overline: {
    ...typography.caption,
    fontSize: 11,
    color: colors.slate,
    fontWeight: '800',
    letterSpacing: 1,
  },
  errorBox: { alignItems: 'center' },
  errorText: { ...typography.body, fontSize: 15, color: colors.slateDeep, textAlign: 'center' },
  sumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
  },
  sumDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  sumIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sumLabel: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  sumSub: { ...typography.caption, color: colors.slate, letterSpacing: 0, marginTop: 1 },
  sumValue: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk, fontWeight: '700' },
  editPill: {
    paddingHorizontal: 10,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
    justifyContent: 'center',
  },
  editPillText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.waterDeep,
    fontWeight: '700',
    letterSpacing: 0,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  totalLabel: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  totalValue: { ...typography.heading, fontSize: 20, color: colors.waterInk },
  moneyField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    height: 72,
  },
  moneyFieldFilled: { borderColor: colors.water, backgroundColor: colors.white },
  moneyRupee: { fontSize: 30, fontWeight: '700', color: colors.slate, marginRight: spacing.xs },
  moneyRupeeFilled: { color: colors.waterInk },
  moneyInput: {
    minWidth: 80,
    fontSize: 36,
    fontWeight: '800',
    color: colors.waterInk,
    paddingVertical: 0,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  hintChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.waterPale,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
  },
  hintChipText: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.waterDeep,
    letterSpacing: 0,
    flex: 1,
  },
  helper: { ...typography.caption, color: colors.slate, letterSpacing: 0, lineHeight: 17 },
  formError: { ...typography.label, color: colors.danger },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  plus: { color: colors.tealDeep },
  minus: { color: colors.danger },
  extra: { color: colors.amberDeep },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
  },
  resultIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultOk: { backgroundColor: '#F0FDFA' },
  resultShort: { backgroundColor: '#FEF2F2' },
  resultOver: { backgroundColor: '#FFFBEB' },
  resultTitle: { ...typography.bodyStrong, fontSize: 17, fontWeight: '700' },
  resultTitleOk: { color: colors.tealDeep },
  resultTitleShort: { color: colors.danger },
  resultTitleOver: { color: colors.amberDeep },
  resultSub: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0, marginTop: 2 },
  noteBlock: { gap: spacing.sm + 2 },
  fieldLabel: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    height: 36,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reasonOn: { backgroundColor: colors.waterInk, borderColor: colors.waterInk },
  reasonText: { ...typography.label, color: colors.waterInk, fontSize: 13 },
  reasonTextOn: { color: colors.white, fontWeight: '700' },
  noteInput: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    fontSize: 15,
    color: colors.waterInk,
    backgroundColor: colors.surface,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  statRow: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    gap: 4,
  },
  statLabel: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  statValue: { ...typography.heading, fontSize: 22, color: colors.waterInk },
  closedMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  closedBy: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  noteQuote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.waterLight,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
  },
  noteQuoteText: { ...typography.body, fontSize: 14, color: colors.slateDeep, fontStyle: 'italic' },
  diffBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    backgroundColor: '#FFFBEB',
  },
  diffText: { ...typography.label, fontSize: 13, lineHeight: 18, color: colors.amberDeep, flex: 1 },
  reopened: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  reopenedText: {
    ...typography.caption,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.slateDeep,
    letterSpacing: 0,
    flex: 1,
  },
  history: { gap: spacing.sm + 4, marginTop: spacing.sm },
  historyHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  historyTitle: {
    ...typography.heading,
    fontSize: 20,
    color: colors.waterInk,
    letterSpacing: -0.2,
  },
  historyCount: { ...typography.caption, fontSize: 13, color: colors.slateDeep, letterSpacing: 0 },
  totalsRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md },
  totalChip: {
    flex: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    gap: 2,
  },
  totalChipShort: { backgroundColor: '#FEF2F2' },
  totalChipOver: { backgroundColor: '#FFFBEB' },
  totalChipLabel: {
    ...typography.caption,
    fontSize: 12,
    color: colors.slateDeep,
    letterSpacing: 0,
  },
  totalChipValue: { ...typography.heading, fontSize: 18 },
  dateBlock: { alignItems: 'center', justifyContent: 'center' },
  dateDay: { fontSize: 16, fontWeight: '800', color: colors.waterInk, lineHeight: 18 },
  dateMonth: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.slateDeep,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyHistory: {
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  emptyHistoryText: { ...typography.body, fontSize: 14, color: colors.slateDeep },
});
