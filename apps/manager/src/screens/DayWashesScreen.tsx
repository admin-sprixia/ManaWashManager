import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { paymentSplit } from '@mana/domain';
import {
  IconChevronLeft,
  IconChevronRight,
  ScreenContainer,
  ScreenHeader,
  colors,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { CalendarSheet } from '../components/CalendarSheet';
import { JobRow } from '../components/board/JobRow';
import type { BoardJob } from '../offline/types';
import { formatDay, formatRupees, istDate } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'DayWashes'>;

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** The IST shop day (YYYY-MM-DD) a timestamp falls on. */
function dayOf(iso: string): string {
  return new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function shift(date: string, days: number): string {
  return new Date(new Date(`${date}T12:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The owner looks back at one day from the home screen: yesterday by default, any date from the
 * calendar. Every wash started or paid that day, with what was collected.
 */
export function DayWashesScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const today = istDate();
  const [date, setDate] = useState(route.params?.date ?? istDate(1));
  const [jobs, setJobs] = useState<BoardJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const load = useCallback(async (day: string) => {
    setError(null);
    try {
      const res = await api.jobs.day.$get({ query: { date: day } });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t load that day.'));
      const body = (await res.json()) as unknown as { date: string; jobs: BoardJob[] };
      setJobs(body.jobs);
    } catch (e) {
      setJobs((j) => j ?? []);
      setError(
        e instanceof NetworkError
          ? 'You’re offline. Past days need a connection.'
          : e instanceof Error
            ? e.message
            : 'Couldn’t load that day.',
      );
    }
  }, []);

  useEffect(() => {
    setJobs(null);
    void load(date);
  }, [date, load]);

  const summary = useMemo(() => {
    const paid = (jobs ?? []).filter(
      (j) => j.status === 'paid' && j.completedAt && dayOf(j.completedAt) === date,
    );
    let cash = 0;
    let upi = 0;
    let other = 0;
    for (const j of paid) {
      const s = paymentSplit(j);
      cash += s.cash + s.extraCash;
      upi += s.upi;
      other += s.other;
    }
    return {
      washes: paid.length,
      collected: paid.reduce((sum, j) => sum + j.total, 0),
      cash,
      upi,
      other,
      voided: (jobs ?? []).filter((j) => j.status === 'void').length,
      open: (jobs ?? []).filter((j) => j.status !== 'paid' && j.status !== 'void').length,
    };
  }, [jobs, date]);

  const onOpen = useCallback(
    (job: BoardJob) => navigation.navigate('JobDetail', { jobId: job.id }),
    [navigation],
  );
  const now = useMemo(() => new Date(), [jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = async () => {
    setRefreshing(true);
    await load(date);
    setRefreshing(false);
  };

  const label = date === today ? 'Today' : date === istDate(1) ? 'Yesterday' : formatDay(date);

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Washes by day" onBack={() => navigation.goBack()} />
      </View>

      <View style={styles.dayNav}>
        <Pressable
          onPress={() => setDate((d) => shift(d, -1))}
          hitSlop={8}
          style={styles.arrow}
          accessibilityLabel="Day before"
        >
          <IconChevronLeft size={20} color={colors.indigo} />
        </Pressable>
        <Pressable
          onPress={() => setCalendarOpen(true)}
          style={styles.dayPick}
          accessibilityRole="button"
          accessibilityLabel="Pick a day"
        >
          <Text style={styles.dayLabel}>{label}</Text>
          <Text style={styles.dayDate}>{formatDay(date)} · tap to pick a date</Text>
        </Pressable>
        <Pressable
          onPress={() => setDate((d) => shift(d, 1))}
          disabled={date >= today}
          hitSlop={8}
          style={[styles.arrow, date >= today && styles.arrowOff]}
          accessibilityLabel="Next day"
        >
          <IconChevronRight size={20} color={colors.indigo} />
        </Pressable>
      </View>

      <View style={styles.figures}>
        <Figure label="Collected" value={formatRupees(summary.collected)} />
        <Figure label="Washes paid" value={String(summary.washes)} />
        <Figure label="Cash" value={formatRupees(summary.cash)} />
        <Figure
          label={summary.other > 0 ? 'UPI + other' : 'UPI'}
          value={formatRupees(summary.upi + summary.other)}
        />
      </View>
      {summary.voided > 0 || summary.open > 0 ? (
        <Text style={styles.note}>
          {[
            summary.open > 0 ? `${summary.open} not paid yet` : null,
            summary.voided > 0 ? `${summary.voided} voided (not counted)` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : null}

      {jobs == null ? (
        <ActivityIndicator color={colors.water} style={styles.loading} />
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(j) => j.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={colors.water}
              colors={[colors.water]}
            />
          }
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <JobRow
              job={item}
              busy={false}
              first={index === 0}
              onOpen={onOpen}
              onAction={onOpen}
              viewerRole={user?.role ?? 'staff'}
              now={now}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {error ? 'Couldn’t load this day' : 'No washes this day'}
              </Text>
              {error ? <Text style={styles.emptyBody}>{error}</Text> : null}
            </View>
          }
        />
      )}

      <CalendarSheet
        visible={calendarOpen}
        mode="plain"
        value={date}
        max={today}
        min={istDate(730)}
        title="Pick a day"
        subtitle="See every wash started or paid that day."
        onClose={() => setCalendarOpen(false)}
        onSelect={(d) => {
          setCalendarOpen(false);
          setDate(d);
        }}
      />
    </ScreenContainer>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.figureLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  arrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.indigoPale,
  },
  arrowOff: { opacity: 0.35 },
  dayPick: { flex: 1, alignItems: 'center', paddingVertical: spacing.xs },
  dayLabel: { ...typography.heading, color: colors.ink },
  dayDate: { ...typography.caption, color: colors.slate },
  figures: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  figure: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  figureValue: { ...typography.bodyStrong, color: colors.ink, fontSize: 17 },
  figureLabel: { ...typography.caption, color: colors.slate, fontSize: 12 },
  note: { ...typography.caption, color: colors.slate, textAlign: 'center', marginTop: spacing.sm },
  loading: { marginTop: spacing.xl },
  list: { paddingTop: spacing.md, paddingBottom: spacing.xxl },
  empty: { alignItems: 'center', padding: spacing.xl, gap: spacing.xs },
  emptyTitle: { ...typography.bodyStrong, color: colors.ink },
  emptyBody: { ...typography.caption, color: colors.slate, textAlign: 'center' },
});
