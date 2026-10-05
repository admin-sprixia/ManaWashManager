import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { formatShopCode } from '@mana/domain';
import {
  colors,
  gradients,
  radius,
  spacing,
  typography,
  BottomSheet,
  Button,
  showToast,
  IconAlert,
  IconShare,
  IconStore,
} from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useShop } from '../offline/ShopProvider';
import { shareShopInvite } from '../utils/shopInvite';

/** Owner: the shop's name and city (what customers see on messages and PDFs), plus the invite. */
export function ShopDetailsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { info, refresh } = useShop();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [focus, setFocus] = useState<'name' | 'city' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(info?.name ?? '');
    setCity(info?.city ?? '');
    setError(null);
    setSaving(false);
  }, [visible, info?.name, info?.city]);

  const trimmed = name.trim().replace(/\s+/g, ' ');
  const changed = trimmed !== (info?.name ?? '') || city.trim() !== (info?.city ?? '');
  const canSave = trimmed.length >= 2 && changed && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.shop.info.$put({ json: { name: trimmed, city: city.trim() || null } });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t save the shop name.'));
      await refresh();
      showToast('Shop details saved');
      onClose();
    } catch (e) {
      setError(
        e instanceof NetworkError
          ? 'Changing the shop name needs a connection.'
          : (e as Error).message,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!saving}
      title="Shop details"
      subtitle="Customers see this name on WhatsApp messages and reports."
      footer={
        <Button
          label={
            trimmed.length < 2 ? 'Enter the shop name' : changed ? 'Save changes' : 'No changes yet'
          }
          onPress={() => void save()}
          disabled={!canSave}
          loading={saving}
        />
      }
    >
      <LinearGradient
        colors={gradients.hero as unknown as string[]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.card}
      >
        <View pointerEvents="none" style={styles.orb} />
        <View style={styles.cardIcon}>
          <IconStore size={24} color={colors.waterDeep} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.cardName} numberOfLines={1}>
            {trimmed || 'Your shop'}
          </Text>
          <Text style={styles.cardMeta} numberOfLines={1}>
            {[city.trim() || null, info ? `Shop ID ${formatShopCode(info.code)}` : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </LinearGradient>

      <View style={styles.field}>
        <Text style={styles.label}>Shop name</Text>
        <TextInput
          style={[styles.input, focus === 'name' && styles.inputFocus]}
          value={name}
          onChangeText={setName}
          onFocus={() => setFocus('name')}
          onBlur={() => setFocus(null)}
          placeholder="e.g. Sai Car Spa"
          placeholderTextColor={colors.slate}
          maxLength={60}
          autoCapitalize="words"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>City (optional)</Text>
        <TextInput
          style={[styles.input, focus === 'city' && styles.inputFocus]}
          value={city}
          onChangeText={setCity}
          onFocus={() => setFocus('city')}
          onBlur={() => setFocus(null)}
          placeholder="e.g. Hyderabad"
          placeholderTextColor={colors.slate}
          maxLength={40}
          autoCapitalize="words"
        />
      </View>

      {info ? (
        <Pressable
          onPress={() => shareShopInvite(info)}
          style={({ pressed }) => [styles.shareRow, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <IconShare size={17} color={colors.waterDeep} />
          <View style={styles.flex}>
            <Text style={styles.shareTitle}>Invite a teammate</Text>
            <Text style={styles.shareSub}>
              Sends the shop ID {formatShopCode(info.code)} with join steps
            </Text>
          </View>
        </Pressable>
      ) : null}

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
  pressed: { opacity: 0.75 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.md,
    overflow: 'hidden',
  },
  orb: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.12)',
    top: -60,
    right: -40,
  },
  cardIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardName: { ...typography.heading, fontSize: 20, color: colors.white },
  cardMeta: { ...typography.label, fontSize: 13, color: 'rgba(255,255,255,0.9)' },
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
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingVertical: spacing.sm + 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  shareTitle: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  shareSub: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: {
    ...typography.caption,
    fontSize: 13,
    color: colors.danger,
    letterSpacing: 0,
    flex: 1,
  },
});
