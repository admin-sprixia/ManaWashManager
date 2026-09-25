import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  canCorrectPayment,
  canVoidJob,
  PAYMENT_METHOD_LABEL,
  type JobEventAction,
  type JobStatus,
  type PaymentMethod,
} from '@mana/domain';
import { ScreenContainer } from '../components/ScreenContainer';
import { ScreenHeader } from '../components/ScreenHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { EdgeGroup, EdgeRow, SectionLabel } from '../components/EdgeList';
import { PaymentSheet } from '../components/PaymentSheet';
import { ReasonSheet } from '../components/ReasonSheet';
import { showToast } from '../components/Toast';
import {
  IconBan,
  IconCheck,
  IconCloudOff,
  IconDroplet,
  IconEdit,
  IconPerson,
  IconPhone,
  IconPlay,
  IconPlus,
  IconWhatsApp,
} from '../components/Icons';
import { colors, radius, spacing, statusColors, typography } from '../theme';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { useSync } from '../offline/SyncProvider';
import { useJobActions } from '../offline/useJobActions';
import { applyOutbox } from '../offline/optimistic';
import { CacheKeys, readCache } from '../offline/cache';
import type { BoardJob } from '../offline/types';
import { buildWhatsAppLink, formatDateTime, formatRupees } from '../utils/format';
import {
  actionLabel,
  customerLine,
  firstName,
  formatTime,
  NEXT_STATUS,
  VOID_REASONS,
  vehicleHeadline,
} from '../utils/jobs';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'JobDetail'>;

interface JobEvent {
  id: string;
  action: JobEventAction;
  fromValue: string | null;
  toValue: string | null;
  reason: string | null;
  createdAt: string;
  user: { id: string; name: string };
}

type JobDetail = BoardJob & {
  voidReason?: string | null;
  voidedBy?: { id: string; name: string } | null;
  completedAt?: string | null;
  events?: JobEvent[];
};

const STEPS: { status: JobStatus; label: string }[] = [
  { status: 'waiting', label: 'Waiting' },
  { status: 'washing', label: 'Washing' },
  { status: 'ready', label: 'Ready' },
  { status: 'paid', label: 'Paid' },
];

function methodLabel(value: string | null): string {
  return value && value in PAYMENT_METHOD_LABEL ? PAYMENT_METHOD_LABEL[value as PaymentMethod] : value ?? '—';
}

function describeEvent(e: JobEvent): string {
  const who = firstName(e.user.name);
  switch (e.action) {
    case 'created':
      return `${who} started a new wash`;
    case 'status_changed':
      return e.toValue === 'washing' ? `${who} started washing` : `${who} marked it ready`;
    case 'paid':
      return `${who} collected payment · ${methodLabel(e.toValue)}`;
    case 'voided':
      return `${who} voided the job`;
    case 'payment_method_changed':
      return `${who} changed payment ${methodLabel(e.fromValue)} → ${methodLabel(e.toValue)}`;
  }
}

function eventTone(action: JobEventAction): { dot: string; bg: string } {
  if (action === 'voided') return { dot: colors.danger, bg: '#FEE2E2' };
  if (action === 'payment_method_changed') return { dot: colors.amber, bg: '#FEF3C7' };
  if (action === 'paid') return { dot: colors.teal, bg: '#CCFBF1' };
  return { dot: colors.water, bg: colors.waterPale };
}

export function JobDetailScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const insets = useSafeAreaInsets();
  const { user, isOwner } = useAuth();
  const { items, version } = useSync();
  const actions = useJobActions();

  const [serverJob, setServerJob] = useState<JobDetail | null>(null);
  const [fallbackJob, setFallbackJob] = useState<BoardJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'pay' | 'void' | 'correct' | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.jobs[':id'].$get({ param: { id: jobId } });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      setServerJob((await res.json()) as unknown as JobDetail);
      setNotFound(false);
      setOffline(false);
    } catch (e) {
      if (e instanceof NetworkError) setOffline(true);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load, version]);

  // No signal, or a wash that only exists on this phone so far: fall back to the board copy.
  useEffect(() => {
    void readCache<{ jobs: BoardJob[] }>(CacheKeys.jobsToday).then((cached) => {
      setFallbackJob(cached?.jobs.find((j) => j.id === jobId) ?? null);
    });
  }, [jobId, version]);

  const job = useMemo<JobDetail | null>(() => {
    const base: JobDetail | null = serverJob ?? fallbackJob;
    const merged = applyOutbox(base ? [base] : [], items).find((j) => j.id === jobId);
    if (!merged) return null;
    return { ...(base ?? {}), ...merged } as JobDetail;
  }, [serverJob, fallbackJob, items, jobId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!job) {
    return (
      <ScreenContainer>
        <ScreenHeader title="Job" onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          {loading ? (
            <ActivityIndicator color={colors.water} />
          ) : (
            <>
              <Text style={styles.emptyTitle}>{notFound ? 'Job not found' : 'Can’t open this job'}</Text>
              <Text style={styles.emptyBody}>
                {notFound
                  ? 'It may have been removed.'
                  : 'You’re offline and this job isn’t saved on this phone yet.'}
              </Text>
              <Button label="Try again" variant="secondary" onPress={() => void load()} />
            </>
          )}
        </View>
      </ScreenContainer>
    );
  }

  const role = user?.role ?? 'staff';
  const headline = vehicleHeadline(job);
  const tone = statusColors[job.status];
  const next = NEXT_STATUS[job.status];
  const primaryLabel = actionLabel(job.status);
  const isVoid = job.status === 'void';
  const pendingOnPhone = job.syncState === 'pending' && !serverJob;
  const allowVoid = canVoidJob(job.status, role);
  const allowCorrect = canCorrectPayment(job.status, role) && !job.syncState;
  const stepIndex = STEPS.findIndex((s) => s.status === job.status);
  const events = serverJob?.events ?? [];

  const runPrimary = async () => {
    if (job.status === 'ready') {
      setSheet('pay');
      return;
    }
    if (!next) return;
    setBusy(true);
    const message = await actions.advance(job.id, next);
    setBusy(false);
    if (message) showToast(message, 'error');
  };

  const call = () => Linking.openURL(`tel:${job.customer.phone}`).catch(() => undefined);
  const whatsapp = () =>
    Linking.openURL(buildWhatsAppLink(job.customer.phone, `Hi ${job.customer.name?.trim() ?? ''}, `)).catch(() =>
      showToast('Couldn’t open WhatsApp — is it installed?', 'error'),
    );

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title={headline.title} onBack={() => navigation.goBack()} right={<StatusBadge status={job.status} />} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.water} colors={[colors.water]} />
        }
      >
        {offline || pendingOnPhone ? (
          <View style={styles.offlineBand}>
            <IconCloudOff size={15} color={colors.amberDeep} />
            <Text style={styles.offlineText}>
              {pendingOnPhone
                ? 'Saved on this phone — it will reach the server when there’s signal.'
                : 'Offline — showing the last saved copy. Activity loads when you’re back online.'}
            </Text>
          </View>
        ) : null}

        {isVoid ? (
          <View style={styles.voidBand}>
            <IconBan size={16} color={colors.danger} />
            <View style={styles.flex}>
              <Text style={styles.voidTitle}>
                Voided{job.voidedBy ? ` by ${job.voidedBy.name}` : ''}
              </Text>
              {job.voidReason ? <Text style={styles.voidReason}>“{job.voidReason}”</Text> : null}
            </View>
          </View>
        ) : null}

        <View style={[styles.summary, { borderLeftColor: tone.border }]}>
          <Text style={styles.summaryMeta}>
            {headline.meta} · {formatDateTime(job.createdAt)}
          </Text>
          <Text style={[styles.summaryTotal, isVoid && styles.strike]}>{formatRupees(job.total)}</Text>
          {!isVoid ? (
            <View style={styles.stepper}>
              {STEPS.map((s, i) => {
                const done = i <= stepIndex;
                const current = i === stepIndex;
                return (
                  <React.Fragment key={s.status}>
                    {i > 0 ? <View style={[styles.stepLine, i <= stepIndex && styles.stepLineDone]} /> : null}
                    <View style={styles.step}>
                      <View style={[styles.stepDot, done && styles.stepDotDone, current && styles.stepDotCurrent]}>
                        {done && !current ? <IconCheck size={10} color={colors.white} /> : null}
                      </View>
                      <Text style={[styles.stepLabel, done && styles.stepLabelDone]}>{s.label}</Text>
                    </View>
                  </React.Fragment>
                );
              })}
            </View>
          ) : null}
        </View>

        <SectionLabel>Customer</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={<IconPerson size={20} color={colors.waterDeep} />}
            title={customerLine(job)}
            subtitle={job.customer.phone}
            onPress={job.customer.id ? () => navigation.navigate('CustomerProfile', { customerId: job.customer.id }) : undefined}
            right={
              <View style={styles.contactBtns}>
                <Pressable onPress={call} hitSlop={6} style={styles.contactBtn} accessibilityLabel="Call customer">
                  <IconPhone size={17} color={colors.waterDeep} />
                </Pressable>
                <Pressable onPress={whatsapp} hitSlop={6} style={styles.contactBtn} accessibilityLabel="WhatsApp customer">
                  <IconWhatsApp size={18} />
                </Pressable>
              </View>
            }
          />
        </EdgeGroup>

        <SectionLabel>Services</SectionLabel>
        <View style={styles.bill}>
          {job.jobServices.map((line, i) => (
            <View key={i} style={styles.billRow}>
              <Text style={styles.billName} numberOfLines={1}>
                {line.service.name}
                {line.quantity > 1 ? ` × ${line.quantity}` : ''}
              </Text>
              <Text style={styles.billAmount}>{formatRupees(line.priceAtTime * line.quantity)}</Text>
            </View>
          ))}
          {job.discount > 0 ? (
            <>
              <View style={[styles.billRow, styles.billDivider]}>
                <Text style={styles.billMuted}>Subtotal</Text>
                <Text style={styles.billMuted}>{formatRupees(job.subtotal)}</Text>
              </View>
              <View style={styles.billRow}>
                <Text style={styles.billDiscount} numberOfLines={1}>
                  Discount{job.discountReason ? ` · ${job.discountReason}` : ''}
                </Text>
                <Text style={styles.billDiscount}>− {formatRupees(job.discount)}</Text>
              </View>
            </>
          ) : null}
          <View style={[styles.billRow, styles.billDivider]}>
            <Text style={styles.billTotalLabel}>Total</Text>
            <Text style={styles.billTotal}>{formatRupees(job.total)}</Text>
          </View>
        </View>

        {job.status === 'paid' ? (
          <>
            <SectionLabel>Payment</SectionLabel>
            <EdgeGroup>
              <EdgeRow
                title={`${methodLabel(job.paymentMethod)} · ${formatRupees(job.total)}`}
                subtitle={
                  [
                    job.paidBy ? `Collected by ${job.paidBy.name}` : null,
                    job.completedAt ? formatTime(job.completedAt) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || undefined
                }
                icon={<IconCheck size={18} color={colors.teal} />}
                iconBg="#CCFBF1"
              />
              {allowCorrect ? (
                <EdgeRow
                  icon={<IconEdit size={18} color={colors.amberDeep} />}
                  iconBg="#FEF3C7"
                  title="Correct payment method"
                  subtitle="Owner only · saved in the audit log"
                  onPress={() => setSheet('correct')}
                />
              ) : null}
            </EdgeGroup>
          </>
        ) : null}

        <SectionLabel>Activity</SectionLabel>
        <View style={styles.timeline}>
          {events.length === 0 ? (
            <Text style={styles.timelineEmpty}>
              {offline || pendingOnPhone
                ? 'Activity will appear once this job syncs.'
                : job.createdBy
                  ? `Started by ${job.createdBy.name}`
                  : 'No activity yet.'}
            </Text>
          ) : (
            events.map((e, i) => {
              const t = eventTone(e.action);
              return (
                <View key={e.id} style={styles.event}>
                  <View style={styles.eventRail}>
                    <View style={[styles.eventDot, { backgroundColor: t.bg, borderColor: t.dot }]} />
                    {i < events.length - 1 ? <View style={styles.eventLine} /> : null}
                  </View>
                  <View style={styles.eventBody}>
                    <Text style={styles.eventText}>{describeEvent(e)}</Text>
                    <Text style={styles.eventTime}>{formatDateTime(e.createdAt)}</Text>
                    {e.reason && e.action !== 'created' ? (
                      <Text style={styles.eventReason}>“{e.reason}”</Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </View>

        {allowVoid && !job.syncState ? (
          <>
            <SectionLabel>Danger zone</SectionLabel>
            <EdgeGroup>
              <EdgeRow
                icon={<IconBan size={18} color={colors.danger} />}
                iconBg="#FEE2E2"
                title="Void this job"
                tone="danger"
                subtitle={
                  job.status === 'paid'
                    ? 'Reverses collected money. A reason is required.'
                    : 'Removes it from the board and totals. A reason is required.'
                }
                onPress={() => setSheet('void')}
              />
            </EdgeGroup>
          </>
        ) : job.status === 'paid' && !isOwner ? (
          <Text style={styles.ownerNote}>Only the owner can void or correct a paid job.</Text>
        ) : null}

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {primaryLabel ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Button
            label={primaryLabel}
            size="lg"
            loading={busy}
            onPress={() => void runPrimary()}
            icon={
              job.status === 'waiting' ? (
                <IconPlay size={15} color={colors.white} />
              ) : job.status === 'washing' ? (
                <IconDroplet size={15} color={colors.white} />
              ) : (
                <IconPlus size={16} color={colors.white} />
              )
            }
          />
        </View>
      ) : null}

      <PaymentSheet
        visible={sheet === 'pay'}
        amount={job.total}
        subtitle={`${headline.title} · ${customerLine(job)}`}
        onClose={() => setSheet(null)}
        onConfirm={async (method) => {
          const message = await actions.pay(job.id, method);
          if (!message) setSheet(null);
          return message;
        }}
      />

      <PaymentSheet
        visible={sheet === 'correct'}
        amount={job.total}
        subtitle={`${headline.title} · ${formatRupees(job.total)}`}
        currentMethod={job.paymentMethod}
        onClose={() => setSheet(null)}
        onConfirm={async (method, reason) => {
          try {
            const res = await api.jobs[':id']['payment-method'].$patch({
              param: { id: job.id },
              json: { paymentMethod: method, reason: reason ?? '' },
            });
            if (!res.ok) return apiErrorMessage(res);
            setSheet(null);
            showToast('Payment method corrected');
            await load();
            return null;
          } catch (e) {
            return e instanceof NetworkError ? 'Corrections need a connection. Try again when online.' : 'Couldn’t save.';
          }
        }}
      />

      <ReasonSheet
        visible={sheet === 'void'}
        title="Void this job?"
        subtitle={`${headline.title} · ${formatRupees(job.total)}${job.status === 'paid' ? ' · already paid' : ''}`}
        confirmLabel="Void job"
        quickReasons={VOID_REASONS}
        onClose={() => setSheet(null)}
        onConfirm={async (reason) => {
          const message = await actions.voidJob(job.id, reason);
          if (!message) {
            setSheet(null);
            showToast('Job voided');
          }
          return message;
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  emptyTitle: { ...typography.heading, color: colors.waterInk },
  emptyBody: { ...typography.body, color: colors.slateDeep, textAlign: 'center', marginBottom: spacing.sm },
  offlineBand: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: '#FFFBEB',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.amberLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.sm,
  },
  offlineText: { ...typography.caption, color: colors.amberDeep, flex: 1, letterSpacing: 0, fontSize: 13 },
  voidBand: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: '#FEF2F2',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#FECACA',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    marginTop: spacing.sm,
  },
  voidTitle: { ...typography.bodyStrong, color: colors.danger, fontSize: 15 },
  voidReason: { ...typography.body, color: colors.slateDeep, fontSize: 14, marginTop: 2, fontStyle: 'italic' },
  summary: {
    backgroundColor: colors.white,
    borderLeftWidth: 3,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 4,
    marginTop: spacing.md,
    gap: 4,
  },
  summaryMeta: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0, fontSize: 13 },
  summaryTotal: { ...typography.display, color: colors.waterInk, fontSize: 36 },
  strike: { textDecorationLine: 'line-through', color: colors.slate },
  stepper: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.md },
  step: { alignItems: 'center', gap: 6, width: 56 },
  stepDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: colors.water, borderColor: colors.water },
  stepDotCurrent: { backgroundColor: colors.white, borderColor: colors.water, borderWidth: 5 },
  stepLabel: { ...typography.caption, color: colors.slate, fontSize: 11, letterSpacing: 0 },
  stepLabelDone: { color: colors.waterDeep, fontWeight: '700' },
  stepLine: { flex: 1, height: 2, backgroundColor: colors.border, marginTop: 8, marginHorizontal: -14 },
  stepLineDone: { backgroundColor: colors.water },
  contactBtns: { flexDirection: 'row', gap: spacing.sm },
  contactBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bill: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, gap: spacing.md },
  billDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 2 },
  billName: { ...typography.body, color: colors.waterInk, flex: 1 },
  billAmount: { ...typography.bodyStrong, color: colors.waterInk },
  billMuted: { ...typography.body, color: colors.slateDeep, fontSize: 14 },
  billDiscount: { ...typography.body, color: colors.teal, fontSize: 14, flexShrink: 1 },
  billTotalLabel: { ...typography.bodyStrong, color: colors.waterInk },
  billTotal: { ...typography.heading, color: colors.waterDeep },
  timeline: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  timelineEmpty: { ...typography.body, color: colors.slateDeep, fontSize: 14, paddingBottom: spacing.sm },
  event: { flexDirection: 'row', gap: spacing.sm + 4 },
  eventRail: { alignItems: 'center', width: 16 },
  eventDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, marginTop: 3 },
  eventLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  eventBody: { flex: 1, paddingBottom: spacing.md, gap: 2 },
  eventText: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  eventTime: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  eventReason: {
    ...typography.body,
    color: colors.slateDeep,
    fontSize: 14,
    fontStyle: 'italic',
    marginTop: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  ownerNote: {
    ...typography.caption,
    color: colors.slate,
    textAlign: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    letterSpacing: 0,
  },
  bottomSpacer: { height: spacing.lg },
  footer: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
