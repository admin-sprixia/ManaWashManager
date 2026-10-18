import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatClock, formatDay, WEEKDAY_SHORT, weekdayOf } from '@mana/domain';
import { IconChevronRight, colors, spacing, typography } from '@mana/ui';
import { BoardSectionHeader } from '../../../components/board/BoardSectionHeader';
import type { Overview } from '../shared';
import { TEAL, TEAL_MIST, TEAL_PALE, plural } from './parts';
import type { Nav } from './types';

type Day = Overview['days'][number];

/** The days after today as a strip; the picked day's wash days as an agenda below it. */
export function WeekSection({ days, nav }: { days: Day[]; nav: Nav }) {
  const [picked, setPicked] = useState<string | null>(null);
  if (!days.length) return null;
  const day = days.find((d) => d.day === picked) ?? days.find((d) => d.places.length) ?? days[0]!;
  const busy = days.filter((d) => d.places.length).length;

  return (
    <View>
      <BoardSectionHeader title="Coming up" count={busy || undefined} />
      <View style={styles.band}>
        <View style={styles.strip} accessibilityRole="tablist">
          {days.map((d) => {
            const on = d.day === day.day;
            const n = d.places.length;
            return (
              <Pressable
                key={d.day}
                onPress={() => setPicked(d.day)}
                style={[styles.day, on && styles.dayOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${formatDay(d.day)}: ${n ? plural(n, 'community', 'communities') : 'free'}`}
              >
                <Text style={[styles.dayName, on && styles.textOn]}>{WEEKDAY_SHORT[weekdayOf(d.day)]}</Text>
                <Text style={[styles.dayDate, on && styles.textOn, !n && !on && styles.dayFree]}>{Number(d.day.slice(8))}</Text>
                <View style={styles.dots}>
                  {n ? (
                    Array.from({ length: Math.min(n, 3) }, (_, i) => <View key={i} style={[styles.dot, on && styles.dotOn]} />)
                  ) : (
                    <View style={styles.dotEmpty} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.agenda}>
          {day.places.length ? (
            day.places.map((p, i) => {
              const cars = p.due + p.unpaid;
              const [time, ampm] = formatClock(p.washTime).split(' ');
              return (
                <Pressable
                  key={p.id}
                  onPress={() => nav.navigate('PlaceDay', { placeId: p.id, day: day.day })}
                  android_ripple={{ color: TEAL_MIST }}
                  style={({ pressed }) => [styles.slot, i > 0 && styles.slotDivider, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatClock(p.washTime)}, ${p.title}, ${plural(cars, 'vehicle')}`}
                >
                  <View style={styles.time}>
                    <Text style={styles.timeValue}>{time}</Text>
                    {ampm ? <Text style={styles.timeAmpm}>{ampm}</Text> : null}
                  </View>
                  <View style={styles.rail} />
                  <View style={styles.slotBody}>
                    <Text style={styles.slotTitle} numberOfLines={1}>
                      {p.title}
                    </Text>
                    <Text style={styles.slotMeta} numberOfLines={1}>
                      {[plural(p.due, 'paid'), p.unpaid ? `${p.unpaid} not paid` : null, p.team.length ? p.team.join(', ') : 'No team set']
                        .filter(Boolean)
                        .join('  ·  ')}
                    </Text>
                  </View>
                  <IconChevronRight size={18} color={colors.slate} />
                </Pressable>
              );
            })
          ) : (
            <View style={styles.free}>
              <Text style={styles.freeTitle}>{formatDay(day.day)} is free</Text>
              <Text style={styles.freeBody}>No community wash days.</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  strip: { flexDirection: 'row', gap: 6, paddingHorizontal: spacing.md - 4, paddingTop: spacing.sm + 4, paddingBottom: spacing.sm },
  day: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 8, borderRadius: 16 },
  dayOn: { backgroundColor: TEAL },
  dayName: { ...typography.caption, fontSize: 11, fontWeight: '700', color: colors.slate, letterSpacing: 0.3 },
  dayDate: { ...typography.heading, fontSize: 18, color: colors.waterInk },
  dayFree: { color: colors.slate },
  textOn: { color: colors.white },
  dots: { flexDirection: 'row', gap: 3, height: 6, alignItems: 'center', marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.teal },
  dotOn: { backgroundColor: colors.white },
  dotEmpty: { width: 5, height: 5 },
  agenda: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  slotDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.surface },
  time: { width: 48, alignItems: 'flex-end' },
  timeValue: { ...typography.heading, fontSize: 17, color: colors.waterInk, letterSpacing: -0.3 },
  timeAmpm: { ...typography.caption, fontSize: 11, fontWeight: '700', color: colors.slate, letterSpacing: 0.3 },
  rail: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: TEAL_PALE },
  slotBody: { flex: 1, gap: 2, minWidth: 0 },
  slotTitle: { ...typography.bodyStrong, fontSize: 15.5, fontWeight: '800', color: colors.waterInk },
  slotMeta: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  free: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: 2 },
  freeTitle: { ...typography.bodyStrong, fontSize: 15, color: colors.slateDeep },
  freeBody: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0 },
});
