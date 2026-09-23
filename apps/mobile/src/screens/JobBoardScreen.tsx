import React, { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  SectionList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { GradientHero } from '../components/GradientHero';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { colors, radius, shadow, spacing, statusColors, typography } from '../theme';
import { api } from '../api/client';
import { getSessionUser } from '../api/session';
import { useAuth } from '../api/auth';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { canTransition, type JobStatus } from '@mana/domain';

type JobBoardScreenProps = NativeStackScreenProps<RootStackParamList, 'JobBoard'>;

interface JobListItem {
  id: string;
  status: JobStatus;
  total: number;
  customer: { name: string | null; phone: string };
  vehicle: { registrationNumber: string; vehicleType: { name: string } };
}

interface JobSection {
  key: string;
  title: string;
  data: JobListItem[];
}

const STATUS_LABEL: Record<JobStatus, string> = {
  waiting: 'Waiting',
  washing: 'Washing',
  ready: 'Ready',
  paid: 'Paid',
  void: 'Void',
};

const NEXT_STATUS: Partial<Record<JobStatus, Exclude<JobStatus, 'waiting'>>> = {
  waiting: 'washing',
  washing: 'ready',
};

const SECTION_DEFS: { key: string; title: string; statuses: JobStatus[] }[] = [
  { key: 'active', title: 'In progress', statuses: ['waiting', 'washing'] },
  { key: 'ready', title: 'Ready for pickup', statuses: ['ready'] },
  { key: 'done', title: 'Paid today', statuses: ['paid'] },
];

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toFixed(0)}`;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Walk-ins are stored as `WALK-IN-<timestamp>` for uniqueness — never show that raw string. */
function vehicleHeadline(job: JobListItem): { title: string; meta: string } {
  const typeName = job.vehicle.vehicleType.name;
  const reg = job.vehicle.registrationNumber;
  if (reg.startsWith('WALK-IN')) {
    return { title: typeName, meta: 'Walk-in' };
  }
  return { title: reg, meta: typeName };
}

function customerLine(job: JobListItem): string {
  return job.customer.name?.trim() || job.customer.phone;
}

function actionLabel(job: JobListItem): string | null {
  if (job.status === 'ready') return 'Mark paid';
  const next = NEXT_STATUS[job.status];
  if (!next) return null;
  if (next === 'washing') return 'Start wash';
  return `Mark ${STATUS_LABEL[next].toLowerCase()}`;
}

export function JobBoardScreen({ navigation }: JobBoardScreenProps) {
  const { signOut } = useAuth();
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      setNeedsReauth(false);
      const res = await api.jobs.today.$get();
      const data = await res.json();
      if (res.status === 401) {
        setJobs([]);
        setNeedsReauth(true);
        setLoadError('Session expired. Sign in again to continue.');
        return;
      }
      if (!res.ok || !Array.isArray(data)) {
        setJobs([]);
        setLoadError(
          !res.ok
            ? `Could not load today's jobs (${res.status}). Check the API is running.`
            : 'Unexpected response from the API.',
        );
        return;
      }
      setJobs(data as JobListItem[]);
    } catch {
      setJobs([]);
      setLoadError('Could not reach the API. Is it running on localhost:8787?');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      void getSessionUser().then((user) => setIsOwner(user?.role === 'owner'));
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const advance = async (job: JobListItem) => {
    const next = NEXT_STATUS[job.status];
    if (!next || !canTransition(job.status, next) || busyId) return;
    setBusyId(job.id);
    try {
      await api.jobs[':id'].status.$patch({ param: { id: job.id }, json: { status: next } });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const markPaid = async (job: JobListItem) => {
    if (busyId) return;
    setBusyId(job.id);
    try {
      await api.jobs[':id'].pay.$post({ param: { id: job.id }, json: { paymentMethod: 'cash' } });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const safeJobs = Array.isArray(jobs) ? jobs : [];

  const stats = useMemo(() => {
    const paidJobs = safeJobs.filter((j) => j.status === 'paid');
    const revenue = paidJobs.reduce((sum, j) => sum + j.total, 0);
    const active = safeJobs.filter((j) => j.status === 'waiting' || j.status === 'washing' || j.status === 'ready').length;
    return { cars: safeJobs.length, revenue, active };
  }, [safeJobs]);

  const sections = useMemo<JobSection[]>(() => {
    return SECTION_DEFS.map((def) => ({
      key: def.key,
      title: def.title,
      data: safeJobs.filter((j) => def.statuses.includes(j.status)),
    })).filter((s) => s.data.length > 0);
  }, [safeJobs]);

  const onAction = (job: JobListItem) => {
    if (job.status === 'ready') void markPaid(job);
    else void advance(job);
  };

  return (
    <ScreenContainer noPadding edges={['bottom']}>
      {/* Strict column: hero → CTA → list. Nothing is absolutely positioned over the cards. */}
      <View style={styles.root}>
        <GradientHero>
          <View style={styles.heroContent}>
            <View style={styles.heroTop}>
              <View style={styles.heroCopy}>
                <Text style={styles.brand}>MANA</Text>
                <Text style={styles.greeting}>{greeting()}</Text>
                <Text style={styles.heroSub}>
                  {stats.active > 0
                    ? `${stats.active} open · ${stats.cars} today`
                    : stats.cars > 0
                      ? `${stats.cars} washes today`
                      : 'Ready when you are'}
                </Text>
              </View>
              {isOwner && (
                <Pressable
                  onPress={() => navigation.navigate('Settings')}
                  style={styles.settingsBtn}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Settings"
                >
                  <Text style={styles.settingsGlyph}>⚙</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.statRow}>
              <View style={styles.statPill}>
                <Text style={styles.statValue}>{stats.cars}</Text>
                <Text style={styles.statLabel}>Washes</Text>
              </View>
              <View style={styles.statPill}>
                <Text style={styles.statValue}>{formatRupees(stats.revenue)}</Text>
                <Text style={styles.statLabel}>Revenue</Text>
              </View>
            </View>
          </View>
        </GradientHero>

        <View style={styles.ctaWrap}>
          <Button label="+ New Wash" size="lg" onPress={() => navigation.navigate('NewWash')} />
        </View>

        <SectionList
          sections={sections}
          keyExtractor={(job) => job.id}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.water} colors={[colors.water]} />
          }
          contentContainerStyle={styles.list}
          style={styles.listFlex}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionCount}>{section.data.length}</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const tone = statusColors[item.status];
            const headline = vehicleHeadline(item);
            const action = actionLabel(item);
            const isBusy = busyId === item.id;

            return (
              <Card elevation="sm" style={[styles.jobCard, { borderLeftColor: tone.border }]}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardTitleBlock}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {headline.title}
                    </Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {headline.meta} · {customerLine(item)}
                    </Text>
                  </View>
                  <StatusBadge status={item.status} />
                </View>

                <View style={styles.cardFooter}>
                  <Text style={styles.price}>{formatRupees(item.total)}</Text>
                  {action ? (
                    <Pressable
                      onPress={() => onAction(item)}
                      disabled={isBusy}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        item.status === 'ready' ? styles.actionAmber : styles.actionWater,
                        (pressed || isBusy) && styles.actionPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={action}
                    >
                      <Text style={styles.actionLabel}>{isBusy ? '…' : action}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </Card>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              {loadError ? (
                <>
                  <Text style={styles.emptyText}>Couldn’t load jobs</Text>
                  <Text style={styles.emptySubtext}>{loadError}</Text>
                  {needsReauth ? (
                    <Pressable onPress={() => void signOut()} style={styles.retryBtn}>
                      <Text style={styles.retryBtnText}>Sign in again</Text>
                    </Pressable>
                  ) : (
                    <Pressable onPress={() => void load()} style={styles.retryBtn}>
                      <Text style={styles.retryBtnText}>Retry</Text>
                    </Pressable>
                  )}
                </>
              ) : (
                <>
                  <View style={styles.emptyIcon}>
                    <View style={styles.emptyCarBody} />
                    <View style={styles.emptyCarCabin} />
                    <View style={[styles.emptyWheel, styles.emptyWheelLeft]} />
                    <View style={[styles.emptyWheel, styles.emptyWheelRight]} />
                  </View>
                  <Text style={styles.emptyText}>No washes yet today</Text>
                  <Text style={styles.emptySubtext}>Tap New Wash when the first car rolls in.</Text>
                </>
              )}
            </View>
          }
          ListFooterComponent={<View style={styles.listFooter} />}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  heroContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  ctaWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroCopy: {
    flex: 1,
    paddingRight: spacing.md,
  },
  brand: {
    ...typography.label,
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 4,
    marginBottom: 4,
  },
  greeting: {
    ...typography.title,
    color: colors.white,
  },
  heroSub: {
    ...typography.body,
    color: 'rgba(255,255,255,0.78)',
    marginTop: 4,
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsGlyph: {
    fontSize: 18,
    color: colors.white,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statPill: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  statValue: {
    ...typography.heading,
    color: colors.white,
    fontSize: 22,
  },
  statLabel: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.72)',
    marginTop: 2,
    letterSpacing: 0.4,
  },
  listFlex: {
    flex: 1,
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.slateDeep,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sectionCount: {
    ...typography.caption,
    color: colors.slate,
    backgroundColor: colors.white,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  jobCard: {
    borderLeftWidth: 4,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardTitleBlock: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    ...typography.heading,
    color: colors.waterInk,
  },
  cardMeta: {
    ...typography.body,
    color: colors.slateDeep,
    fontSize: 14,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  price: {
    ...typography.heading,
    color: colors.waterDeep,
    fontSize: 20,
  },
  actionBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    ...shadow('sm'),
  },
  actionWater: {
    backgroundColor: colors.water,
  },
  actionAmber: {
    backgroundColor: colors.amber,
  },
  actionPressed: {
    opacity: 0.75,
  },
  actionLabel: {
    ...typography.label,
    color: colors.white,
    fontSize: 13,
  },
  empty: {
    alignItems: 'center',
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyIcon: {
    width: 72,
    height: 48,
    marginBottom: spacing.md,
    position: 'relative',
  },
  emptyCarBody: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 10,
    height: 18,
    borderRadius: 8,
    backgroundColor: colors.waterPale,
  },
  emptyCarCabin: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: 6,
    height: 16,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    backgroundColor: colors.waterLight,
    opacity: 0.7,
  },
  emptyWheel: {
    position: 'absolute',
    bottom: 4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.waterDeep,
    opacity: 0.35,
  },
  emptyWheelLeft: { left: 12 },
  emptyWheelRight: { right: 12 },
  emptyText: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    marginBottom: 4,
  },
  emptySubtext: {
    ...typography.body,
    color: colors.slateDeep,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.water,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryBtnText: {
    ...typography.label,
    color: colors.white,
  },
  listFooter: {
    height: spacing.lg,
  },
});
