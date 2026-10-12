import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { addDaysTo, formatDay, formatInr, istDay } from '@mana/domain';
import {
  BottomSheet,
  Button,
  ChoiceChips,
  Counter,
  IconCalendar,
  IconReceipt,
  Notice,
  colors,
  formatDateTime,
  radius,
  shadow,
  showAlert,
  showToast,
  spacing,
  type PillTone,
} from '@mana/ui';
import { api, send } from '../../api/client';
import { errorMessage } from '../../api/errors';
import type { PlaceOrder } from '../../api/types';
import { EdgeGroup, EdgeRow, Pill, SectionLabel } from '../../components/CardList';
import { MessageCard } from '../../components/MessageCard';
import { ScreenHeader } from '../../components/ScreenHeader';
import { usePayNow } from '../../hooks/usePayNow';
import { useRemote } from '../../hooks/useRemote';
import { usePageStyle } from '../../layout/Layout';
import type { MainStackParams } from '../../navigation/types';
import { NEEDS_PAYMENT, PHASE_LABEL, PHASE_TONE, deadlineLine, washDayLine } from '../../places/format';

type Props = NativeStackScreenProps<MainStackParams, 'Plan'>;

const PAUSE_START_CHOICES = 7;
const CANCELLABLE = new Set(['waitlist', 'awaiting_payment', 'active']);

function vehicleLine(o: PlaceOrder): string {
  return o.vehicle.registrationNumber ?? o.vehicle.typeName;
}

function partPill(status: PlaceOrder['installments'][number]['status'], dueOn: string, today: string): { label: string; tone: PillTone } {
  if (status === 'paid') return { label: 'PAID', tone: 'teal' };
  if (status === 'cancelled') return { label: 'CANCELLED', tone: 'slate' };
  if (dueOn > today) return { label: 'UPCOMING', tone: 'slate' };
  return dueOn === today ? { label: 'DUE', tone: 'amber' } : { label: 'LATE', tone: 'danger' };
}

/**
 * One vehicle's plan (or one wash): what's due, the next washes with skip and undo, pauses,
 * payment parts and receipts, and renew or cancel. Every change is checked again by the API.
 */
export function PlanScreen({ navigation, route }: Props) {
  const pageStyle = usePageStyle();
  const { orderId } = route.params;
  const remote = useRemote(() => send(api.orders[':id'].$get({ param: { id: orderId } })));
  const { pay, paying } = usePayNow();
  const [busy, setBusy] = useState<string | null>(null);
  const [pausing, setPausing] = useState(false);

  const order = remote.data?.order ?? null;
  const receipts = remote.data?.receipts ?? [];

  /** Runs one change, shows what went wrong, and reloads. */
  const act = async (key: string, run: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await run();
      if (done) showToast(done, 'success');
      await remote.reload();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const confirmCancel = (o: PlaceOrder) =>
    showAlert(
      o.kind === 'plan' ? 'Cancel this plan?' : 'Cancel this wash?',
      o.paid > 0 ? 'Washes not given yet are refunded to how you paid, as per the plan’s rules.' : 'Nothing has been paid, so nothing is charged.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel',
          style: 'destructive',
          onPress: () =>
            void act('cancel', async () => {
              const { refund } = await send(api.orders[':id'].cancel.$post({ param: { id: o.id }, json: { reason: null } }));
              showToast(refund > 0 ? `Cancelled. ${formatInr(refund)} will be refunded in 5–7 days.` : 'Cancelled.', 'success');
            }),
        },
      ],
      { plain: true },
    );

  const renew = (o: PlaceOrder) =>
    void act('renew', async () => {
      const { order: next } = await send(api.orders[':id'].renew.$post({ param: { id: o.id }, json: { payMode: o.payMode } }));
      if (!next) throw new Error('The renewed plan didn’t load. Pull down to refresh.');
      navigation.replace('Plan', { orderId: next.id });
      await pay(next.id);
    });

  if (!order) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <ScreenHeader title="Plan" onBack={() => navigation.goBack()} />
        {remote.loading ? (
          <ActivityIndicator style={styles.loading} color={colors.water} size="large" />
        ) : (
          <MessageCard
            title="Couldn’t open this plan"
            body={remote.error ?? 'Check your connection and try again.'}
            action={{ label: 'Try again', onPress: () => void remote.reload() }}
          />
        )}
      </SafeAreaView>
    );
  }

  const isPlan = order.kind === 'plan';
  const running = order.status === 'active';
  const owes = NEEDS_PAYMENT.has(order.phase);
  const payAmount = order.due?.amount ?? order.total - order.paid;
  const upcoming = [...new Set([...order.nextWashes, ...order.skipped])].sort();
  const progress = order.washesTotal ? order.washesUsed / order.washesTotal : 0;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScreenHeader title={vehicleLine(order)} onBack={() => navigation.goBack()} right={<Pill label={PHASE_LABEL[order.phase].toUpperCase()} tone={PHASE_TONE[order.phase]} />} />
      <ScrollView
        contentContainerStyle={[styles.content, pageStyle]}
        refreshControl={<RefreshControl refreshing={remote.refreshing} onRefresh={() => void remote.reload()} />}
      >
        <View style={styles.hero}>
          <Text style={styles.heroPlace}>{order.place.name ?? order.place.label}</Text>
          <Text style={styles.heroTitle}>{order.title}</Text>
          <Text style={styles.heroMeta}>
            {order.vehicle.typeName} · {formatInr(order.total)}
            {order.payMode === 'parts' ? ' in parts' : ''}
          </Text>
          {isPlan ? (
            <>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
              </View>
              <Text style={styles.heroMeta}>
                {order.washesUsed} of {order.washesTotal} washes done
                {order.lastWash ? ` · last one around ${formatDay(order.lastWash)}` : ''}
              </Text>
            </>
          ) : null}
        </View>

        <View style={styles.notices}>
          {order.status === 'cancelled' ? (
            <Notice tone="info" title="Cancelled">
              {order.refundDue > 0
                ? `${formatInr(order.refundDue)} goes back to how you paid, in 5–7 days.`
                : order.paid > 0
                  ? 'No refund was due as per the plan’s rules.'
                  : 'Nothing was charged.'}
            </Notice>
          ) : null}
          {order.memberStatus === 'pending' && CANCELLABLE.has(order.status) ? (
            <Notice tone="warning" title="Waiting for the team">
              The team will confirm your place and call you. You can pay once they do.
            </Notice>
          ) : null}
          {order.phase === 'waitlist' ? (
            <Notice tone="info" title="On the waiting list">
              The place is full on its wash days. We’ll tell you as soon as a spot opens.
            </Notice>
          ) : null}
          {owes && order.memberStatus === 'active' ? (
            <View style={styles.payCard}>
              <Text style={styles.payTitle}>
                {order.phase === 'awaiting_payment'
                  ? 'Pay before your first wash'
                  : order.phase === 'paused_unpaid'
                    ? 'Washes are paused until you pay'
                    : `Part ${order.due?.seq ?? ''} is due`}
              </Text>
              <Text style={styles.payBody}>
                {order.payBy
                  ? `Please pay by ${deadlineLine(order.payBy)} so the washer sees “Paid”.`
                  : order.due
                    ? `Due ${formatDay(order.due.dueOn)}.`
                    : 'Pay to keep your washes going.'}
              </Text>
              <Button label={`Pay ${formatInr(payAmount)}`} size="lg" loading={paying === order.id} onPress={() => void pay(order.id)} />
            </View>
          ) : null}
          {order.renewalDue ? (
            <View style={styles.payCard}>
              <Text style={styles.payTitle}>Your plan ends soon</Text>
              <Text style={styles.payBody}>
                {order.lastWash ? `The last wash is around ${formatDay(order.lastWash)}. ` : ''}Renew now to keep your wash day. Nothing is charged by itself.
              </Text>
              <Button label="Renew plan" size="lg" loading={busy === 'renew'} onPress={() => renew(order)} />
            </View>
          ) : null}
        </View>

        {upcoming.length ? (
          <>
            <SectionLabel right={isPlan && running ? `${order.skipsLeft} ${order.skipsLeft === 1 ? 'skip' : 'skips'} left` : undefined}>Next washes</SectionLabel>
            <EdgeGroup>
              {upcoming.map((day) => {
                const skipped = order.skipped.includes(day);
                const key = `skip:${day}`;
                return (
                  <EdgeRow
                    key={day}
                    icon={<IconCalendar size={18} color={colors.indigo} />}
                    title={washDayLine(day, order.place.washTime)}
                    subtitle={skipped ? 'Skipped. Not counted on your plan.' : undefined}
                    tone={skipped ? 'muted' : 'default'}
                    right={
                      isPlan && running && !order.skipClosed.includes(day) && (skipped || order.skipsLeft > 0) ? (
                        <Pressable
                          disabled={busy != null}
                          onPress={() =>
                            void act(
                              key,
                              () =>
                                skipped
                                  ? send(api.orders[':id'].unskip.$post({ param: { id: order.id }, json: { day } }))
                                  : send(api.orders[':id'].skip.$post({ param: { id: order.id }, json: { day } })),
                              skipped ? 'Wash is back on.' : `Skipped ${formatDay(day)}. Your plan moves by one wash.`,
                            )
                          }
                          hitSlop={8}
                          style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
                          accessibilityRole="button"
                        >
                          {busy === key ? (
                            <ActivityIndicator size="small" color={colors.indigo} />
                          ) : (
                            <Text style={styles.linkText}>{skipped ? 'Undo' : 'Skip'}</Text>
                          )}
                        </Pressable>
                      ) : undefined
                    }
                  />
                );
              })}
            </EdgeGroup>
          </>
        ) : null}

        {isPlan && (running || order.pauses.length) ? (
          <>
            <SectionLabel right={running ? `${order.pauseDaysLeft} ${order.pauseDaysLeft === 1 ? 'day' : 'days'} left` : undefined}>Pauses</SectionLabel>
            <EdgeGroup>
              {order.pauses.map((p) => {
                const started = p.fromOn <= istDay(new Date());
                return (
                <EdgeRow
                  key={p.id}
                  title={p.fromOn === p.toOn ? formatDay(p.fromOn) : `${formatDay(p.fromOn)} – ${formatDay(p.toOn)}`}
                  subtitle={started ? 'Paused now' : 'Coming up'}
                  right={
                    <Pressable
                      disabled={busy != null}
                      onPress={() =>
                        void act(
                          `pause:${p.id}`,
                          () => send(api.orders[':id'].pauses[':pauseId'].$delete({ param: { id: order.id, pauseId: p.id } })),
                          started ? 'Pause ended.' : 'Pause cancelled.',
                        )
                      }
                      hitSlop={8}
                      style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
                      accessibilityRole="button"
                    >
                      {busy === `pause:${p.id}` ? <ActivityIndicator size="small" color={colors.indigo} /> : <Text style={styles.linkText}>{started ? 'End' : 'Cancel'}</Text>}
                    </Pressable>
                  }
                />
                );
              })}
              {running && order.pauseDaysLeft > 0 ? (
                <EdgeRow title="Pause washes" subtitle="Going away? Your plan waits for you." onPress={() => setPausing(true)} />
              ) : null}
            </EdgeGroup>
          </>
        ) : null}

        {order.payMode === 'parts' && order.installments.length ? (
          <>
            <SectionLabel>Payment parts</SectionLabel>
            <EdgeGroup>
              {order.installments.map((i) => {
                const pill = partPill(i.status, i.dueOn, istDay(new Date()));
                return (
                  <EdgeRow
                    key={i.seq}
                    title={`Part ${i.seq} · ${formatInr(i.amount)}`}
                    subtitle={i.status === 'paid' && i.paidAt ? `Paid ${formatDateTime(i.paidAt)}` : `Due ${formatDay(i.dueOn)}`}
                    right={<Pill label={pill.label} tone={pill.tone} />}
                  />
                );
              })}
            </EdgeGroup>
          </>
        ) : null}

        {receipts.length ? (
          <>
            <SectionLabel>Receipts</SectionLabel>
            <EdgeGroup>
              {receipts.map((r) => (
                <EdgeRow
                  key={r.paymentId}
                  icon={<IconReceipt size={18} color={colors.indigo} />}
                  title={`${formatInr(r.amount)} · ${r.receiptNo}`}
                  subtitle={[r.paidAt ? formatDateTime(r.paidAt) : null, r.refunded > 0 ? `${formatInr(r.refunded)} refunded` : null]
                    .filter(Boolean)
                    .join(' · ')}
                  onPress={() => navigation.navigate('Receipt', { paymentId: r.paymentId })}
                />
              ))}
            </EdgeGroup>
          </>
        ) : null}

        <View style={styles.actions}>
          {isPlan && order.status === 'ended' ? (
            <Button label="Renew plan" size="lg" loading={busy === 'renew'} onPress={() => renew(order)} />
          ) : null}
          {CANCELLABLE.has(order.status) ? (
            <Button
              label={isPlan ? 'Cancel plan' : 'Cancel wash'}
              variant="ghost"
              loading={busy === 'cancel'}
              onPress={() => confirmCancel(order)}
            />
          ) : null}
        </View>
      </ScrollView>

      <PauseSheet
        visible={pausing}
        daysLeft={order.pauseDaysLeft}
        onClose={() => setPausing(false)}
        onPause={(fromOn, toOn) => {
          setPausing(false);
          void act(
            'pause',
            () => send(api.orders[':id'].pauses.$post({ param: { id: order.id }, json: { fromOn, toOn } })),
            `Paused ${fromOn === toOn ? formatDay(fromOn) : `${formatDay(fromOn)} – ${formatDay(toOn)}`}.`,
          );
        }}
      />
    </SafeAreaView>
  );
}

function PauseSheet({
  visible,
  daysLeft,
  onClose,
  onPause,
}: {
  visible: boolean;
  daysLeft: number;
  onClose: () => void;
  onPause: (fromOn: string, toOn: string) => void;
}) {
  const starts = useMemo(() => {
    const today = istDay(new Date());
    return Array.from({ length: PAUSE_START_CHOICES }, (_, i) => {
      const day = addDaysTo(today, i + 1);
      return { value: day, label: i === 0 ? 'Tomorrow' : formatDay(day) };
    });
    // Recomputed each time the sheet opens, so "Tomorrow" stays right past midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const [fromOn, setFromOn] = useState<string | null>(null);
  const [days, setDays] = useState(1);
  const max = Math.max(1, daysLeft);
  const toOn = fromOn ? addDaysTo(fromOn, Math.min(days, max) - 1) : null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Pause washes"
      subtitle={`Up to ${daysLeft} more days on this plan. Paused days don’t use washes.`}
      footer={
        <Button label={toOn ? `Pause till ${formatDay(toOn)}` : 'Pick a start day'} disabled={!fromOn} onPress={() => fromOn && toOn && onPause(fromOn, toOn)} />
      }
    >
      <View style={styles.sheet}>
        <ChoiceChips label="Starting" options={starts} value={fromOn} onChange={setFromOn} />
        <Counter label="Days" value={Math.min(days, max)} onChange={setDays} min={1} max={max} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: spacing.xl },
  loading: { marginTop: spacing.xl },
  hero: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: spacing.md + 2,
    gap: 6,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E9EDFC',
    ...shadow('md'),
  },
  heroPlace: { fontSize: 12.5, fontWeight: '800', letterSpacing: 0.6, color: colors.indigo, textTransform: 'uppercase' },
  heroTitle: { fontSize: 20, fontWeight: '800', color: colors.ink, letterSpacing: -0.2 },
  heroMeta: { fontSize: 13.5, color: colors.slateDeep },
  track: { height: 8, marginTop: 8, borderRadius: 4, backgroundColor: colors.indigoPale, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: colors.teal },
  notices: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  payCard: {
    padding: spacing.md,
    gap: 8,
    borderRadius: radius.lg,
    backgroundColor: colors.amberPale,
    borderWidth: 1,
    borderColor: '#F6E2A8',
  },
  payTitle: { fontSize: 16.5, fontWeight: '800', color: colors.ink },
  payBody: { fontSize: 14, lineHeight: 20, color: colors.slateDeep, marginBottom: 4 },
  link: { minWidth: 52, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.indigoPale, alignItems: 'center' },
  linkPressed: { opacity: 0.7 },
  linkText: { fontSize: 13.5, fontWeight: '800', color: colors.indigo },
  actions: { paddingHorizontal: 16, paddingTop: spacing.lg, gap: spacing.sm },
  sheet: { gap: spacing.md, paddingBottom: spacing.sm },
});
