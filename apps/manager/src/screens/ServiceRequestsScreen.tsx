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
import {
  PLACE_KIND_LABELS,
  PREFERRED_TIME_LABELS,
  vehicleSummary,
  type PlaceKind,
  type PreferredTime,
} from '@mana/domain';
import {
  Button,
  ChoiceChips,
  EmptyState,
  IconCar,
  IconClock,
  IconMapPin,
  IconPhone,
  IconUserPlus,
  Notice,
  ScreenContainer,
  ScreenHeader,
  colors,
  formatDateTime,
  formatPhone,
  radius,
  showAlert,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { ReasonSheet } from '../components/ReasonSheet';
import { useShop } from '../offline/ShopProvider';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'ServiceRequests'>;
type Filter = 'open' | 'handled';
type Request = InferResponseType<(typeof api)['service-requests']['$get'], 200>['requests'][number];

const STATUS: Record<Request['status'], { label: string; fg: string; bg: string }> = {
  pending: { label: 'New', fg: colors.waterDeep, bg: colors.waterPale },
  out_of_area: { label: 'Outside your area', fg: colors.amberDeep, bg: '#FEF3C7' },
  approved: { label: 'Approved', fg: colors.tealDeep, bg: '#CCFBF1' },
  rejected: { label: 'Declined', fg: colors.danger, bg: '#FEE2E2' },
  cancelled: { label: 'Cancelled by them', fg: colors.slateDeep, bg: '#F1F5F9' },
};

const DECLINE_REASONS = [
  'Too far from our branch',
  'We can’t take more doorstep washes now',
  'Couldn’t reach them on the phone',
];

function Line({ icon, children }: { icon: React.ReactNode; children: string }) {
  return (
    <View style={styles.line}>
      {icon}
      <Text style={styles.lineText}>{children}</Text>
    </View>
  );
}

function RequestItem({
  request,
  isOwner,
  busy,
  onApprove,
  onDecline,
}: {
  request: Request;
  isOwner: boolean;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const status = STATUS[request.status];
  const open = request.status === 'pending' || request.status === 'out_of_area';
  const place = [request.homeText, request.placeName, request.address].filter(Boolean).join(', ');
  const call = () => void Linking.openURL(`tel:+91${request.phone}`).catch(() => undefined);
  const openMap = () => {
    if (!request.location) return;
    const { latitude, longitude } = request.location;
    void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`).catch(
      () => undefined,
    );
  };

  return (
    <View style={styles.item}>
      <View style={styles.itemHead}>
        <View style={styles.who}>
          <Text style={styles.name}>{request.name}</Text>
          <Text style={styles.phone}>+91 {formatPhone(request.phone)}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: status.bg }]}>
          <Text style={[styles.badgeText, { color: status.fg }]}>{status.label}</Text>
        </View>
      </View>

      <Line icon={<IconMapPin size={16} color={colors.slateDeep} />}>
        {request.area ? `${place} · ${request.area.name}` : place}
      </Line>
      <Line icon={<IconCar size={16} color={colors.slateDeep} />}>
        {`${vehicleSummary(request.cars, request.bikes)} · ${PLACE_KIND_LABELS[request.placeKind as PlaceKind] ?? 'Other'}`}
      </Line>
      {request.preferredTime ? (
        <Line icon={<IconClock size={16} color={colors.slateDeep} />}>
          {PREFERRED_TIME_LABELS[request.preferredTime as PreferredTime] ?? ''}
        </Line>
      ) : null}
      {request.notes ? <Text style={styles.notes}>“{request.notes}”</Text> : null}
      <Text style={styles.meta}>
        Asked {formatDateTime(request.createdAt)}
        {request.handledAt && request.handledBy ? ` · ${STATUS[request.status].label.toLowerCase()} by ${request.handledBy.name}` : ''}
      </Text>
      {request.reason ? <Text style={styles.meta}>Reason: {request.reason}</Text> : null}

      <View style={styles.actions}>
        <Pressable onPress={call} style={({ pressed }) => [styles.chip, pressed && styles.pressed]} accessibilityRole="button">
          <IconPhone size={16} color={colors.waterDeep} />
          <Text style={styles.chipText}>Call</Text>
        </Pressable>
        {request.location ? (
          <Pressable onPress={openMap} style={({ pressed }) => [styles.chip, pressed && styles.pressed]} accessibilityRole="button">
            <IconMapPin size={16} color={colors.waterDeep} />
            <Text style={styles.chipText}>Map</Text>
          </Pressable>
        ) : null}
      </View>
      {open && isOwner ? (
        <View style={styles.decide}>
          <View style={styles.flex}>
            <Button label="Decline" variant="danger" onPress={onDecline} disabled={busy} />
          </View>
          <View style={styles.flex}>
            <Button label="Approve" onPress={onApprove} loading={busy} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Requests from the MANA Car Wash app: people who aren't customers yet asking for doorstep
 * washing. Everyone can see them (to call); the owner approves, which makes them a customer here
 * so they can sign in, or declines with a reason they'll see.
 */
export function ServiceRequestsScreen({ navigation }: Props) {
  const { isOwner } = useAuth();
  const { refresh: refreshShop } = useShop();
  const [filter, setFilter] = useState<Filter>('open');
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<Request | null>(null);

  const load = useCallback(
    async (pull = false) => {
      if (pull) setRefreshing(true);
      try {
        const res = await api['service-requests'].$get({ query: { filter } });
        if (!res.ok) throw new Error(await apiErrorMessage(res));
        const body = await res.json();
        setRequests(body.requests);
        setOpenCount(body.open);
        setError(null);
      } catch (err) {
        setError(err instanceof NetworkError ? 'No connection. Pull down to try again.' : (err as Error).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    setLoading(true);
    setRequests(null);
    void load();
  }, [load]);

  const afterDecision = async (message: string) => {
    showToast(message);
    await load();
    void refreshShop();
  };

  const approve = (r: Request) =>
    showAlert(
      `Approve ${r.name}?`,
      'They become a customer of this branch and can sign in to the MANA Car Wash app. Call them first to agree a time and price.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () => {
            void (async () => {
              setBusyId(r.id);
              try {
                const res = await api['service-requests'][':id'].approve.$post({ param: { id: r.id }, json: {} });
                if (!res.ok) throw new Error(await apiErrorMessage(res));
                await afterDecision(`${r.name} is now a customer`);
              } catch (err) {
                showToast(err instanceof NetworkError ? 'No connection. Try again.' : (err as Error).message, 'error');
              } finally {
                setBusyId(null);
              }
            })();
          },
        },
      ],
      { icon: <IconUserPlus size={26} color={colors.teal} /> },
    );

  const decline = async (reason: string): Promise<string | null> => {
    if (!declining) return null;
    try {
      const res = await api['service-requests'][':id'].reject.$post({ param: { id: declining.id }, json: { reason } });
      if (!res.ok) return apiErrorMessage(res);
      setDeclining(null);
      await afterDecision('Request declined');
      return null;
    } catch (err) {
      return err instanceof NetworkError ? 'No connection. Try again.' : 'Something went wrong.';
    }
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Service requests" onBack={() => navigation.goBack()} />
        <ChoiceChips<Filter>
          options={[
            { value: 'open', label: openCount > 0 ? `Open · ${openCount}` : 'Open' },
            { value: 'handled', label: 'Handled' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>
      <FlatList
        data={requests ?? []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={error && requests ? <Notice tone="warning">{error}</Notice> : null}
        renderItem={({ item }) => (
          <RequestItem
            request={item}
            isOwner={isOwner}
            busy={busyId === item.id}
            onApprove={() => approve(item)}
            onDecline={() => setDeclining(item)}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.water} style={styles.loading} />
          ) : error ? (
            <EmptyState
              icon={<IconUserPlus size={28} color={colors.water} />}
              title="Couldn’t load requests"
              body={error}
              action={{ label: 'Try again', onPress: () => void load() }}
            />
          ) : (
            <EmptyState
              icon={<IconUserPlus size={28} color={colors.water} />}
              title={filter === 'open' ? 'No new requests' : 'Nothing handled yet'}
              body={
                filter === 'open'
                  ? 'When someone asks for doorstep washing in the MANA Car Wash app, it shows here.'
                  : 'Approved and declined requests show here.'
              }
            />
          )
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
      />
      <ReasonSheet
        visible={declining != null}
        title={`Decline ${declining?.name ?? ''}?`}
        subtitle="They’ll see this reason in the app."
        confirmLabel="Decline request"
        quickReasons={DECLINE_REASONS}
        onClose={() => setDeclining(null)}
        onConfirm={decline}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.sm },
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
  who: { flex: 1, gap: 2 },
  name: { ...typography.heading, color: colors.waterInk },
  phone: { ...typography.body, color: colors.slateDeep, fontSize: 14 },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { ...typography.label, fontSize: 12 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  lineText: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20, flex: 1 },
  notes: { ...typography.body, color: colors.waterInk, fontSize: 14, fontStyle: 'italic' },
  meta: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
  },
  chipText: { ...typography.label, color: colors.waterDeep },
  pressed: { opacity: 0.7 },
  decide: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1 },
});
