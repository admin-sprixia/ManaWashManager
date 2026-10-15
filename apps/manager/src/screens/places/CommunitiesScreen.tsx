import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { describeWashDays, formatClock, formatDay, START_COMMUNITY_AT, WEEKDAY_SHORT, weekdayOf } from '@mana/domain';
import {
  Button,
  EdgeGroup,
  EdgeRow,
  IconBuilding,
  IconCalendar,
  IconMapPin,
  IconPlus,
  IconSearch,
  Notice,
  Pill,
  ScreenContainer,
  ScreenHeader,
  SectionLabel,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { api } from '../../api/client';
import { useAuth } from '../../api/auth';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { formatTime } from '../../utils/jobs';
import { placeTitle, useApiData, type Demand, type Overview, type OverviewPlace, type PlaceListItem } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'Communities'>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function listLine(p: PlaceListItem): string {
  return [
    describeWashDays(p.washDays),
    formatClock(p.washTime),
    plural(p.members, 'member'),
    p.unpaid ? `${p.unpaid} not paid` : null,
    p.waitlist ? `${p.waitlist} waiting` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Today" progress for one community: washed so far out of the paid vehicles due. */
function TodayCard({ p, onPress }: { p: OverviewPlace; onPress: () => void }) {
  const recorded = p.done + p.notFound + p.missed;
  const total = Math.max(p.due, recorded);
  const pct = total ? Math.min(1, recorded / total) : 0;
  const finished = total > 0 && recorded >= total;
  const status = finished
    ? `Finished${p.lastAt ? ` at ${formatTime(p.lastAt)}` : ''}`
    : p.startedAt
      ? `Started ${formatTime(p.startedAt)}`
      : `Starts ${formatClock(p.washTime)}`;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]} accessibilityRole="button">
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {p.title}
        </Text>
        <Text style={[styles.cardStatus, finished && styles.cardDone]}>{status}</Text>
      </View>
      <Text style={styles.cardCount}>
        {p.done} of {p.due} washed
      </Text>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${pct * 100}%` }, finished && styles.barDone]} />
      </View>
      <Text style={styles.cardMeta} numberOfLines={2}>
        {[
          p.washers.length ? `By ${p.washers.join(', ')}` : p.team.length ? `Team: ${p.team.join(', ')}` : 'No team set',
          p.notFound ? `${p.notFound} not found` : null,
          p.unpaid ? `${p.unpaid} not paid` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {p.far ? <Text style={styles.cardWarn}>{plural(p.far, 'wash', 'washes')} recorded away from the community</Text> : null}
    </Pressable>
  );
}

/**
 * Everything about communities in one place: today's progress, the week ahead, drafts waiting
 * for approval, every community, and where people are asking for us.
 */
export function CommunitiesScreen({ navigation }: Props) {
  const { isOwner } = useAuth();
  const overview = useApiData<Overview>(() => api.places.overview.$get({ query: {} }), 'Couldn’t load this week.');
  const list = useApiData<{ places: PlaceListItem[] }>(() => api.places.$get(), 'Couldn’t load your communities.');
  const demand = useApiData<Demand>(() => api.places.demand.$get(), 'Couldn’t load the requests.');
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showClosed, setShowClosed] = useState(false);

  const days = overview.data?.days ?? [];
  const today = days[0];
  const day = days.find((d) => d.day === pickedDay) ?? days.find((d) => d.day !== today?.day && d.places.length) ?? days[1];
  const places = list.data?.places ?? [];
  const review = places.filter((p) => p.stage === 'review' && p.status !== 'closed');
  const drafts = places.filter((p) => p.stage === 'draft' && p.status !== 'closed');
  const live = places.filter((p) => p.stage === 'live');
  const closedCount = places.filter((p) => p.status === 'closed').length;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return live.filter(
      (p) => (showClosed || p.status !== 'closed') && (!q || `${p.name ?? ''} ${p.label}`.toLowerCase().includes(q)),
    );
  }, [live, search, showClosed]);
  const clusters = (demand.data?.clusters ?? []).slice(0, 3);

  const refresh = () => void Promise.all([overview.refresh(), list.refresh(), demand.refresh()]);
  const loading = !list.data && !list.error;

  const draftRow = (p: PlaceListItem) => (
    <EdgeRow
      key={p.id}
      icon={<IconBuilding size={19} color={colors.waterDeep} />}
      iconBg={colors.waterPale}
      title={placeTitle(p)}
      subtitle={
        p.stage === 'review'
          ? `Sent by ${p.setup.createdBy?.name ?? 'the team'}${p.setup.submittedAt ? ` · ${formatDay(p.setup.submittedAt.slice(0, 10))}` : ''}`
          : p.setup.reviewNote
            ? `Sent back: ${p.setup.reviewNote}`
            : p.setup.missing.length
              ? `Still to add: ${p.setup.missing.slice(0, 2).join(', ')}${p.setup.missing.length > 2 ? '…' : ''}`
              : 'Ready to send for approval'
      }
      right={p.stage === 'review' ? <Pill label={isOwner ? 'REVIEW' : 'WITH OWNER'} tone="amber" /> : <Pill label="DRAFT" tone="slate" />}
      onPress={() => navigation.navigate(p.stage === 'review' && isOwner ? 'PlaceForm' : 'Place', { placeId: p.id })}
    />
  );

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader
          title="Communities"
          onBack={() => navigation.goBack()}
          right={
            <Pressable onPress={() => navigation.navigate('CommunitySetup')} style={({ pressed }) => [styles.add, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Add a community" hitSlop={6}>
              <IconPlus size={16} color={colors.white} />
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          }
        />
      </View>
      {loading ? (
        <ActivityIndicator color={colors.water} style={styles.loading} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={refresh} />}>
          {list.error && !list.data ? (
            <View style={styles.pad}>
              <Notice tone="danger">{list.error}</Notice>
              <Button label="Try again" variant="secondary" onPress={refresh} />
            </View>
          ) : null}

          {/* Today */}
          {today ? (
            <>
              <SectionLabel right={formatDay(today.day)}>Today</SectionLabel>
              {today.places.length ? (
                <View style={styles.cards}>
                  {today.places.map((p) => (
                    <TodayCard key={p.id} p={p} onPress={() => navigation.navigate('PlaceDay', { placeId: p.id, day: today.day })} />
                  ))}
                </View>
              ) : (
                <Text style={[styles.help, styles.pad]}>No community washes today.</Text>
              )}
            </>
          ) : overview.error ? (
            <Text style={[styles.error, styles.pad]}>{overview.error}</Text>
          ) : null}

          {/* This week */}
          {days.length > 1 ? (
            <>
              <SectionLabel>This week</SectionLabel>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.week}>
                {days.slice(1).map((d) => {
                  const on = d.day === day?.day;
                  const cars = d.places.reduce((n, p) => n + p.due + p.unpaid, 0);
                  return (
                    <Pressable
                      key={d.day}
                      onPress={() => setPickedDay(d.day)}
                      style={[styles.dayPill, on && styles.dayPillOn, !d.places.length && styles.dayPillEmpty]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${formatDay(d.day)}: ${plural(d.places.length, 'community', 'communities')}, ${plural(cars, 'vehicle')}`}
                    >
                      <Text style={[styles.dayName, on && styles.dayTextOn]}>{WEEKDAY_SHORT[weekdayOf(d.day)]}</Text>
                      <Text style={[styles.dayDate, on && styles.dayTextOn]}>{Number(d.day.slice(8))}</Text>
                      <Text style={[styles.dayCount, on && styles.dayTextOn]}>{d.places.length ? `${cars} due` : '—'}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {day ? (
                <EdgeGroup>
                  {day.places.length ? (
                    day.places.map((p) => (
                      <EdgeRow
                        key={p.id}
                        icon={<IconCalendar size={18} color={colors.waterDeep} />}
                        title={`${formatClock(p.washTime)} · ${p.title}`}
                        subtitle={[plural(p.due, 'paid vehicle'), p.unpaid ? `${p.unpaid} not paid` : null, p.team.length ? p.team.join(', ') : 'No team set']
                          .filter(Boolean)
                          .join(' · ')}
                        onPress={() => navigation.navigate('PlaceDay', { placeId: p.id, day: day.day })}
                      />
                    ))
                  ) : (
                    <EdgeRow title={`${formatDay(day.day)} is free`} subtitle="No community washes" chevron={false} tone="muted" />
                  )}
                </EdgeGroup>
              ) : null}
            </>
          ) : null}

          {/* Waiting for approval and drafts */}
          {review.length ? (
            <>
              <SectionLabel right={`${review.length}`}>Waiting for approval</SectionLabel>
              <EdgeGroup>{review.map(draftRow)}</EdgeGroup>
            </>
          ) : null}
          {drafts.length ? (
            <>
              <SectionLabel right={`${drafts.length}`}>Drafts</SectionLabel>
              <EdgeGroup>{drafts.map(draftRow)}</EdgeGroup>
            </>
          ) : null}

          {/* All communities */}
          <SectionLabel right={live.length ? `${live.filter((p) => p.status !== 'closed').length}` : undefined}>All communities</SectionLabel>
          {live.length > 4 ? (
            <View style={styles.searchWrap}>
              <IconSearch size={18} color={colors.slate} />
              <TextInput
                style={styles.search}
                value={search}
                onChangeText={setSearch}
                placeholder="Search by name"
                placeholderTextColor={colors.slate}
                accessibilityLabel="Search communities"
                disableFullscreenUI
              />
            </View>
          ) : null}
          <EdgeGroup>
            {shown.map((p) => (
              <EdgeRow
                key={p.id}
                icon={<IconBuilding size={19} color={p.status === 'active' ? colors.waterDeep : colors.slate} />}
                iconBg={colors.waterPale}
                title={placeTitle(p)}
                subtitle={listLine(p)}
                tone={p.status === 'active' ? 'default' : 'muted'}
                right={
                  p.pending > 0 ? (
                    <Pill label={`${p.pending} TO CONFIRM`} tone="danger" />
                  ) : p.status !== 'active' ? (
                    <Pill label={p.status === 'paused' ? 'PAUSED' : 'CLOSED'} tone="slate" />
                  ) : undefined
                }
                onPress={() => navigation.navigate('Place', { placeId: p.id })}
              />
            ))}
            {!shown.length ? (
              <EdgeRow
                title={search ? 'No community by that name' : 'No live communities yet'}
                subtitle={search ? 'Try another name' : 'Visit one, add it here, and send it for approval'}
                chevron={false}
                tone="muted"
              />
            ) : null}
            <EdgeRow
              icon={<IconPlus size={18} color={colors.waterDeep} />}
              title="Add a community"
              subtitle="After visiting: pin, photos, what you found"
              onPress={() => navigation.navigate('CommunitySetup')}
            />
          </EdgeGroup>
          {closedCount ? (
            <Pressable onPress={() => setShowClosed((s) => !s)} style={styles.closedToggle} accessibilityRole="button">
              <Text style={styles.link}>{showClosed ? 'Hide closed' : `Show closed (${closedCount})`}</Text>
            </Pressable>
          ) : null}

          {/* People asking */}
          <SectionLabel>People asking</SectionLabel>
          {clusters.length ? (
            <View style={styles.cards}>
              {clusters.map((c) => {
                const ready = c.requests >= START_COMMUNITY_AT;
                return (
                  <View key={c.requestIds[0]} style={styles.card}>
                    <View style={styles.cardHead}>
                      <Text style={styles.cardTitle} numberOfLines={1}>
                        {c.landmarks[0] ?? 'Near a pinned spot'}
                      </Text>
                      <Pill label={plural(c.requests, 'request').toUpperCase()} tone={ready ? 'teal' : 'water'} />
                    </View>
                    <Text style={styles.cardMeta}>
                      {[c.cars ? plural(c.cars, 'car') : null, c.bikes ? plural(c.bikes, 'bike') : null].filter(Boolean).join(', ') || 'Vehicles not given'}
                      {ready ? ' · enough to start' : ` · ${START_COMMUNITY_AT - c.requests} more to start`}
                    </Text>
                    {ready ? (
                      <Button
                        label="Start community"
                        icon={<IconMapPin size={16} color={colors.white} />}
                        onPress={() => navigation.navigate('CommunitySetup', { at: c.center, label: c.landmarks[0] ?? undefined })}
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={[styles.help, styles.pad]}>Nobody waiting right now. When people ask in the Mana Wash app, they show here by area.</Text>
          )}
          <EdgeGroup>
            <EdgeRow
              icon={<IconMapPin size={19} color={colors.tealDeep} />}
              iconBg="#CCFBF1"
              title="All requests by area"
              subtitle="Start a community where enough neighbours asked"
              onPress={() => navigation.navigate('PlaceDemand')}
            />
          </EdgeGroup>
          <View style={styles.bottomPad} />
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.sm },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20 },
  error: { ...typography.label, color: colors.danger },
  pressed: { opacity: 0.75 },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.water,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  addText: { ...typography.label, color: colors.white, fontWeight: '700' },
  cards: { paddingHorizontal: spacing.md, gap: spacing.sm },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 6,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { ...typography.bodyStrong, color: colors.waterInk, flex: 1 },
  cardStatus: { ...typography.caption, color: colors.slateDeep, fontWeight: '700' },
  cardDone: { color: colors.tealDeep },
  cardCount: { ...typography.heading, fontSize: 20, color: colors.waterInk },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.waterPale, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.water },
  barDone: { backgroundColor: colors.teal },
  cardMeta: { fontSize: 13.5, color: colors.slateDeep },
  cardWarn: { ...typography.label, color: colors.amberDeep, fontWeight: '700' },
  week: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.sm },
  dayPill: {
    width: 64,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    gap: 2,
  },
  dayPillOn: { backgroundColor: colors.water, borderColor: colors.water },
  dayPillEmpty: { opacity: 0.6 },
  dayName: { ...typography.caption, color: colors.slateDeep, fontWeight: '700' },
  dayDate: { ...typography.heading, fontSize: 19, color: colors.waterInk },
  dayCount: { ...typography.caption, color: colors.slateDeep },
  dayTextOn: { color: colors.white },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  search: { flex: 1, paddingVertical: 10, ...typography.body, color: colors.waterInk },
  closedToggle: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  link: { ...typography.label, color: colors.waterDeep, fontWeight: '700' },
  bottomPad: { height: spacing.xxl },
});
