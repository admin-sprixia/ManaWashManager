import React, { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { REFERRAL_OFFER_TEXT } from '@mana/domain';
import {
  IconEdit,
  IconLogout,
  IconPhone,
  IconShield,
  IconStore,
  IconTrash,
  IconUserPlus,
  colors,
  formatPhone,
  radius,
  showAlert,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { EdgeGroup, EdgeRow, SectionLabel } from '../components/CardList';
import { api, send } from '../api/client';
import { errorMessage } from '../api/errors';
import { useAccount, useAuth } from '../auth/AuthProvider';
import { EditNameSheet } from '../components/EditNameSheet';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { TabTitle } from '../components/TabTitle';
import { APP_NAME, APP_VERSION, SUPPORT_EMAIL } from '../config/app';
import type { MainStackParams, TabParams } from '../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParams, 'Profile'>,
  NativeStackScreenProps<MainStackParams>
>;

/** Who's signed in, their branches, and signing out or deleting the app account. */
export function ProfileScreen({ navigation }: Props) {
  const account = useAccount();
  const { signOut, refreshAccount } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [editingName, setEditingName] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshAccount();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const confirmSignOut = () =>
    showAlert('Sign out?', 'You can sign in again any time with your number.', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut(null) },
    ], { plain: true });

  const confirmSignOutEverywhere = () =>
    showAlert('Sign out on all phones?', 'Every phone signed in with your number, this one too, will need a new code.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out everywhere',
        style: 'destructive',
        onPress: () => {
          void send(api.me['sign-out-everywhere'].$post())
            .then(() => signOut('You signed out on all phones.'))
            .catch((err: unknown) => showToast(errorMessage(err), 'error'));
        },
      },
    ], { plain: true });

  const confirmDelete = () =>
    showAlert(
      'Delete your app account?',
      'You’ll be signed out everywhere. Your washes stay with the car wash, as their records. Sign in again any time to see them.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void send(api.me.$delete())
              .then(() => signOut('Your app account was deleted.'))
              .catch((err: unknown) => showToast(errorMessage(err), 'error'));
          },
        },
      ],
      { plain: true },
    );

  return (
    <View style={styles.screen}>
      <TabTitle title="Profile" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <View style={styles.top} />
        <EdgeGroup>
          <Pressable
            onPress={() => setEditingName(true)}
            android_ripple={{ color: colors.indigoPale }}
            style={({ pressed }) => [styles.profile, pressed && styles.profilePressed]}
            accessibilityRole="button"
            accessibilityLabel="Edit your name"
          >
            <ProfileAvatar name={account.name ?? 'MANA'} size={56} />
            <View style={styles.profileCopy}>
              <Text style={styles.profileName} numberOfLines={1}>
                {account.name ?? 'Add your name'}
              </Text>
              <Text style={styles.profileMeta}>+91 {formatPhone(account.phone)}</Text>
            </View>
            <View style={styles.editBtn}>
              <IconEdit size={15} color={colors.indigoMid} />
              <Text style={styles.editText}>Edit</Text>
            </View>
          </Pressable>
        </EdgeGroup>

        <SectionLabel>MANA Car Wash</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={<IconUserPlus size={19} color={colors.tealDeep} />}
            iconBg={colors.tealPale}
            title="Invite friends"
            subtitle={`They get ${REFERRAL_OFFER_TEXT} their first wash`}
            onPress={() => navigation.navigate('Refer')}
          />
          <EdgeRow
            icon={<IconPhone size={18} color={colors.waterDeep} />}
            title="Help & support"
            subtitle="Call the branch or report a problem"
            onPress={() => navigation.navigate('Help')}
          />
        </EdgeGroup>

        <SectionLabel>{account.branches.length > 1 ? 'Your branches' : 'Your branch'}</SectionLabel>
        <EdgeGroup>
          {account.branches.map((b, i) => (
            <EdgeRow
              key={`${b.id}:${i}`}
              icon={<IconStore size={19} color={colors.waterDeep} />}
              title={b.name}
              subtitle={b.city ?? undefined}
              onPress={() => navigation.navigate('Tabs', { screen: 'Visit' })}
            />
          ))}
        </EdgeGroup>

        <SectionLabel>Account</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={<IconLogout size={18} color={colors.waterDeep} />}
            title="Sign out"
            onPress={confirmSignOut}
          />
          <EdgeRow
            icon={<IconShield size={18} color={colors.waterDeep} />}
            title="Sign out on all phones"
            subtitle="If you lost a phone or shared your code"
            onPress={confirmSignOutEverywhere}
          />
          <EdgeRow
            icon={<IconTrash size={18} color={colors.danger} />}
            iconBg={colors.dangerPale}
            title="Delete app account"
            subtitle="Your washes stay with the car wash"
            tone="danger"
            onPress={confirmDelete}
          />
        </EdgeGroup>

        <Text style={styles.footer} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
          {APP_NAME} {APP_VERSION} · {SUPPORT_EMAIL}
        </Text>
      </ScrollView>
      <EditNameSheet visible={editingName} current={account.name} onClose={() => setEditingName(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: spacing.xxl },
  top: { height: 20 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 16, minHeight: 90, backgroundColor: colors.white },
  profilePressed: { backgroundColor: colors.surface },
  profileCopy: { flex: 1, gap: 3 },
  profileName: { fontSize: 19, fontWeight: '800', color: colors.ink, letterSpacing: -0.2 },
  profileMeta: { fontSize: 14, color: colors.slateDeep },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  editText: { fontSize: 12.5, fontWeight: '700', color: colors.indigoMid },
  footer: { ...typography.caption, color: colors.slate, letterSpacing: 0, textAlign: 'center', marginTop: spacing.lg },
});
