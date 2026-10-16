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
import {
  PLACE_KIND_LABELS,
  PREFERRED_TIME_LABELS,
  vehicleSummary,
  type PlaceKind,
  type PreferredTime,
} from '@mana/domain';
import {
  Avatar,
  BRAND_MARK,
  brandGradients,
  Button,
  IconCar,
  IconCheck,
  IconClock,
  IconCloudOff,
  IconMapPin,
  IconPhone,
  IconUserPlus,
  ScreenContainer,
  ScreenHeader,
  colors,
  formatDateTime,
  formatPhone,
  radius,
  shadow,
  showAlert,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { useSync } from '../offline/SyncProvider';
import { ReasonSheet } from '../components/ReasonSheet';
import { useShop } from '../offline/ShopProvider';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'ServiceRequests'>;
type Filter = 'open' | 'handled';
type Request = InferResponseType<(typeof api)['service-requests']['$get'], 200>['requests'][number];

/** Amber when people are waiting, teal when the inbox is clear — same idea as Inventory / Rewards. */
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

const STATUS: Record<Request['status'], { label: string; fg: string; bg: string }> = {
  pending: { label: 'New', fg: colors.indigo, bg: colors.indigoPale },
  out_of_area: { label: 'Outside your area', fg: colors.amberDeep, bg: '#FEF3C7' },
  approved: { label: 'Approved', fg: colors.tealDeep, bg: '#CCFBF1' },
  rejected: { label: 'Declined', fg: colors.danger, bg: '#FEE2E2' },
  cancelled: { label: 'Cancelled by them', fg: colors.slateDeep, bg: '#F1F5F9' },
};

const DECLINE_REASONS = [
  'Too far from our branch',
  'We can’t take more washes in your area now',
  'Couldn’t reach them on the phone',
];

const whoOf = (r: Request) => r.name || `+91 ${formatPhone(r.phone)}`;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function Fact({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <View style={styles.fact}>
      {icon}
      <Text style={styles.factText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function RequestCard({
  request,
  first,
  isOwner,
  busy,
  onApprove,
  onDecline,
}: {
  request: Request;
  first?: boolean;
  isOwner: boolean;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const status = STATUS[request.status];
  const open = request.status === 'pending' || request.status === 'out_of_area';
  const displayName = request.name || `+91 ${formatPhone(request.phone)}`;
  const place = [request.homeText, request.placeName, request.address].filter(Boolean).join(', ');
  const where = [place, request.area?.name].filter(Boolean).join(' · ') || (request.location ? 'Location shared' : '');
  const kind = PLACE_KIND_LABELS[request.placeKind as PlaceKind];
  const vehicles = vehicleSummary(request.cars, request.bikes);
  const time = request.preferredTime
    ? PREFERRED_TIME_LABELS[request.preferredTime as PreferredTime]
    : null;
  const call = () => void Linking.openURL(`tel:+91${request.phone}`).catch(() => undefined);
  const openMap = () => {
    if (!request.location) return;
    const { latitude, longitude } = request.location;
    void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`).catch(
      () => undefined,
    );
  };

  return (
    <View style={[styles.card, first && styles.cardFirst]}>
      {open ? <View style={[styles.accent, { backgroundColor: status.fg }]} /> : null}

      <View style={styles.cardBody}>
        <View style={styles.cardHead}>
          <Avatar name={displayName} id={request.id} size={44} />
          <View style={styles.who}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {displayName}
              </Text>
              <View style={[styles.badge, { backgroundColor: status.bg }]}>
                <Text style={[styles.badgeText, { color: status.fg }]}>{status.label}</Text>
              </View>
            </View>
            <Text style={styles.subline} numberOfLines={1}>
              {request.name ? `+91 ${formatPhone(request.phone)} · ` : ''}
              Asked {formatDateTime(request.createdAt)}
            </Text>
          </View>
        </View>

        <View style={styles.facts}>
          {kind ? <Fact icon={<IconMapPin size={13} color={colors.slateDeep} />} label={kind} /> : null}
          <Fact icon={<IconCar size={13} color={colors.slateDeep} />} label={vehicles} />
          {time ? <Fact icon={<IconClock size={13} color={colors.slateDeep} />} label={time} /> : null}
        </View>

        {where ? (
          <Text style={styles.where} numberOfLines={2}>
            {where}
          </Text>
        ) : null}

        {request.notes ? (
          <View style={styles.notes}>
            <Text style={styles.notesText} numberOfLines={3}>
              “{request.notes}”
            </Text>
          </View>
        ) : null}

        {request.handledAt && request.handledBy ? (
          <Text style={styles.handled}>
            {STATUS[request.status].label} by {request.handledBy.name}
          </Text>
        ) : null}
        {request.reason ? <Text style={styles.reason}>{request.reason}</Text> : null}
      </View>

      <View style={styles.footer}>
        <View style={styles.footerLeft}>
          <Pressable
            onPress={call}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Call ${whoOf(request)}`}
          >
            <IconPhone size={16} color={colors.indigo} />
          </Pressable>
          {request.location ? (
            <Pressable
              onPress={openMap}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Open map"
            >
              <IconMapPin size={16} color={colors.indigo} />
            </Pressable>
          ) : null}
        </View>

        {open && isOwner ? (
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
                style={styles.approveBtn}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <>
                    <IconCheck size={14} color={colors.white} />
                    <Text style={styles.approveText}>Approve</Text>
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

/**
 * Requests from the Mana Wash app: people who aren't customers yet asking us to wash where
 * they live. Everyone can see them (to call); the owner approves, which makes them a customer here
 * so they can sign in, or declines with a reason they'll see.
 */
export function ServiceRequestsScreen({ navigation }: Props) {
  const { isOwner } = useAuth();
  const { online } = useSync();
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
      `Approve ${whoOf(r)}?`,
      'They become a customer of this branch and can sign in to the Mana Wash app. Call them first to agree a time and price.',
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
                await afterDecision(`${whoOf(r)} is now a customer`);
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
      const res = await api['service-requests'][':id'].reject.$post({
        param: { id: declining.id },
        json: { reason },
      });
      if (!res.ok) return apiErrorMessage(res);
      setDeclining(null);
      await afterDecision('Request declined');
      return null;
    } catch (err) {
      return err instanceof NetworkError ? 'No connection. Try again.' : 'Something went wrong.';
    }
  };

  const g = brandGradients.hero;
  const needsAction = openCount > 0;
  const heroColors = needsAction
    ? (HERO_OPEN as unknown as string[])
    : loading && requests == null
      ? (g.colors as unknown as string[])
      : (HERO_CLEAR as unknown as string[]);
  const heroValue = needsAction
    ? `${plural(openCount, 'request')} waiting`
    : loading && requests == null
      ? 'Loading…'
      : 'Inbox clear';
  const heroMeta = needsAction
    ? 'Call them, agree a time and price, then approve so they can sign in.'
    : 'When someone asks you to wash where they live, it shows here.';

  const listHeader = (
    <View style={styles.headerBlock}>
      <LinearGradient
        colors={heroColors}
        locations={!needsAction ? (g.locations as unknown as number[]) : undefined}
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
        <Text style={styles.heroEyebrow}>Doorstep wash requests</Text>
        <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
          {heroValue}
        </Text>
        <Text style={styles.heroMeta}>{heroMeta}</Text>
        <View style={styles.heroChips}>
          <View style={styles.heroChip}>
            <View style={styles.heroChipTop}>
              {needsAction ? <View style={[styles.heroDot, { backgroundColor: colors.amberLight }]} /> : null}
              <Text style={styles.heroChipLabel}>Open</Text>
            </View>
            <Text style={styles.heroChipValue}>{openCount}</Text>
          </View>
          <View style={styles.heroChip}>
            <Text style={styles.heroChipLabel}>Showing</Text>
            <Text style={styles.heroChipValue}>{filter === 'open' ? 'Waiting' : 'Handled'}</Text>
          </View>
          <View style={styles.heroChip}>
            <Text style={styles.heroChipLabel}>On this list</Text>
            <Text style={styles.heroChipValue}>{requests?.length ?? '—'}</Text>
          </View>
        </View>
      </LinearGradient>

      {!online ? (
        <View style={styles.notice}>
          <IconCloudOff size={15} color={colors.amberDeep} />
          <Text style={styles.noticeText}>Offline — pull to refresh when you’re back online.</Text>
        </View>
      ) : error && requests ? (
        <View style={styles.notice}>
          <IconCloudOff size={15} color={colors.amberDeep} />
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.tabs}>
        {(
          [
            { key: 'open' as const, label: 'Open', count: openCount },
            { key: 'handled' as const, label: 'Handled', count: 0 },
          ] as const
        ).map((t) => {
          const on = filter === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setFilter(t.key)}
              style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && !on && styles.pressed]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>
                {t.label}
                {t.key === 'open' && t.count > 0 ? ` · ${t.count}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const empty = loading ? (
    <ActivityIndicator color={colors.indigo} style={styles.loading} />
  ) : error && !requests?.length ? (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIcon}>
        <IconUserPlus size={28} color={colors.indigo} />
      </View>
      <Text style={styles.emptyTitle}>Couldn’t load requests</Text>
      <Text style={styles.emptyBody}>{error}</Text>
      <Button label="Try again" onPress={() => void load()} />
    </View>
  ) : (
    <View style={styles.emptyCard}>
      <View style={[styles.emptyIcon, { backgroundColor: filter === 'open' ? '#CCFBF1' : colors.indigoPale }]}>
        {filter === 'open' ? (
          <IconCheck size={28} color={colors.tealDeep} />
        ) : (
          <IconUserPlus size={28} color={colors.indigo} />
        )}
      </View>
      <Text style={styles.emptyTitle}>{filter === 'open' ? 'No open requests' : 'Nothing handled yet'}</Text>
      <Text style={styles.emptyBody}>
        {filter === 'open'
          ? 'When someone asks you to wash where they live in the Mana Wash app, it shows here.'
          : 'Approved and declined requests show here.'}
      </Text>
    </View>
  );

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Service requests" onBack={() => navigation.goBack()} />
      </View>
      <FlatList
        data={requests ?? []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={listHeader}
        renderItem={({ item, index }) => (
          <RequestCard
            request={item}
            first={index === 0}
            isOwner={isOwner}
            busy={busyId === item.id}
            onApprove={() => approve(item)}
            onDecline={() => setDeclining(item)}
          />
        )}
        ListEmptyComponent={empty}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={colors.indigo}
            colors={[colors.indigo]}
          />
        }
      />
      <ReasonSheet
        visible={declining != null}
        title={declining ? `Decline ${whoOf(declining)}?` : ''}
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
  headerPad: { paddingHorizontal: spacing.md },
  list: { paddingBottom: spacing.xxl },
  headerBlock: { gap: spacing.lg, marginBottom: spacing.lg, paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  pressed: { opacity: 0.75 },
  btnOff: { opacity: 0.45 },
  flex: { flex: 1 },

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
  heroChipValue: { ...typography.bodyStrong, fontSize: 16, color: colors.white, fontWeight: '800', marginTop: 2 },

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
  tab: { flex: 1, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.indigo },
  tabText: { ...typography.label, fontSize: 13, color: colors.slateDeep },
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
  emptyBody: { ...typography.body, fontSize: 13.5, color: colors.slateDeep, textAlign: 'center', marginBottom: spacing.sm },

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
    fontSize: 16.5,
    color: colors.waterInk,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    height: 22,
    justifyContent: 'center',
    flexShrink: 0,
  },
  badgeText: { ...typography.caption, fontSize: 11, fontWeight: '800', letterSpacing: 0 },
  subline: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0 },

  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    maxWidth: '100%',
  },
  factText: { ...typography.label, fontSize: 12.5, color: colors.slateDeep, fontWeight: '600', flexShrink: 1 },
  where: { ...typography.body, fontSize: 13.5, color: colors.slateDeep, lineHeight: 19 },
  notes: {
    borderLeftWidth: 3,
    borderLeftColor: colors.indigoMist,
    paddingLeft: spacing.sm + 2,
    paddingVertical: 2,
  },
  notesText: { ...typography.body, fontSize: 13.5, color: colors.waterInk, fontStyle: 'italic', lineHeight: 19 },
  handled: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0 },
  reason: { ...typography.caption, fontSize: 12.5, color: colors.danger, fontWeight: '700', letterSpacing: 0 },

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
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  approveBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minWidth: 108,
  },
  approveText: { ...typography.label, color: colors.white, fontWeight: '800', fontSize: 13.5 },
});
