import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import { api } from '../api/client';
import { BottomSheet } from './BottomSheet';
import { IconChevronLeft, IconChevronRight } from './Icons';

export interface DayMarks {
  present: number;
  half: number;
  absent: number;
}

interface CalendarSheetProps {
  visible: boolean;
  /** Selected day, YYYY-MM-DD. */
  value: string;
  /** Latest pickable day (today); later days are greyed out. */
  max: string;
  /** Earliest pickable day; earlier days are greyed out. */
  min?: string;
  /** `attendance` shows marked-day dots; `plain` is a bare date picker. */
  mode?: 'attendance' | 'plain';
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onSelect: (date: string) => void;
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Days of a month laid out Monday-first, with nulls for the blank cells before the 1st. */
export function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= count; d++) cells.push(`${year}-${pad(month)}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Tone of a day's dot: every active member marked, some marked, or nothing. */
export function markTone(marks: DayMarks | undefined, members: number): 'full' | 'partial' | null {
  if (!marks) return null;
  const marked = marks.present + marks.half + marks.absent;
  if (marked === 0) return null;
  return members > 0 && marked >= members ? 'full' : 'partial';
}

/** Month calendar for picking a day; in attendance mode, dots show which days are already marked. */
export function CalendarSheet({
  visible,
  value,
  max,
  min,
  mode = 'attendance',
  title = 'Pick a day',
  subtitle = 'See or mark attendance for any past day.',
  onClose,
  onSelect,
}: CalendarSheetProps) {
  const marks = mode === 'attendance';
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - spacing.lg * 2) / 7);
  const [cursor, setCursor] = useState(value.slice(0, 7));
  const [days, setDays] = useState<Record<string, DayMarks>>({});
  const [members, setMembers] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) setCursor(value.slice(0, 7));
  }, [visible, value]);

  useEffect(() => {
    if (!visible || !marks) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await api.attendance.month.$get({ query: { month: cursor } });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setDays(data.days);
        setMembers(data.members);
      } catch {
        // Offline: the calendar still works, just without dots.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, cursor, marks]);

  const year = Number(cursor.slice(0, 4));
  const month = Number(cursor.slice(5, 7));
  const grid = useMemo(() => monthGrid(year, month), [year, month]);
  const atMaxMonth = cursor >= max.slice(0, 7);
  const atMinMonth = min != null && cursor <= min.slice(0, 7);

  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    setCursor(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };

  const fullDays = Object.values(days).filter((d) => markTone(d, members) === 'full').length;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} subtitle={subtitle}>
      <View style={styles.monthBar}>
        <Pressable
          onPress={() => shiftMonth(-1)}
          disabled={atMinMonth}
          hitSlop={10}
          style={({ pressed }) => [styles.navBtn, atMinMonth && styles.navBtnOff, pressed && styles.pressed]}
          accessibilityLabel="Previous month"
        >
          <IconChevronLeft size={18} color={colors.waterDeep} />
        </Pressable>
        <View style={styles.monthCopy}>
          <Text style={styles.monthTitle}>
            {MONTH_NAMES[month - 1]} {year}
          </Text>
          <Text style={styles.monthMeta}>
            {!marks
              ? value.slice(0, 7) === cursor
                ? `Selected: ${Number(value.slice(8, 10))} ${MONTH_NAMES[month - 1]!.slice(0, 3)}`
                : ' '
              : loading
                ? ' '
                : `${fullDays} day${fullDays === 1 ? '' : 's'} fully marked`}
          </Text>
        </View>
        <Pressable
          onPress={() => shiftMonth(1)}
          disabled={atMaxMonth}
          hitSlop={10}
          style={({ pressed }) => [styles.navBtn, atMaxMonth && styles.navBtnOff, pressed && styles.pressed]}
          accessibilityLabel="Next month"
        >
          <IconChevronRight size={18} color={colors.waterDeep} />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((d) => (
          <Text key={d} style={[styles.weekday, { width: cell }, (d === 'Sun') && styles.weekend]}>
            {d}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {grid.map((date, i) => {
          if (!date) return <View key={`b${i}`} style={{ width: cell, height: cell }} />;
          const future = date > max || (min != null && date < min);
          const selected = date === value;
          const isToday = date === max;
          const tone = marks ? markTone(days[date], members) : null;
          return (
            <Pressable
              key={date}
              disabled={future}
              onPress={() => onSelect(date)}
              style={[styles.cell, { width: cell, height: cell }]}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: future }}
              accessibilityLabel={date}
            >
              {({ pressed }) => (
                <View
                  style={[
                    styles.dayCircle,
                    isToday && !selected && styles.todayCircle,
                    selected && styles.selectedCircle,
                    pressed && !selected && styles.pressedCircle,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      future && styles.dayFuture,
                      isToday && !selected && styles.todayText,
                      selected && styles.selectedText,
                    ]}
                  >
                    {Number(date.slice(8, 10))}
                  </Text>
                  <View
                    style={[
                      styles.dot,
                      tone === 'full' && styles.dotFull,
                      tone === 'partial' && styles.dotPartial,
                      selected && tone != null && styles.dotOnSelected,
                    ]}
                  />
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {marks ? (
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.dotFull]} />
            <Text style={styles.legendText}>Everyone marked</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.dotPartial]} />
            <Text style={styles.legendText}>Some marked</Text>
          </View>
          {loading ? <ActivityIndicator size="small" color={colors.water} /> : null}
        </View>
      ) : null}

      {value !== max ? (
        <Pressable
          onPress={() => onSelect(max)}
          style={({ pressed }) => [styles.todayBtn, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.todayBtnText}>Jump to today</Text>
        </Pressable>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
  monthBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  navBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnOff: { opacity: 0.35 },
  monthCopy: { flex: 1, alignItems: 'center', gap: 2 },
  monthTitle: { ...typography.heading, fontSize: 19, color: colors.waterInk },
  monthMeta: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  weekRow: { flexDirection: 'row', marginTop: spacing.xs },
  weekday: {
    ...typography.caption,
    fontSize: 11.5,
    textAlign: 'center',
    color: colors.slate,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  weekend: { color: colors.danger },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: -spacing.xs },
  cell: { alignItems: 'center', justifyContent: 'center' },
  dayCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  todayCircle: { borderWidth: 1.5, borderColor: colors.water },
  selectedCircle: { backgroundColor: colors.waterInk },
  pressedCircle: { backgroundColor: colors.waterPale },
  dayText: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  dayFuture: { color: colors.border },
  todayText: { color: colors.water, fontWeight: '800' },
  selectedText: { color: colors.white, fontWeight: '800' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'transparent' },
  dotFull: { backgroundColor: colors.teal },
  dotPartial: { backgroundColor: colors.amber },
  dotOnSelected: { borderWidth: 1, borderColor: colors.white },
  legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  todayBtn: {
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
    justifyContent: 'center',
  },
  todayBtnText: { ...typography.label, fontSize: 14, color: colors.waterDeep, fontWeight: '700' },
});
