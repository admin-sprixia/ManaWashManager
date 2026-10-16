import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { USER_ROLE_LABEL } from '@mana/domain';
import {
  colors,
  spacing,
  typography,
  BottomSheet,
  showToast,
  showAlert,
  IconAlert,
  IconCheck,
} from '@mana/ui';
import { useAuth } from '../api/auth';
import { NetworkError } from '../api/network';
import { useShop, type MyShop } from '../offline/ShopProvider';
import { useSync } from '../offline/SyncProvider';

const offlineMessage = 'Switching shops needs a connection.';

/**
 * Anyone working at more than one branch: pick which branch the whole app shows. Each keeps its
 * own team, prices, money and stock; the PIN is the same for all of them. New branches are opened
 * by HQ, not from here.
 */
export function ShopSwitcherSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { switchShop } = useAuth();
  const { myShops, info } = useShop();
  const { pendingCount, online, syncNow } = useSync();
  const pendingRef = useRef(pendingCount);
  pendingRef.current = pendingCount;
  const [busyShop, setBusyShop] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setBusyShop(null);
    setError(null);
  }, [visible]);

  const currentName = info?.name ?? 'this shop';
  const shops: MyShop[] =
    myShops.length > 0
      ? myShops
      : info
        ? [{ shopId: 'current', name: info.name, city: info.city, code: info.code, current: true }]
        : [];

  // Entries made here wait for this shop's account; say so before leaving with some unsent.
  const confirmUnsynced = async (): Promise<boolean> => {
    if (pendingRef.current > 0 && online) await syncNow().catch(() => undefined);
    const left = pendingRef.current;
    if (left === 0) return true;
    return new Promise((resolve) => {
      showAlert(
        `${left} ${left === 1 ? 'entry hasn’t' : 'entries haven’t'} synced yet`,
        `They’re safe on this phone and will send the next time you open ${currentName}.`,
        [
          { text: 'Stay here', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Switch anyway', onPress: () => resolve(true) },
        ],
        { tone: 'warning' },
      );
    });
  };

  const pick = async (shop: MyShop) => {
    if (shop.current || busyShop) return;
    setError(null);
    if (!online) {
      setError(offlineMessage);
      return;
    }
    if (!(await confirmUnsynced())) return;
    setBusyShop(shop.shopId);
    try {
      await switchShop(shop.shopId);
      onClose();
      showToast(`Now showing ${shop.name}`);
    } catch (e) {
      setError(e instanceof NetworkError ? offlineMessage : (e as Error).message);
    } finally {
      setBusyShop(null);
    }
  };

  const busy = busyShop != null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title="Your branches"
      subtitle="The whole app shows the branch you pick. Each one keeps its own team, money and stock."
    >
      <View style={styles.list}>
        {shops.map((shop) => {
          const loading = busyShop === shop.shopId;
          return (
            <Pressable
              key={shop.shopId}
              onPress={() => void pick(shop)}
              disabled={busy || shop.current}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="radio"
              accessibilityState={{ selected: shop.current }}
            >
              <View style={[styles.badge, shop.current && styles.badgeOn]}>
                <Text style={[styles.badgeText, shop.current && styles.badgeTextOn]}>
                  {shop.name.trim().charAt(0).toUpperCase() || '#'}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {shop.name}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {[
                    shop.role ? USER_ROLE_LABEL[shop.role] : null,
                    shop.city,
                    `${shop.code}`,
                    shop.status === 'paused' ? 'Paused' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              {loading ? (
                <ActivityIndicator color={colors.water} />
              ) : shop.current ? (
                <View style={styles.tick}>
                  <IconCheck size={13} color={colors.white} />
                </View>
              ) : (
                <Text style={styles.openText}>Open</Text>
              )}
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <View style={styles.errorRow}>
          <IconAlert size={15} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  list: { marginHorizontal: -spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  badge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeOn: { backgroundColor: colors.water },
  badgeText: { ...typography.heading, fontSize: 17, color: colors.waterDeep },
  badgeTextOn: { color: colors.white },
  rowTitle: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk },
  rowSub: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slate,
    letterSpacing: 0,
    marginTop: 1,
  },
  tick: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.water,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openText: { ...typography.label, fontSize: 14, color: colors.water },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: {
    ...typography.caption,
    fontSize: 13,
    color: colors.danger,
    letterSpacing: 0,
    flex: 1,
  },
});
