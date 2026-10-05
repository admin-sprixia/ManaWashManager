import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import { FOUNDER_SLOTS, PLAN_LIMITS, PRO_FEATURE_LABEL, PRO_HIGHLIGHTS } from '@mana/domain';
import {
  GradientHero,
  Button,
  showAlert,
  showToast,
  IconAlert,
  IconCheck,
  IconChevronLeft,
  IconClock,
  IconReceipt,
  IconSparkle,
  IconSync,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { EdgeGroup, EdgeRow, Pill, SectionLabel } from '../components/EdgeList';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { usePlan } from '../offline/PlanProvider';
import { formatRupees } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Plan'>;
type Billing = InferResponseType<typeof api.billing.$get, 200>;
type Interval = 'monthly' | 'yearly';

/** After returning from Razorpay, ask a few times — the bank can take a few seconds to confirm. */
const CONFIRM_TRIES = 5;
const CONFIRM_GAP_MS = 2500;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function heroCopy(b: Billing): { title: string; subtitle: string } {
  const { state, endsAt, daysLeft, subscription } = b;
  if (state === 'trial') {
    return {
      title: 'Pro trial',
      subtitle: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left · ends ${endsAt ? formatDate(endsAt) : ''}`,
    };
  }
  if (state === 'grace') {
    return {
      title: 'Pro',
      subtitle: 'Your last payment didn’t go through. Razorpay is trying again.',
    };
  }
  if (state === 'pro') {
    const price =
      subscription.pricePaise != null && subscription.interval
        ? ` · ${formatRupees(subscription.pricePaise)}/${subscription.interval === 'monthly' ? 'month' : 'year'}`
        : '';
    return subscription.status === 'active'
      ? { title: 'Pro', subtitle: `Renews ${endsAt ? formatDate(endsAt) : ''}${price}` }
      : { title: 'Pro', subtitle: `Ends ${endsAt ? formatDate(endsAt) : ''} · won’t renew` };
  }
  return {
    title: 'Free',
    subtitle: `Owner + ${PLAN_LIMITS.free.staff} staff · last ${PLAN_LIMITS.free.reportDays} days of reports`,
  };
}

/** What Free keeps for good — shown next to the Pro list so trial owners know what stays. */
const FREE_FOREVER = [
  'Job board & new wash',
  'Cash & UPI payments',
  'Customer history',
  'Works offline',
  `Owner + ${PLAN_LIMITS.free.staff} staff`,
  `${PLAN_LIMITS.free.washesPerMonth ?? 0} washes a month`,
  `Last ${PLAN_LIMITS.free.reportDays ?? 0} days of reports`,
];

const washes = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? 'wash' : 'washes'}`;

export function PlanScreen({ navigation }: Props) {
  const { refreshPlan } = usePlan();
  const [data, setData] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interval, setBillingInterval] = useState<Interval>('monthly');
  const [busy, setBusy] = useState<'subscribe' | 'cancel' | 'confirm' | 'refresh' | null>(null);
  const awaitingCheckout = useRef(false);

  const load = useCallback(async (sync = false): Promise<Billing | null> => {
    try {
      const res = sync ? await api.billing.sync.$post() : await api.billing.$get();
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t load your plan.'));
        return null;
      }
      const body = await res.json();
      setData(body);
      setError(null);
      return body;
    } catch (e) {
      setError(
        e instanceof NetworkError
          ? 'Your plan needs a connection. Check mobile data or Wi-Fi.'
          : 'Couldn’t load your plan.',
      );
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Back from Razorpay's page: Pro switches on as soon as the payment is confirmed. */
  const confirmCheckout = useCallback(async () => {
    setBusy('confirm');
    try {
      for (let i = 0; i < CONFIRM_TRIES; i++) {
        const body = await load(true);
        const status = body?.subscription.status;
        if (status === 'active') {
          awaitingCheckout.current = false;
          void refreshPlan();
          showToast(
            body?.state === 'trial'
              ? 'Pro is set up. Your trial days carry on first.'
              : 'You’re on Pro. Thank you!',
          );
          return;
        }
        if (status !== 'pending') return;
        await wait(CONFIRM_GAP_MS);
      }
    } finally {
      setBusy(null);
    }
  }, [load, refreshPlan]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && awaitingCheckout.current) void confirmCheckout();
    });
    return () => sub.remove();
  }, [confirmCheckout]);

  const subscribe = async () => {
    setBusy('subscribe');
    try {
      const res = await api.billing.subscribe.$post({ json: { interval } });
      if (!res.ok) {
        showAlert(
          'Couldn’t start the upgrade',
          await apiErrorMessage(res, 'Please try again in a minute.'),
        );
        void load();
        return;
      }
      const body = await res.json();
      const openCheckout = async () => {
        awaitingCheckout.current = true;
        await Linking.openURL(body.checkoutUrl);
        void load();
      };
      // The price shown was a founder price, but the last spot went to someone else meanwhile.
      if (data?.offer.kind === 'founder' && body.kind !== 'founder') {
        const per = body.interval === 'yearly' ? 'year' : 'month';
        showAlert(
          'The last founder spot was just taken',
          `Pro for this shop is ${formatRupees(body.amountPaise)} a ${per}. Continue to payment?`,
          [
            { text: 'Not now', style: 'cancel', onPress: () => void load() },
            { text: 'Continue', onPress: () => void openCheckout() },
          ],
        );
        return;
      }
      await openCheckout();
    } catch (e) {
      showAlert(
        'Couldn’t start the upgrade',
        e instanceof NetworkError
          ? 'Upgrading needs a connection.'
          : 'Please try again in a minute.',
      );
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    const until = data?.endsAt ? formatDate(data.endsAt) : 'the end of what you’ve paid for';
    showAlert(
      'Cancel Pro?',
      `You keep Pro until ${until}. After that the shop moves to Free: nothing is deleted, and Pro features come back the moment you upgrade again.`,
      [
        { text: 'Keep Pro', style: 'cancel' },
        {
          text: 'Cancel subscription',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy('cancel');
              try {
                const res = await api.billing.cancel.$post();
                if (!res.ok) {
                  showAlert(
                    'Couldn’t cancel',
                    await apiErrorMessage(res, 'Please try again in a minute.'),
                  );
                  return;
                }
                setData(await res.json());
                void refreshPlan();
                showToast(`Cancelled. Pro stays on until ${until}.`);
              } catch {
                showAlert('Couldn’t cancel', 'Cancelling needs a connection.');
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ],
    );
  };

  const refresh = async () => {
    setBusy('refresh');
    await load(true);
    void refreshPlan();
    setBusy(null);
  };

  const hero = data ? heroCopy(data) : null;
  const status = data?.subscription.status;
  const subscribed = status === 'active' || status === 'past_due';
  const usage = data?.usage.washesThisMonth ?? 0;
  const limit = data?.limits.washesPerMonth ?? null;
  const offer = data?.offer;
  const price = offer ? (interval === 'monthly' ? offer.monthlyPaise : offer.yearlyPaise) : 0;
  const regular = offer
    ? interval === 'monthly'
      ? offer.regularMonthlyPaise
      : offer.regularYearlyPaise
    : 0;
  const perMonthOnYearly = offer ? Math.round(offer.yearlyPaise / 12 / 100) * 100 : 0;
  const carryOverIso =
    data?.state === 'trial'
      ? data.endsAt
      : status === 'cancelled' && data?.state === 'pro'
        ? data.endsAt
        : null;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={busy === 'refresh'} onRefresh={() => void refresh()} />
        }
      >
        <GradientHero>
          <View style={styles.heroContent}>
            <Pressable
              onPress={() => navigation.goBack()}
              style={({ pressed }) => [styles.back, pressed && styles.glassPressed]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <IconChevronLeft size={20} color={colors.white} />
            </Pressable>
            <Text style={styles.eyebrow}>YOUR PLAN</Text>
            {hero ? (
              <>
                <View style={styles.titleRow}>
                  <Text style={styles.heroTitle} accessibilityRole="header">
                    {hero.title}
                  </Text>
                  {data?.subscription.priceKind === 'founder' ||
                  data?.subscription.priceKind === 'branch' ? (
                    <View style={styles.glassChip}>
                      <IconSparkle size={13} color={colors.white} />
                      <Text style={styles.glassChipText}>
                        {data.subscription.priceKind === 'founder' ? 'Founder' : 'Branch'}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.heroSubtitle}>{hero.subtitle}</Text>
                <View style={styles.heroUsage}>
                  <Text style={styles.heroUsageText}>
                    {limit != null
                      ? `${usage.toLocaleString('en-IN')} of ${limit} washes used this month`
                      : `${washes(usage)} this month · unlimited`}
                  </Text>
                  {limit != null ? (
                    <View style={styles.meter}>
                      <View
                        style={[
                          styles.meterFill,
                          {
                            width: `${Math.min(100, (usage / limit) * 100)}%`,
                            backgroundColor:
                              usage >= limit
                                ? '#FCA5A5'
                                : usage / limit >= 0.8
                                  ? colors.amberLight
                                  : colors.white,
                          },
                        ]}
                      />
                    </View>
                  ) : null}
                </View>
              </>
            ) : (
              <ActivityIndicator color={colors.white} style={styles.heroSpinner} />
            )}
          </View>
        </GradientHero>

        {error && !data ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : null}

        {data ? (
          <>
            {status === 'past_due' ? (
              <Notice
                tone="amber"
                icon={<IconAlert size={18} color={colors.amberDeep} />}
                text={`Your renewal payment failed. Razorpay will retry it — keep money in the linked account or card.${data.endsAt ? ` Pro stays on until ${formatDate(data.endsAt)}.` : ''}`}
              />
            ) : status === 'pending' ? (
              <Notice
                tone="water"
                icon={<IconClock size={18} color={colors.waterDeep} />}
                text="Waiting for your payment to be confirmed. Finished paying? Tap “Check payment”. Didn’t finish? Tap Upgrade again."
                action={{
                  label: 'Check payment',
                  onPress: () => void confirmCheckout(),
                  busy: busy === 'confirm',
                }}
              />
            ) : data.state === 'trial' && (data.daysLeft ?? 99) <= 3 ? (
              <Notice
                tone="amber"
                icon={<IconClock size={18} color={colors.amberDeep} />}
                text="Your trial ends soon. Upgrade now to keep every Pro feature — you won’t be charged until the trial is over."
              />
            ) : null}

            {!subscribed ? (
              <>
                <SectionLabel>
                  {status === 'cancelled' && data.state === 'pro'
                    ? 'Keep Pro going'
                    : 'Upgrade to Pro'}
                </SectionLabel>
                <View style={styles.offer}>
                  <View style={styles.segment} accessibilityRole="tablist">
                    {(['monthly', 'yearly'] as const).map((key) => (
                      <Pressable
                        key={key}
                        onPress={() => setBillingInterval(key)}
                        style={[styles.segmentItem, interval === key && styles.segmentItemOn]}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: interval === key }}
                      >
                        <Text
                          style={[styles.segmentText, interval === key && styles.segmentTextOn]}
                        >
                          {key === 'monthly' ? 'Monthly' : 'Yearly'}
                        </Text>
                        {key === 'yearly' ? (
                          <Text
                            style={[styles.segmentSave, interval === key && styles.segmentSaveOn]}
                          >
                            2 months free
                          </Text>
                        ) : null}
                      </Pressable>
                    ))}
                  </View>

                  <View style={styles.priceRow}>
                    <Text style={styles.price}>{formatRupees(price)}</Text>
                    <Text style={styles.per}>/{interval === 'monthly' ? 'month' : 'year'}</Text>
                    {offer && offer.kind !== 'regular' ? (
                      <Text style={styles.strike}>{formatRupees(regular)}</Text>
                    ) : null}
                  </View>
                  {interval === 'yearly' ? (
                    <Text style={styles.priceNote}>
                      About {formatRupees(perMonthOnYearly)} a month
                    </Text>
                  ) : null}
                  {offer && offer.kind !== 'regular' ? (
                    <View style={styles.founder}>
                      <IconSparkle size={13} color={colors.amberDeep} />
                      <Text style={styles.founderText} numberOfLines={2}>
                        {offer.kind === 'branch'
                          ? 'Branch price · because another of your shops is on Pro'
                          : data?.subscription.founder
                            ? 'Your founder price · yours for life'
                            : `Founder price · ${offer.founderSlotsLeft} of ${FOUNDER_SLOTS} left · yours for life`}
                      </Text>
                    </View>
                  ) : null}

                  <View style={styles.cta}>
                    <Button
                      label="Upgrade with UPI AutoPay"
                      size="lg"
                      icon={<IconSparkle size={18} color={colors.white} />}
                      loading={busy === 'subscribe'}
                      disabled={!data.configured || busy != null}
                      onPress={() => void subscribe()}
                    />
                  </View>
                  <Text style={styles.fine}>
                    {!data.configured
                      ? 'Payments are being switched on. Check back soon.'
                      : `${carryOverIso ? `No charge until ${formatDate(carryOverIso)}. ` : ''}Any UPI app or card, on Razorpay’s secure page. Cancel anytime.`}
                  </Text>
                </View>
              </>
            ) : null}

            <SectionLabel>
              {data.state === 'trial' && data.endsAt
                ? `After ${formatDate(data.endsAt)}, these need Pro`
                : data.tier === 'pro'
                  ? 'Included in your plan'
                  : 'What you get with Pro'}
            </SectionLabel>
            <View style={styles.features}>
              <FeatureItem label="Unlimited washes" />
              <FeatureItem label={`Up to ${PLAN_LIMITS.pro.staff} staff`} />
              {PRO_HIGHLIGHTS.map((f) => (
                <FeatureItem key={f} label={PRO_FEATURE_LABEL[f]} />
              ))}
            </View>
            {data.state === 'trial' || data.tier !== 'pro' ? (
              <>
                <SectionLabel>Always free</SectionLabel>
                <View style={styles.features}>
                  {FREE_FOREVER.map((label) => (
                    <FeatureItem key={label} label={label} />
                  ))}
                </View>
                <Text style={styles.footnote}>
                  {data.state === 'trial'
                    ? 'Features marked PRO around the app are the ones that need Pro. Nothing is ever deleted — if you don’t upgrade, Pro features lock and come back with all their data when you do.'
                    : 'Nothing is ever deleted. Upgrade and every Pro feature comes back with all its data.'}
                </Text>
              </>
            ) : null}

            {subscribed || status === 'pending' ? (
              <>
                <SectionLabel>Subscription</SectionLabel>
                <EdgeGroup>
                  {subscribed ? (
                    <EdgeRow
                      icon={<IconSparkle size={18} color={colors.waterDeep} />}
                      title={`Pro ${data.subscription.interval === 'yearly' ? 'yearly' : 'monthly'}`}
                      subtitle={
                        data.subscription.pricePaise != null
                          ? `${formatRupees(data.subscription.pricePaise)} per ${data.subscription.interval === 'yearly' ? 'year' : 'month'}${data.subscription.paidUntil ? ` · paid until ${formatDate(data.subscription.paidUntil)}` : ''}`
                          : undefined
                      }
                      right={
                        data.subscription.priceKind === 'founder' ? (
                          <Pill label="FOUNDER" tone="amber" />
                        ) : data.subscription.priceKind === 'branch' ? (
                          <Pill label="BRANCH" tone="amber" />
                        ) : undefined
                      }
                    />
                  ) : null}
                  <EdgeRow
                    icon={<IconSync size={18} color={colors.waterDeep} />}
                    title="Check payment status"
                    subtitle="Ask Razorpay for the latest"
                    right={
                      busy === 'confirm' || busy === 'refresh' ? (
                        <ActivityIndicator color={colors.water} />
                      ) : undefined
                    }
                    chevron={false}
                    onPress={() => void refresh()}
                  />
                  <EdgeRow
                    icon={<IconAlert size={18} color={colors.danger} />}
                    iconBg="#FEE2E2"
                    title={status === 'pending' ? 'Cancel this upgrade' : 'Cancel subscription'}
                    tone="danger"
                    chevron={false}
                    disabled={busy != null}
                    onPress={cancel}
                  />
                </EdgeGroup>
              </>
            ) : null}

            {data.payments.length > 0 ? (
              <>
                <SectionLabel>Payments</SectionLabel>
                <EdgeGroup>
                  {data.payments.map((p) => (
                    <EdgeRow
                      key={p.id}
                      icon={<IconReceipt size={18} color={colors.waterDeep} />}
                      title={formatRupees(p.amountPaise)}
                      subtitle={`${formatDate(p.paidAt)}${p.method ? ` · ${p.method.toUpperCase()}` : ''}${p.periodEnd ? ` · Pro until ${formatDate(p.periodEnd)}` : ''}`}
                      right={
                        <Pill
                          label={
                            p.status === 'captured'
                              ? 'PAID'
                              : p.status === 'refunded'
                                ? 'REFUNDED'
                                : 'FAILED'
                          }
                          tone={
                            p.status === 'captured'
                              ? 'teal'
                              : p.status === 'refunded'
                                ? 'slate'
                                : 'danger'
                          }
                        />
                      }
                    />
                  ))}
                </EdgeGroup>
              </>
            ) : null}

            <Text style={styles.legal}>
              Payments by Razorpay. MANA never sees your UPI PIN or card.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function FeatureItem({ label }: { label: string }) {
  return (
    <View style={styles.featureItem}>
      <View style={styles.tick}>
        <IconCheck size={11} color={colors.tealDeep} />
      </View>
      <Text style={styles.featureText} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function Notice({
  tone,
  icon,
  text,
  action,
}: {
  tone: 'amber' | 'water';
  icon: React.ReactNode;
  text: string;
  action?: { label: string; onPress: () => void; busy?: boolean };
}) {
  return (
    <View style={[styles.notice, tone === 'amber' ? styles.noticeAmber : styles.noticeWater]}>
      {icon}
      <View style={styles.noticeCopy}>
        <Text style={[styles.noticeText, tone === 'amber' && { color: colors.amberDeep }]}>
          {text}
        </Text>
        {action ? (
          <Pressable
            onPress={action.onPress}
            hitSlop={6}
            disabled={action.busy}
            style={styles.noticeAction}
          >
            {action.busy ? (
              <ActivityIndicator color={colors.water} size="small" />
            ) : (
              <Text style={styles.noticeActionText}>{action.label}</Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const glass = {
  backgroundColor: 'rgba(255,255,255,0.16)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.3)',
};

const textShadow = {
  textShadowColor: 'rgba(8,47,73,0.25)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingBottom: spacing.xxl },
  heroContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
  back: {
    ...glass,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassPressed: { backgroundColor: 'rgba(255,255,255,0.3)' },
  eyebrow: {
    ...typography.label,
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 1.6,
    marginTop: spacing.md,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, marginTop: 4 },
  heroTitle: {
    ...typography.display,
    color: colors.white,
    fontSize: 34,
    lineHeight: 40,
    ...textShadow,
  },
  heroSubtitle: {
    ...typography.body,
    color: 'rgba(255,255,255,0.94)',
    fontSize: 15,
    lineHeight: 21,
    marginTop: 4,
    ...textShadow,
  },
  heroSpinner: { alignSelf: 'flex-start', marginTop: spacing.md, marginBottom: spacing.md },
  glassChip: {
    ...glass,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  glassChipText: { ...typography.label, color: colors.white, fontSize: 12 },
  errorBox: { padding: spacing.lg, gap: spacing.md },
  errorText: { ...typography.body, color: colors.danger },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noticeAmber: { backgroundColor: '#FFFBEB', borderColor: colors.amberLight },
  noticeWater: { backgroundColor: colors.waterPale, borderColor: colors.border },
  noticeCopy: { flex: 1, gap: spacing.sm },
  noticeText: { ...typography.body, color: colors.waterDeep, fontSize: 14, lineHeight: 20 },
  noticeAction: { alignSelf: 'flex-start' },
  noticeActionText: {
    ...typography.label,
    color: colors.waterDeep,
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  heroUsage: { marginTop: spacing.md, gap: 6 },
  heroUsageText: {
    ...typography.label,
    color: colors.white,
    fontSize: 13,
    textTransform: 'none',
    ...textShadow,
  },
  meter: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  meterFill: { height: 6, borderRadius: 3 },
  offer: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 7,
    borderRadius: radius.sm,
    gap: 1,
  },
  segmentItemOn: { backgroundColor: colors.waterInk },
  segmentText: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  segmentTextOn: { color: colors.white },
  segmentSave: { ...typography.caption, color: colors.teal, fontSize: 11 },
  segmentSaveOn: { color: colors.tealLight },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: spacing.md },
  price: { ...typography.display, color: colors.waterInk, fontSize: 34 },
  per: { ...typography.body, color: colors.slateDeep, fontSize: 17 },
  strike: {
    ...typography.body,
    color: colors.slate,
    fontSize: 17,
    textDecorationLine: 'line-through',
    marginLeft: spacing.sm,
  },
  priceNote: { ...typography.body, color: colors.slateDeep, fontSize: 14, marginTop: 2 },
  founder: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#FFFBEB',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: spacing.sm,
  },
  founderText: {
    ...typography.label,
    color: colors.amberDeep,
    fontSize: 12,
    textTransform: 'none',
    flexShrink: 1,
  },
  cta: { marginTop: spacing.md },
  fine: {
    ...typography.caption,
    color: colors.slateDeep,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.sm + 4,
    letterSpacing: 0,
  },
  features: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  featureItem: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    paddingRight: spacing.sm,
  },
  tick: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    ...typography.body,
    color: colors.waterInk,
    fontSize: 13.5,
    lineHeight: 18,
    flex: 1,
  },
  footnote: {
    ...typography.caption,
    color: colors.slateDeep,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    letterSpacing: 0,
    lineHeight: 17,
  },
  legal: {
    ...typography.caption,
    color: colors.slate,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    letterSpacing: 0,
  },
});
