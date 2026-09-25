import React, { useCallback, useMemo, useState } from 'react';
import {
  Linking,
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
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import {
  IconChart,
  IconCheck,
  IconDroplet,
  IconPlay,
  IconPlus,
  IconSettings,
  IconSparkle,
  IconWhatsApp,
} from '../components/Icons';
import { colors, radius, shadow, spacing, statusColors, typography } from '../theme';
import { api } from '../api/client';
import { getSessionUser } from '../api/session';
import { useAuth } from '../api/auth';
import { buildWhatsAppLink, formatRupees } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { canTransition, type JobStatus } from '@mana/domain';

type JobBoardScreenProps = NativeStackScreenProps<RootStackParamList, 'JobBoard'>;

interface JobListItem {
  id: string;
  status: JobStatus;
  total: number;
  customer: { id: string; name: string | null; phone: string };
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

function ActionIcon({ status }: { status: JobStatus }) {
  if (status === 'ready') return <IconCheck size={14} color={colors.white} />;
  if (status === 'waiting') return <IconPlay size={13} color={colors.white} />;
  return <IconDroplet size={13} color={colors.white} />;
}

export function JobBoardScreen({ navigation }: JobBoardScreenProps) {
  const { signOut } = useAuth();
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);

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
    // Excludes void jobs — matches jobRepo.getStats' `carsWashed`, so this hero number and
    // the Reports screen's "Cars washed" never disagree for the same day.
    const realJobs = safeJobs.filter((j) => j.status !== 'void');
    const paidJobs = safeJobs.filter((j) => j.status === 'paid');
    const revenue = paidJobs.reduce((sum, j) => sum + j.total, 0);
    const active = safeJobs.filter(
      (j) => j.status === 'waiting' || j.status === 'washing' || j.status === 'ready',
    ).length;
    return { cars: realJobs.length, revenue, active };
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

  const sendThankYou = (job: JobListItem) => {
    setWhatsappError(null);
    const headline = vehicleHeadline(job);
    const name = job.customer.name?.trim();
    const message =
      `Hi${name ? ` ${name}` : ''}, thank you for choosing MANA Car Wash! ` +
      `Your ${headline.title} is all done — we hope it looks great. See you next time 🚗`;
    Linking.openURL(buildWhatsAppLink(job.customer.phone, message)).catch(() => {
      setWhatsappError('Could not open WhatsApp — make sure it’s installed.');
    });
  };

  return (
    <ScreenContainer noPadding edges={['bottom']}>
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
                <View style={styles.headerActions}>
                  <Pressable
                    onPress={() => navigation.navigate('Reports')}
                    style={({ pressed }) => [styles.heroIconBtn, pressed && styles.heroIconPressed]}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Reports"
                  >
                    <IconChart size={18} color={colors.white} />
                  </Pressable>
                  <Pressable
                    onPress={() => navigation.navigate('Settings')}
                    style={({ pressed }) => [styles.heroIconBtn, pressed && styles.heroIconPressed]}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Settings"
                  >
                    <IconSettings size={18} color={colors.white} />
                  </Pressable>
                </View>
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
          <Button
            label="New Wash"
            size="lg"
            onPress={() => navigation.navigate('NewWash')}
            icon={<IconPlus size={18} color={colors.white} />}
          />
          {whatsappError ? <Text style={styles.whatsappError}>{whatsappError}</Text> : null}
        </View>

        <SectionList
          sections={sections}
          keyExtractor={(job) => job.id}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={colors.water}
              colors={[colors.water]}
            />
          }
          contentContainerStyle={styles.list}
          style={styles.listFlex}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <View style={styles.sectionCountPill}>
                <Text style={styles.sectionCount}>{section.data.length}</Text>
              </View>
            </View>
          )}
          renderSectionFooter={() => <View style={styles.sectionFooter} />}
          renderItem={({ item, index, section }) => {
            const tone = statusColors[item.status];
            const headline = vehicleHeadline(item);
            const action = actionLabel(item);
            const isBusy = busyId === item.id;
            const isFirst = index === 0;
            const isLast = index === section.data.length - 1;

            return (
              <View
                style={[
                  styles.jobRow,
                  { borderLeftColor: tone.border },
                  isFirst && styles.jobRowFirst,
                  isLast && styles.jobRowLast,
                ]}
              >
                <View style={styles.cardHeader}>
                  <Pressable
                    style={styles.cardTitleBlock}
                    onPress={() =>
                      navigation.navigate('CustomerProfile', { customerId: item.customer.id })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`View ${customerLine(item)}'s profile`}
                  >
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {headline.title}
                    </Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {headline.meta}
                      <Text style={styles.cardMetaDot}>  ·  </Text>
                      {customerLine(item)}
                    </Text>
                  </Pressable>
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
                      {!isBusy ? <ActionIcon status={item.status} /> : null}
                      <Text style={styles.actionLabel}>{isBusy ? '…' : action}</Text>
                    </Pressable>
                  ) : item.status === 'paid' ? (
                    <Pressable
                      onPress={() => sendThankYou(item)}
                      style={({ pressed }) => [
                        styles.actionWhatsapp,
                        pressed && styles.actionPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Send thank-you on WhatsApp"
                    >
                      <IconWhatsApp size={16} color="#25D366" />
                      <Text style={styles.actionWhatsappLabel}>Thank you</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
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
                  <View style={styles.emptyIconWrap}>
                    <IconSparkle size={32} color={colors.water} />
                  </View>
                  <Text style={styles.emptyText}>No washes yet today</Text>
                  <Text style={styles.emptySubtext}>
                    Tap New Wash when the first car rolls in.
                  </Text>
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
    paddingBottom: spacing.lg + 4,
    gap: spacing.md + 2,
  },
  ctaWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  whatsappError: {
    ...typography.caption,
    color: colors.danger,
    textAlign: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 10,
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
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 3.5,
    marginBottom: 6,
  },
  greeting: {
    ...typography.title,
    color: colors.white,
    fontSize: 28,
    letterSpacing: -0.4,
  },
  heroSub: {
    ...typography.body,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 6,
    fontSize: 15,
  },
  heroIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIconPressed: {
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statPill: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: radius.lg,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.md,
  },
  statValue: {
    ...typography.heading,
    color: colors.white,
    fontSize: 24,
    letterSpacing: -0.3,
  },
  statLabel: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 4,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontSize: 11,
  },
  listFlex: {
    flex: 1,
  },
  list: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.slateDeep,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontSize: 12,
  },
  sectionCountPill: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  sectionCount: {
    ...typography.caption,
    color: colors.slateDeep,
    fontSize: 12,
  },
  sectionFooter: {
    height: spacing.md,
  },
  jobRow: {
    backgroundColor: colors.white,
    borderLeftWidth: 3,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  jobRowFirst: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  jobRowLast: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardTitleBlock: {
    flex: 1,
    gap: 4,
    paddingRight: spacing.xs,
  },
  cardTitle: {
    ...typography.heading,
    color: colors.waterInk,
    fontSize: 17,
    letterSpacing: -0.2,
  },
  cardMeta: {
    ...typography.body,
    color: colors.slateDeep,
    fontSize: 14,
  },
  cardMetaDot: {
    color: colors.slate,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  price: {
    ...typography.heading,
    color: colors.waterDeep,
    fontSize: 20,
    letterSpacing: -0.3,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
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
    opacity: 0.78,
  },
  actionLabel: {
    ...typography.label,
    color: colors.white,
    fontSize: 13,
  },
  actionWhatsapp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  actionWhatsappLabel: {
    ...typography.label,
    color: colors.tealDeep,
    fontSize: 13,
  },
  empty: {
    alignItems: 'center',
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyText: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    marginBottom: 4,
    fontSize: 17,
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
