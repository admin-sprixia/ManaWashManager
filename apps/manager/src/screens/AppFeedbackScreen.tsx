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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import { PROBLEM_KIND_LABELS, STAR_LABELS } from '@mana/domain';
import {
  Button,
  ChoiceChips,
  EmptyState,
  IconAlert,
  IconCar,
  IconPhone,
  IconStar,
  Notice,
  ScreenContainer,
  ScreenHeader,
  colors,
  formatDateTime,
  formatPhone,
  formatRupees,
  radius,
  showAlert,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { ReasonSheet } from '../components/ReasonSheet';
import { useShop } from '../offline/ShopProvider';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'AppFeedback'>;
type Tab = 'problems' | 'vehicles' | 'ratings';
type Problem = InferResponseType<(typeof api)['app-feedback']['problems']['$get'], 200>['problems'][number];
type VehicleRequest = InferResponseType<(typeof api)['app-feedback']['vehicles']['$get'], 200>['requests'][number];
type RatingsBody = InferResponseType<(typeof api)['app-feedback']['ratings']['$get'], 200>;
type Rating = RatingsBody['ratings'][number];

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

function customerLabel(c: { name: string | null; phone: string }) {
  return c.name ? `${c.name} · +91 ${formatPhone(c.phone)}` : `+91 ${formatPhone(c.phone)}`;
}

const callCustomer = (phone: string) => void Linking.openURL(`tel:+91${phone}`).catch(() => undefined);

function CallChip({ phone }: { phone: string }) {
  return (
    <Pressable
      onPress={() => callCustomer(phone)}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Call the customer"
    >
      <IconPhone size={16} color={colors.waterDeep} />
      <Text style={styles.chipText}>Call</Text>
    </Pressable>
  );
}

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <View style={styles.stars} accessibilityLabel={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((s) => (
        <IconStar key={s} size={size} color={s <= value ? colors.amber : colors.border} filled={s <= value} />
      ))}
    </View>
  );
}

function ProblemItem({ problem, onResolve }: { problem: Problem; onResolve: () => void }) {
  const open = problem.status === 'open';
  return (
    <View style={styles.item}>
      <View style={styles.itemHead}>
        <View style={styles.flex}>
          <Text style={styles.title}>{PROBLEM_KIND_LABELS[problem.kind] ?? 'Problem'}</Text>
          <Text style={styles.sub}>{customerLabel(problem.customer)}</Text>
        </View>
        <View style={[styles.badge, open ? styles.badgeOpen : styles.badgeDone]}>
          <Text style={[styles.badgeText, { color: open ? colors.danger : colors.tealDeep }]}>
            {open ? 'Open' : 'Resolved'}
          </Text>
        </View>
      </View>
      <Text style={styles.quote}>“{problem.details}”</Text>
      {problem.wash ? (
        <View style={styles.line}>
          <IconCar size={16} color={colors.slateDeep} />
          <Text style={styles.lineText}>
            {problem.wash.registrationNumber} · {formatDateTime(problem.wash.createdAt)} · {formatRupees(problem.wash.total)}
            {problem.wash.washers.length ? ` · washed by ${problem.wash.washers.join(', ')}` : ''}
          </Text>
        </View>
      ) : (
        <Text style={styles.meta}>About the branch in general</Text>
      )}
      <Text style={styles.meta}>Reported {formatDateTime(problem.createdAt)}</Text>
      {problem.resolution ? (
        <Text style={styles.meta}>
          {problem.resolvedBy ? `${problem.resolvedBy.name}: ` : ''}
          {problem.resolution}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <CallChip phone={problem.customer.phone} />
        {open ? (
          <View style={styles.flex}>
            <Button label="Mark resolved" onPress={onResolve} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function VehicleItem({
  request,
  busy,
  onApprove,
  onDecline,
}: {
  request: VehicleRequest;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const pending = request.status === 'pending';
  const makeModel = [request.make, request.model].filter(Boolean).join(' ');
  return (
    <View style={styles.item}>
      <View style={styles.itemHead}>
        <View style={styles.flex}>
          <Text style={styles.plate}>{request.registrationNumber}</Text>
          <Text style={styles.sub}>{[request.type.name, makeModel].filter(Boolean).join(' · ')}</Text>
        </View>
        {!pending ? (
          <View style={[styles.badge, request.status === 'approved' ? styles.badgeDone : styles.badgeOpen]}>
            <Text
              style={[styles.badgeText, { color: request.status === 'approved' ? colors.tealDeep : colors.danger }]}
            >
              {request.status === 'approved' ? 'Added' : 'Declined'}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.lineText}>For {customerLabel(request.customer)}</Text>
      {request.currentOwner ? (
        <Notice tone="warning">
          {`This vehicle is with ${request.currentOwner.name ?? `+91 ${formatPhone(request.currentOwner.phone)}`} today. Approving moves it to this customer.`}
        </Notice>
      ) : null}
      <Text style={styles.meta}>
        Asked {formatDateTime(request.createdAt)}
        {request.handledBy ? ` · ${request.status === 'approved' ? 'added' : 'declined'} by ${request.handledBy.name}` : ''}
      </Text>
      {request.reason ? <Text style={styles.meta}>Reason: {request.reason}</Text> : null}
      <View style={styles.actions}>
        <CallChip phone={request.customer.phone} />
      </View>
      {pending ? (
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button label="Decline" variant="danger" onPress={onDecline} disabled={busy} />
          </View>
          <View style={styles.flex}>
            <Button label="Add vehicle" onPress={onApprove} loading={busy} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function RatingItem({ rating }: { rating: Rating }) {
  return (
    <View style={styles.item}>
      <View style={styles.itemHead}>
        <View style={styles.flex}>
          <Stars value={rating.stars} />
          <Text style={styles.sub}>{customerLabel(rating.customer)}</Text>
        </View>
        <Text style={styles.meta}>{STAR_LABELS[rating.stars]}</Text>
      </View>
      {rating.comment ? <Text style={styles.quote}>“{rating.comment}”</Text> : null}
      <Text style={styles.meta}>
        {rating.registrationNumber} · washed {formatDateTime(rating.washedAt)}
        {rating.washers.length ? ` by ${rating.washers.join(', ')}` : ''}
      </Text>
    </View>
  );
}

function RatingSummary({ last30 }: { last30: RatingsBody['last30'] }) {
  if (!last30.count || last30.average == null) return null;
  const max = Math.max(...last30.byStars, 1);
  return (
    <View style={[styles.item, styles.summary]}>
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
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * What customers send from the MANA Car Wash app: problems to sort out, vehicles to add, and
 * how they rated their washes. The whole team can act on them.
 */
export function AppFeedbackScreen({ navigation, route }: Props) {
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

  const load = useCallback(
    async (pull = false) => {
      if (pull) setRefreshing(true);
      try {
        if (tab === 'problems') {
          const res = await api['app-feedback'].problems.$get({ query: { filter: showDone ? 'resolved' : 'open' } });
          if (!res.ok) throw new Error(await apiErrorMessage(res));
          setProblems((await res.json()).problems);
        } else if (tab === 'vehicles') {
          const res = await api['app-feedback'].vehicles.$get({ query: { filter: showDone ? 'handled' : 'pending' } });
          if (!res.ok) throw new Error(await apiErrorMessage(res));
          setVehicles((await res.json()).requests);
        } else {
          const res = await api['app-feedback'].ratings.$get({ query: {} });
          if (!res.ok) throw new Error(await apiErrorMessage(res));
          setRatings(await res.json());
        }
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
    setLoading(true);
    void load();
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
      const res = await api['app-feedback'].vehicles[':id'].reject.$post({ param: { id: declining.id }, json: { reason } });
      if (!res.ok) return apiErrorMessage(res);
      setDeclining(null);
      await done('Request declined');
      return null;
    } catch (err) {
      return err instanceof NetworkError ? 'No connection. Try again.' : 'Something went wrong.';
    }
  };

  const tabs = [
    {
      value: 'problems' as const,
      label: customerApp.openProblems ? `Problems · ${customerApp.openProblems}` : 'Problems',
    },
    {
      value: 'vehicles' as const,
      label: customerApp.pendingVehicles ? `Vehicles · ${customerApp.pendingVehicles}` : 'Vehicles',
    },
    { value: 'ratings' as const, label: 'Ratings' },
  ];

  const empty = (() => {
    if (loading) return <ActivityIndicator color={colors.water} style={styles.loading} />;
    if (error) {
      return (
        <EmptyState
          icon={<IconAlert size={28} color={colors.water} />}
          title="Couldn’t load"
          body={error}
          action={{ label: 'Try again', onPress: () => void load() }}
        />
      );
    }
    if (tab === 'problems') {
      return (
        <EmptyState
          icon={<IconAlert size={28} color={colors.water} />}
          title={showDone ? 'Nothing resolved yet' : 'No open problems'}
          body="When a customer reports a problem in the MANA Car Wash app, it shows here."
        />
      );
    }
    if (tab === 'vehicles') {
      return (
        <EmptyState
          icon={<IconCar size={28} color={colors.water} />}
          title={showDone ? 'Nothing handled yet' : 'No vehicles to add'}
          body="Customers can ask to add a vehicle in the app. Add it once you’ve seen it."
        />
      );
    }
    return (
      <EmptyState
        icon={<IconStar size={28} color={colors.water} />}
        title="No ratings yet"
        body="Customers can rate a wash in the app after paying."
      />
    );
  })();

  const header = (
    <View style={styles.headerGap}>
      {error && !loading ? <Notice tone="warning">{error}</Notice> : null}
      {tab === 'ratings' && ratings ? <RatingSummary last30={ratings.last30} /> : null}
      {tab !== 'ratings' ? (
        <Pressable onPress={() => setShowDone((v) => !v)} accessibilityRole="button" style={styles.toggle}>
          <Text style={styles.toggleText}>
            {showDone ? 'Show waiting' : tab === 'problems' ? 'Show resolved' : 'Show handled'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Customer feedback" onBack={() => navigation.goBack()} />
        <ChoiceChips<Tab>
          options={tabs}
          value={tab}
          onChange={(t) => {
            setTab(t);
            setShowDone(false);
          }}
        />
      </View>
      {tab === 'problems' ? (
        <FlatList
          data={loading ? [] : (problems ?? [])}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          renderItem={({ item }) => <ProblemItem problem={item} onResolve={() => setResolving(item)} />}
          refreshControl={refreshControl}
        />
      ) : tab === 'vehicles' ? (
        <FlatList
          data={loading ? [] : (vehicles ?? [])}
          keyExtractor={(v) => v.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          renderItem={({ item }) => (
            <VehicleItem
              request={item}
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
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          renderItem={({ item }) => <RatingItem rating={item} />}
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
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.sm },
  headerGap: { gap: spacing.sm },
  list: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  loading: { marginTop: spacing.xl },
  item: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  itemHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1 },
  title: { ...typography.heading, color: colors.waterInk },
  plate: { ...typography.heading, color: colors.waterInk, letterSpacing: 1 },
  sub: { ...typography.body, color: colors.slateDeep, fontSize: 14 },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  badgeOpen: { backgroundColor: '#FEE2E2' },
  badgeDone: { backgroundColor: '#CCFBF1' },
  badgeText: { ...typography.label, fontSize: 12 },
  quote: { ...typography.body, color: colors.waterInk, fontSize: 15, lineHeight: 22 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  lineText: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20, flex: 1 },
  meta: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
  },
  chipText: { ...typography.label, color: colors.waterDeep },
  pressed: { opacity: 0.7 },
  stars: { flexDirection: 'row', gap: 2 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  summaryLeft: { alignItems: 'center', gap: 4 },
  average: { ...typography.title, color: colors.waterInk, fontSize: 34 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 16 },
  barLabel: { ...typography.caption, color: colors.slateDeep, width: 10, letterSpacing: 0 },
  barTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surface, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.amber },
  toggle: { alignSelf: 'flex-end', paddingVertical: 4 },
  toggleText: { ...typography.label, color: colors.waterDeep },
});
