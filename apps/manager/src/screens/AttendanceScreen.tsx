import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  IconSync,
  IconUsers,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { CalendarSheet, markTone, type DayMarks } from '../components/CalendarSheet';
import { api, apiErrorMessage } from '../api/client';
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
}

const TONE: Record<AttendanceStatus, { bg: string; fg: string; solid: string }> = {
  present: { bg: '#CCFBF1', fg: colors.tealDeep, solid: colors.teal },
  half: { bg: '#FEF3C7', fg: colors.amberDeep, solid: colors.amber },
  absent: { bg: '#FEE2E2', fg: colors.danger, solid: colors.danger },
};

const SHORT: Record<AttendanceStatus, string> = { present: 'Present', half: 'Half day', absent: 'Absent' };
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

  // A week can straddle two months; the strip needs both for its dots.
  const weekMonths = [...new Set(weekOf(date).map((d) => d.slice(0, 7)))].join(',');

  const load = useCallback(async () => {
    try {
      const res = await api.attendance.$get({ query: { date } });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t load attendance.'));
      const data = await res.json();
      setRows(data.rows as Row[]);
      setError(null);
    } catch (e) {
      setError(e instanceof NetworkError ? 'Attendance needs a connection. Pull down to retry.' : (e as Error).message);
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

  const mark = async (row: Row, status: AttendanceStatus) => {
    const next = row.status === status ? null : status;
    setSaving(row.userId);
    setRows((prev) => prev.map((r) => (r.userId === row.userId ? { ...r, status: next } : r)));
    try {
      const res = await api.attendance.$put({ json: { userId: row.userId, date, status: next } });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t save.'));
    } catch (e) {
      setRows((prev) => prev.map((r) => (r.userId === row.userId ? row : r)));
      showToast(e instanceof NetworkError ? 'Attendance needs a connection.' : (e as Error).message, 'error');
    } finally {
      setSaving(null);
    }
  };

  const markAllPresent = async () => {
    const unmarked = rows.filter((r) => r.status == null);
    for (const r of unmarked) await mark(r, 'present');
    void loadMonth();
  };

  const markAndRefresh = async (row: Row, status: AttendanceStatus) => {
    await mark(row, status);
    void loadMonth();
  };

  const counts = ATTENDANCE_STATUSES.map((s) => ({ s, n: rows.filter((r) => r.status === s).length }));
  const unmarkedCount = rows.filter((r) => r.status == null).length;
  const markedCount = rows.length - unmarkedCount;
  const allDone = rows.length > 0 && unmarkedCount === 0;
  const dayTitle = date === today ? 'Today' : date === shiftDate(today, -1) ? 'Yesterday' : formatDay(date);

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
              void Promise.all([load(), loadMonth()]).finally(() => setRefreshing(false));
            }}
            tintColor={colors.water}
            colors={[colors.water]}
          />
        }
      >
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
                <Text style={styles.dateTitle}>{dayTitle}</Text>
                <IconChevronDown size={15} color={colors.waterDeep} />
              </View>
              <Text style={styles.dateMeta}>{formatDay(date)} · tap for calendar</Text>
            </Pressable>
            <Pressable
              onPress={() => setDate(shiftDate(date, 1))}
              disabled={date >= today}
              hitSlop={10}
              style={({ pressed }) => [styles.dateBtn, date >= today && styles.dateBtnOff, pressed && styles.pressed]}
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
                  style={({ pressed }) => [styles.weekDay, on && styles.weekDayOn, pressed && !on && styles.weekDayPressed]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: future }}
                >
                  <Text style={[styles.weekLetter, on && styles.weekTextOn, future && styles.weekFuture]}>
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
            <Text style={styles.stateText}>Add people in More → Team, then mark their days here.</Text>
          </View>
        ) : (
          <>
            {/* Progress + counts */}
            <View style={styles.summary}>
              <View style={styles.progressHead}>
                <Text style={styles.progressTitle}>
                  {allDone ? 'All marked' : `${markedCount} of ${rows.length} marked`}
                </Text>
                {allDone ? (
                  <View style={styles.doneChip}>
                    <IconCheck size={12} color={colors.white} />
                    <Text style={styles.doneChipText}>Done</Text>
                  </View>
                ) : (
                  <Text style={styles.progressMeta}>{unmarkedCount} left</Text>
                )}
              </View>
              <View style={styles.progressBar}>
                {counts.map(({ s, n }) =>
                  n > 0 ? <View key={s} style={{ flex: n, backgroundColor: TONE[s].solid }} /> : null,
                )}
                {unmarkedCount > 0 ? <View style={{ flex: unmarkedCount }} /> : null}
              </View>
              <View style={styles.counts}>
                {counts.map(({ s, n }, i) => (
                  <View key={s} style={[styles.countCell, i > 0 && styles.countDivider]}>
                    <Text style={[styles.countValue, { color: n > 0 ? TONE[s].fg : colors.slate }]}>{n}</Text>
                    <Text style={styles.countLabel}>{ATTENDANCE_LABEL[s]}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Team */}
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Team</Text>
              {unmarkedCount > 0 ? (
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
            <View style={styles.list}>
              {rows.map((r, i) => (
                <View key={r.userId} style={[styles.row, i < rows.length - 1 && styles.divider]}>
                  <View style={styles.rowTop}>
                    <View>
                      <Avatar name={r.name} id={r.userId} size={42} />
                      {r.status ? (
                        <View style={[styles.statusBadge, { backgroundColor: TONE[r.status].solid }]}>
                          {r.status === 'present' ? (
                            <IconCheck size={10} color={colors.white} />
                          ) : (
                            <Text style={styles.statusBadgeText}>{r.status === 'half' ? '½' : '✕'}</Text>
                          )}
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.rowCopy}>
                      <Text style={styles.name} numberOfLines={1}>
                        {r.name}
                      </Text>
                      <Text style={[styles.meta, r.status && { color: TONE[r.status].fg }]} numberOfLines={1}>
                        {r.status ? SHORT[r.status] : 'Not marked yet'}
                        {r.status && r.markedBy ? ` · by ${r.markedBy}` : ''}
                        {r.role === 'owner' ? ' · Owner' : ''}
                      </Text>
                    </View>
                    {saving === r.userId ? <ActivityIndicator size="small" color={colors.water} /> : null}
                  </View>
                  <View style={styles.choices}>
                    {ATTENDANCE_STATUSES.map((s) => {
                      const on = r.status === s;
                      return (
                        <Pressable
                          key={s}
                          onPress={() => void markAndRefresh(r, s)}
                          disabled={saving === r.userId}
                          style={({ pressed }) => [
                            styles.choice,
                            on && { backgroundColor: TONE[s].solid, borderColor: TONE[s].solid },
                            pressed && !on && styles.choicePressed,
                          ]}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={`${r.name} ${ATTENDANCE_LABEL[s]}`}
                        >
                          {on ? <IconCheck size={13} color={colors.white} /> : null}
                          <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{SHORT[s]}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
            <Text style={styles.footnote}>
              Tap a choice again to clear it. A half day counts as 0.5 days worked. Staff see their own days in More.
            </Text>
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
  scroll: { paddingBottom: spacing.xxl, paddingTop: spacing.sm, gap: spacing.md },
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
  weekLetter: { ...typography.caption, fontSize: 11, fontWeight: '700', color: colors.slate, letterSpacing: 0.3 },
  weekNum: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk, fontWeight: '700' },
  weekToday: { color: colors.water },
  weekTextOn: { color: colors.white },
  weekFuture: { color: colors.border },
  weekDot: { width: 5, height: 5, borderRadius: 3 },
  dotFull: { backgroundColor: colors.teal },
  dotPartial: { backgroundColor: colors.amber },
  dotOnSelected: { borderWidth: 1, borderColor: colors.white },
  summary: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm + 4,
    gap: spacing.sm + 4,
  },
  progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressTitle: { ...typography.heading, fontSize: 18, color: colors.waterInk },
  progressMeta: { ...typography.label, fontSize: 13, color: colors.amberDeep },
  doneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.teal,
  },
  doneChipText: { ...typography.caption, fontSize: 12, color: colors.white, fontWeight: '800', letterSpacing: 0.2 },
  progressBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    gap: 2,
  },
  counts: { flexDirection: 'row', paddingTop: spacing.xs },
  countCell: { flex: 1, alignItems: 'center', gap: 1 },
  countDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  countValue: { ...typography.heading, fontSize: 22 },
  countLabel: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, letterSpacing: 0 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginBottom: -spacing.sm,
  },
  sectionTitle: { ...typography.heading, fontSize: 18, color: colors.waterInk, letterSpacing: -0.2 },
  restBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.teal,
  },
  restBtnText: { ...typography.caption, fontSize: 12.5, color: colors.white, fontWeight: '700', letterSpacing: 0 },
  list: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.sm + 4 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
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
  rowCopy: { flex: 1, gap: 2 },
  name: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk, fontWeight: '700' },
  meta: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0, fontWeight: '600' },
  choices: { flexDirection: 'row', gap: spacing.sm },
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
  stateBox: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, gap: spacing.sm },
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
  stateText: { ...typography.body, fontSize: 14.5, color: colors.slateDeep, textAlign: 'center', lineHeight: 21 },
});
