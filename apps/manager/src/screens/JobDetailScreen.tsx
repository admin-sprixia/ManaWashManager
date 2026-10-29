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
  unstable_batchedUpdates,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  canCorrectPayment,
  canVoidJob,
  jobCommission,
  MAX_OFFLINE_BACKDATE_MS,
  MAX_SELLERS_PER_JOB,
  MAX_WASHERS_PER_JOB,
  PAYMENT_METHOD_LABEL,
  type JobEventAction,
  type JobStatus,
  type PaymentMethod,
} from '@mana/domain';
import {
  ScreenContainer,
  ScreenHeader,
  Avatar,
  Button,
  showToast,
  IconPhone,
  IconWhatsApp,
  colors,
  formatPhone,
  spacing,
  typography,
} from '@mana/ui';
import { FactRow, JobHero, SheetHeading } from '../components/jobDetail/JobDetailParts';
import { SellPlanSheet } from '../components/newWash/SellPlanSheet';
import { PaymentSheet } from '../components/PaymentSheet';
import { ReasonSheet } from '../components/ReasonSheet';
import { PeoplePickerSheet } from '../components/PeoplePickerSheet';
import { JobPhotos, type JobPhoto } from '../components/JobPhotos';
import ReactNativeBlobUtil from 'react-native-blob-util';
import Share from 'react-native-share';
import { api, API_BASE_URL, apiErrorMessage } from '../api/client';
import { bytesToBase64 } from '../utils/shareReportPdf';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { useSync } from '../offline/SyncProvider';
import { useJobActions } from '../offline/useJobActions';
import { applyOutbox } from '../offline/optimistic';
import { boardJob } from '../offline/useBoardJobs';
import { useOpened } from '../utils/useOpened';
import { CacheKeys, readCache } from '../offline/cache';
import type { BoardJob } from '../offline/types';
import { formatDateTime, formatRupees } from '../utils/format';
import { openWhatsApp } from '../utils/whatsapp';
import { giftLine } from '../utils/rewards';
import {
  actionLabel,
  customerLine,
  firstName,
  formatTime,
  isToday,
  isWalkIn,
  NEXT_STATUS,
  spacedPlate,
  STATUS_LABEL,
  VOID_REASONS,
  vehicleHeadline,
  vehicleModelLine,
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
  photos?: JobPhoto[];
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
    case 'washers_changed':
      return e.toValue ? `${who} changed washers to ${e.toValue}` : `${who} cleared who washed it`;
    case 'sellers_changed':
      return `${who} changed who got the service to ${e.toValue ?? '—'}`;
    case 'price_kept':
      return `Kept the price ${who} quoted offline: ${formatRupees(Number(e.toValue))} (today ${formatRupees(Number(e.fromValue))})`;
  }
}

function eventTone(action: JobEventAction): { dot: string; bg: string } {
  if (action === 'voided') return { dot: colors.danger, bg: '#FEE2E2' };
  if (action === 'payment_method_changed' || action === 'washers_changed' || action === 'sellers_changed' || action === 'price_kept') {
    return { dot: colors.amber, bg: '#FEF3C7' };
  }
  if (action === 'paid') return { dot: colors.teal, bg: '#CCFBF1' };
  return { dot: colors.water, bg: colors.waterPale };
}

export function JobDetailScreen({ navigation, route }: Props) {
  const { jobId } = route.params;
  const insets = useSafeAreaInsets();
  const { user, isOwner } = useAuth();
  const { shopItems: items, version, online } = useSync();
  const [selling, setSelling] = useState(false);
  const actions = useJobActions();

  const [serverJob, setServerJob] = useState<JobDetail | null>(null);
  // The board's copy first: the page opens filled in, before the server answers.
  const [fallbackJob, setFallbackJob] = useState<BoardJob | null>(() => boardJob(jobId));
  const [loading, setLoading] = useState(true);
  /** False while the page slides in: the download and the photos wait for it. */
  const opened = useOpened(navigation);
  const [offline, setOffline] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'pay' | 'void' | 'correct' | 'start' | 'washers' | 'sellers' | null>(null);
  const [sharingBill, setSharingBill] = useState(false);

  // Each answer is applied in one go: the old architecture would redraw the page per update.
  const load = useCallback(async () => {
    try {
      const res = await api.jobs[':id'].$get({ param: { id: jobId } });
      if (res.status === 404) {
        unstable_batchedUpdates(() => {
          setNotFound(true);
          setLoading(false);
        });
        return;
      }
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      const fresh = (await res.json()) as unknown as JobDetail;
      unstable_batchedUpdates(() => {
        setServerJob(fresh);
        setNotFound(false);
        setOffline(false);
        setLoading(false);
      });
    } catch (e) {
      unstable_batchedUpdates(() => {
        if (e instanceof NetworkError) setOffline(true);
        setLoading(false);
      });
    }
  }, [jobId]);

  useEffect(() => {
    if (opened) void load();
  }, [opened, load, version]);

  // No signal, or a wash that only exists on this phone so far: the board's copy (in memory,
  // else the saved one).
  useEffect(() => {
    const onBoard = boardJob(jobId);
    if (onBoard) {
      setFallbackJob(onBoard);
      return;
    }
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
  const next = NEXT_STATUS[job.status];
  const primaryLabel = actionLabel(job.status);
  const isVoid = job.status === 'void';
  const pendingOnPhone = job.syncState === 'pending' && !serverJob;
  const allowVoid = canVoidJob(job.status, role);
  const allowCorrect = canCorrectPayment(job.status, role) && !job.syncState;
  const stepIndex = STEPS.findIndex((s) => s.status === job.status);
  const events = serverJob?.events ?? [];
  const washers = (job.washers ?? []).map((w) => w.user);
  const showWashers = job.status !== 'waiting' && !(isVoid && washers.length === 0);
  const allowWasherEdit = !isVoid && job.status !== 'waiting' && job.syncState !== 'failed';
  const sellers = (job.sellers ?? []).map((s) => s.user);
  const commission = jobCommission(
    job.jobServices.map((l) => ({ commissionAtTime: l.commissionAtTime ?? 0, quantity: l.quantity })),
  );
  // Anyone can fix who got the service until the job is paid; after that it moves earned money, so owner only.
  const allowSellerEdit =
    commission > 0 && !isVoid && (job.status !== 'paid' || isOwner) && job.syncState !== 'failed';
  // Staff only see photos for jobs still on the board (the API enforces the same).
  const onBoard = isToday(job.createdAt) || job.status === 'waiting' || job.status === 'washing' || job.status === 'ready';
  const canSeePhotos = isOwner || onBoard;
  const canAddPhotos = !isVoid && (isOwner || Date.now() - new Date(job.createdAt).getTime() < MAX_OFFLINE_BACKDATE_MS);

  const runPrimary = async () => {
    if (job.status === 'ready') {
      setSheet('pay');
      return;
    }
    if (job.status === 'waiting') {
      setSheet('start');
      return;
    }
    if (!next) return;
    setBusy(true);
    const message = await actions.advance(job.id, next);
    setBusy(false);
    if (message) showToast(message, 'error');
    else if (next === 'ready') showToast('Ready. The customer gets a WhatsApp to come pick it up.');
  };

  const call = () => void Linking.openURL(`tel:${job.customer.phone}`).catch(() => undefined);

  /** The same PDF bill the customer gets on WhatsApp, to open, print or forward. */
  const shareBill = async () => {
    setSharingBill(true);
    try {
      const res = await api.jobs[':id'].bill.$get({ param: { id: job.id } });
      if (!res.ok) {
        showToast(await apiErrorMessage(res, 'Couldn’t make the bill.'), 'error');
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `Bill-${job.id.slice(-4)}.pdf`;
      const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${name}`;
      await ReactNativeBlobUtil.fs.writeFile(path, bytesToBase64(new Uint8Array(await res.arrayBuffer())), 'base64');
      await Share.open({ url: `file://${path}`, type: 'application/pdf', filename: name, title: 'Share bill', failOnCancel: false });
    } catch {
      showToast('You’re offline. The bill needs a connection.', 'error');
    } finally {
      setSharingBill(false);
    }
  };
  const whatsapp = () => void openWhatsApp(job.customer.phone, `Hi ${job.customer.name?.trim() ?? ''}, `);

  const model = vehicleModelLine(job.vehicle);
  const make = job.vehicle.make?.trim() || null;
  const walkIn = isWalkIn(job.vehicle);
  const plate = walkIn ? 'Walk-in' : spacedPlate(job.vehicle.registrationNumber);
  const doorstep = job.deliveryMode === 'doorstep';
  const heroTone = isVoid ? 'danger' : job.status === 'paid' ? 'teal' : 'brand';
  const started = isToday(job.createdAt) ? formatTime(job.createdAt) : formatDateTime(job.createdAt);
  const amountNote = isVoid
    ? 'Voided · not counted'
    : job.status === 'paid'
      ? [`Paid by ${methodLabel(job.paymentMethod)}`, job.completedAt ? formatTime(job.completedAt) : null].filter(Boolean).join(' · ')
      : job.status === 'ready'
        ? 'To collect now'
        : 'To collect when it’s ready';
  const phone = job.customer.phone.replace(/\D/g, '').slice(-10);
  // A customer who asks for a plan while their car is here: sign them up; it starts next visit.
  const vehicleTypeId = (job.vehicle as { vehicleTypeId?: string }).vehicleTypeId ?? null;
  const canSellPlan = !isVoid && !walkIn && !doorstep && online && vehicleTypeId != null && !job.syncState;

  return (
    <ScreenContainer noPadding edges={['bottom']}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.water} colors={[colors.water]} />
        }
      >
        <View style={{ paddingTop: insets.top }}>
          <JobHero
            tone={heroTone}
            status={STATUS_LABEL[job.status]}
            make={make}
            title={model ?? plate}
            subtitle={[model ? plate : null, doorstep ? 'Doorstep' : 'At the shop'].filter(Boolean).join('  ·  ')}
            amount={formatRupees(job.total)}
            amountNote={amountNote}
            steps={isVoid ? null : STEPS.map((x) => x.label)}
            current={stepIndex}
            onBack={() => navigation.goBack()}
          />
        </View>

        <View style={styles.sheet}>
          {offline || pendingOnPhone ? (
            <Text style={styles.note}>
              {pendingOnPhone
                ? 'Saved on this phone. It reaches the server when there’s signal.'
                : 'Offline. Showing the last saved copy; activity loads when you’re back online.'}
            </Text>
          ) : null}

          {isVoid ? (
            <View style={styles.voidNote}>
              <Text style={styles.voidTitle}>Voided{job.voidedBy ? ` by ${job.voidedBy.name}` : ''}</Text>
              {job.voidReason ? <Text style={styles.voidReason}>“{job.voidReason}”</Text> : null}
            </View>
          ) : null}

          {/* Customer */}
          <Pressable
            onPress={job.customer.id ? () => navigation.navigate('CustomerProfile', { customerId: job.customer.id }) : undefined}
            disabled={!job.customer.id}
            style={({ pressed }) => [styles.customer, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${customerLine(job)}, open profile`}
          >
            <Avatar name={customerLine(job)} id={job.customer.id || job.customer.phone} size={46} />
            <View style={styles.flex}>
              <Text style={styles.customerName} numberOfLines={1}>
                {customerLine(job)}
              </Text>
              <Text style={styles.customerPhone}>+91 {formatPhone(phone)}</Text>
            </View>
            <Pressable onPress={call} hitSlop={6} style={styles.contact} accessibilityLabel="Call customer">
              <IconPhone size={17} color={colors.indigo} />
            </Pressable>
            <Pressable onPress={whatsapp} hitSlop={6} style={[styles.contact, styles.contactWa]} accessibilityLabel="WhatsApp customer">
              <IconWhatsApp size={19} />
            </Pressable>
          </Pressable>

          {/* Receipt */}
          <SheetHeading>Bill</SheetHeading>
          {job.jobServices.map((line, i) => {
            const free = line.serviceId != null && job.freeServiceIds?.includes(line.serviceId);
            return (
              <View key={i} style={styles.line}>
                <View style={styles.flex}>
                  <Text style={styles.lineName} numberOfLines={2}>
                    {line.service.name}
                    {line.quantity > 1 ? ` × ${line.quantity}` : ''}
                  </Text>
                  {free ? <Text style={styles.lineFree}>Free · stamp card</Text> : null}
                </View>
                <Text style={styles.lineAmount}>{formatRupees(line.priceAtTime * line.quantity)}</Text>
              </View>
            );
          })}
          {job.discount > 0 ? (
            <>
              <View style={styles.lineSmall}>
                <Text style={[styles.lineMuted, styles.flex]}>Subtotal</Text>
                <Text style={styles.lineMuted}>{formatRupees(job.subtotal)}</Text>
              </View>
              <View style={styles.lineSmall}>
                <Text style={[styles.lineDiscount, styles.flex]} numberOfLines={2}>
                  Discount{job.discountReason ? ` · ${job.discountReason}` : ''}
                </Text>
                <Text style={styles.lineDiscount}>− {formatRupees(job.discount)}</Text>
              </View>
            </>
          ) : null}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={[styles.total, isVoid && styles.strike]}>{formatRupees(job.total)}</Text>
          </View>

          {/* Details */}
          {canSellPlan ? (
            <Pressable
              onPress={() => setSelling(true)}
              style={({ pressed }) => [styles.sellPlan, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.sellPlanText}>Sell a plan for {plate}</Text>
              <Text style={styles.sellPlanNote}>Starts from their next visit · today’s wash is paid as usual</Text>
            </Pressable>
          ) : null}

          <SheetHeading>Details</SheetHeading>
          <FactRow
            label="Started"
            value={started}
            note={job.createdBy ? `by ${job.createdBy.name}` : undefined}
          />
          {showWashers ? (
            <FactRow
              label="Washed by"
              value={washers.length > 0 ? washers.map((w) => w.name).join(', ') : 'Not recorded'}
              onPress={allowWasherEdit ? () => setSheet('washers') : undefined}
            />
          ) : null}
          {commission > 0 ? (
            <FactRow
              label="Got the service"
              value={sellers.length > 0 ? sellers.map((x) => x.name).join(', ') : 'Not recorded'}
              note={[
                `${formatRupees(commission)} commission${sellers.length > 1 ? `, ${formatRupees(Math.floor(commission / sellers.length))} each` : ''}`,
                isVoid ? 'not earned' : job.status === 'paid' ? null : 'earned once paid',
              ]
                .filter(Boolean)
                .join(' · ')}
              onPress={allowSellerEdit ? () => setSheet('sellers') : undefined}
            />
          ) : null}
          {job.status === 'paid' ? (
            <FactRow
              label="Payment"
              value={methodLabel(job.paymentMethod)}
              tone="good"
              note={[job.paidBy ? `to ${job.paidBy.name}` : null, job.completedAt ? formatTime(job.completedAt) : null]
                .filter(Boolean)
                .join(' · ')}
              onPress={allowCorrect ? () => setSheet('correct') : undefined}
            />
          ) : null}
          {job.status === 'paid' && !job.syncState ? (
            <FactRow
              label="Bill"
              value={sharingBill ? 'Preparing…' : 'Open or share the PDF'}
              note="Services, total and the before & after photos. The customer gets it on WhatsApp."
              onPress={sharingBill ? undefined : () => void shareBill()}
            />
          ) : null}
          {(job.gifts ?? []).map((g) => (
            <FactRow
              key={g.id}
              label="Welcome gift"
              value={giftLine(g)}
              tone={g.status === 'owed' ? 'warn' : g.status === 'given' ? 'good' : 'default'}
              note={g.status === 'given' ? 'Handed over' : g.status === 'owed' ? 'Owed · out of stock' : 'Taken back'}
              onPress={
                g.status === 'owed' ? () => navigation.navigate('CustomerProfile', { customerId: job.customer.id }) : undefined
              }
            />
          ))}

          {opened && canSeePhotos && (canAddPhotos || (serverJob?.photos?.length ?? 0) > 0) ? (
            <>
              <SheetHeading>Photos</SheetHeading>
              <View style={styles.photos}>
                <JobPhotos
                  jobId={job.id}
                  photos={serverJob?.photos ?? []}
                  canAdd={canAddPhotos}
                  canAddKind={(kind) => (kind === 'before' ? job.status === 'waiting' : job.status !== 'waiting')}
                  closedNote={(kind) =>
                    kind === 'before' ? 'Before photos are taken before the wash starts.' : 'After photos once the wash has started.'
                  }
                  canDelete={isOwner}
                  baseUrl={API_BASE_URL}
                  onChanged={() => void load()}
                />
              </View>
            </>
          ) : null}

          {/* Activity */}
          <SheetHeading>Activity</SheetHeading>
          {events.length === 0 ? (
            <Text style={styles.empty}>
              {offline || pendingOnPhone
                ? 'Activity appears once this wash syncs.'
                : job.createdBy
                  ? `Started by ${job.createdBy.name}`
                  : 'No activity yet.'}
            </Text>
          ) : (
            <View style={styles.timeline}>
              {events.map((e, i) => (
                <View key={e.id} style={styles.event}>
                  <View style={styles.rail}>
                    <View style={[styles.dot, { backgroundColor: eventTone(e.action).dot }]} />
                    {i < events.length - 1 ? <View style={styles.railLine} /> : null}
                  </View>
                  <View style={styles.eventBody}>
                    <Text style={styles.eventText}>{describeEvent(e)}</Text>
                    {e.reason && e.action !== 'created' ? <Text style={styles.eventReason}>“{e.reason}”</Text> : null}
                  </View>
                  <Text style={styles.eventTime}>
                    {isToday(e.createdAt) ? formatTime(e.createdAt) : formatDateTime(e.createdAt)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {allowVoid && !job.syncState ? (
            <Pressable
              onPress={() => setSheet('void')}
              style={({ pressed }) => [styles.voidLink, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.voidLinkText}>Void this wash</Text>
              <Text style={styles.voidLinkNote}>
                {job.status === 'paid' ? 'Reverses collected money.' : 'Removes it from the board and totals.'} A reason is required.
              </Text>
            </Pressable>
          ) : job.status === 'paid' && !isOwner ? (
            <Text style={styles.ownerNote}>Only the owner can void or correct a paid wash.</Text>
          ) : null}
        </View>
      </ScrollView>

      {primaryLabel ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Button
            label={primaryLabel}
            size="lg"
            loading={busy}
            onPress={() => void runPrimary()}
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

      <PeoplePickerSheet
        visible={sheet === 'sellers'}
        title="Who got this service?"
        subtitle={`${formatRupees(commission)} commission · split equally if more than one`}
        confirmLabel="Save"
        max={MAX_SELLERS_PER_JOB}
        initial={sellers}
        sharedHint={(count) => `${formatRupees(Math.floor(commission / count))} each — shared equally.`}
        onClose={() => setSheet(null)}
        onConfirm={async (picked) => {
          const message = await actions.setSellers(job.id, picked);
          if (!message) {
            showToast('Saved');
            setSheet(null);
          }
          return message;
        }}
      />

      <PeoplePickerSheet
        visible={sheet === 'start' || sheet === 'washers'}
        title={sheet === 'start' ? 'Who’s washing it?' : 'Who washed it?'}
        subtitle={`${headline.title} · ${customerLine(job)}`}
        confirmLabel={sheet === 'start' ? 'Start wash' : 'Save washers'}
        max={MAX_WASHERS_PER_JOB}
        initial={sheet === 'washers' ? washers : undefined}
        onClose={() => setSheet(null)}
        skipLabel={sheet === 'start' ? 'Skip' : 'Clear'}
        onSkip={
          sheet === 'start' || washers.length > 0
            ? async () => {
                const message =
                  sheet === 'start' ? await actions.advance(job.id, 'washing') : await actions.setWashers(job.id, []);
                if (!message) setSheet(null);
                return message;
              }
            : undefined
        }
        onConfirm={async (picked) => {
          const message =
            sheet === 'start'
              ? await actions.advance(job.id, 'washing', picked)
              : await actions.setWashers(job.id, picked);
          if (!message) {
            if (sheet === 'washers') showToast('Washers updated');
            setSheet(null);
          }
          return message;
        }}
      />

      {canSellPlan && vehicleTypeId ? (
        <SellPlanSheet
          visible={selling}
          vehicleTypeId={vehicleTypeId}
          vehicleName={job.vehicle.vehicleType.name}
          customer={{ phone: job.customer.phone, name: job.customer.name?.trim() || 'Customer' }}
          registrationNumber={job.vehicle.registrationNumber}
          onClose={() => setSelling(false)}
          onSold={() => void load()}
          formatMoney={formatRupees}
          startsNextVisit
        />
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { backgroundColor: colors.white },
  scroll: { paddingBottom: spacing.xl },
  headerPad: { paddingHorizontal: spacing.md },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  emptyTitle: { ...typography.heading, color: colors.waterInk },
  emptyBody: { ...typography.body, color: colors.slateDeep, textAlign: 'center', marginBottom: spacing.sm },
  pressed: { opacity: 0.6 },

  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    marginTop: -26,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  note: { ...typography.caption, color: colors.amberDeep, fontSize: 13, letterSpacing: 0, marginBottom: spacing.sm },
  voidNote: { borderLeftWidth: 3, borderLeftColor: colors.danger, paddingLeft: spacing.sm + 2, marginBottom: spacing.md, gap: 2 },
  voidTitle: { ...typography.bodyStrong, color: colors.danger, fontSize: 15 },
  voidReason: { ...typography.body, color: colors.slateDeep, fontSize: 14, fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through', color: colors.slate },

  customer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, paddingVertical: spacing.xs },
  customerName: { ...typography.heading, color: colors.waterInk, fontSize: 17 },
  customerPhone: { ...typography.body, color: colors.slate, fontSize: 13.5, marginTop: 1 },
  contact: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.indigoPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactWa: { backgroundColor: '#E8F8EE' },

  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  lineName: { ...typography.body, color: colors.waterInk, fontSize: 15 },
  lineFree: { ...typography.caption, color: colors.amberDeep, fontSize: 12, fontWeight: '700', letterSpacing: 0, marginTop: 2 },
  lineAmount: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  lineSmall: { flexDirection: 'row', gap: spacing.md, paddingTop: spacing.sm + 2 },
  lineMuted: { ...typography.body, color: colors.slate, fontSize: 14 },
  lineDiscount: { ...typography.body, color: colors.tealDeep, fontSize: 14 },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', paddingTop: spacing.md, marginTop: spacing.xs },
  totalLabel: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 16, flex: 1 },
  total: { ...typography.display, color: colors.waterInk, fontSize: 24, letterSpacing: -0.4 },

  photos: { marginHorizontal: -spacing.lg },

  empty: { ...typography.body, color: colors.slate, fontSize: 14, paddingVertical: spacing.sm },
  timeline: { paddingTop: spacing.xs },
  event: { flexDirection: 'row', gap: spacing.sm + 4 },
  rail: { alignItems: 'center', width: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  railLine: { flex: 1, width: 1.5, backgroundColor: colors.border, marginVertical: 3 },
  eventBody: { flex: 1, paddingBottom: spacing.md },
  eventText: { ...typography.body, color: colors.waterInk, fontSize: 14.5 },
  eventReason: { ...typography.caption, color: colors.slateDeep, fontSize: 13, fontStyle: 'italic', letterSpacing: 0, marginTop: 2 },
  eventTime: { ...typography.caption, color: colors.slate, fontSize: 12, letterSpacing: 0, marginTop: 2 },

  sellPlan: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#C7D2FE',
    backgroundColor: colors.indigoPale,
    alignItems: 'center',
    gap: 2,
  },
  sellPlanText: { ...typography.label, color: colors.indigo, fontSize: 14, fontWeight: '800' },
  sellPlanNote: { ...typography.caption, color: colors.slateDeep, fontSize: 12, letterSpacing: 0 },
  voidLink: { marginTop: spacing.xl, paddingVertical: spacing.sm, gap: 2 },
  voidLinkText: { ...typography.bodyStrong, color: colors.danger, fontSize: 15 },
  voidLinkNote: { ...typography.caption, color: colors.slate, fontSize: 12.5, letterSpacing: 0 },
  ownerNote: {
    ...typography.caption,
    color: colors.slate,
    textAlign: 'center',
    marginTop: spacing.xl,
    letterSpacing: 0,
  },
  footer: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
