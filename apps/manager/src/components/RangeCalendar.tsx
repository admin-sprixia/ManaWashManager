import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors, radius, spacing, typography, IconChevronLeft, IconChevronRight } from '@mana/ui';
import { MONTH_NAMES, WEEKDAYS, monthGrid } from './CalendarSheet';

export interface DateRange {
  /** Inclusive, YYYY-MM-DD. */
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2 Oct" / "2 Oct 2025" when it isn't this year. */
export function shortDate(iso: string, thisYear = new Date().getFullYear()): string {
  const [y, m, d] = iso.split('-').map(Number);
  const base = `${d} ${MONTH_NAMES[(m ?? 1) - 1]!.slice(0, 3)}`;
  return y === thisYear ? base : `${base} ${y}`;
}

export function rangeLabel(r: DateRange): string {
  return r.from === r.to ? shortDate(r.from) : `${shortDate(r.from)} → ${shortDate(r.to)}`;
}

/** Whole days from `from` to `to`, counting both ends. */
export function rangeDays(r: DateRange): number {
  return (
    Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000) +
    1
  );
}

/**
 * Inline month calendar for picking a From → To range: first tap sets From, second sets To
 * (tapping an earlier day restarts). Days outside `min`…`max` are greyed out.
 */
export function RangeCalendar({
  from,
  to,
  min,
  max,
  onChange,
}: {
  from: string | null;
  to: string | null;
  min?: string;
  max: string;
  onChange: (from: string | null, to: string | null) => void;
}) {
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - spacing.lg * 2) / 7);
  const [cursor, setCursor] = useState((to ?? from ?? max).slice(0, 7));

  const year = Number(cursor.slice(0, 4));
  const month = Number(cursor.slice(5, 7));
  const grid = useMemo(() => monthGrid(year, month), [year, month]);
  const atMaxMonth = cursor >= max.slice(0, 7);
  const atMinMonth = min != null && cursor <= min.slice(0, 7);

  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    setCursor(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };

  const tap = (date: string) => {
    if (from && !to && date >= from) onChange(from, date);
    else onChange(date, null);
  };

  return (
    <View>
      <View style={styles.monthBar}>
        <Pressable
          onPress={() => shiftMonth(-1)}
          disabled={atMinMonth}
          hitSlop={10}
          style={({ pressed }) => [
            styles.navBtn,
            atMinMonth && styles.navBtnOff,
            pressed && styles.pressed,
          ]}
          accessibilityLabel="Previous month"
        >
          <IconChevronLeft size={18} color={colors.waterDeep} />
        </Pressable>
        <Text style={styles.monthTitle}>
          {MONTH_NAMES[month - 1]} {year}
        </Text>
        <Pressable
          onPress={() => shiftMonth(1)}
          disabled={atMaxMonth}
          hitSlop={10}
          style={({ pressed }) => [
            styles.navBtn,
            atMaxMonth && styles.navBtnOff,
            pressed && styles.pressed,
          ]}
          accessibilityLabel="Next month"
        >
          <IconChevronRight size={18} color={colors.waterDeep} />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((d) => (
          <Text key={d} style={[styles.weekday, { width: cell }, d === 'Sun' && styles.weekend]}>
            {d}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {grid.map((date, i) => {
          if (!date) return <View key={`b${i}`} style={{ width: cell, height: cell - 6 }} />;
          const off = date > max || (min != null && date < min);
          const isFrom = date === from;
          const isTo = date === to;
          const end = isFrom || isTo;
          const inside = from != null && to != null && date > from && date < to;
          const isToday = date === max;
          return (
            <Pressable
              key={date}
              disabled={off}
              onPress={() => tap(date)}
              style={[styles.cell, { width: cell, height: cell - 6 }]}
              accessibilityRole="button"
              accessibilityState={{ selected: end, disabled: off }}
              accessibilityLabel={date}
            >
              {({ pressed }) => (
                <>
                  {inside ? <View style={styles.bandFull} /> : null}
                  {isFrom && to && to !== from ? (
                    <View style={[styles.bandHalf, styles.bandRight]} />
                  ) : null}
                  {isTo && from && to !== from ? (
                    <View style={[styles.bandHalf, styles.bandLeft]} />
                  ) : null}
                  <View
                    style={[
                      styles.dayCircle,
                      isToday && !end && styles.todayCircle,
                      end && styles.endCircle,
                      pressed && !end && styles.pressedCircle,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        off && styles.dayOff,
                        inside && styles.dayInside,
                        isToday && !end && styles.todayText,
                        end && styles.endText,
                      ]}
                    >
                      {Number(date.slice(8, 10))}
                    </Text>
                  </View>
                </>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const BAND = '#DBEAFE';

const styles = StyleSheet.create({
  pressed: { opacity: 0.6 },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnOff: { opacity: 0.35 },
  monthTitle: {
    ...typography.heading,
    fontSize: 17,
    color: colors.waterInk,
    flex: 1,
    textAlign: 'center',
  },
  weekRow: { flexDirection: 'row', marginBottom: 2 },
  weekday: {
    ...typography.caption,
    fontSize: 11.5,
    textAlign: 'center',
    color: colors.slate,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  weekend: { color: colors.danger },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { alignItems: 'center', justifyContent: 'center' },
  bandFull: { ...StyleSheet.absoluteFillObject, top: 4, bottom: 4, backgroundColor: BAND },
  bandHalf: { position: 'absolute', top: 4, bottom: 4, width: '50%', backgroundColor: BAND },
  bandRight: { right: 0 },
  bandLeft: { left: 0 },
  dayCircle: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCircle: { borderWidth: 1.5, borderColor: colors.water },
  endCircle: { backgroundColor: colors.waterInk },
  pressedCircle: { backgroundColor: colors.waterPale },
  dayText: { ...typography.bodyStrong, fontSize: 14.5, color: colors.waterInk },
  dayOff: { color: colors.border },
  dayInside: { color: colors.waterDeep },
  todayText: { color: colors.water, fontWeight: '800' },
  endText: { color: colors.white, fontWeight: '800' },
});
