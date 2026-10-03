import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { IconGift } from '../Icons';
import { StampCardView } from '../rewards/StampCardView';
import { showToast } from '../Toast';
import { colors, radius, spacing, typography } from '../../theme';
import { api, apiErrorMessage } from '../../api/client';
import { NetworkError } from '../../api/network';
import type { GiftItemView } from '../../offline/ShopProvider';
import type { RewardCard, RewardGift } from '../../offline/types';
import { giftLine } from '../../utils/rewards';

interface RewardsPanelProps {
  cards: RewardCard[];
  /** Services the customer is taking free on this bill. */
  freeIds: ReadonlySet<string>;
  /** Whether a card's free wash can be used on this bill, and why not. */
  freeState: (card: RewardCard) => { disabled: boolean; note: string | null };
  onToggleFree: (card: RewardCard) => void;
  giftsOwed: RewardGift[];
  /** Owed items known from the saved directory when the details can't be read (offline). */
  giftsOwedCount: number;
  /** The shop's welcome gift, when this car hasn't been washed before. */
  welcome: GiftItemView[] | null;
  online: boolean;
  /** After a gift is handed over: re-read the car, inventory and the owed count. */
  onGiven: () => void;
}

/** New Wash: the car's stamp cards (with "Use free"), gifts owed to it, and its welcome gift. */
export function RewardsPanel({
  cards,
  freeIds,
  freeState,
  onToggleFree,
  giftsOwed,
  giftsOwedCount,
  welcome,
  online,
  onGiven,
}: RewardsPanelProps) {
  const [giving, setGiving] = useState<string | null>(null);

  const give = async (gift: RewardGift) => {
    if (giving) return;
    setGiving(gift.id);
    try {
      const res = await api.rewards.gifts[':id'].give.$post({ param: { id: gift.id } });
      if (res.ok) {
        showToast(`Handed over · ${giftLine(gift)}`);
        onGiven();
        return;
      }
      showToast(await apiErrorMessage(res, 'Couldn’t mark it given.'), 'error');
      if (res.status === 404 || res.status === 409) onGiven();
    } catch (e) {
      showToast(e instanceof NetworkError ? 'No internet — try again when you’re back online.' : 'Couldn’t mark it given.', 'error');
    } finally {
      setGiving(null);
    }
  };

  const outOfStock = welcome?.filter((g) => g.balance < g.quantity) ?? [];
  const owedOffline = giftsOwed.length === 0 && giftsOwedCount > 0;
  if (cards.length === 0 && giftsOwed.length === 0 && !owedOffline && !welcome?.length) return null;

  return (
    <View style={styles.wrap}>
      {cards.map((card) => {
        const state = freeState(card);
        return (
          <StampCardView
            key={card.serviceId}
            card={card}
            action={{
              on: freeIds.has(card.serviceId),
              disabled: state.disabled,
              note: state.note,
              onToggle: () => onToggleFree(card),
            }}
          />
        );
      })}

      {giftsOwed.length > 0 ? (
        <View style={[styles.box, styles.owedBox]}>
          <View style={styles.boxHead}>
            <View style={[styles.icon, styles.iconOwed]}>
              <IconGift size={17} color={colors.white} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.boxTitle}>Welcome gift still owed</Text>
              <Text style={styles.boxMeta}>It was out of stock on the first visit. Hand it over now.</Text>
            </View>
          </View>
          {giftsOwed.map((gift) => (
            <View key={gift.id} style={styles.giftRow}>
              <Text style={styles.giftName} numberOfLines={1}>
                {giftLine(gift)}
              </Text>
              <Pressable
                onPress={() => void give(gift)}
                disabled={!online || giving != null}
                style={({ pressed }) => [styles.giveBtn, !online && styles.giveBtnOff, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Mark ${gift.itemName} given`}
                hitSlop={6}
              >
                {giving === gift.id ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.giveText}>Given</Text>
                )}
              </Pressable>
            </View>
          ))}
          {!online ? <Text style={styles.offline}>Needs internet to mark it given</Text> : null}
        </View>
      ) : owedOffline ? (
        <View style={[styles.box, styles.owedBox]}>
          <View style={styles.boxHead}>
            <View style={[styles.icon, styles.iconOwed]}>
              <IconGift size={17} color={colors.white} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.boxTitle}>
                {giftsOwedCount === 1 ? 'A welcome gift item is owed' : `${giftsOwedCount} welcome gift items owed`}
              </Text>
              <Text style={styles.boxMeta}>Connect to the internet to see what and mark it given.</Text>
            </View>
          </View>
        </View>
      ) : null}

      {welcome && welcome.length > 0 ? (
        <View style={[styles.box, styles.welcomeBox]}>
          <View style={styles.boxHead}>
            <View style={[styles.icon, styles.iconWelcome]}>
              <IconGift size={17} color={colors.tealDeep} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.boxTitle}>First visit · welcome gift</Text>
              <Text style={styles.boxMeta}>{welcome.map((g) => giftLine(g)).join(', ')}</Text>
              <Text style={styles.boxHint}>Hand it over when the wash is paid — it comes out of stock then.</Text>
              {outOfStock.length > 0 ? (
                <Text style={styles.offline}>
                  {outOfStock.map((g) => g.name).join(', ')} {outOfStock.length === 1 ? 'is' : 'are'} out of stock — it’ll be
                  saved as owed for their next visit.
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm },
  flex: { flex: 1, gap: 2 },
  box: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
  },
  owedBox: { backgroundColor: '#FFF7ED', borderColor: '#FDBA74' },
  welcomeBox: { backgroundColor: '#F0FDFA', borderColor: '#99F6E4' },
  boxHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOwed: { backgroundColor: '#EA580C' },
  iconWelcome: { backgroundColor: '#CCFBF1' },
  boxTitle: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  boxMeta: { ...typography.caption, color: colors.slateDeep, fontSize: 13, letterSpacing: 0 },
  boxHint: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  giftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: 48,
  },
  giftName: { ...typography.body, color: colors.waterInk, fontSize: 15, flex: 1 },
  giveBtn: {
    minWidth: 72,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: '#EA580C',
  },
  giveBtnOff: { backgroundColor: '#CBD5E1' },
  giveText: { ...typography.label, color: colors.white },
  offline: { ...typography.caption, color: colors.amberDeep, letterSpacing: 0 },
  pressed: { opacity: 0.85 },
});
