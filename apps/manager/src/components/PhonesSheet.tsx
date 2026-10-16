import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { InferResponseType } from 'hono/client';
import {
  BottomSheet,
  Button,
  IconAlert,
  IconCheck,
  IconPhone,
  colors,
  radius,
  showAlert,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { SheetHead, SheetNotice, SheetPill } from './SheetBits';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { formatDateTime } from '../utils/format';

type Phone = InferResponseType<(typeof api)['auth']['devices']['$get'], 200>['devices'][number];

/**
 * Every phone your number is trusted (and may be signed in) on. Sign out one you don't use or
 * recognise, or all of them at once after losing or sharing a phone; this phone stays in.
 */
export function PhonesSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { signIn } = useAuth();
  const [phones, setPhones] = useState<Phone[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.auth.devices.$get();
      if (!res.ok) return setError(await apiErrorMessage(res, 'Couldn’t load your phones.'));
      setPhones((await res.json()).devices);
    } catch (e) {
      setError(e instanceof NetworkError ? 'You’re offline. Connect to see your phones.' : 'Couldn’t load your phones.');
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setPhones(null);
    void load();
  }, [visible, load]);

  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      const message = await action();
      if (message) setError(message);
    } catch (e) {
      setError(e instanceof NetworkError ? 'You’re offline. Try again when connected.' : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const remove = (phone: Phone) =>
    showAlert(
      `Sign out ${phone.label ?? 'this phone'}?`,
      'It’s signed out straight away. To use it again you’ll need a WhatsApp code and your PIN.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              const res = await api.auth.devices[':id'].$delete({ param: { id: phone.id } });
              if (!res.ok) return apiErrorMessage(res, 'Couldn’t sign out that phone.');
              showToast(`${phone.label ?? 'Phone'} signed out`);
              await load();
              return null;
            }),
        },
      ],
    );

  const signOutOthers = () =>
    showAlert(
      'Sign out all other phones?',
      'Every other phone signed in as you is signed out straight away and needs a WhatsApp code and your PIN to come back. This phone stays signed in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out others',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              const res = await api.auth.devices['sign-out-others'].$post();
              if (!res.ok) return apiErrorMessage(res, 'Couldn’t sign out your other phones.');
              const session = await res.json();
              if ('token' in session) await signIn(session.token, session.user);
              showToast('All other phones signed out');
              await load();
              return null;
            }),
        },
      ],
    );

  const others = phones?.filter((p) => !p.current) ?? [];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title="Your phones"
      subtitle="Phones that can sign in as you with just your PIN"
      footer={
        others.length > 0 ? (
          <Button label="Sign out all other phones" variant="danger" size="lg" loading={busy} onPress={signOutOthers} />
        ) : undefined
      }
    >
      {phones == null && !error ? <ActivityIndicator color={colors.indigo} style={styles.loading} /> : null}
      {phones ? (
        <SheetHead
          icon={<IconPhone size={22} color={colors.indigo} />}
          title={`${phones.length} phone${phones.length === 1 ? '' : 's'} signed in`}
          caption={
            others.length > 0
              ? 'Sign out any you don’t use or recognise.'
              : 'Only this phone is signed in as you.'
          }
        />
      ) : null}
      {phones && phones.length > 0 ? (
        <View style={styles.list}>
          {phones.map((p, i) => (
            <View key={p.id} style={[styles.row, i < phones.length - 1 && styles.divider]}>
              <View style={[styles.rowIcon, p.current && styles.rowIconCurrent]}>
                {p.current ? (
                  <IconCheck size={17} color={colors.tealDeep} />
                ) : (
                  <IconPhone size={17} color={colors.indigo} />
                )}
              </View>
              <View style={styles.text}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {p.label ?? 'Unknown phone'}
                  </Text>
                  {p.current ? <SheetPill tone="teal" label="This phone" /> : null}
                </View>
                <Text style={styles.meta}>
                  Last signed in {formatDateTime(p.lastUsedAt)} · added {formatDateTime(p.createdAt)}
                </Text>
              </View>
              {!p.current ? (
                <Button label="Sign out" variant="ghost" disabled={busy} onPress={() => remove(p)} />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {error ? (
        <SheetNotice tone="danger" icon={<IconAlert size={14} color={colors.danger} />}>
          {error}
        </SheetNotice>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: spacing.lg },
  list: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.sm + 4,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingVertical: spacing.sm + 4 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.indigoPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconCurrent: { backgroundColor: colors.tealPale },
  text: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { ...typography.bodyStrong, fontSize: 15, color: colors.ink, fontWeight: '800', flexShrink: 1 },
  meta: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0, lineHeight: 16 },
});
