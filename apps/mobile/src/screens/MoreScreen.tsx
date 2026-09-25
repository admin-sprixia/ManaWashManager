import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { ScreenHeader } from '../components/ScreenHeader';
import { Avatar } from '../components/Avatar';
import { EdgeGroup, EdgeRow, Pill, SectionLabel } from '../components/EdgeList';
import { SetPinSheet } from '../components/SetPinSheet';
import { EditProfileSheet } from '../components/EditProfileSheet';
import { showToast } from '../components/Toast';
import {
  IconAlert,
  IconChart,
  IconCheck,
  IconCloudOff,
  IconEdit,
  IconLock,
  IconPerson,
  IconLogout,
  IconReceipt,
  IconSettings,
  IconShield,
  IconSync,
  IconUsers,
} from '../components/Icons';
import { colors, radius, spacing, typography } from '../theme';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { useSync } from '../offline/SyncProvider';
import { describeOp } from '../offline/types';
import { formatDateTime } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'More'>;

function timeAgo(ts: number | null): string {
  if (!ts) return 'Not yet this session';
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}

export function MoreScreen({ navigation }: Props) {
  const { user, isOwner, signOut, refreshUser } = useAuth();
  const { online, syncing, lastSyncedAt, myItems, items, pendingCount, failedCount, syncNow, retry, discard } =
    useSync();
  const [pinOpen, setPinOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  if (!user) return null;

  const failed = myItems.filter((i) => i.state === 'failed');
  const othersWaiting = items.filter((i) => i.userId !== user.id).length;

  const confirmSignOut = () => {
    const waiting = myItems.length;
    Alert.alert(
      'Sign out?',
      waiting > 0
        ? `${waiting} change${waiting === 1 ? '' : 's'} haven’t synced yet. They stay safely on this phone and will sync the next time you sign in here.`
        : 'You can sign back in with an SMS code or your PIN.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
      ],
    );
  };

  const confirmDiscard = (id: string, label: string) => {
    Alert.alert('Discard this change?', `“${label}” will be removed from this phone and never synced.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => void discard(id) },
    ]);
  };

  const syncStatus = !online
    ? { title: 'Offline', subtitle: pendingCount > 0 ? `${pendingCount} waiting to sync` : 'Changes save on this phone', tone: 'amber' as const }
    : pendingCount > 0
      ? { title: 'Syncing…', subtitle: `${pendingCount} change${pendingCount === 1 ? '' : 's'} left`, tone: 'water' as const }
      : failedCount > 0
        ? { title: 'Needs attention', subtitle: `${failedCount} couldn’t sync`, tone: 'danger' as const }
        : { title: 'All synced', subtitle: `Last sync ${timeAgo(lastSyncedAt).toLowerCase()}`, tone: 'teal' as const };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="More" onBack={() => navigation.goBack()} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable
          style={styles.profile}
          android_ripple={{ color: colors.waterPale }}
          onPress={() => setProfileOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
        >
          <Avatar name={user.name} id={user.id} size={56} />
          <View style={styles.profileCopy}>
            <View style={styles.profileTop}>
              <Text style={styles.profileName} numberOfLines={1}>
                {user.name}
              </Text>
              <Pill label={isOwner ? 'OWNER' : 'STAFF'} tone={isOwner ? 'water' : 'slate'} />
            </View>
            <Text style={styles.profileMeta}>
              +91 {user.phone.length === 10 ? `${user.phone.slice(0, 5)} ${user.phone.slice(5)}` : user.phone}
            </Text>
          </View>
          <View style={styles.editBtn}>
            <IconEdit size={15} color={colors.waterDeep} />
            <Text style={styles.editText}>Edit</Text>
          </View>
        </Pressable>

        <SectionLabel>Sync</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={
              !online ? (
                <IconCloudOff size={18} color={colors.amberDeep} />
              ) : failedCount > 0 ? (
                <IconAlert size={18} color={colors.danger} />
              ) : pendingCount > 0 ? (
                <IconSync size={18} color={colors.waterDeep} />
              ) : (
                <IconCheck size={18} color={colors.teal} />
              )
            }
            iconBg={
              syncStatus.tone === 'amber'
                ? '#FEF3C7'
                : syncStatus.tone === 'danger'
                  ? '#FEE2E2'
                  : syncStatus.tone === 'teal'
                    ? '#CCFBF1'
                    : colors.waterPale
            }
            title={syncStatus.title}
            subtitle={syncStatus.subtitle}
            right={
              syncing ? (
                <ActivityIndicator color={colors.water} />
              ) : (
                <Pressable onPress={() => void syncNow()} hitSlop={8} style={styles.syncBtn}>
                  <Text style={styles.syncBtnText}>Sync now</Text>
                </Pressable>
              )
            }
          />
          {failed.map((item) => (
            <View key={item.id} style={styles.failedRow}>
              <View style={styles.failedCopy}>
                <Text style={styles.failedTitle}>{describeOp(item.op)}</Text>
                <Text style={styles.failedError}>{item.error ?? 'Rejected by the server.'}</Text>
                <Text style={styles.failedMeta}>Saved {formatDateTime(item.createdAt)}</Text>
              </View>
              <View style={styles.failedActions}>
                <Pressable onPress={() => void retry(item.id)} style={styles.retryBtn} hitSlop={6}>
                  <Text style={styles.retryText}>Retry</Text>
                </Pressable>
                <Pressable onPress={() => confirmDiscard(item.id, describeOp(item.op))} hitSlop={6}>
                  <Text style={styles.discardText}>Discard</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </EdgeGroup>
        {othersWaiting > 0 ? (
          <Text style={styles.footnote}>
            {othersWaiting} change{othersWaiting === 1 ? '' : 's'} from another teammate {othersWaiting === 1 ? 'is' : 'are'} waiting on this
            phone — {othersWaiting === 1 ? 'it syncs' : 'they sync'} when they sign in here.
          </Text>
        ) : null}

        <SectionLabel>Shift</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={<IconReceipt size={19} color={colors.waterDeep} />}
            title="Expenses"
            subtitle={isOwner ? 'Log and review shop spending' : 'Log what you spent for the shop'}
            onPress={() => navigation.navigate('Expenses')}
          />
        </EdgeGroup>

        {isOwner ? (
          <>
            <SectionLabel>Owner</SectionLabel>
            <EdgeGroup>
              <EdgeRow
                icon={<IconChart size={19} color={colors.waterDeep} />}
                title="Reports"
                subtitle="Revenue, expenses, net and exports"
                onPress={() => navigation.navigate('Reports')}
              />
              <EdgeRow
                icon={<IconShield size={19} color={colors.tealDeep} />}
                iconBg="#CCFBF1"
                title="Staff report"
                subtitle="Sales per person, voids and corrections"
                onPress={() => navigation.navigate('StaffReport')}
              />
              <EdgeRow
                icon={<IconUsers size={19} color="#5B21B6" />}
                iconBg="#EDE9FE"
                title="Team"
                subtitle="Add staff, roles, access and PINs"
                onPress={() => navigation.navigate('Team')}
              />
              <EdgeRow
                icon={<IconSettings size={19} color={colors.amberDeep} />}
                iconBg="#FEF3C7"
                title="Services & prices"
                subtitle="Cars, bikes, sizes and price list"
                onPress={() => navigation.navigate('Settings')}
              />
            </EdgeGroup>
          </>
        ) : null}

        <SectionLabel>Account</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={<IconPerson size={19} color={colors.waterDeep} />}
            title="Edit profile"
            subtitle="Your name and mobile number"
            onPress={() => setProfileOpen(true)}
          />
          <EdgeRow
            icon={<IconLock size={19} color={colors.waterDeep} />}
            title={user.hasPin ? 'Change PIN' : 'Set a PIN'}
            subtitle={user.hasPin ? 'Quick sign-in on this or any shop phone' : 'Sign in without waiting for an SMS'}
            onPress={() => setPinOpen(true)}
            right={!user.hasPin ? <Pill label="Recommended" tone="amber" /> : undefined}
          />
          <EdgeRow
            icon={<IconLogout size={19} color={colors.danger} />}
            iconBg="#FEE2E2"
            title="Sign out"
            tone="danger"
            chevron={false}
            onPress={confirmSignOut}
          />
        </EdgeGroup>

        <Text style={styles.version}>MANA Wash Manager · v2.0</Text>
      </ScrollView>

      <EditProfileSheet visible={profileOpen} onClose={() => setProfileOpen(false)} />

      <SetPinSheet
        visible={pinOpen}
        title={user.hasPin ? 'Change your PIN' : 'Set your PIN'}
        subtitle={`For +91 ${user.phone}`}
        onClose={() => setPinOpen(false)}
        onSubmit={async (pin) => {
          try {
            const res = await api.auth.pin.$put({ json: { pin } });
            if (!res.ok) return apiErrorMessage(res, 'Couldn’t save your PIN.');
            await refreshUser();
            setPinOpen(false);
            showToast('PIN saved — use it next time you sign in');
            return null;
          } catch (e) {
            return e instanceof NetworkError ? 'Setting a PIN needs a connection.' : 'Couldn’t save your PIN.';
          }
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 2,
    marginTop: spacing.md,
  },
  profileCopy: { flex: 1, gap: 4 },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  profileName: { ...typography.heading, color: colors.waterInk, flexShrink: 1 },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 6,
  },
  editText: { ...typography.label, color: colors.waterDeep, fontSize: 12 },
  profileMeta: { ...typography.body, color: colors.slateDeep, fontSize: 14 },
  syncBtn: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 6,
  },
  syncBtnText: { ...typography.label, color: colors.waterDeep, fontSize: 12 },
  failedRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    backgroundColor: '#FFFBFB',
  },
  failedCopy: { flex: 1, gap: 2 },
  failedTitle: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  failedError: { ...typography.caption, color: colors.danger, letterSpacing: 0, fontSize: 13 },
  failedMeta: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  failedActions: { alignItems: 'flex-end', justifyContent: 'center', gap: spacing.sm },
  retryBtn: {
    backgroundColor: colors.water,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  retryText: { ...typography.label, color: colors.white, fontSize: 12 },
  discardText: { ...typography.label, color: colors.danger, fontSize: 12 },
  footnote: {
    ...typography.caption,
    color: colors.slate,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    letterSpacing: 0,
  },
  version: {
    ...typography.caption,
    color: colors.slate,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
