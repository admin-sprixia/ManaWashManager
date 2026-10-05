import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BRANCH_PRICE_LABEL, formatShopCode, MAX_SHOPS_PER_OWNER } from '@mana/domain';
import {
  colors,
  radius,
  spacing,
  typography,
  BottomSheet,
  Button,
  showToast,
  showAlert,
  IconAlert,
  IconCheck,
  IconPlus,
} from '@mana/ui';
import { api } from '../api/client';
import { useAuth } from '../api/auth';
import { NetworkError } from '../api/network';
import { useShop, type MyShop } from '../offline/ShopProvider';
import { useSync } from '../offline/SyncProvider';
import { handlePlanError } from './UpgradeSheet';

type Mode = 'list' | 'add';

const offlineMessage = 'Switching shops needs a connection.';

/**
 * Owners running more than one branch: pick which shop the whole app shows, or open a new one.
 * Each shop keeps its own team, prices, money and stock; the PIN is the same for all of them.
 */
export function ShopSwitcherSheet({
  visible,
  onClose,
  startWith = 'list',
}: {
  visible: boolean;
  onClose: () => void;
  startWith?: Mode;
}) {
  const { switchShop, signIn } = useAuth();
  const { myShops, canAddShop, info } = useShop();
  const { pendingCount, online, syncNow } = useSync();
  const pendingRef = useRef(pendingCount);
  pendingRef.current = pendingCount;
  const [mode, setMode] = useState<Mode>(startWith);
  const [busyShop, setBusyShop] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [focus, setFocus] = useState<'name' | 'city' | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setMode(startWith);
    setBusyShop(null);
    setName('');
    setCity('');
    setError(null);
    setCreating(false);
  }, [visible, startWith]);

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

  const trimmed = name.trim().replace(/\s+/g, ' ');
  const canCreate = trimmed.length >= 2 && !creating;

  const create = async () => {
    if (!canCreate) return;
    setError(null);
    if (!(await confirmUnsynced())) return;
    setCreating(true);
    try {
      const res = await api.auth.shops.$post({
        json: { shopName: trimmed, city: city.trim() || undefined },
      });
      if (res.status === 402) {
        onClose();
        await handlePlanError(res);
        return;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || !('token' in body)) {
        const message = body && 'message' in body ? body.message : null;
        throw new Error(message ?? 'Couldn’t open the new shop.');
      }
      await signIn(body.token, body.user);
      onClose();
      showToast(`${trimmed} is ready — add its prices in More → Services & prices`);
    } catch (e) {
      setError(
        e instanceof NetworkError ? 'Opening a new shop needs a connection.' : (e as Error).message,
      );
    } finally {
      setCreating(false);
    }
  };

  const busy = busyShop != null || creating;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={mode === 'add' ? 'Open another shop' : 'Your shops'}
      subtitle={
        mode === 'add'
          ? 'A new branch with its own shop ID, team, prices and money. Same number and PIN.'
          : 'The whole app shows the shop you pick. Each one keeps its own team, money and stock.'
      }
      footer={
        mode === 'add' ? (
          <View style={styles.footerStack}>
            <Button
              label={trimmed.length < 2 ? 'Enter the shop name' : `Open ${trimmed}`}
              onPress={() => void create()}
              disabled={!canCreate}
              loading={creating}
            />
            {startWith === 'list' ? (
              <Pressable
                onPress={() => setMode('list')}
                disabled={creating}
                hitSlop={8}
                style={styles.backLink}
              >
                <Text style={styles.backText}>Back to your shops</Text>
              </Pressable>
            ) : null}
          </View>
        ) : undefined
      }
    >
      {mode === 'list' ? (
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
                    {[shop.city, `ID ${formatShopCode(shop.code)}`].filter(Boolean).join(' · ')}
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

          {canAddShop ? (
            <Pressable
              onPress={() => {
                setError(null);
                setMode('add');
              }}
              disabled={busy}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <View style={[styles.badge, styles.addBadge]}>
                <IconPlus size={18} color={colors.waterDeep} />
              </View>
              <View style={styles.flex}>
                <Text style={[styles.rowTitle, styles.addTitle]}>Open another shop</Text>
                <Text style={styles.rowSub}>A new branch, managed from this same login</Text>
              </View>
            </Pressable>
          ) : shops.length >= MAX_SHOPS_PER_OWNER ? (
            <Text style={styles.note}>
              You can run up to {MAX_SHOPS_PER_OWNER} shops on one number.
            </Text>
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>New shop name</Text>
            <TextInput
              style={[styles.input, focus === 'name' && styles.inputFocus]}
              value={name}
              onChangeText={setName}
              onFocus={() => setFocus('name')}
              onBlur={() => setFocus(null)}
              placeholder="e.g. Mana Car Wash – Kavali"
              placeholderTextColor={colors.slate}
              maxLength={60}
              autoCapitalize="words"
              autoFocus
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>City or area (optional)</Text>
            <TextInput
              style={[styles.input, focus === 'city' && styles.inputFocus]}
              value={city}
              onChangeText={setCity}
              onFocus={() => setFocus('city')}
              onBlur={() => setFocus(null)}
              placeholder="e.g. Kavali"
              placeholderTextColor={colors.slate}
              maxLength={40}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.facts}>
            {[
              'Its own shop ID — staff there join with that ID',
              'Starts empty: add its services and prices once',
              `Starts on Free — Pro for this branch is ${BRANCH_PRICE_LABEL}`,
              'Switch any time from the top of the home screen',
            ].map((fact) => (
              <View key={fact} style={styles.fact}>
                <View style={styles.factDot}>
                  <IconCheck size={10} color={colors.white} />
                </View>
                <Text style={styles.factText}>{fact}</Text>
              </View>
            ))}
          </View>
        </>
      )}

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
  addBadge: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: colors.white,
  },
  rowTitle: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk },
  addTitle: { color: colors.waterDeep },
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
  note: {
    ...typography.caption,
    color: colors.slate,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  field: { gap: 6 },
  label: { ...typography.caption, color: colors.slateDeep },
  input: {
    ...typography.body,
    fontSize: 16,
    height: 50,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.waterInk,
  },
  inputFocus: { borderColor: colors.water, backgroundColor: colors.white },
  facts: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  fact: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  factDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  factText: { ...typography.body, fontSize: 14, color: colors.slateDeep, flex: 1 },
  footerStack: { gap: spacing.sm },
  backLink: { alignSelf: 'center', paddingVertical: 4 },
  backText: { ...typography.label, fontSize: 14, color: colors.water },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: {
    ...typography.caption,
    fontSize: 13,
    color: colors.danger,
    letterSpacing: 0,
    flex: 1,
  },
});
