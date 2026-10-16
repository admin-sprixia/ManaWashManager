import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Circle, G, Path } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import { PROBLEM_KIND_LABELS, STAR_LABELS } from '@mana/domain';
import {
  Avatar,
  BottomSheet,
  BRAND_MARK,
  brandGradients,
  Button,
  IconAlert,
  IconCar,
  IconCheck,
  IconCloudOff,
  IconFilter,
  IconPhone,
  IconStar,
  ScreenContainer,
  ScreenHeader,
  colors,
  formatDateTime,
  formatPhone,
  formatRupees,
  radius,
  shadow,
  showAlert,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useSync } from '../offline/SyncProvider';
import { ReasonSheet } from '../components/ReasonSheet';
import { useShop } from '../offline/ShopProvider';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'AppFeedback'>;
type Tab = 'problems' | 'vehicles' | 'ratings';
type Problem = InferResponseType<(typeof api)['app-feedback']['problems']['$get'], 200>['problems'][number];
type VehicleRequest = InferResponseType<(typeof api)['app-feedback']['vehicles']['$get'], 200>['requests'][number];
type RatingsBody = InferResponseType<(typeof api)['app-feedback']['ratings']['$get'], 200>;
type Rating = RatingsBody['ratings'][number];

/** Amber when something needs the team; teal when the inbox is clear. */
const HERO_OPEN = ['#F59E0B', '#D97706', '#92400E'] as const;
const HERO_CLEAR = ['#0F766E', '#0B4F4A', '#062B28'] as const;

const STARS = [
  [24, 26, 1.2, 0.5],
  [88, 12, 0.9, 0.4],
  [150, 40, 1.1, 0.3],
  [214, 18, 1.2, 0.45],
  [40, 86, 0.8, 0.3],
  [190, 96, 1, 0.3],
  [118, 132, 0.9, 0.25],
] as const;

const CARD_SHADOW = {
  shadowColor: '#0C1442',
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

const RESOLVE_NOTES = [
  'Called them and sorted it out',
  'Re-washed the vehicle free',
  'Refunded the difference',
  'Apologised; will take care next time',
];
const VEHICLE_DECLINE_REASONS = [
  'We haven’t washed this vehicle yet',
  'This vehicle belongs to someone else',
  'The registration number looks wrong',
];

function failure(err: unknown): string {
  return err instanceof NetworkError ? 'No connection. Pull down to try again.' : (err as Error).message;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function customerLabel(c: { name: string | null; phone: string }) {
  return c.name ? `${c.name} · +91 ${formatPhone(c.phone)}` : `+91 ${formatPhone(c.phone)}`;
}

function customerName(c: { name: string | null; phone: string }) {
  return c.name || `+91 ${formatPhone(c.phone)}`;
}

const callCustomer = (phone: string) => void Linking.openURL(`tel:+91${phone}`).catch(() => undefined);

function Stars({ value, size = 15 }: { value: number; size?: number }) {
  return (
    <View style={styles.stars} accessibilityLabel={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <IconStar key={s} size={size} color={s <= value ? colors.amber : '#E2E8F0'} filled={s <= value} />
      ))}
    </View>
  );
}

function Fact({ label }: { label: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function ProblemCard({ problem, onResolve, first }: { problem: Problem; onResolve: () => void; first?: boolean }) {
  const open = problem.status === 'open';
  return (
    <View style={[styles.card, first && styles.cardFirst]}>
      {open ? <View style={[styles.accent, { backgroundColor: colors.danger }]} /> : null}
      <View style={styles.cardBody}>
        <View style={styles.cardHead}>
          <Avatar name={customerName(problem.customer)} id={problem.customer.phone} size={44} />
          <View style={styles.who}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {PROBLEM_KIND_LABELS[problem.kind] ?? 'Problem'}
              </Text>
              <View style={[styles.badge, open ? styles.badgeOpen : styles.badgeDone]}>
                <Text style={[styles.badgeText, { color: open ? colors.danger : colors.tealDeep }]}>
                  {open ? 'Open' : 'Resolved'}
                </Text>
              </View>
            </View>
            <Text style={styles.subline} numberOfLines={1}>
              {customerLabel(problem.customer)}
            </Text>
          </View>
        </View>

        <View style={styles.quote}>
          <Text style={styles.quoteText}>“{problem.details}”</Text>
        </View>

        <View style={styles.facts}>
          {problem.wash ? (
            <>
              <Fact label={problem.wash.registrationNumber} />
              <Fact label={formatRupees(problem.wash.total)} />
              {problem.wash.washers.length ? <Fact label={problem.wash.washers.join(', ')} /> : null}
            </>
          ) : (
            <Fact label="About the branch" />
          )}
        </View>

        <Text style={styles.meta}>
          Reported {formatDateTime(problem.createdAt)}
          {problem.wash ? ` · wash ${formatDateTime(problem.wash.createdAt)}` : ''}
        </Text>
        {problem.resolution ? (
          <Text style={styles.resolution}>
            {problem.resolvedBy ? `${problem.resolvedBy.name}: ` : ''}
            {problem.resolution}
          </Text>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Pressable
          onPress={() => callCustomer(problem.customer.phone)}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Call the customer"
        >
          <IconPhone size={16} color={colors.indigo} />
        </Pressable>
        {open ? (
          <Pressable onPress={onResolve} style={({ pressed }) => [pressed && styles.pressed]} accessibilityRole="button">
            <LinearGradient
              colors={brandGradients.primary.colors as unknown as string[]}
              start={brandGradients.primary.start}
              end={brandGradients.primary.end}
              style={styles.primaryBtn}
            >
              <IconCheck size={14} color={colors.white} />
              <Text style={styles.primaryBtnText}>Mark resolved</Text>
            </LinearGradient>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function VehicleCard({
  request,
  busy,
  onApprove,
  onDecline,
  first,
}: {
  request: VehicleRequest;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
  first?: boolean;
}) {
  const pending = request.status === 'pending';
  const makeModel = [request.make, request.model].filter(Boolean).join(' ');
  const statusFg =
    request.status === 'approved' ? colors.tealDeep : request.status === 'rejected' ? colors.danger : colors.indigo;
  const statusBg =
    request.status === 'approved' ? '#CCFBF1' : request.status === 'rejected' ? '#FEE2E2' : colors.indigoPale;
  const statusLabel =
    request.status === 'approved' ? 'Added' : request.status === 'rejected' ? 'Declined' : 'Waiting';

  return (
    <View style={[styles.card, first && styles.cardFirst]}>
      {pending ? <View style={[styles.accent, { backgroundColor: colors.amber }]} /> : null}
      <View style={styles.cardBody}>
        <View style={styles.cardHead}>
          <View style={[styles.plateAvatar, { backgroundColor: statusBg }]}>
            <IconCar size={18} color={statusFg} />
          </View>
          <View style={styles.who}>
            <View style={styles.nameRow}>
              <Text style={styles.plate} numberOfLines={1}>
                {request.registrationNumber}
              </Text>
              <View style={[styles.badge, { backgroundColor: statusBg }]}>
                <Text style={[styles.badgeText, { color: statusFg }]}>{statusLabel}</Text>
              </View>
            </View>
            <Text style={styles.subline} numberOfLines={1}>
              {[request.type.name, makeModel].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>

        <Text style={styles.where} numberOfLines={1}>
          For {customerLabel(request.customer)}
        </Text>

        {request.currentOwner ? (
          <View style={styles.warnBand}>
            <IconAlert size={14} color={colors.amberDeep} />
            <Text style={styles.warnText}>
              With {request.currentOwner.name ?? `+91 ${formatPhone(request.currentOwner.phone)}`} today — approving
              moves it.
            </Text>
          </View>
        ) : null}

        <Text style={styles.meta}>
          Asked {formatDateTime(request.createdAt)}
          {request.handledBy
            ? ` · ${request.status === 'approved' ? 'added' : 'declined'} by ${request.handledBy.name}`
            : ''}
        </Text>
        {request.reason ? <Text style={styles.reason}>{request.reason}</Text> : null}
      </View>

      <View style={styles.footer}>
        <Pressable
          onPress={() => callCustomer(request.customer.phone)}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Call the customer"
        >
          <IconPhone size={16} color={colors.indigo} />
        </Pressable>
        {pending ? (
          <View style={styles.decide}>
            <Pressable
              onPress={onDecline}
              disabled={busy}
              style={({ pressed }) => [styles.declineBtn, busy && styles.btnOff, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.declineText}>Decline</Text>
            </Pressable>
            <Pressable
              onPress={onApprove}
              disabled={busy}
              style={({ pressed }) => [pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <LinearGradient
                colors={brandGradients.primary.colors as unknown as string[]}
                start={brandGradients.primary.start}
                end={brandGradients.primary.end}
                style={styles.primaryBtn}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <>
                    <IconCheck size={14} color={colors.white} />
                    <Text style={styles.primaryBtnText}>Add vehicle</Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function RatingCard({ rating, first }: { rating: Rating; first?: boolean }) {
  const low = rating.stars <= 2;
  return (
    <View style={[styles.card, first && styles.cardFirst]}>
      {low ? <View style={[styles.accent, { backgroundColor: colors.danger }]} /> : null}
      <View style={styles.cardBody}>
        <View style={styles.cardHead}>
          <Avatar name={customerName(rating.customer)} id={rating.customer.phone} size={44} />
          <View style={styles.who}>
            <View style={styles.nameRow}>
              <Stars value={rating.stars} />
              <Text style={styles.starLabel}>{STAR_LABELS[rating.stars]}</Text>
            </View>
            <Text style={styles.subline} numberOfLines={1}>
              {customerLabel(rating.customer)}
            </Text>
          </View>
        </View>

        {rating.comment ? (
          <View style={styles.quote}>
            <Text style={styles.quoteText}>“{rating.comment}”</Text>
          </View>
        ) : null}

        <View style={styles.facts}>
          <Fact label={rating.registrationNumber} />
          {rating.washers.length ? <Fact label={rating.washers.join(', ')} /> : null}
        </View>

        <Text style={styles.meta}>Washed {formatDateTime(rating.washedAt)}</Text>
      </View>
    </View>
  );
}

function RatingSummary({ last30 }: { last30: RatingsBody['last30'] }) {
  if (!last30.count || last30.average == null) return null;
  const max = Math.max(...last30.byStars, 1);
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryLeft}>
        <Text style={styles.average}>{last30.average.toFixed(1)}</Text>
        <Stars value={Math.round(last30.average)} size={14} />
        <Text style={styles.meta}>
          {last30.count} {last30.count === 1 ? 'rating' : 'ratings'} · 30 days
        </Text>
      </View>
      <View style={styles.flex}>
        {[5, 4, 3, 2, 1].map((s) => (
          <View key={s} style={styles.barRow}>
            <Text style={styles.barLabel}>{s}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${(last30.byStars[s - 1]! / max) * 100}%` }]} />
            </View>
            <Text style={styles.barCount}>{last30.byStars[s - 1]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * What customers send from the Mana Wash app: problems to sort out, vehicles to add, and
 * how they rated their washes. The whole team can act on them.
 */
export function AppFeedbackScreen({ navigation, route }: Props) {
  const { online } = useSync();
  const { customerApp, refresh: refreshShop } = useShop();
  const [tab, setTab] = useState<Tab>(route.params?.tab ?? 'problems');
  const [showDone, setShowDone] = useState(false);
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [vehicles, setVehicles] = useState<VehicleRequest[] | null>(null);
  const [ratings, setRatings] = useState<RatingsBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolving, setResolving] = useState<Problem | null>(null);
  const [declining, setDeclining] = useState<VehicleRequest | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const openProblems = customerApp.openProblems;
  const pendingVehicles = customerApp.pendingVehicles;
  const needsAction = openProblems + pendingVehicles > 0;

  const load = useCallback(
    async (pull = false) => {
      if (pull) setRefreshing(true);
      try {
        const ratingsReq = api['app-feedback'].ratings.$get({ query: {} });
        if (tab === 'problems') {
          const res = await api['app-feedback'].problems.$get({ query: { filter: showDone ? 'resolved' : 'open' } });
          if (!res.ok) throw new Error(await apiErrorMessage(res));
          setProblems((await res.json()).problems);
        } else if (tab === 'vehicles') {
          const res = await api['app-feedback'].vehicles.$get({
            query: { filter: showDone ? 'handled' : 'pending' },
          });
          if (!res.ok) throw new Error(await apiErrorMessage(res));
          setVehicles((await res.json()).requests);
        }
        const ratingsRes = await ratingsReq;
        if (ratingsRes.ok) setRatings(await ratingsRes.json());
        else if (tab === 'ratings') throw new Error(await apiErrorMessage(ratingsRes));
        setError(null);
      } catch (err) {
        setError(failure(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tab, showDone],
  );

  useEffect(() => {
    // Keep the hero steady — only spin the list when this tab has never loaded.
    const already =
      tab === 'problems' ? problems != null : tab === 'vehicles' ? vehicles != null : ratings != null;
    if (!already) setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the query (load) changes
  }, [load]);

  const done = async (message: string) => {
    showToast(message);
    await load();
    void refreshShop();
  };

  const resolve = async (note: string): Promise<string | null> => {
    if (!resolving) return null;
    try {
      const res = await api['app-feedback'].problems[':id'].resolve.$post({
        param: { id: resolving.id },
        json: { resolution: note },
      });
      if (!res.ok) return apiErrorMessage(res);
      setResolving(null);
      await done('Marked resolved');
      return null;
    } catch (err) {
      return err instanceof NetworkError ? 'No connection. Try again.' : 'Something went wrong.';
    }
  };

  const approveVehicle = (r: VehicleRequest) =>
    showAlert(
      `Add ${r.registrationNumber}?`,
      r.currentOwner
        ? 'It moves to this customer. Past washes stay with whoever brought it in.'
        : 'It’s added to this customer, and shows in their app.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Add vehicle',
          onPress: () => {
            void (async () => {
              setBusyId(r.id);
              try {
                const res = await api['app-feedback'].vehicles[':id'].approve.$post({ param: { id: r.id } });
                if (!res.ok) throw new Error(await apiErrorMessage(res));
                await done(`${r.registrationNumber} added`);
              } catch (err) {
                showToast(failure(err), 'error');
              } finally {
                setBusyId(null);
              }
            })();
          },
        },
      ],
      { icon: <IconCar size={26} color={colors.teal} /> },
    );

  const declineVehicle = async (reason: string): Promise<string | null> => {
    if (!declining) return null;
    try {
      const res = await api['app-feedback'].vehicles[':id'].reject.$post({
        param: { id: declining.id },
        json: { reason },
      });
      if (!res.ok) return apiErrorMessage(res);
      setDeclining(null);
      await done('Request declined');
      return null;
    } catch (err) {
      return err instanceof NetworkError ? 'No connection. Try again.' : 'Something went wrong.';
    }
  };

  const g = brandGradients.hero;
  // Inbox colour only — never flips with tab switches or loading.
  const heroColors = (needsAction ? HERO_OPEN : HERO_CLEAR) as unknown as string[];
  const heroValue = needsAction
    ? `${plural(openProblems + pendingVehicles, 'item')} waiting`
    : 'Inbox clear';
  const heroMeta = needsAction
    ? [
        openProblems ? plural(openProblems, 'problem') : null,
        pendingVehicles ? plural(pendingVehicles, 'vehicle') : null,
      ]
        .filter(Boolean)
        .join(' · ') + ' from the Mana Wash app'
    : 'Problems, vehicle requests and ratings from customers land here.';

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'problems', label: 'Problems', count: openProblems },
    { key: 'vehicles', label: 'Vehicles', count: pendingVehicles },
    { key: 'ratings', label: 'Ratings', count: ratings?.last30.count ?? 0 },
  ];

  const statusFilterOptions =
    tab === 'problems'
      ? [
          { key: false as const, label: 'Open', hint: openProblems ? `${plural(openProblems, 'problem')} waiting` : 'Nothing waiting' },
          { key: true as const, label: 'Resolved', hint: 'Problems you’ve already sorted out' },
        ]
      : [
          { key: false as const, label: 'Waiting', hint: pendingVehicles ? `${plural(pendingVehicles, 'vehicle')} to add` : 'Nothing waiting' },
          { key: true as const, label: 'Handled', hint: 'Added or declined vehicles' },
        ];
  const statusFilterLabel = statusFilterOptions.find((o) => o.key === showDone)?.label ?? 'Open';

  const empty = (() => {
    if (loading) return <ActivityIndicator color={colors.indigo} style={styles.loading} />;
    if (error) {
      return (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <IconAlert size={28} color={colors.indigo} />
          </View>
          <Text style={styles.emptyTitle}>Couldn’t load</Text>
          <Text style={styles.emptyBody}>{error}</Text>
          <Button label="Try again" onPress={() => void load()} />
        </View>
      );
    }
    const copy =
      tab === 'problems'
        ? {
            title: showDone ? 'Nothing resolved yet' : 'No open problems',
            body: 'When a customer reports a problem in the Mana Wash app, it shows here.',
            icon: <IconAlert size={28} color={showDone ? colors.indigo : colors.tealDeep} />,
            bg: showDone ? colors.indigoPale : '#CCFBF1',
          }
        : tab === 'vehicles'
          ? {
              title: showDone ? 'Nothing handled yet' : 'No vehicles to add',
              body: 'Customers can ask to add a vehicle in the app. Add it once you’ve seen it.',
              icon: <IconCar size={28} color={colors.indigo} />,
              bg: colors.indigoPale,
            }
          : {
              title: 'No ratings yet',
              body: 'Customers can rate a wash in the app after paying.',
              icon: <IconStar size={28} color={colors.amberDeep} />,
              bg: '#FEF3C7',
            };
    return (
      <View style={styles.emptyCard}>
        <View style={[styles.emptyIcon, { backgroundColor: copy.bg }]}>{copy.icon}</View>
        <Text style={styles.emptyTitle}>{copy.title}</Text>
        <Text style={styles.emptyBody}>{copy.body}</Text>
      </View>
    );
  })();

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => void load(true)}
      tintColor={colors.indigo}
      colors={[colors.indigo]}
    />
  );

  const ratingsHeader =
    tab === 'ratings' && ratings ? (
      <View style={styles.ratingsHead}>
        <RatingSummary last30={ratings.last30} />
      </View>
    ) : null;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader
          title="Customer feedback"
          onBack={() => navigation.goBack()}
          right={
            tab !== 'ratings' ? (
              <Pressable
                onPress={() => setFilterOpen(true)}
                style={({ pressed }) => [styles.filterBtn, showDone && styles.filterBtnOn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Filter: ${statusFilterLabel}. Change`}
              >
                <IconFilter size={18} color={showDone ? colors.white : colors.indigo} />
                {showDone ? <View style={styles.filterDot} /> : null}
              </Pressable>
            ) : undefined
          }
        />
      </View>

      {/* Hero + tabs stay mounted — only the list below changes with the tab. */}
      <View style={styles.topBlock}>
        <LinearGradient
          colors={heroColors}
          locations={g.locations as unknown as number[]}
          start={g.start}
          end={g.end}
          style={[styles.hero, shadow('md')]}
        >
          <Svg
            style={StyleSheet.absoluteFill}
            width="100%"
            height="100%"
            viewBox="0 0 340 200"
            preserveAspectRatio="xMidYMid slice"
          >
            {STARS.map(([x, y, r, o]) => (
              <Circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#FFFFFF" fillOpacity={o} />
            ))}
          </Svg>
          <Svg style={styles.heroMark} width={150} height={150} viewBox="0 0 256 256">
            <G>
              <Path d={BRAND_MARK.drop} fill="#FFFFFF" fillOpacity={0.07} />
              <Path d={BRAND_MARK.arms} fill="#FFFFFF" fillOpacity={0.1} />
              <Path d={BRAND_MARK.centre} fill="#FFFFFF" fillOpacity={0.15} />
            </G>
          </Svg>
          <Text style={styles.heroEyebrow}>From the Mana Wash app</Text>
          <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
            {heroValue}
          </Text>
          <Text style={styles.heroMeta}>{heroMeta}</Text>
          <View style={styles.heroChips}>
            {[
              { label: 'Problems', value: openProblems, dot: openProblems > 0 ? '#FCA5A5' : null },
              { label: 'Vehicles', value: pendingVehicles, dot: pendingVehicles > 0 ? colors.amberLight : null },
              {
                label: 'Avg · 30d',
                value: ratings?.last30.average != null ? ratings.last30.average.toFixed(1) : '—',
                dot: null as string | null,
              },
            ].map((c) => (
              <View key={c.label} style={styles.heroChip}>
                <View style={styles.heroChipTop}>
                  {c.dot ? <View style={[styles.heroDot, { backgroundColor: c.dot }]} /> : null}
                  <Text style={styles.heroChipLabel}>{c.label}</Text>
                </View>
                <Text style={styles.heroChipValue}>{c.value}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        {!online ? (
          <View style={styles.notice}>
            <IconCloudOff size={15} color={colors.amberDeep} />
            <Text style={styles.noticeText}>Offline — pull to refresh when you’re back online.</Text>
          </View>
        ) : error && !loading ? (
          <View style={styles.notice}>
            <IconCloudOff size={15} color={colors.amberDeep} />
            <Text style={styles.noticeText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.tabs}>
          {tabs.map((t) => {
            const on = tab === t.key;
            const showCount = t.key !== 'ratings' && t.count > 0;
            return (
              <Pressable
                key={t.key}
                onPress={() => {
                  setTab(t.key);
                  setShowDone(false);
                }}
                style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && !on && styles.pressed]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
                  {t.label}
                  {showCount ? ` · ${t.count}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {tab === 'problems' ? (
        <FlatList
          data={loading ? [] : (problems ?? [])}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={empty}
          renderItem={({ item, index }) => (
            <ProblemCard problem={item} first={index === 0} onResolve={() => setResolving(item)} />
          )}
          refreshControl={refreshControl}
        />
      ) : tab === 'vehicles' ? (
        <FlatList
          data={loading ? [] : (vehicles ?? [])}
          keyExtractor={(v) => v.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={empty}
          renderItem={({ item, index }) => (
            <VehicleCard
              request={item}
              first={index === 0}
              busy={busyId === item.id}
              onApprove={() => approveVehicle(item)}
              onDecline={() => setDeclining(item)}
            />
          )}
          refreshControl={refreshControl}
        />
      ) : (
        <FlatList
          data={loading ? [] : (ratings?.ratings ?? [])}
          keyExtractor={(r) => r.washId}
          contentContainerStyle={styles.list}
          ListHeaderComponent={ratingsHeader}
          ListEmptyComponent={empty}
          renderItem={({ item, index }) => <RatingCard rating={item} first={index === 0} />}
          refreshControl={refreshControl}
        />
      )}
      <ReasonSheet
        visible={resolving != null}
        title="Mark as resolved"
        subtitle="The customer sees this note in the app."
        confirmLabel="Mark resolved"
        confirmVariant="primary"
        placeholder="What did you do?"
        quickReasons={RESOLVE_NOTES}
        onClose={() => setResolving(null)}
        onConfirm={resolve}
      />
      <ReasonSheet
        visible={declining != null}
        title={`Decline ${declining?.registrationNumber ?? ''}?`}
        subtitle="The customer sees this reason in the app."
        confirmLabel="Decline"
        quickReasons={VEHICLE_DECLINE_REASONS}
        onClose={() => setDeclining(null)}
        onConfirm={declineVehicle}
      />
      <BottomSheet
        visible={filterOpen && tab !== 'ratings'}
        onClose={() => setFilterOpen(false)}
        title="Show"
        subtitle={tab === 'problems' ? 'Which problems to list' : 'Which vehicle requests to list'}
      >
        <View style={styles.filterList}>
          {statusFilterOptions.map((o, i) => {
            const on = showDone === o.key;
            return (
              <Pressable
                key={o.label}
                onPress={() => {
                  setShowDone(o.key);
                  setFilterOpen(false);
                }}
                style={({ pressed }) => [
                  styles.filterRow,
                  i > 0 && styles.filterRowDivider,
                  on && styles.filterRowOn,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <View style={styles.flex}>
                  <Text style={[styles.filterRowLabel, on && styles.filterRowLabelOn]}>{o.label}</Text>
                  <Text style={styles.filterRowHint}>{o.hint}</Text>
                </View>
                <View style={[styles.filterRadio, on && styles.filterRadioOn]}>
                  {on ? <IconCheck size={12} color={colors.white} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  topBlock: { paddingHorizontal: spacing.md, gap: spacing.md, paddingBottom: spacing.md },
  list: { paddingBottom: spacing.xxl, flexGrow: 1 },
  ratingsHead: { marginBottom: spacing.md, marginHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  pressed: { opacity: 0.75 },
  btnOff: { opacity: 0.45 },
  flex: { flex: 1 },
  filterBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.indigoPale,
  },
  filterBtnOn: { backgroundColor: colors.indigo },
  filterDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.amberLight,
    borderWidth: 1.5,
    borderColor: colors.indigo,
  },
  filterList: {
    marginHorizontal: -spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 6,
  },
  filterRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  filterRowOn: { backgroundColor: '#F0F9FF' },
  filterRowLabel: { ...typography.bodyStrong, color: colors.waterInk },
  filterRowLabelOn: { color: colors.waterDeep },
  filterRowHint: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  filterRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRadioOn: { backgroundColor: colors.water, borderColor: colors.water },

  hero: {
    borderRadius: radius.xl,
    padding: spacing.md + 2,
    gap: 4,
    overflow: 'hidden',
  },
  heroMark: { position: 'absolute', right: -22, top: -14 },
  heroEyebrow: { ...typography.label, fontSize: 14, color: 'rgba(255,255,255,0.88)' },
  heroValue: {
    ...typography.display,
    fontSize: 34,
    color: colors.white,
    letterSpacing: -0.8,
  },
  heroMeta: { ...typography.label, fontSize: 13.5, color: 'rgba(255,255,255,0.9)', lineHeight: 19 },
  heroChips: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  heroChip: {
    flex: 1,
    padding: spacing.sm + 2,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  heroChipTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroDot: { width: 7, height: 7, borderRadius: 4 },
  heroChipLabel: { ...typography.caption, fontSize: 11, color: 'rgba(255,255,255,0.75)', letterSpacing: 0.3 },
  heroChipValue: { ...typography.bodyStrong, fontSize: 18, color: colors.white, fontWeight: '800', marginTop: 2 },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: 14,
    backgroundColor: colors.amberPale,
    borderWidth: 1,
    borderColor: colors.amberLight,
  },
  noticeText: { ...typography.caption, flex: 1, fontSize: 12.5, color: colors.amberDeep, letterSpacing: 0 },

  tabs: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tab: { flex: 1, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabOn: { backgroundColor: colors.indigo },
  tabText: { ...typography.label, fontSize: 12.5, color: colors.slateDeep },
  tabTextOn: { color: colors.white, fontWeight: '800' },

  emptyCard: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderRadius: 22,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    ...CARD_SHADOW,
  },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.indigoPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { ...typography.heading, fontSize: 18, color: colors.ink },
  emptyBody: {
    ...typography.body,
    fontSize: 13.5,
    color: colors.slateDeep,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },

  card: {
    backgroundColor: colors.white,
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardFirst: { borderTopWidth: StyleSheet.hairlineWidth },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  cardBody: { padding: spacing.md, paddingLeft: spacing.md + 4, gap: spacing.sm + 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  who: { flex: 1, gap: 3, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: {
    ...typography.bodyStrong,
    flexShrink: 1,
    fontSize: 15.5,
    color: colors.waterInk,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  plate: {
    ...typography.bodyStrong,
    flexShrink: 1,
    fontSize: 16.5,
    color: colors.waterInk,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  plateAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { borderRadius: radius.pill, paddingHorizontal: 9, height: 22, justifyContent: 'center', flexShrink: 0 },
  badgeOpen: { backgroundColor: '#FEE2E2' },
  badgeDone: { backgroundColor: '#CCFBF1' },
  badgeText: { ...typography.caption, fontSize: 11, fontWeight: '800', letterSpacing: 0 },
  subline: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0 },
  where: { ...typography.body, fontSize: 13.5, color: colors.slateDeep, lineHeight: 19 },

  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.indigoMist,
    paddingLeft: spacing.sm + 2,
    paddingVertical: 2,
  },
  quoteText: { ...typography.body, fontSize: 14.5, color: colors.waterInk, lineHeight: 21, fontStyle: 'italic' },

  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fact: {
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    maxWidth: '100%',
  },
  factText: { ...typography.label, fontSize: 12.5, color: colors.slateDeep, fontWeight: '600' },
  meta: { ...typography.caption, color: colors.slate, letterSpacing: 0, fontSize: 12.5 },
  resolution: { ...typography.caption, fontSize: 12.5, color: colors.tealDeep, fontWeight: '600', letterSpacing: 0 },
  reason: { ...typography.caption, fontSize: 12.5, color: colors.danger, fontWeight: '700', letterSpacing: 0 },

  warnBand: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: spacing.sm + 2,
    borderRadius: 14,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  warnText: { ...typography.caption, flex: 1, fontSize: 12.5, color: colors.amberDeep, letterSpacing: 0, lineHeight: 17 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: '#FAFBFF',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.indigoPale,
  },
  decide: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  declineBtn: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
  },
  declineText: { ...typography.label, color: colors.danger, fontWeight: '700', fontSize: 13.5 },
  primaryBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minWidth: 120,
  },
  primaryBtnText: { ...typography.label, color: colors.white, fontWeight: '800', fontSize: 13.5 },

  stars: { flexDirection: 'row', gap: 2 },
  starLabel: { ...typography.caption, fontSize: 12, color: colors.amberDeep, fontWeight: '700', letterSpacing: 0 },

  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: 22,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...CARD_SHADOW,
  },
  summaryLeft: { alignItems: 'center', gap: 4, minWidth: 72 },
  average: { ...typography.display, color: colors.waterInk, fontSize: 36, letterSpacing: -1 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 18 },
  barLabel: { ...typography.caption, color: colors.slateDeep, width: 10, letterSpacing: 0, fontWeight: '700' },
  barTrack: { flex: 1, height: 7, borderRadius: 4, backgroundColor: colors.surface, overflow: 'hidden' },
  barFill: { height: 7, borderRadius: 4, backgroundColor: colors.amber },
  barCount: { ...typography.caption, color: colors.slate, width: 16, textAlign: 'right', letterSpacing: 0, fontSize: 11 },
});
