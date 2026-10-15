import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { InferResponseType } from 'hono/client';
import { BottomSheet, Button, colors, showAlert, showToast, spacing, typography } from '@mana/ui';
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
      {phones == null && !error ? <ActivityIndicator color={colors.waterDeep} style={styles.loading} /> : null}
      {phones?.map((p) => (
        <View key={p.id} style={styles.row}>
          <View style={styles.text}>
            <Text style={styles.name}>
              {p.label ?? 'Unknown phone'}
              {p.current ? '  · This phone' : ''}
            </Text>
            <Text style={styles.meta}>
              Last signed in {formatDateTime(p.lastUsedAt)} · added {formatDateTime(p.createdAt)}
            </Text>
          </View>
          {!p.current ? <Button label="Sign out" variant="ghost" disabled={busy} onPress={() => remove(p)} /> : null}
        </View>
      ))}
      {phones && others.length === 0 ? <Text style={styles.meta}>No other phones are signed in as you.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  text: { flex: 1 },
  name: { ...typography.body, color: colors.ink, fontWeight: '600' },
  meta: { ...typography.caption, color: colors.slate },
  error: { ...typography.caption, color: colors.danger, fontWeight: '600', marginTop: spacing.xs },
});
