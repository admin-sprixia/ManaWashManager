import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ATTENDANCE_LABEL, ATTENDANCE_STATUSES, type AttendanceStatus } from '@mana/domain';
import {
  ScreenContainer,
  ScreenHeader,
  Avatar,
  Button,
  showToast,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconLock,
  IconSync,
  IconUsers,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { Band, BandRow, ScreenHero, SectionTitle, TipBand } from '../components/ScreenChrome';
import { CalendarSheet, markTone, type DayMarks } from '../components/CalendarSheet';
import { api, apiErrorMessage } from '../api/client';
import { useAuth } from '../api/auth';
import { NetworkError } from '../api/network';
import { formatDay, istDate } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Attendance'>;

interface Row {
  userId: string;
  name: string;
  role: string;
  status: AttendanceStatus | null;
  markedBy: string | null;
  /** The owner marks everyone, themselves too; a manager marks staff (today and yesterday), not themselves. */
  canMark: boolean;
}

/** One person's month, for the summary under the day's sheet. */
interface MonthPerson {
  userId: string;
  name: string;
  role: string;
  present: number;
  half: number;
  absent: number;
  daysWorked: number;
  noAbsences: boolean;
}

const MONTH_NAME = new Intl.DateTimeFormat('en-IN', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const TONE: Record<AttendanceStatus, { bg: string; fg: string; solid: string }> = {
  present: { bg: '#CCFBF1', fg: colors.tealDeep, solid: colors.teal },
  half: { bg: '#FEF3C7', fg: colors.amberDeep, solid: colors.amber },
  absent: { bg: '#FEE2E2', fg: colors.danger, solid: colors.danger },
};

const SHORT: Record<AttendanceStatus, string> = {
  present: 'Present',
  half: 'Half day',
  absent: 'Absent',
};
const WEEK_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday-to-Sunday week that contains `date`. */
function weekOf(date: string): string[] {
  const d = new Date(`${date}T12:00:00Z`);
  const monday = shiftDate(date, -((d.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => shiftDate(monday, i));
}

/** Owner marks who worked each day — present, half day or absent. Tap the same choice to clear it. */
export function AttendanceScreen({ navigation }: Props) {
  const { user } = useAuth();
  const today = istDate(0);
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [monthDays, setMonthDays] = useState<Record<string, DayMarks>>({});
  const [members, setMembers] = useState(0);
  const [locked, setLocked] = useState<string | null>(null);
  const [monthPeople, setMonthPeople] = useState<MonthPerson[]>([]);
  const month = date.slice(0, 7);

  // A week can straddle two months; the strip needs both for its dots.
  const weekMonths = [...new Set(weekOf(date).map((d) => d.slice(0, 7)))].join(',');

  const load = useCallback(async () => {
    try {
      const res = await api.attendance.$get({ query: { date } });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t load attendance.'));
      const data = await res.json();
      setRows(data.rows as Row[]);
      setLocked(data.locked);
      setError(null);
    } catch (e) {
      setError(
        e instanceof NetworkError
          ? 'Attendance needs a connection. Pull down to retry.'
          : (e as Error).message,
      );
    } finally {
      setLoading(false);
    }
  }, [date]);

  const loadMonth = useCallback(async () => {
    try {
      const months = await Promise.all(
        weekMonths.split(',').map(async (month) => {
          const res = await api.attendance.month.$get({ query: { month } });
          return res.ok ? res.json() : null;
        }),
      );
      const loaded = months.filter((m) => m != null);
      if (loaded.length === 0) return;
      setMonthDays(Object.assign({}, ...loaded.map((m) => m.days)) as Record<string, DayMarks>);
      setMembers(loaded[loaded.length - 1]!.members);
    } catch {
      // The week strip just shows no dots offline.
    }
  }, [weekMonths]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    void loadMonth();
  }, [loadMonth]);

  const loadSummary = useCallback(async () => {
    try {
      const res = await api.attendance.summary.$get({ query: { month } });
      if (res.ok) setMonthPeople((await res.json()).people as MonthPerson[]);
    } catch {
      // The month summary just doesn't show offline.
    }
  }, [month]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const mark = async (row: Row, status: AttendanceStatus) => {
    const next = row.status === status ? null : status;
    setSaving(row.userId);
    setRows((prev) => prev.map((r) => (r.userId === row.userId ? { ...r, status: next } : r)));
    try {
      const res = await api.attendance.$put({ json: { userId: row.userId, date, status: next } });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t save.'));
    } catch (e) {
      setRows((prev) => prev.map((r) => (r.userId === row.userId ? row : r)));
      showToast(
        e instanceof NetworkError ? 'Attendance needs a connection.' : (e as Error).message,
        'error',
      );
    } finally {
      setSaving(null);
    }
  };

  const markAllPresent = async () => {
    const unmarked = rows.filter((r) => r.status == null && r.canMark);
    for (const r of unmarked) await mark(r, 'present');
    void loadMonth();
    void loadSummary();
  };

  const markAndRefresh = async (row: Row, status: AttendanceStatus) => {
    await mark(row, status);
    void loadMonth();
    void loadSummary();
  };

  const counts = ATTENDANCE_STATUSES.map((s) => ({
    s,
    n: rows.filter((r) => r.status === s).length,
  }));
  const unmarkedCount = rows.filter((r) => r.status == null).length;
  const markedCount = rows.length - unmarkedCount;
  const allDone = rows.length > 0 && unmarkedCount === 0;
  const markableUnmarked = rows.filter((r) => r.status == null && r.canMark).length;
  const dayTitle =
    date === today ? 'Today' : date === shiftDate(today, -1) ? 'Yesterday' : formatDay(date);

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader
          title="Attendance"
          onBack={() => navigation.goBack()}
          right={
            <Pressable
              onPress={() => setCalendarOpen(true)}
              hitSlop={8}
              style={({ pressed }) => [styles.calendarBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Open calendar"
            >
              <IconCalendar size={18} color={colors.waterDeep} />
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
              void Promise.all([load(), loadMonth(), loadSummary()]).finally(() =>
                setRefreshing(false),
              );
            }}
            tintColor={colors.water}
            colors={[colors.water]}
          />
        }
      >
        <ScreenHero
          eyebrow="Attendance"
          title={dayTitle}
          meta={
            rows.length > 0
              ? `${formatDay(date)} · ${allDone ? 'everyone marked' : `${markedCount} of ${rows.length} marked`}`
              : formatDay(date)
          }
          right={
            allDone ? (
              <View style={styles.doneChip}>
                <IconCheck size={12} color={colors.white} />
                <Text style={styles.doneChipText}>Done</Text>
              </View>
            ) : rows.length > 0 ? (
              <Text style={styles.heroLeft}>{unmarkedCount} left</Text>
            ) : undefined
          }
          chips={
            rows.length > 0
              ? counts.map(({ s, n }) => ({ label: ATTENDANCE_LABEL[s], value: n }))
              : undefined
          }
        >
          {rows.length > 0 ? (
            <View style={styles.progressBar}>
              {counts.map(({ s, n }) =>
                n > 0 ? <View key={s} style={{ flex: n, backgroundColor: TONE[s].solid }} /> : null,
              )}
              {unmarkedCount > 0 ? <View style={{ flex: unmarkedCount }} /> : null}
            </View>
          ) : null}
        </ScreenHero>

        {/* Day picker */}
        <View style={styles.dayBand}>
          <View style={styles.dateBar}>
            <Pressable
              onPress={() => setDate(shiftDate(date, -1))}
              hitSlop={10}
              style={({ pressed }) => [styles.dateBtn, pressed && styles.pressed]}
              accessibilityLabel="Previous day"
            >
              <IconChevronLeft size={18} color={colors.waterDeep} />
            </Pressable>
            <Pressable
              onPress={() => setCalendarOpen(true)}
              style={({ pressed }) => [styles.dateCopy, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${dayTitle}, open calendar`}
            >
              <View style={styles.dateTitleRow}>
                <Text style={styles.dateTitle}>{formatDay(date)}</Text>
                <IconChevronDown size={15} color={colors.waterDeep} />
              </View>
              <Text style={styles.dateMeta}>Tap for calendar</Text>
            </Pressable>
            <Pressable
              onPress={() => setDate(shiftDate(date, 1))}
              disabled={date >= today}
              hitSlop={10}
              style={({ pressed }) => [
                styles.dateBtn,
                date >= today && styles.dateBtnOff,
                pressed && styles.pressed,
              ]}
              accessibilityLabel="Next day"
            >
              <IconChevronRight size={18} color={colors.waterDeep} />
            </Pressable>
          </View>

          <View style={styles.week}>
            {weekOf(date).map((d, i) => {
              const on = d === date;
              const future = d > today;
              const tone = markTone(monthDays[d], members);
              return (
                <Pressable
                  key={d}
                  disabled={future}
                  onPress={() => setDate(d)}
                  style={({ pressed }) => [
                    styles.weekDay,
                    on && styles.weekDayOn,
                    pressed && !on && styles.weekDayPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: future }}
                >
                  <Text
                    style={[
                      styles.weekLetter,
                      on && styles.weekTextOn,
                      future && styles.weekFuture,
                    ]}
                  >
                    {WEEK_LETTERS[i]}
                  </Text>
                  <Text
                    style={[
                      styles.weekNum,
                      d === today && !on && styles.weekToday,
                      on && styles.weekTextOn,
                      future && styles.weekFuture,
                    ]}
                  >
                    {Number(d.slice(8, 10))}
                  </Text>
                  <View
                    style={[
                      styles.weekDot,
                      tone === 'full' && styles.dotFull,
                      tone === 'partial' && styles.dotPartial,
                      on && tone != null && styles.dotOnSelected,
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>

        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.water} />
        ) : error ? (
          <View style={styles.stateBox}>
            <View style={styles.stateIcon}>
              <IconSync size={26} color={colors.waterDeep} />
            </View>
            <Text style={styles.stateText}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.stateBox}>
            <View style={styles.stateIcon}>
              <IconUsers size={26} color={colors.waterDeep} />
            </View>
            <Text style={styles.stateTitle}>No team yet</Text>
            <Text style={styles.stateText}>
              Add people in More → Team, then mark their days here.
            </Text>
          </View>
        ) : (
          <>
            {/* Team */}
            <View style={styles.sectionRow}>
              <View style={styles.sectionRowTitle}>
                <SectionTitle meta={`${markedCount} of ${rows.length} marked`}>Team</SectionTitle>
              </View>
              {markableUnmarked > 0 ? (
                <Pressable
                  onPress={() => void markAllPresent()}
                  hitSlop={8}
                  style={({ pressed }) => [styles.restBtn, pressed && styles.pressed]}
                >
                  <IconCheck size={13} color={colors.white} />
                  <Text style={styles.restBtnText}>Mark rest present</Text>
                </Pressable>
              ) : null}
            </View>
            {locked ? <TipBand>{locked}</TipBand> : null}
            <Band>
              {rows.map((r, i) => (
                <View key={r.userId} style={i < rows.length - 1 && styles.divider}>
                  <BandRow
                    last
                    icon={
                      <View>
                        <Avatar name={r.name} id={r.userId} size={42} />
                        {r.status ? (
                          <View
                            style={[styles.statusBadge, { backgroundColor: TONE[r.status].solid }]}
                          >
                            {r.status === 'present' ? (
                              <IconCheck size={10} color={colors.white} />
                            ) : (
                              <Text style={styles.statusBadgeText}>
                                {r.status === 'half' ? '½' : '✕'}
                              </Text>
                            )}
                          </View>
                        ) : null}
                      </View>
                    }
                    iconBg="transparent"
                    title={r.userId === user?.id ? `${r.name} · You` : r.name}
                    subtitle={
                      (r.status ? SHORT[r.status] : 'Not marked yet') +
                      (r.status && r.markedBy ? ` · by ${r.markedBy}` : '') +
                      (r.role === 'owner' ? ' · Owner' : '')
                    }
                    right={
                      saving === r.userId ? (
                        <ActivityIndicator size="small" color={colors.water} />
                      ) : r.status ? (
                        <View style={[styles.statusPill, { backgroundColor: TONE[r.status].bg }]}>
                          <Text style={[styles.statusPillText, { color: TONE[r.status].fg }]}>
                            {SHORT[r.status]}
                          </Text>
                        </View>
                      ) : undefined
                    }
                  />
                  <View style={styles.choices}>
                    {ATTENDANCE_STATUSES.map((s) => {
                      const on = r.status === s;
                      return (
                        <Pressable
                          key={s}
                          onPress={() => void markAndRefresh(r, s)}
                          disabled={saving === r.userId || !r.canMark}
                          style={({ pressed }) => [
                            styles.choice,
                            on && { backgroundColor: TONE[s].solid, borderColor: TONE[s].solid },
                            !r.canMark && !on && styles.choiceOff,
                            pressed && !on && styles.choicePressed,
                          ]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on, disabled: !r.canMark }}
                          accessibilityLabel={`${r.name} ${ATTENDANCE_LABEL[s]}`}
                        >
                          {on ? <IconCheck size={13} color={colors.white} /> : null}
                          <Text style={[styles.choiceText, on && styles.choiceTextOn]}>
                            {SHORT[s]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </Band>
            <Text style={styles.footnote}>
              Tap a choice again to clear it. A half day counts as 0.5 days worked. The owner marks
              everyone, their own day too; a manager marks staff for today and yesterday, not their own.
              Staff see their own days in More.
            </Text>

            {monthPeople.length > 0 ? (
              <>
                <SectionTitle meta="Days worked this month">
                  {MONTH_NAME.format(new Date(`${month}-01T00:00:00Z`))}
                </SectionTitle>
                <Band>
                  {monthPeople.map((p, i) => (
                    <BandRow
                      key={p.userId}
                      last={i === monthPeople.length - 1}
                      title={p.name}
                      subtitle={`${p.present} present · ${p.half} half · ${p.absent} absent`}
                      right={
                        <View style={styles.monthRightRow}>
                          {p.noAbsences ? (
                            <View style={styles.fullChip}>
                              <IconCheck size={11} color={colors.white} />
                              <Text style={styles.fullChipText}>No absences</Text>
                            </View>
                          ) : null}
                          <View style={styles.monthRight}>
                            <Text style={styles.monthDays}>{p.daysWorked}</Text>
                            <Text style={styles.monthDaysLabel}>days</Text>
                          </View>
                        </View>
                      }
                    />
                  ))}
                </Band>
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <CalendarSheet
        visible={calendarOpen}
        value={date}
        max={today}
        onClose={() => setCalendarOpen(false)}
        onSelect={(d) => {
          setDate(d);
          setCalendarOpen(false);
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl, paddingTop: spacing.xs, gap: spacing.sm + 2 },
  pressed: { opacity: 0.65 },
  loader: { marginTop: spacing.xxl },
  calendarBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBand: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 4,
    paddingBottom: spacing.sm + 4,
    gap: spacing.sm + 4,
  },
  dateBar: { flexDirection: 'row', alignItems: 'center' },
  dateBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateBtnOff: { opacity: 0.35 },
  dateCopy: { flex: 1, alignItems: 'center', gap: 1 },
  dateTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dateTitle: { ...typography.heading, fontSize: 19, color: colors.waterInk },
  dateMeta: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  week: { flexDirection: 'row', justifyContent: 'space-between' },
  weekDay: { width: 42, alignItems: 'center', paddingVertical: 6, borderRadius: radius.md, gap: 3 },
  weekDayOn: { backgroundColor: colors.waterInk },
  weekDayPressed: { backgroundColor: colors.waterPale },
  weekLetter: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    color: colors.slate,
    letterSpacing: 0.3,
  },
  weekNum: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk, fontWeight: '700' },
  weekToday: { color: colors.water },
  weekTextOn: { color: colors.white },
  weekFuture: { color: colors.border },
  weekDot: { width: 5, height: 5, borderRadius: 3 },
  dotFull: { backgroundColor: colors.teal },
  dotPartial: { backgroundColor: colors.amber },
  dotOnSelected: { borderWidth: 1, borderColor: colors.white },
  doneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.teal,
  },
  doneChipText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.white,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  heroLeft: { ...typography.label, fontSize: 13, color: 'rgba(255,255,255,0.9)' },
  progressBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.18)',
    gap: 2,
    marginTop: spacing.sm,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', paddingRight: spacing.md },
  sectionRowTitle: { flex: 1 },
  restBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 32,
    marginBottom: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.teal,
  },
  restBtnText: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.white,
    fontWeight: '700',
    letterSpacing: 0,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  statusBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadgeText: { fontSize: 9, fontWeight: '900', color: colors.white },
  choices: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.white,
  },
  statusPill: {
    paddingHorizontal: 10,
    height: 24,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  statusPillText: { ...typography.caption, fontSize: 11.5, fontWeight: '800', letterSpacing: 0 },
  monthRightRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  choice: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  choicePressed: { backgroundColor: colors.waterPale },
  choiceOff: { opacity: 0.45 },
  monthRight: { alignItems: 'flex-end' },
  monthDays: { ...typography.heading, fontSize: 18, color: colors.waterInk },
  monthDaysLabel: { ...typography.caption, fontSize: 11, color: colors.slate, letterSpacing: 0 },
  fullChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.teal,
  },
  fullChipText: {
    ...typography.caption,
    fontSize: 11,
    color: colors.white,
    fontWeight: '700',
    letterSpacing: 0,
  },
  choiceText: { ...typography.label, fontSize: 13.5, color: colors.slateDeep },
  choiceTextOn: { color: colors.white, fontWeight: '800' },
  footnote: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slate,
    paddingHorizontal: spacing.md,
    letterSpacing: 0,
    lineHeight: 18,
  },
  stateBox: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  stateIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  stateTitle: { ...typography.heading, fontSize: 19, color: colors.waterInk },
  stateText: {
    ...typography.body,
    fontSize: 14.5,
    color: colors.slateDeep,
    textAlign: 'center',
    lineHeight: 21,
  },
});
