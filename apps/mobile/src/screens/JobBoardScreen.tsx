import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
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
import { ScreenContainer } from '../components/ScreenContainer';
import { SyncBanner } from '../components/SyncBanner';
import { PaymentSheet } from '../components/PaymentSheet';
import { Fab } from '../components/Fab';
import { showToast } from '../components/Toast';
import { BoardCompactBar, BoardHero, type BoardStats } from '../components/board/BoardHeader';
import { JobRow } from '../components/board/JobRow';
import { IconPlus, IconSparkle } from '../components/Icons';
import { colors, radius, spacing, typography } from '../theme';
import { useAuth } from '../api/auth';
import { useBoardJobs } from '../offline/useBoardJobs';
import { useReminderCount } from '../offline/useReminderCount';
import { useJobActions } from '../offline/useJobActions';
import type { BoardJob } from '../offline/types';
import { buildWhatsAppLink } from '../utils/format';
import { buildThankYouMessage } from '../utils/messages';
import { customerLine, firstName, isToday, NEXT_STATUS, vehicleHeadline } from '../utils/jobs';
import type { RootStackParamList } from '../navigation/RootNavigator';
import type { JobStatus } from '@mana/domain';

type JobBoardScreenProps = NativeStackScreenProps<RootStackParamList, 'JobBoard'>;

interface JobSection {
  key: string;
  title: string;
  data: BoardJob[];
}

const SECTION_DEFS: { key: string; title: string; statuses: JobStatus[]; todayOnly?: boolean }[] = [
  { key: 'ready', title: 'Ready for pickup', statuses: ['ready'] },
  { key: 'active', title: 'In progress', statuses: ['washing', 'waiting'] },
  { key: 'done', title: 'Paid today', statuses: ['paid'], todayOnly: true },
  { key: 'void', title: 'Voided today', statuses: ['void'], todayOnly: true },
];

/** Height of the pinned compact bar below the status bar. */
const COMPACT_BAR_HEIGHT = 58;

export function JobBoardScreen({ navigation }: JobBoardScreenProps) {
  const { user, isOwner } = useAuth();
  const insets = useSafeAreaInsets();
  const { jobs, loading, error, refresh } = useBoardJobs();
  const actions = useJobActions();
  const reminderCount = useReminderCount();
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [payJob, setPayJob] = useState<BoardJob | null>(null);
  const [heroHeight, setHeroHeight] = useState(0);
  const [compact, setCompact] = useState(false);
  const [fabCollapsed, setFabCollapsed] = useState(false);
  const lastY = useRef(0);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
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
      const next = NEXT_STATUS[job.status];
      if (!next || busyId) return;
      setBusyId(job.id);
      const message = await actions.advance(job.id, next);
      setBusyId(null);
      if (message) showToast(message, 'error');
    },
    [actions, busyId],
  );

  const onOpen = useCallback(
    (job: BoardJob) => navigation.navigate('JobDetail', { jobId: job.id }),
    [navigation],
  );

  const onThankYou = useCallback((job: BoardJob) => {
    const message = buildThankYouMessage({
      jobId: job.id,
      customerName: job.customer.name,
      registrationNumber: job.vehicle.registrationNumber,
      vehicleType: job.vehicle.vehicleType.name,
      services: job.jobServices.map((js) => ({ name: js.service.name, quantity: js.quantity })),
      total: job.total,
      discount: job.discount,
      paymentMethod: job.paymentMethod,
      visitedAt: job.createdAt,
    });
    Linking.openURL(buildWhatsAppLink(job.customer.phone, message)).catch(() =>
      showToast('Couldn’t open WhatsApp — is it installed?', 'error'),
    );
  }, []);

  const stats = useMemo<BoardStats>(() => {
    // Excludes void jobs — matches jobRepo.getStats' `carsWashed`, so this hero number and
    // the Reports screen's "Cars washed" never disagree for the same day.
    const todays = jobs.filter((j) => isToday(j.createdAt));
    const cars = todays.filter((j) => j.status !== 'void').length;
    const revenue = todays.filter((j) => j.status === 'paid').reduce((sum, j) => sum + j.total, 0);
    const open = jobs.filter(
      (j) => j.status === 'waiting' || j.status === 'washing' || j.status === 'ready',
    ).length;
    return { cars, revenue, open };
  }, [jobs]);

  const sections = useMemo<JobSection[]>(
    () =>
      SECTION_DEFS.map((def) => ({
        key: def.key,
        title: def.title,
        data: jobs
          .filter(
            (j) => def.statuses.includes(j.status) && (!def.todayOnly || isToday(j.createdAt)),
          )
          .sort((a, b) => def.statuses.indexOf(a.status) - def.statuses.indexOf(b.status)),
      })).filter((s) => s.data.length > 0),
    [jobs],
  );

  const goReports = useCallback(() => navigation.navigate('Reports'), [navigation]);
  const goMore = useCallback(() => navigation.navigate('More'), [navigation]);
  const goReminders = useCallback(() => navigation.navigate('Reminders'), [navigation]);
  const name = firstName(user?.name);

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
                name={name}
                stats={stats}
                isOwner={isOwner}
                onReports={goReports}
                onMore={goMore}
                onReminders={goReminders}
                reminderCount={reminderCount}
                onLayout={(e) => setHeroHeight(e.nativeEvent.layout.height)}
              />
              <View style={styles.bannerWrap}>
                <SyncBanner onReview={goMore} />
              </View>
            </>
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.data.length}</Text>
            </View>
          )}
          renderSectionFooter={() => <View style={styles.sectionFooter} />}
          renderItem={({ item, index }) => (
            <JobRow
              job={item}
              busy={busyId === item.id}
              first={index === 0}
              onOpen={onOpen}
              onAction={(job) => void onAction(job)}
              onThankYou={onThankYou}
            />
          )}
          ListEmptyComponent={
            loading ? (
              <View style={styles.empty}>
                <ActivityIndicator color={colors.water} />
              </View>
            ) : (
              <View style={styles.empty}>
                <View style={styles.emptyIconWrap}>
                  <IconSparkle size={32} color={colors.water} />
                </View>
                <Text style={styles.emptyText}>
                  {error ? 'Couldn’t load jobs' : 'No washes yet today'}
                </Text>
                <Text style={styles.emptySubtext}>
                  {error ?? 'Tap New Wash when the first vehicle rolls in.'}
                </Text>
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
          stats={stats}
          isOwner={isOwner}
          onReports={goReports}
          onMore={goMore}
          onReminders={goReminders}
          reminderCount={reminderCount}
        />

        <Fab
          label="New Wash"
          icon={<IconPlus size={22} color={colors.white} />}
          onPress={() => navigation.navigate('NewWash')}
          collapsed={fabCollapsed}
          bottom={spacing.lg}
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
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  listFlex: { flex: 1 },
  // Room for the floating New Wash button so the last row's action is never covered.
  list: { paddingBottom: 112, flexGrow: 1 },
  bannerWrap: { paddingTop: spacing.sm },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.slateDeep,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontSize: 12,
  },
  sectionCount: { ...typography.label, color: colors.slate, fontSize: 12 },
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
