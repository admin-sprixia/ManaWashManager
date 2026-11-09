import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { paymentSplit } from '@mana/domain';
import {
  IconCalendar,
  IconCash,
  IconChevronLeft,
  IconChevronRight,
  IconReceipt,
  IconSparkle,
  IconUpi,
  ScreenContainer,
  brandGradients,
  colors,
  shadow,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { CalendarSheet } from '../components/CalendarSheet';
import { JobRow } from '../components/board/JobRow';
import { BoardSectionHeader } from '../components/board/BoardSectionHeader';
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
  return new Date(new Date(`${date}T12:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** "Sunday, 8 November" for the hero. */
function longDay(date: string): string {
  return new Date(`${date}T12:00:00+05:30`).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

interface Section {
  key: string;
  title: string;
  tone?: 'default' | 'alert';
  data: BoardJob[];
}

/**
 * The owner looks back at one day from the home screen: yesterday by default, any date from the
 * calendar. What was collected and how (cash in the box, UPI to the bank), then every wash started
 * or paid that day: still open, paid, and voided.
 */
export function DayWashesScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
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
    const all = jobs ?? [];
    const paid = all.filter((j) => j.status === 'paid' && j.completedAt && dayOf(j.completedAt) === date);
    let cash = 0;
    let upi = 0;
    let other = 0;
    for (const j of paid) {
      const s = paymentSplit(j);
      cash += s.cash + s.extraCash;
      upi += s.upi;
      other += s.other;
    }
    const collected = paid.reduce((sum, j) => sum + j.total, 0);
    return {
      paid,
      collected,
      cash,
      upi,
      other,
      average: paid.length ? Math.round(collected / paid.length) : 0,
      open: all.filter((j) => j.status !== 'paid' && j.status !== 'void'),
      voided: all.filter((j) => j.status === 'void'),
    };
  }, [jobs, date]);

  const sections = useMemo<Section[]>(
    () =>
      [
        { key: 'open', title: 'Not paid yet', tone: 'alert' as const, data: summary.open },
        { key: 'paid', title: 'Paid', data: summary.paid },
        { key: 'void', title: 'Voided · not counted', data: summary.voided },
      ].filter((s) => s.data.length > 0),
    [summary],
  );

  const onOpen = useCallback((job: BoardJob) => navigation.navigate('JobDetail', { jobId: job.id }), [navigation]);
  const now = useMemo(() => new Date(), [jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = async () => {
    setRefreshing(true);
    await load(date);
    setRefreshing(false);
  };

  const label = date === today ? 'Today' : date === istDate(1) ? 'Yesterday' : formatDay(date);
  const atToday = date >= today;
  const moneyTotal = summary.cash + summary.upi + summary.other;
  const loading = jobs == null;
  const pct = (part: number) => `${Math.round((part / moneyTotal) * 100)}%`;

  const header = (
    <>
      <LinearGradient
        colors={brandGradients.hero.colors as unknown as string[]}
        locations={brandGradients.hero.locations as unknown as number[]}
        start={brandGradients.hero.start}
        end={brandGradients.hero.end}
        style={[styles.hero, { paddingTop: insets.top + spacing.sm }]}
      >
        <Svg
          style={StyleSheet.absoluteFill}
          width="100%"
          height="100%"
          viewBox="0 0 390 300"
          preserveAspectRatio="none"
        >
          <Defs>
            <RadialGradient id="dayGlow" cx="85%" cy="10%" r="55%">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.18" />
              <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="340" cy="30" r="160" fill="url(#dayGlow)" />
          {[
            [28, 60, 1.4, 0.45],
            [120, 22, 1, 0.3],
            [210, 120, 1.2, 0.35],
            [360, 190, 1.1, 0.3],
          ].map(([x, y, r, o]) => (
            <Circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#FFFFFF" fillOpacity={o} />
          ))}
        </Svg>

        <View style={styles.topBar}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.glassBtn} accessibilityLabel="Back">
            <IconChevronLeft size={20} color={colors.white} />
          </Pressable>
          <Text style={styles.topTitle}>Washes by day</Text>
          <Pressable
            onPress={() => setCalendarOpen(true)}
            hitSlop={8}
            style={styles.glassBtn}
            accessibilityLabel="Pick a date"
          >
            <IconCalendar size={19} color={colors.white} />
          </Pressable>
        </View>

        <View style={styles.dayNav}>
          <Pressable
            onPress={() => setDate((d) => shift(d, -1))}
            hitSlop={8}
            style={styles.navBtn}
            accessibilityLabel="Day before"
          >
            <IconChevronLeft size={20} color={colors.white} />
          </Pressable>
          <Pressable onPress={() => setCalendarOpen(true)} style={styles.dayPick} accessibilityRole="button">
            <Text style={styles.dayLabel}>{label}</Text>
            <Text style={styles.dayDate}>{longDay(date)}</Text>
          </Pressable>
          <Pressable
            onPress={() => setDate((d) => shift(d, 1))}
            disabled={atToday}
            hitSlop={8}
            style={[styles.navBtn, atToday && styles.navBtnOff]}
            accessibilityLabel="Next day"
          >
            <IconChevronRight size={20} color={colors.white} />
          </Pressable>
        </View>

        <View style={styles.collected}>
          <Text style={styles.collectedLabel}>Collected</Text>
          {loading ? (
            <ActivityIndicator color={colors.white} style={styles.heroSpinner} />
          ) : (
            <Text style={styles.collectedValue} numberOfLines={1} adjustsFontSizeToFit>
              {formatRupees(summary.collected)}
            </Text>
          )}
          <Text style={styles.collectedNote}>
            {loading
              ? ' '
              : `${summary.paid.length} ${summary.paid.length === 1 ? 'wash' : 'washes'} paid${
                  summary.open.length ? ` · ${summary.open.length} not paid yet` : ''
                }${summary.voided.length ? ` · ${summary.voided.length} voided` : ''}`}
          </Text>
        </View>

        {!loading && moneyTotal > 0 ? (
          <View style={styles.mix}>
            <View style={styles.mixBar}>
              {summary.cash > 0 ? <View style={[styles.mixCash, { flex: summary.cash }]} /> : null}
              {summary.upi > 0 ? <View style={[styles.mixUpi, { flex: summary.upi }]} /> : null}
              {summary.other > 0 ? <View style={[styles.mixOther, { flex: summary.other }]} /> : null}
            </View>
            <View style={styles.mixLegend}>
              <Legend color={colors.tealLight} label={`Cash ${pct(summary.cash)}`} />
              <Legend color={colors.indigoSoft} label={`UPI ${pct(summary.upi)}`} />
              {summary.other > 0 ? <Legend color={colors.amberLight} label={`Other ${pct(summary.other)}`} /> : null}
            </View>
          </View>
        ) : null}
      </LinearGradient>

      {!loading && summary.paid.length > 0 ? (
        <View style={styles.tiles}>
          <Tile
            tone="teal"
            icon={<IconCash size={18} color={colors.teal} />}
            label="Cash"
            value={formatRupees(summary.cash)}
            note="in the box"
          />
          <Tile
            tone="indigo"
            icon={<IconUpi size={18} color={colors.indigo} />}
            label={summary.other > 0 ? 'UPI + other' : 'UPI'}
            value={formatRupees(summary.upi + summary.other)}
            note="to the bank"
          />
          <Tile
            tone="amber"
            icon={<IconReceipt size={18} color={colors.amberDeep} />}
            label="Avg. bill"
            value={formatRupees(summary.average)}
            note="per wash"
          />
        </View>
      ) : null}
    </>
  );

  return (
    <ScreenContainer noPadding edges={['bottom']}>
      <SectionList
        style={styles.list}
        sections={loading ? [] : sections}
        keyExtractor={(j) => j.id}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.white}
            colors={[colors.water]}
            progressViewOffset={insets.top}
          />
        }
        renderSectionHeader={({ section }) => (
          <BoardSectionHeader title={section.title} count={section.data.length} tone={section.tone} />
        )}
        renderItem={({ item, index }) => (
          <JobRow
            job={item}
            busy={false}
            first={index === 0}
            onOpen={onOpen}
            onAction={onOpen}
            viewerRole={user?.role ?? 'staff'}
            now={now}
            showTime
          />
        )}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, error ? styles.emptyIconError : null]}>
                <IconSparkle size={30} color={error ? colors.danger : colors.indigo} />
              </View>
              <Text style={styles.emptyTitle}>{error ? 'Couldn’t load this day' : 'No washes this day'}</Text>
              <Text style={styles.emptyBody}>
                {error ??
                  (date === today ? 'Washes show here as they’re entered.' : 'Pick another day with ‹ › or the calendar.')}
              </Text>
              {error ? (
                <Pressable onPress={() => void onRefresh()} style={styles.retry} accessibilityRole="button">
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              ) : null}
            </View>
          )
        }
      />

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

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const TILE_TONES = {
  teal: { bg: colors.tealPale, fg: colors.tealDeep },
  indigo: { bg: colors.indigoPale, fg: colors.indigo },
  amber: { bg: colors.amberPale, fg: colors.amberDeep },
} as const;

function Tile({
  tone,
  icon,
  label,
  value,
  note,
}: {
  tone: keyof typeof TILE_TONES;
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  const t = TILE_TONES[tone];
  return (
    <View style={[styles.tile, { backgroundColor: t.bg }]}>
      <View style={styles.tileTop}>
        <View style={styles.tileIcon}>{icon}</View>
        <Text style={[styles.tileLabel, { color: t.fg }]}>{label}</Text>
      </View>
      <Text style={[styles.tileValue, { color: t.fg }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[styles.tileNote, { color: t.fg }]}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.surface },
  listContent: { paddingBottom: spacing.xxl },
  hero: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
  },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  glassBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  topTitle: { ...typography.heading, color: colors.white, flex: 1 },
  dayNav: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, gap: spacing.sm },
  navBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  navBtnOff: { opacity: 0.3 },
  dayPick: { flex: 1, alignItems: 'center' },
  dayLabel: { ...typography.title, color: colors.white },
  dayDate: { ...typography.label, color: 'rgba(255,255,255,0.72)', textTransform: 'none', marginTop: 2 },
  collected: { alignItems: 'center', marginTop: spacing.lg },
  collectedLabel: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.7)',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  collectedValue: { ...typography.display, color: colors.white, fontSize: 46, marginTop: 2 },
  heroSpinner: { marginVertical: spacing.md },
  collectedNote: { ...typography.label, color: 'rgba(255,255,255,0.78)', textTransform: 'none' },
  mix: { marginTop: spacing.lg },
  mixBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.12)',
    gap: 2,
  },
  mixCash: { backgroundColor: colors.tealLight },
  mixUpi: { backgroundColor: colors.indigoSoft },
  mixOther: { backgroundColor: colors.amberLight },
  mixLegend: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { ...typography.caption, color: 'rgba(255,255,255,0.85)' },
  tiles: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.md },
  tile: { flex: 1, borderRadius: 18, padding: spacing.md, ...shadow('sm') },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tileIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  tileLabel: { ...typography.label, textTransform: 'none' },
  tileValue: { ...typography.heading, fontSize: 22, marginTop: spacing.sm },
  tileNote: { ...typography.caption, opacity: 0.75 },
  empty: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.xxl, gap: spacing.sm },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.indigoPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIconError: { backgroundColor: colors.dangerPale },
  emptyTitle: { ...typography.heading, color: colors.ink },
  emptyBody: { ...typography.body, color: colors.slateDeep, textAlign: 'center' },
  retry: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.indigo,
  },
  retryText: { ...typography.bodyStrong, color: colors.white },
});
