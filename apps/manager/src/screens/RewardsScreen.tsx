import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Circle, G, Path } from 'react-native-svg';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  BONUS_STAMPS_DEFAULT,
  GIFT_ITEMS_MAX,
  GIFT_QUANTITY_MAX,
  REWARD_EXPIRY_WARN_DAYS,
  REWARD_RESET_MONTHS,
  STAMP_EVERY_DEFAULT,
  STAMP_EVERY_MAX,
  STAMP_EVERY_MIN,
  STAMP_WEIGHT_MAX,
  formatStock,
  maxBonusStamps,
  roundStock,
  type StockUnit,
} from '@mana/domain';
import {
  BRAND_MARK,
  brandGradients,
  ScreenContainer,
  ScreenHeader,
  BottomSheet,
  Button,
  showToast,
  showAlert,
  IconCheck,
  IconCloudOff,
  IconGift,
  IconMinus,
  IconPlus,
  IconStar,
  colors,
  radius,
  shadow,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { useSync } from '../offline/SyncProvider';
import { useShop, type GiftItemView, type RewardRuleView, type StockItemView } from '../offline/ShopProvider';
import type { RewardGift } from '../offline/types';
import { formatDateTime, formatDay } from '../utils/format';
import { giftLine } from '../utils/rewards';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Rewards'>;

type OwedGift = RewardGift & {
  registrationNumber: string;
  customerName: string | null;
  customerPhone: string | null;
};

interface ServiceOption {
  id: string;
  name: string;
  /** "car" | "bike" | "both". */
  appliesTo: string;
  /** "wash" | "protection" | "addon". */
  kind: string;
}

/** A stamp card as the owner sees it: its own rule, and every service that fills it (itself too). */
interface CardGroup {
  card: RewardRuleView;
  earners: { serviceId: string; serviceName: string; stamps: number }[];
}

/** Rules grouped into cards. A service filling a card that's off fills nothing, so it's left out. */
function groupCards(rules: RewardRuleView[]): CardGroup[] {
  const cards = rules.filter((r) => !r.cardServiceId);
  return cards.map((card) => ({
    card,
    earners: [
      { serviceId: card.serviceId, serviceName: card.serviceName, stamps: card.stamps ?? 1 },
      ...rules
        .filter((r) => r.cardServiceId === card.serviceId)
        .map((r) => ({ serviceId: r.serviceId, serviceName: r.serviceName, stamps: r.stamps ?? 1 })),
    ],
  }));
}

/** "Wed, 25 Nov": the shop day (India time) a card started counting. */
function sinceDay(iso: string): string {
  return formatDay(new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10));
}

/** "Basic Wash 1 · Express Wash 1 · Premium Wash 2". */
function earnersLabel(group: CardGroup): string {
  return group.earners.map((e) => `${e.serviceName} ${e.stamps}`).join(' · ');
}

const EVERY_PRESETS = [5, 8, 10, 12];

/** Same alert colours as Inventory / Cash — amber when gifts are waiting, teal when clear. */
const HERO_OWED = ['#F59E0B', '#D97706', '#92400E'] as const;
const HERO_OK = ['#0F766E', '#0B4F4A', '#062B28'] as const;

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

type RewardsTab = 'owed' | 'cards' | 'gift';

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function offlineMessage(e: unknown, fallback: string): string {
  return e instanceof NetworkError ? 'No internet — try again when you’re back online.' : fallback;
}

export function RewardsScreen({ navigation }: Props) {
  const { isOwner } = useAuth();
  const { online } = useSync();
  const { rewards, refreshRewards, stock, refreshStock } = useShop();
  const [owed, setOwed] = useState<OwedGift[] | null>(null);
  const [owedError, setOwedError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [giving, setGiving] = useState<string | null>(null);
  const [cardSheet, setCardSheet] = useState<{ group: CardGroup | null } | null>(null);
  const [giftSheet, setGiftSheet] = useState(false);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [tab, setTab] = useState<RewardsTab>('owed');

  const loadOwed = useCallback(async () => {
    try {
      const res = await api.rewards.gifts.owed.$get();
      if (!res.ok) {
        setOwedError(await apiErrorMessage(res, 'Couldn’t load gifts owed.'));
        return;
      }
      const body = await res.json();
      setOwed(body.gifts as OwedGift[]);
      setOwedError(null);
    } catch (e) {
      setOwedError(offlineMessage(e, 'Couldn’t load gifts owed.'));
    }
  }, []);

  const loadServices = useCallback(async () => {
    if (!isOwner) return;
    try {
      const res = await api.services.$get({ query: {} });
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body)) {
        setServices(
          body
            .filter((s) => s.active)
            .map((s) => ({ id: s.id, name: s.name, appliesTo: s.appliesTo, kind: s.kind })),
        );
      }
    } catch {
      // Offline: setting up a card needs the connection anyway.
    }
  }, [isOwner]);

  const reload = useCallback(
    () => Promise.all([refreshRewards(), loadOwed(), loadServices(), isOwner ? refreshStock() : null]),
    [refreshRewards, loadOwed, loadServices, refreshStock, isOwner],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const give = async (gift: OwedGift) => {
    if (giving) return;
    setGiving(gift.id);
    try {
      const res = await api.rewards.gifts[':id'].give.$post({ param: { id: gift.id } });
      if (res.ok) {
        showToast(`Handed over to ${gift.customerName || gift.registrationNumber} · ${giftLine(gift)}`);
      } else {
        showToast(await apiErrorMessage(res, 'Couldn’t mark it given.'), 'error');
      }
      void Promise.all([loadOwed(), refreshRewards(), refreshStock()]);
    } catch (e) {
      showToast(offlineMessage(e, 'Couldn’t mark it given.'), 'error');
    } finally {
      setGiving(null);
    }
  };

  const rules = useMemo(() => rewards?.rules ?? [], [rewards]);
  const cardGroups = useMemo(() => groupCards(rules), [rules]);
  const gift = rewards?.gift ?? [];
  const owedCount = owed?.length ?? rewards?.giftsOwed ?? 0;
  const giftShort = gift.filter((g) => g.balance < g.quantity).length;
  const nothingSetUp = rules.length === 0 && gift.length === 0;
  const needsAction = owedCount > 0 || giftShort > 0;
  // A service can be on one card only: these are free to start a new card or join one.
  const unusedServices = services.filter((s) => !rules.some((r) => r.serviceId === s.id));

  useEffect(() => {
    if (owed == null) return;
    if (tab === 'owed' && owed.length === 0 && (rules.length > 0 || gift.length > 0)) {
      setTab(rules.length > 0 ? 'cards' : 'gift');
    }
  }, [owed, rules.length, gift.length, tab]);

  const g = brandGradients.hero;
  const heroColors = nothingSetUp
    ? (g.colors as unknown as string[])
    : needsAction
      ? (HERO_OWED as unknown as string[])
      : (HERO_OK as unknown as string[]);
  const heroValue = nothingSetUp
    ? 'Not set up yet'
    : owedCount > 0
      ? `${plural(owedCount, 'gift')} to hand over`
      : giftShort > 0
        ? `${plural(giftShort, 'gift')} running low`
        : 'Rewards are on';
  const heroMeta = nothingSetUp
    ? 'Stamp cards earn a free wash; new cars get a welcome gift on their first paid visit.'
    : owedCount > 0
      ? 'Hand these over when the customer comes in — they come out of stock then.'
      : giftShort > 0
        ? 'Welcome gift stock is low — new cars will be owed it until you restock.'
        : 'Stamp cards and welcome gifts are ready for the next wash.';

  const tabs: { key: RewardsTab; label: string; count: number }[] = [
    { key: 'owed', label: 'Gifts owed', count: owedCount },
    { key: 'cards', label: 'Stamp cards', count: cardGroups.length },
    { key: 'gift', label: 'Welcome gift', count: gift.length },
  ];

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader
          title="Rewards"
          onBack={() => navigation.goBack()}
          right={
            isOwner && tab === 'cards' && unusedServices.length > 0 ? (
              <Pressable
                onPress={() => setCardSheet({ group: null })}
                disabled={!online}
                style={({ pressed }) => [styles.addBtn, !online && styles.btnOff, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Add a stamp card"
              >
                <IconPlus size={16} color={colors.white} />
                <Text style={styles.addBtnText}>Card</Text>
              </Pressable>
            ) : isOwner && tab === 'gift' ? (
              <Pressable
                onPress={() => setGiftSheet(true)}
                disabled={!online}
                style={({ pressed }) => [styles.addBtn, !online && styles.btnOff, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={gift.length ? 'Change the welcome gift' : 'Set up the welcome gift'}
              >
                <Text style={styles.addBtnText}>{gift.length ? 'Change' : 'Set up'}</Text>
              </Pressable>
            ) : undefined
          }
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void reload().finally(() => setRefreshing(false));
            }}
            tintColor={colors.indigo}
            colors={[colors.indigo]}
          />
        }
      >
        <LinearGradient
          colors={heroColors}
          locations={nothingSetUp || !needsAction ? (g.locations as unknown as number[]) : undefined}
          start={g.start}
          end={g.end}
          style={[styles.hero, shadow('md')]}
        >
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 340 200" preserveAspectRatio="xMidYMid slice">
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
          <Text style={styles.heroEyebrow}>Bring them back</Text>
          <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
            {heroValue}
          </Text>
          <Text style={styles.heroMeta}>{heroMeta}</Text>
          <View style={styles.heroChips}>
            {[
              { label: 'Stamp cards', value: cardGroups.length, dot: null as string | null },
              { label: 'Gift items', value: gift.length, dot: giftShort > 0 ? '#FCA5A5' : null },
              {
                label: 'Gifts owed',
                value: owedCount,
                dot: owedCount > 0 ? colors.amberLight : null,
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
            <Text style={styles.noticeText}>Offline — showing the last saved copy. Changes need internet.</Text>
          </View>
        ) : null}

        <View style={styles.tabs}>
          {tabs.map((t) => {
            const on = tab === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={({ pressed }) => [styles.tab, on && styles.tabOn, pressed && !on && styles.pressed]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
                  {t.label}
                  {t.count > 0 ? ` · ${t.count}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {tab === 'owed' ? (
          <>
            {owed == null && !owedError ? (
              <ActivityIndicator style={styles.loader} color={colors.indigo} />
            ) : owedError && owed == null ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Couldn’t load</Text>
                <Text style={styles.emptyBody}>{owedError}</Text>
              </View>
            ) : owed && owed.length === 0 ? (
              <View style={styles.emptyCard}>
                <View style={[styles.emptyIcon, { backgroundColor: '#CCFBF1' }]}>
                  <IconCheck size={28} color={colors.tealDeep} />
                </View>
                <Text style={styles.emptyTitle}>Nobody is waiting</Text>
                <Text style={styles.emptyBody}>
                  When a welcome gift is out of stock, it’s saved here until it’s handed over.
                </Text>
              </View>
            ) : (
              <View style={styles.band}>
                {owed?.map((item, i) => (
                  <Pressable
                    key={item.id}
                    onPress={() => navigation.navigate('CustomerProfile', { customerId: item.customerId })}
                    android_ripple={{ color: colors.waterPale }}
                    style={({ pressed }) => [
                      styles.row,
                      i < (owed?.length ?? 0) - 1 && styles.rowDivider,
                      pressed && styles.pressedRow,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${giftLine(item)} owed to ${item.customerName || item.registrationNumber}`}
                  >
                    <View style={[styles.rowIcon, { backgroundColor: '#FFEDD5' }]}>
                      <IconGift size={18} color="#C2410C" />
                    </View>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {giftLine(item)}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {item.customerName || 'Customer'} · {item.registrationNumber} · since{' '}
                        {formatDateTime(item.createdAt)}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => void give(item)}
                      disabled={!online || giving != null}
                      hitSlop={6}
                      style={({ pressed }) => [styles.giveBtn, !online && styles.btnOff, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Mark ${item.itemName} given`}
                    >
                      {giving === item.id ? (
                        <ActivityIndicator size="small" color={colors.white} />
                      ) : (
                        <Text style={styles.giveText}>Given</Text>
                      )}
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            )}
            {owed && owed.length > 0 ? (
              <Text style={styles.footnote}>
                Tap Given when the customer gets it — it comes out of stock then. Owed gifts never expire.
              </Text>
            ) : null}
          </>
        ) : null}

        {tab === 'cards' ? (
          <>
            {cardGroups.length === 0 ? (
              <View style={styles.emptyCard}>
                <View style={[styles.emptyIcon, { backgroundColor: '#FEF3C7' }]}>
                  <IconStar size={28} color={colors.amberDeep} />
                </View>
                <Text style={styles.emptyTitle}>No stamp cards yet</Text>
                <Text style={styles.emptyBody}>
                  {isOwner
                    ? 'Pick the free wash (e.g. Basic Wash), then which washes fill the card. Tap + Card to start.'
                    : 'The owner hasn’t set up any stamp cards.'}
                </Text>
              </View>
            ) : (
              <View style={styles.band}>
                {cardGroups.map((group, i) => {
                  const { card } = group;
                  const bonus = card.bonusStamps ?? 0;
                  return (
                    <Pressable
                      key={card.serviceId}
                      onPress={isOwner ? () => setCardSheet({ group }) : undefined}
                      disabled={!isOwner}
                      android_ripple={isOwner ? { color: colors.waterPale } : undefined}
                      style={({ pressed }) => [
                        styles.row,
                        i < cardGroups.length - 1 && styles.rowDivider,
                        pressed && styles.pressedRow,
                      ]}
                      accessibilityRole={isOwner ? 'button' : undefined}
                    >
                      <View style={[styles.rowIcon, { backgroundColor: '#FEF3C7' }]}>
                        <IconStar size={18} color={colors.amberDeep} />
                      </View>
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          Free {card.serviceName}
                        </Text>
                        <Text style={styles.rowMeta}>
                          {card.every} stamps for one free{bonus > 0 ? ` · ${bonus} welcome stamps` : ''}
                        </Text>
                        <Text style={styles.rowMeta}>Stamps: {earnersLabel(group)}</Text>
                        {card.startsAt ? (
                          <Text style={styles.rowMeta}>Counting washes since {sinceDay(card.startsAt)}</Text>
                        ) : null}
                      </View>
                      {isOwner ? <Text style={styles.editLink}>Edit</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
            <Text style={styles.footnote}>
              Stamps land when a wash is paid. Plan washes and washes that cost nothing don’t earn stamps. The bill on
              WhatsApp shows the customer’s card. Staff see “Free wash ready” on New Wash; the customer can use it or
              save it. A card resets if the vehicle has no wash for {REWARD_RESET_MONTHS} months — staff are warned{' '}
              {REWARD_EXPIRY_WARN_DAYS} days before.
            </Text>
          </>
        ) : null}

        {tab === 'gift' ? (
          <>
            {gift.length === 0 ? (
              <View style={styles.emptyCard}>
                <View style={[styles.emptyIcon, { backgroundColor: '#FCE7F3' }]}>
                  <IconGift size={28} color="#BE185D" />
                </View>
                <Text style={styles.emptyTitle}>No welcome gift yet</Text>
                <Text style={styles.emptyBody}>
                  {isOwner
                    ? 'Give every new car something from Inventory on its first paid wash — a cloth, an air freshener.'
                    : 'The owner hasn’t set up a welcome gift.'}
                </Text>
              </View>
            ) : (
              <View style={styles.band}>
                {gift.map((item, i) => {
                  const short = item.balance < item.quantity;
                  return (
                    <View
                      key={item.stockItemId}
                      style={[styles.row, i < gift.length - 1 && styles.rowDivider]}
                    >
                      <View style={[styles.rowIcon, { backgroundColor: short ? '#FEE2E2' : '#CCFBF1' }]}>
                        <IconGift size={18} color={short ? colors.danger : colors.tealDeep} />
                      </View>
                      <View style={styles.rowCopy}>
                        <View style={styles.rowTitleLine}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {giftLine(item)}
                          </Text>
                          {short ? (
                            <View style={[styles.levelPill, { backgroundColor: '#FEE2E2' }]}>
                              <Text style={[styles.levelPillText, { color: colors.danger }]}>Low</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={[styles.rowMeta, short && styles.rowMetaDanger]}>
                          {short
                            ? `Only ${formatStock(item.balance, item.unit)} left — new cars will be owed it`
                            : `${formatStock(item.balance, item.unit)} in stock`}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
            <Text style={styles.footnote}>
              Every new car gets it once, on its first paid wash — even a regular customer’s new car. It comes out
              of stock when the wash is paid and goes back if the wash is voided. Out of stock? The wash still
              goes ahead and the gift is saved as owed.
            </Text>
          </>
        ) : null}
      </ScrollView>

      {isOwner ? (
        <CardSheet
          target={cardSheet}
          services={services}
          rules={rules}
          onClose={() => setCardSheet(null)}
          onSaved={() => {
            setCardSheet(null);
            void refreshRewards();
          }}
        />
      ) : null}
      {isOwner ? (
        <GiftSheet
          visible={giftSheet}
          current={gift}
          stock={stock}
          onClose={() => setGiftSheet(false)}
          onSaved={() => {
            setGiftSheet(false);
            void refreshRewards();
          }}
        />
      ) : null}
    </ScreenContainer>
  );
}

function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(Math.max(min, roundStock(value - step)))}
        disabled={value <= min}
        style={({ pressed }) => [styles.stepBtn, value <= min && styles.btnOff, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Fewer ${label}`}
        hitSlop={6}
      >
        <IconMinus size={16} color={colors.waterDeep} />
      </Pressable>
      <Text style={styles.stepValue} accessibilityLabel={`${value} ${label}`}>
        {value}
      </Text>
      <Pressable
        onPress={() => onChange(Math.min(max, roundStock(value + step)))}
        disabled={value >= max}
        style={({ pressed }) => [styles.stepBtn, value >= max && styles.btnOff, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`More ${label}`}
        hitSlop={6}
      >
        <IconPlus size={16} color={colors.waterDeep} />
      </Pressable>
    </View>
  );
}

/** The washes that usually fill a card: the same vehicles' washes, Premium counting 2. */
function suggestedStamps(card: ServiceOption, candidates: ServiceOption[]): Map<string, number> {
  const out = new Map<string, number>([[card.id, 1]]);
  for (const s of candidates) {
    if (s.id === card.id || s.kind !== 'wash' || s.appliesTo !== card.appliesTo) continue;
    out.set(s.id, /premium/i.test(s.name) ? 2 : 1);
  }
  return out;
}

const WEIGHTS = Array.from({ length: STAMP_WEIGHT_MAX + 1 }, (_, i) => i);

/**
 * Owner: a stamp card — the free wash it gives, how many stamps fill it, the welcome stamps a
 * new car starts with, and which washes put how many stamps on it. Or switch it off.
 */
function CardSheet({
  target,
  services,
  rules,
  onClose,
  onSaved,
}: {
  target: { group: CardGroup | null } | null;
  services: ServiceOption[];
  rules: RewardRuleView[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const group = target?.group ?? null;
  const [cardId, setCardId] = useState<string | null>(null);
  const [every, setEvery] = useState(STAMP_EVERY_DEFAULT);
  const [bonus, setBonus] = useState(BONUS_STAMPS_DEFAULT);
  const [weights, setWeights] = useState<Map<string, number>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Services this card may use: free ones, and the ones already on it.
  const available = useMemo(() => {
    const mine = new Set(group?.earners.map((e) => e.serviceId) ?? []);
    return services.filter((s) => s.kind !== 'addon' && (mine.has(s.id) || !rules.some((r) => r.serviceId === s.id)));
  }, [services, rules, group]);

  useEffect(() => {
    if (!target) return;
    const g = target.group;
    setCardId(g?.card.serviceId ?? null);
    setEvery(g?.card.every ?? STAMP_EVERY_DEFAULT);
    setBonus(g ? (g.card.bonusStamps ?? 0) : BONUS_STAMPS_DEFAULT);
    setWeights(new Map(g?.earners.map((e) => [e.serviceId, e.stamps]) ?? []));
    setSaving(false);
    setError(null);
  }, [target]);

  const pickCard = (s: ServiceOption) => {
    setCardId(s.id);
    setWeights(suggestedStamps(s, available));
    setError(null);
  };

  const setWeight = (id: string, n: number) => {
    setWeights((prev) => {
      const next = new Map(prev);
      if (n === 0) next.delete(id);
      else next.set(id, n);
      return next;
    });
  };

  const maxBonus = maxBonusStamps(every);
  const bonusShown = Math.min(bonus, maxBonus);
  const cardName = group?.card.serviceName ?? services.find((s) => s.id === cardId)?.name ?? null;
  const cardService = services.find((s) => s.id === cardId);
  // Washes that can fill this card: the same vehicles' (a car card isn't filled by bike washes).
  const fillers = available
    .filter((s) => s.id !== cardId && (!cardService || s.appliesTo === cardService.appliesTo || s.appliesTo === 'both' || weights.has(s.id)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const earners = cardId
    ? [{ serviceId: cardId, stamps: weights.get(cardId) ?? 1 }, ...[...weights.entries()].filter(([id]) => id !== cardId).map(([serviceId, stamps]) => ({ serviceId, stamps }))]
    : [];
  const nameOf = (id: string) => services.find((s) => s.id === id)?.name ?? rules.find((r) => r.serviceId === id)?.serviceName ?? 'Service';

  const save = async () => {
    if (!cardId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.rewards.cards[':serviceId'].$put({
        param: { serviceId: cardId },
        json: { every, bonusStamps: bonusShown, earners },
      });
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t save the stamp card.'));
        return;
      }
      showToast(group ? 'Stamp card updated' : 'Stamp card is on');
      onSaved();
    } catch (e) {
      setError(offlineMessage(e, 'Couldn’t save the stamp card.'));
    } finally {
      setSaving(false);
    }
  };

  const turnOff = () => {
    if (!group) return;
    showAlert(
      `Turn off the free ${group.card.serviceName} card?`,
      'New washes stop collecting stamps and New Wash stops offering its free wash. If you turn it on again later, it starts counting from that day.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setSaving(true);
              try {
                const res = await api.rewards.rules[':serviceId'].$delete({ param: { serviceId: group.card.serviceId } });
                if (!res.ok) {
                  setError(await apiErrorMessage(res, 'Couldn’t turn it off.'));
                  return;
                }
                showToast('Stamp card turned off');
                onSaved();
              } catch (e) {
                setError(offlineMessage(e, 'Couldn’t turn it off.'));
              } finally {
                setSaving(false);
              }
            })();
          },
        },
      ],
    );
  };

  const choices = available.filter((s) => s.kind === 'wash');

  return (
    <BottomSheet
      visible={target != null}
      onClose={onClose}
      dismissable={!saving}
      title={group ? `Free ${group.card.serviceName}` : 'New stamp card'}
      subtitle={group ? 'Change the card. It applies to every vehicle straight away.' : 'Pick the free wash, then which washes fill the card'}
      footer={
        <View style={styles.sheetFooter}>
          <Button
            label={saving ? 'Saving…' : group ? 'Save' : 'Turn on'}
            onPress={() => void save()}
            loading={saving}
            disabled={!cardId}
          />
          {group ? (
            <Pressable onPress={turnOff} disabled={saving} style={styles.offLink} accessibilityRole="button">
              <Text style={styles.offLinkText}>Turn off this card</Text>
            </Pressable>
          ) : null}
        </View>
      }
    >
      {!group ? (
        <>
          <Text style={styles.sheetLabel}>The free wash</Text>
          {choices.length === 0 ? (
            <Text style={styles.sheetHint}>Every wash is already on a card.</Text>
          ) : (
            <View style={styles.chipWrap}>
              {choices.map((s) => {
                const on = s.id === cardId;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => pickCard(s)}
                    style={[styles.chip, on && styles.chipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{s.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </>
      ) : null}

      {cardId ? (
        <>
          <Text style={styles.sheetLabel}>Stamps for one free wash</Text>
          <View style={styles.everyRow}>
            <Stepper value={every} onChange={setEvery} min={STAMP_EVERY_MIN} max={STAMP_EVERY_MAX} label="stamps" />
            <View style={styles.chipWrapTight}>
              {EVERY_PRESETS.map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setEvery(n)}
                  style={[styles.chip, every === n && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: every === n }}
                >
                  <Text style={[styles.chipText, every === n && styles.chipTextOn]}>{n}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Text style={styles.sheetLabel}>Welcome stamps on the first wash</Text>
          <View style={styles.everyRow}>
            <Stepper value={bonusShown} onChange={setBonus} min={0} max={maxBonus} label="welcome stamps" />
            <Text style={[styles.sheetHint, styles.flex]}>Up to {maxBonus}. Once per vehicle.</Text>
          </View>

          <Text style={styles.sheetLabel}>Stamps each wash gives</Text>
          <View style={styles.weightList}>
            {[{ id: cardId, name: cardName ?? nameOf(cardId), own: true }, ...fillers.map((s) => ({ id: s.id, name: s.name, own: false }))].map((row) => {
              const value = row.own ? (weights.get(row.id) ?? 1) : (weights.get(row.id) ?? 0);
              return (
                <View key={row.id} style={styles.weightRow}>
                  <Text style={styles.weightName} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <View style={styles.weightChips}>
                    {WEIGHTS.filter((n) => !(row.own && n === 0)).map((n) => {
                      const on = value === n;
                      return (
                        <Pressable
                          key={n}
                          onPress={() => setWeight(row.id, n)}
                          style={[styles.weightChip, on && styles.chipOn]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={n === 0 ? `${row.name} gives no stamps` : `${row.name} gives ${n} stamps`}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextOn]}>{n === 0 ? 'No' : n}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>

          <View style={styles.preview}>
            <IconStar size={16} color={colors.amberDeep} />
            <Text style={styles.previewText}>
              {`${earners.map((e) => `${nameOf(e.serviceId)} = ${e.stamps}`).join(', ')}. ${every} stamps = a free ${cardName ?? 'wash'}.${bonusShown > 0 ? ` New vehicles start with ${bonusShown} welcome stamps.` : ''}`}
            </Text>
          </View>
          <Text style={styles.sheetHint}>
            {group
              ? group.card.startsAt
                ? `Counting washes since ${sinceDay(group.card.startsAt)}.`
                : 'Counts every vehicle’s past washes.'
              : 'Counts washes from the moment you turn it on. Earlier washes don’t count.'}
          </Text>
        </>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

/** Owner: which Inventory items new cars get on their first paid wash, and how many of each. */
function GiftSheet({
  visible,
  current,
  stock,
  onClose,
  onSaved,
}: {
  visible: boolean;
  current: GiftItemView[];
  stock: StockItemView[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPicked(new Map(current.map((g) => [g.stockItemId, String(g.quantity)])));
    setSaving(false);
    setError(null);
  }, [visible, current]);

  const items = useMemo(() => [...stock].sort((a, b) => a.name.localeCompare(b.name)), [stock]);
  const unitOf = (id: string): StockUnit => stock.find((s) => s.id === id)?.unit ?? 'pcs';

  const toggle = (item: StockItemView) => {
    setError(null);
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else if (next.size < GIFT_ITEMS_MAX) next.set(item.id, '1');
      else setError(`At most ${GIFT_ITEMS_MAX} items in the welcome gift.`);
      return next;
    });
  };

  const setQty = (id: string, text: string) => setPicked((prev) => new Map(prev).set(id, text));

  const parsed = Array.from(picked.entries()).map(([stockItemId, text]) => ({
    stockItemId,
    quantity: Number(text.replace(',', '.')),
  }));
  const invalid = parsed.find(
    (p) =>
      !Number.isFinite(p.quantity) ||
      p.quantity <= 0 ||
      p.quantity > GIFT_QUANTITY_MAX ||
      (unitOf(p.stockItemId) === 'pcs' && !Number.isInteger(p.quantity)),
  );

  const save = async () => {
    if (saving || invalid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.rewards.gift.$put({ json: { items: parsed } });
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t save the welcome gift.'));
        return;
      }
      showToast(parsed.length ? 'Welcome gift saved' : 'Welcome gift turned off');
      onSaved();
    } catch (e) {
      setError(offlineMessage(e, 'Couldn’t save the welcome gift.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!saving}
      title="Welcome gift"
      subtitle={`Pick up to ${GIFT_ITEMS_MAX} items from Inventory for every new car`}
      footer={
        <Button
          label={saving ? 'Saving…' : parsed.length === 0 && current.length > 0 ? 'Turn off welcome gift' : 'Save'}
          onPress={() => void save()}
          loading={saving}
          disabled={Boolean(invalid) || (parsed.length === 0 && current.length === 0)}
          variant={parsed.length === 0 && current.length > 0 ? 'danger' : 'primary'}
        />
      }
    >
      {items.length === 0 ? (
        <Text style={styles.sheetHint}>
          Nothing in Inventory yet. Add the items you want to give (cloths, air fresheners) in Inventory first.
        </Text>
      ) : (
        <View style={styles.giftList}>
          {items.map((item) => {
            const on = picked.has(item.id);
            const text = picked.get(item.id) ?? '';
            const qty = Number(text.replace(',', '.'));
            return (
              <View key={item.id} style={[styles.giftItem, on && styles.giftItemOn]}>
                <Pressable
                  onPress={() => toggle(item)}
                  style={styles.giftItemMain}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={item.name}
                >
                  <View style={[styles.check, on && styles.checkOn]}>
                    {on ? <IconCheck size={13} color={colors.white} /> : null}
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.giftItemName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.giftItemMeta}>{formatStock(item.balance, item.unit)} in stock</Text>
                  </View>
                </Pressable>
                {on ? (
                  item.unit === 'pcs' ? (
                    <Stepper
                      value={Number.isInteger(qty) && qty > 0 ? qty : 1}
                      onChange={(n) => setQty(item.id, String(n))}
                      min={1}
                      max={GIFT_QUANTITY_MAX}
                      label="pieces"
                    />
                  ) : (
                    <View style={styles.qtyField}>
                      <TextInput
                        value={text}
                        onChangeText={(t) => setQty(item.id, t.replace(/[^\d.,]/g, ''))}
                        keyboardType="decimal-pad"
                        style={styles.qtyInput}
                        maxLength={6}
                        accessibilityLabel={`${item.name} quantity in ${item.unit}`}
                      />
                      <Text style={styles.qtyUnit}>{item.unit}</Text>
                    </View>
                  )
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      {invalid ? (
        <Text style={styles.error}>
          {unitOf(invalid.stockItemId) === 'pcs'
            ? 'Pieces must be a whole number.'
            : `Enter an amount between 0 and ${GIFT_QUANTITY_MAX}.`}
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.lg },
  pressed: { opacity: 0.75 },
  pressedRow: { backgroundColor: colors.surface },
  loader: { marginTop: spacing.lg },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.indigo,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md - 2,
    height: 36,
  },
  addBtnText: { ...typography.label, color: colors.white, fontWeight: '700' },
  btnOff: { opacity: 0.45 },

  hero: {
    marginHorizontal: spacing.md,
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
    marginHorizontal: spacing.md,
    padding: spacing.sm + 4,
    borderRadius: 14,
    backgroundColor: colors.amberPale,
    borderWidth: 1,
    borderColor: colors.amberLight,
  },
  noticeText: { ...typography.caption, flex: 1, fontSize: 12.5, color: colors.amberDeep, letterSpacing: 0 },

  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
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
  emptyBody: { ...typography.body, fontSize: 13.5, color: colors.slateDeep, textAlign: 'center' },

  band: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
    backgroundColor: colors.white,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1, gap: 3, minWidth: 0 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: {
    ...typography.bodyStrong,
    flexShrink: 1,
    color: colors.waterInk,
    fontSize: 15.5,
    fontWeight: '700',
  },
  levelPill: { paddingHorizontal: 8, height: 20, borderRadius: 10, justifyContent: 'center' },
  levelPillText: { ...typography.caption, fontSize: 11, fontWeight: '800', letterSpacing: 0 },
  rowMeta: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  rowMetaDanger: { color: colors.danger, fontWeight: '700' },
  editLink: { ...typography.label, color: colors.indigo, fontSize: 14, fontWeight: '700' },
  footnote: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slate,
    letterSpacing: 0,
    lineHeight: 18,
    paddingHorizontal: spacing.md,
  },
  giveBtn: {
    minWidth: 72,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: '#EA580C',
  },
  giveText: { ...typography.label, color: colors.white, fontWeight: '700' },
  sheetFooter: { gap: spacing.sm },
  sheetLabel: {
    ...typography.label,
    color: colors.slateDeep,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 12,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sheetHint: { ...typography.caption, color: colors.slate, fontSize: 13, letterSpacing: 0, lineHeight: 18, marginTop: spacing.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chipWrapTight: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1, justifyContent: 'flex-end' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.water, borderColor: colors.water },
  chipText: { ...typography.label, color: colors.waterInk, fontSize: 14 },
  chipTextOn: { color: colors.white },
  everyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { ...typography.heading, color: colors.waterInk, minWidth: 34, textAlign: 'center' },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.sm + 4,
    borderRadius: radius.md,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  weightList: { gap: spacing.sm },
  weightRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  weightName: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 14.5, flex: 1 },
  weightChips: { flexDirection: 'row', gap: 6 },
  weightChip: {
    minWidth: 40,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewText: { ...typography.body, color: colors.amberDeep, fontSize: 14, fontWeight: '600', flex: 1 },
  offLink: { alignSelf: 'center', paddingVertical: spacing.sm },
  offLinkText: { ...typography.label, color: colors.danger, fontSize: 14 },
  giftList: { gap: spacing.sm, marginTop: spacing.sm },
  giftItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  giftItemOn: { borderColor: colors.teal, backgroundColor: '#F0FDFA' },
  giftItemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.slate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  giftItemName: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  giftItemMeta: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  qtyField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.white,
  },
  qtyInput: { minWidth: 48, fontSize: 16, color: colors.waterInk, paddingVertical: 6, textAlign: 'right' },
  qtyUnit: { ...typography.label, color: colors.slateDeep },
  error: { ...typography.label, color: colors.danger, textTransform: 'none', marginTop: spacing.md },
});
