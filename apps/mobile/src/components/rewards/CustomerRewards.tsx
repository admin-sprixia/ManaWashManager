import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { IconGift } from '../Icons';
import { PlateBadge } from '../newWash/Highlight';
import { showToast } from '../Toast';
import { StampCardView } from './StampCardView';
import { colors, radius, spacing, typography } from '../../theme';
import { api, apiErrorMessage } from '../../api/client';
import { NetworkError } from '../../api/network';
import { useDirectory } from '../../offline/DirectoryProvider';
import { useShop } from '../../offline/ShopProvider';
import { useSync } from '../../offline/SyncProvider';
import type { RewardCard, RewardGift } from '../../offline/types';
import { formatRelativeDate } from '../../utils/format';
import { giftLine, liveCards } from '../../utils/rewards';

interface VehicleCards {
  vehicleId: string;
  registrationNumber: string;
  cards: RewardCard[];
}

interface CustomerRewardsData {
  vehicles: VehicleCards[];
  giftsOwed: RewardGift[];
  giftsGiven: RewardGift[];
}

/**
 * Customer profile: each car's stamp cards, welcome-gift items still owed (hand them over right
 * here, no wash needed) and what was already given. Read live; the saved directory fills in offline.
 */
export function CustomerRewards({ customerId }: { customerId: string }) {
  const { online } = useSync();
  const { refreshRewards, refreshStock } = useShop();
  const directory = useDirectory();
  const [data, setData] = useState<CustomerRewardsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [giving, setGiving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.rewards.customer[':customerId'].$get({ param: { customerId } });
      if (!res.ok) return;
      const body = await res.json();
      setData({
        vehicles: body.vehicles.map((v) => ({ ...v, cards: v.cards as RewardCard[] })),
        giftsOwed: body.giftsOwed as RewardGift[],
        giftsGiven: body.giftsGiven as RewardGift[],
      });
    } catch {
      // Offline: the saved directory below fills in.
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    if (online) void load();
  }, [online, load]);

  const offline = useMemo<CustomerRewardsData & { owedCount: number }>(() => {
    const mine = directory.entries.filter((e) => e.customerId === customerId);
    return {
      vehicles: mine.map((e) => ({
        vehicleId: e.vehicleId,
        registrationNumber: e.registrationNumber,
        cards: e.rewardCards ?? [],
      })),
      giftsOwed: [],
      giftsGiven: [],
      owedCount: mine.reduce((sum, e) => sum + (e.giftsOwed ?? 0), 0),
    };
  }, [directory.entries, customerId]);

  const shown = online && data ? data : offline;
  const owedCount = online && data ? data.giftsOwed.length : offline.owedCount;
  const withCards = shown.vehicles
    .map((v) => ({ ...v, cards: liveCards(v.cards) }))
    .filter((v) => v.cards.length > 0);
  const multiCar = shown.vehicles.length > 1;

  const give = async (gift: RewardGift) => {
    if (giving) return;
    setGiving(gift.id);
    try {
      const res = await api.rewards.gifts[':id'].give.$post({ param: { id: gift.id } });
      if (res.ok) showToast(`Handed over · ${giftLine(gift)}`);
      else showToast(await apiErrorMessage(res, 'Couldn’t mark it given.'), 'error');
      void Promise.all([load(), refreshRewards(), refreshStock(), directory.refresh({ force: true })]);
    } catch (e) {
      showToast(e instanceof NetworkError ? 'No internet — try again when you’re back online.' : 'Couldn’t mark it given.', 'error');
    } finally {
      setGiving(null);
    }
  };

  if (withCards.length === 0 && owedCount === 0 && shown.giftsGiven.length === 0) {
    return loading && !data ? <ActivityIndicator style={styles.loader} color={colors.water} /> : null;
  }

  const plateOf = (vehicleId: string) => shown.vehicles.find((v) => v.vehicleId === vehicleId)?.registrationNumber;

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.title}>Rewards</Text>
        {owedCount > 0 ? (
          <View style={styles.owedPill}>
            <Text style={styles.owedPillText}>{owedCount} gift owed</Text>
          </View>
        ) : null}
      </View>

      {withCards.map((v) => (
        <View key={v.vehicleId}>
          {multiCar ? (
            <View style={styles.plateRow}>
              <PlateBadge plate={v.registrationNumber} size="sm" />
            </View>
          ) : null}
          {v.cards.map((card) => (
            <StampCardView key={card.serviceId} card={card} />
          ))}
        </View>
      ))}

      {online && data && data.giftsOwed.length > 0 ? (
        <View style={styles.box}>
          <Text style={styles.boxTitle}>Welcome gift still owed</Text>
          {data.giftsOwed.map((g) => (
            <View key={g.id} style={styles.giftRow}>
              <View style={styles.giftIcon}>
                <IconGift size={16} color={colors.white} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.giftName} numberOfLines={1}>
                  {giftLine(g)}
                </Text>
                <Text style={styles.giftMeta} numberOfLines={1}>
                  {multiCar && plateOf(g.vehicleId) ? `${plateOf(g.vehicleId)} · ` : ''}owed since{' '}
                  {formatRelativeDate(g.createdAt).toLowerCase()}
                </Text>
              </View>
              <Pressable
                onPress={() => void give(g)}
                disabled={giving != null}
                style={({ pressed }) => [styles.giveBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Mark ${g.itemName} given`}
                hitSlop={6}
              >
                {giving === g.id ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.giveText}>Given</Text>
                )}
              </Pressable>
            </View>
          ))}
        </View>
      ) : owedCount > 0 ? (
        <View style={styles.box}>
          <Text style={styles.boxTitle}>
            {owedCount === 1 ? 'A welcome gift item is owed' : `${owedCount} welcome gift items owed`}
          </Text>
          <Text style={styles.giftMeta}>Connect to the internet to see what and mark it given.</Text>
        </View>
      ) : null}

      {online && data && data.giftsGiven.length > 0 ? (
        <Text style={styles.given}>
          Welcome gift given:{' '}
          {data.giftsGiven
            .map((g) => `${giftLine(g)}${g.givenAt ? ` (${formatRelativeDate(g.givenAt).toLowerCase()})` : ''}`)
            .join(', ')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  loader: { marginTop: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  title: { ...typography.heading, color: colors.waterInk, fontSize: 18 },
  owedPill: { backgroundColor: '#FFEDD5', borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  owedPillText: { ...typography.caption, color: '#C2410C', fontWeight: '800', fontSize: 11 },
  plateRow: { paddingHorizontal: spacing.md, marginTop: spacing.sm },
  box: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FDBA74',
    gap: spacing.sm,
  },
  boxTitle: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  giftRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  giftIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EA580C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  giftName: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  giftMeta: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0, fontSize: 12.5 },
  giveBtn: {
    minWidth: 72,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: '#EA580C',
  },
  giveText: { ...typography.label, color: colors.white },
  given: {
    ...typography.caption,
    color: colors.slateDeep,
    letterSpacing: 0,
    fontSize: 12.5,
    lineHeight: 18,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  pressed: { opacity: 0.85 },
});
