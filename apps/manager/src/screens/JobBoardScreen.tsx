import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { branchPausedMessage } from '@mana/domain';
import {
  Notice,
  ScreenContainer,
  showToast,
  IconPlus,
  IconSparkle,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { SyncBanner } from '../components/SyncBanner';
import { PaymentSheet } from '../components/PaymentSheet';
import { PeoplePickerSheet } from '../components/PeoplePickerSheet';
import { ShopSwitcherSheet } from '../components/ShopSwitcherSheet';
import { Fab } from '../components/Fab';
import { BoardCompactBar, BoardHero } from '../components/board/BoardHeader';
import { LaneTabs } from '../components/board/LaneTabs';
import { LANE_META, inLane, useBoardLanes, visibleLanes, type Lane } from '../components/board/lanes';
import { LANE_EMPTY, LANE_FAB, jobStats, laneBadges, laneHero, sectionDefs } from '../components/board/laneView';
import { useCommunityToday } from '../components/board/useCommunityToday';
import { JobRow } from '../components/board/JobRow';
import { warmNewWash } from './NewWashScreen';
import { BoardSectionHeader } from '../components/board/BoardSectionHeader';
import { CommunitiesPanel, type CommunitiesPanelHandle } from './places/CommunitiesPanel';
import { useAuth } from '../api/auth';
import { useBoardJobs } from '../offline/useBoardJobs';
import { useReminderCount } from '../offline/useReminderCount';
import { useInboxCount } from '../offline/useInboxCount';
import { useJobActions } from '../offline/useJobActions';
import { useShop } from '../offline/ShopProvider';
import type { BoardJob } from '../offline/types';
import { activityAt, customerLine, firstName, isToday, NEXT_STATUS, vehicleHeadline } from '../utils/jobs';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { MAX_WASHERS_PER_JOB } from '@mana/domain';

type JobBoardScreenProps = NativeStackScreenProps<RootStackParamList, 'JobBoard'>;

interface JobSection {
  key: string;
  title: string;
  data: BoardJob[];
}

/** Height of the pinned compact bar below the status bar. */
const COMPACT_BAR_HEIGHT = 58;

export function JobBoardScreen({ navigation }: JobBoardScreenProps) {
  const { user, isOwner } = useAuth();
  // New Wash is opened all day: have its saved catalog in memory before the first tap.
  const boardShopId = user?.shopId;
  useEffect(() => {
    if (boardShopId) void warmNewWash(boardShopId);
  }, [boardShopId]);
  const insets = useSafeAreaInsets();
  const { jobs, loading, error, refresh } = useBoardJobs();
  const actions = useJobActions();
  const reminderCount = useReminderCount();
  // The WhatsApp inbox is for owners and managers.
  const canInbox = user?.role === 'owner' || user?.role === 'manager';
  const inboxCount = useInboxCount(canInbox);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payJob, setPayJob] = useState<BoardJob | null>(null);
  const [washerJob, setWasherJob] = useState<BoardJob | null>(null);
  const {
    unseenErrors,
    lowStock,
    myShops,
    info: shopInfo,
  } = useShop();
  const moreAlerts = [
    isOwner && unseenErrors > 0 ? 'new errors to review' : null,
    lowStock > 0 ? 'stock running low' : null,
  ].filter((a): a is string => a != null);
  const moreAlert = moreAlerts.length > 0 ? moreAlerts.join(', ') : undefined;
  const [shopsOpen, setShopsOpen] = useState(false);
  const shopSwitch =
    isOwner && myShops.length > 1 && shopInfo
      ? { name: shopInfo.name, onPress: () => setShopsOpen(true) }
      : undefined;
  const [heroHeight, setHeroHeight] = useState(0);
  const [compact, setCompact] = useState(false);
  const [fabCollapsed, setFabCollapsed] = useState(false);
  const lastY = useRef(0);

  // One tab per way this branch washes: the hub, community wash days, and customers' homes.
  const laneState = useBoardLanes();
  const communities = useCommunityToday();
  const panel = useRef<CommunitiesPanelHandle>(null);
  const lanes = useMemo(
    () => visibleLanes(laneState.available, jobs, communities.places.length > 0 || communities.review > 0),
    [laneState.available, jobs, communities.places.length, communities.review],
  );
  const lane: Lane = laneState.saved && lanes.includes(laneState.saved) ? laneState.saved : lanes[0]!;
  const multi = lanes.length > 1;
  const laneJobs = useMemo(() => (multi ? jobs.filter((j) => inLane(j, lane)) : jobs), [jobs, lane, multi]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refresh(), communities.refresh(), lane === 'community' ? panel.current?.refresh() : undefined]);
    setRefreshing(false);
  };

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const threshold = heroHeight - (insets.top + COMPACT_BAR_HEIGHT);
      const nextCompact = heroHeight > 0 && y > threshold;
      setCompact((prev) => (prev === nextCompact ? prev : nextCompact));

      // Extended FAB shrinks while scrolling down through the list and grows back on the way up.
      const delta = y - lastY.current;
      if (Math.abs(delta) > 6) {
        const nextCollapsed = y > 24 && delta > 0;
        setFabCollapsed((prev) => (prev === nextCollapsed ? prev : nextCollapsed));
        lastY.current = y;
      }
    },
    [heroHeight, insets.top],
  );

  const onAction = useCallback(
    async (job: BoardJob) => {
      if (job.status === 'ready') {
        setPayJob(job);
        return;
      }
      if (job.status === 'waiting') {
        setWasherJob(job);
        return;
      }
      const next = NEXT_STATUS[job.status];
      if (!next || busyId) return;
      setBusyId(job.id);
      const message = await actions.advance(job.id, next);
      setBusyId(null);
      if (message) showToast(message, 'error');
      else if (next === 'ready') showToast('Ready. The customer gets a WhatsApp to come pick it up.');
    },
    [actions, busyId],
  );

  // One handler for every row, so a row only redraws when its own wash changes.
  const onRowAction = useCallback((job: BoardJob) => void onAction(job), [onAction]);
  const onOpen = useCallback(
    (job: BoardJob) => navigation.navigate('JobDetail', { jobId: job.id }),
    [navigation],
  );

  const stats = useMemo(() => jobStats(laneJobs), [laneJobs]);
  const hero = laneHero({ lane, multi, isOwner, stats, community: communities });
  const badges = useMemo(() => laneBadges(jobs, communities, isOwner), [jobs, communities, isOwner]);
  const meta = LANE_META[lane];
  const palette = multi ? meta.palette : undefined;

  const sections = useMemo<JobSection[]>(() => {
    if (lane === 'community') return [];
    return sectionDefs(lane)
      .map((def) => ({
        key: def.key,
        title: def.title,
        data: laneJobs
          .filter((j) => def.statuses.includes(j.status) && (!def.todayOnly || isToday(activityAt(j))))
          .sort((a, b) => def.statuses.indexOf(a.status) - def.statuses.indexOf(b.status)),
      }))
      .filter((s) => s.data.length > 0);
  }, [lane, laneJobs]);

  const goReports = useCallback(() => navigation.navigate('Reports'), [navigation]);
  const goMore = useCallback(() => navigation.navigate('More'), [navigation]);
  const goReminders = useCallback(() => navigation.navigate('Reminders'), [navigation]);
  const goInbox = useCallback(() => navigation.navigate('Inbox'), [navigation]);
  const paused = shopInfo?.status === 'paused';
  const onFab = useCallback(() => {
    if (lane === 'community') return navigation.navigate('CommunitySetup');
    if (paused) return showToast('Mana Wash HQ has paused this branch — no new washes for now.', 'error');
    navigation.navigate('NewWash', { mode: lane });
  }, [lane, navigation, paused]);
  const name = firstName(user?.name);
  const empty = lane === 'community' ? null : LANE_EMPTY[lane];

  return (
    <ScreenContainer noPadding edges={['bottom']}>
      <View style={styles.root}>
        <SectionList
          sections={sections}
          keyExtractor={(job) => job.id}
          stickySectionHeadersEnabled={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={colors.water}
              colors={[colors.water]}
              progressViewOffset={insets.top}
            />
          }
          contentContainerStyle={styles.list}
          style={styles.listFlex}
          ListHeaderComponent={
            <>
              <BoardHero
                shopSwitch={shopSwitch}
                shopName={shopInfo?.name}
                name={name}
                figures={hero.figures}
                tagline={hero.tagline}
                taglineWarn={hero.taglineWarn}
                laneKey={lane}
                palette={palette}
                tabs={multi ? <LaneTabs lanes={lanes} value={lane} onChange={laneState.choose} badges={badges} /> : undefined}
                isOwner={isOwner}
                onReports={goReports}
                onMore={goMore}
                onReminders={goReminders}
                reminderCount={reminderCount}
                onInbox={canInbox ? goInbox : undefined}
                inboxCount={inboxCount}
                moreAlert={moreAlert}
                onLayout={(e) => setHeroHeight(e.nativeEvent.layout.height)}
              />
              <View style={styles.bannerWrap}>
                {paused ? (
                  <View style={styles.pausedWrap}>
                    <Notice tone="warning" title="Branch paused">
                      {branchPausedMessage(shopInfo?.statusReason ?? null)}
                    </Notice>
                  </View>
                ) : null}
                <SyncBanner onReview={goMore} />
              </View>
              {lane === 'community' ? <CommunitiesPanel ref={panel} /> : null}
            </>
          }
          renderSectionHeader={({ section }) => <BoardSectionHeader title={section.title} count={section.data.length} />}
          renderSectionFooter={() => <View style={styles.sectionFooter} />}
          renderItem={({ item, index }) => (
            <JobRow
              job={item}
              busy={busyId === item.id}
              first={index === 0}
              onOpen={onOpen}
              onAction={onRowAction}
            />
          )}
          ListEmptyComponent={
            !empty ? null : loading ? (
              <View style={styles.empty}>
                <ActivityIndicator color={meta.accent} />
              </View>
            ) : (
              <View style={styles.empty}>
                <View style={styles.emptyIconWrap}>
                  {lane === 'doorstep' ? <meta.Icon size={30} color={meta.accent} /> : <IconSparkle size={32} color={colors.water} />}
                </View>
                <Text style={styles.emptyText}>{error ? 'Couldn’t load jobs' : empty.title}</Text>
                <Text style={styles.emptySubtext}>{error ?? empty.body}</Text>
                {error ? (
                  <Pressable onPress={() => void refresh()} style={styles.retryBtn}>
                    <Text style={styles.retryBtnText}>Retry</Text>
                  </Pressable>
                ) : null}
              </View>
            )
          }
        />

        <BoardCompactBar
          visible={compact}
          title={hero.compactTitle}
          summary={hero.compactSummary}
          palette={palette}
          isOwner={isOwner}
          onReports={goReports}
          onMore={goMore}
          onReminders={goReminders}
          reminderCount={reminderCount}
          onInbox={canInbox ? goInbox : undefined}
          inboxCount={inboxCount}
          moreAlert={moreAlert}
        />

        <Fab
          label={LANE_FAB[lane]}
          icon={<IconPlus size={22} color={colors.white} />}
          onPress={onFab}
          collapsed={fabCollapsed}
          bottom={spacing.lg}
          tint={multi ? meta.fabTint : undefined}
        />
      </View>

      <PaymentSheet
        visible={payJob != null}
        amount={payJob?.total ?? 0}
        subtitle={payJob ? `${vehicleHeadline(payJob).title} · ${customerLine(payJob)}` : ''}
        onClose={() => setPayJob(null)}
        onConfirm={async (method) => {
          if (!payJob) return null;
          const message = await actions.pay(payJob.id, method);
          if (!message) setPayJob(null);
          return message;
        }}
      />

      <PeoplePickerSheet
        visible={washerJob != null}
        title="Who’s washing it?"
        subtitle={
          washerJob ? `${vehicleHeadline(washerJob).title} · ${customerLine(washerJob)}` : ''
        }
        confirmLabel="Start wash"
        max={MAX_WASHERS_PER_JOB}
        onClose={() => setWasherJob(null)}
        onSkip={async () => {
          if (!washerJob) return null;
          const message = await actions.advance(washerJob.id, 'washing');
          if (!message) setWasherJob(null);
          return message;
        }}
        onConfirm={async (washers) => {
          if (!washerJob) return null;
          const message = await actions.advance(washerJob.id, 'washing', washers);
          if (!message) setWasherJob(null);
          return message;
        }}
      />

      <ShopSwitcherSheet visible={shopsOpen} onClose={() => setShopsOpen(false)} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  listFlex: { flex: 1 },
  // Room for the floating New Wash button so the last row's action is never covered.
  list: { paddingBottom: 112, flexGrow: 1 },
  bannerWrap: { paddingTop: spacing.sm },
  pausedWrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  sectionFooter: { height: spacing.xs },
  empty: { alignItems: 'center', marginTop: spacing.xxl, paddingHorizontal: spacing.lg },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyText: { ...typography.bodyStrong, color: colors.waterInk, marginBottom: 4, fontSize: 17 },
  emptySubtext: { ...typography.body, color: colors.slateDeep, textAlign: 'center' },
  retryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.water,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryBtnText: { ...typography.label, color: colors.white },
});
