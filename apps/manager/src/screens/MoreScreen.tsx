import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ScreenContainer,
  ScreenHeader,
  Avatar,
  showAlert,
  IconAlert,
  IconBox,
  IconBug,
  IconCalendarCheck,
  IconCar,
  IconChart,
  IconCheck,
  IconCloudOff,
  IconDrawer,
  IconEdit,
  IconGift,
  IconStar,
  IconReceipt,
  IconRupee,
  IconShield,
  IconSparkle,
  IconStore,
  IconSync,
  IconUserPlus,
  IconUsers,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { EdgeGroup, EdgeRow, Pill } from '../components/EdgeList';
import { ScreenHero, SectionTitle } from '../components/ScreenChrome';
import { EditProfileSheet } from '../components/EditProfileSheet';
import { ShopSwitcherSheet } from '../components/ShopSwitcherSheet';
import { EarningsCard } from '../components/EarningsCard';
import { HqToolsGroup } from '../components/HqToolsGroup';
import { AccountGroup } from '../components/AccountGroup';
import { USER_ROLE_LABEL } from '@mana/domain';
import { api } from '../api/client';
import { useAuth } from '../api/auth';
import { useSync } from '../offline/SyncProvider';
import { CacheKeys, readCache, writeCache } from '../offline/cache';
import { useShop } from '../offline/ShopProvider';
import { describeOp } from '../offline/types';
import { APP_VERSION } from '../config/app';
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

function feedbackSubtitle(problems: number, vehicles: number): string {
  const parts: string[] = [];
  if (problems) parts.push(`${problems} ${problems === 1 ? 'problem' : 'problems'} to sort out`);
  if (vehicles) parts.push(`${vehicles} ${vehicles === 1 ? 'vehicle' : 'vehicles'} to add`);
  return parts.join(' · ') || 'Problems, ratings and vehicles from customers';
}

export function MoreScreen({ navigation }: Props) {
  const { user, isOwner, isManager, canManageTeam } = useAuth();
  const {
    online,
    syncing,
    lastSyncedAt,
    myItems,
    items,
    shopItems,
    pendingCount,
    failedCount,
    syncNow,
    retry,
    discard,
  } = useSync();
  const [profileOpen, setProfileOpen] = useState(false);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const {
    unseenErrors,
    info: shop,
    stock,
    lowStock,
    myShops,
    rewards,
    rewardsOn,
    customerApp,
  } = useShop();
  const giftsOwed = rewards?.giftsOwed ?? 0;
  const [businessAdmin, setBusinessAdmin] = useState(false);
  // Whether this person is Mana Wash HQ. The last answer is kept on the phone, so being offline
  // (or one failed request) doesn't hide the HQ section; a fresh answer replaces it.
  const userId = user?.id;
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void readCache<{ userId: string; admin: boolean }>(CacheKeys.hq).then((last) => {
        if (alive && last && last.userId === userId) setBusinessAdmin(last.admin);
      });
      api.services.network
        .$get()
        .then((res) => (res.ok ? res.json() : null))
        .then((network) => {
          if (!alive || !network || !userId) return;
          setBusinessAdmin(network.isBusinessAdmin);
          void writeCache(CacheKeys.hq, { userId, admin: network.isBusinessAdmin });
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, [userId]),
  );
  if (!user) return null;

  const failed = myItems.filter((i) => i.state === 'failed');
  // A person on two branches has an account at each: their own changes from the other branch wait
  // for that branch, not for "a teammate".
  const notMine = items.filter((i) => i.userId !== user.id);
  const mineElsewhere = notMine.filter((i) => i.userName === user.name).length;
  const othersWaiting = notMine.length - mineElsewhere;
  // Teammates' changes made at this branch, which only they can send (under their own sign-in).
  const teammates = shopItems.filter((i) => i.userId !== user.id && i.userName !== user.name);
  const confirmDiscardTheirs = (id: string, who: string, label: string) => {
    showAlert(
      `Discard ${who}’s change?`,
      `“${label}” was saved by ${who} and never reached the server. Discard it only if ${who} won’t sign in on this phone again. It can’t be brought back.`,
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => void discard(id) },
      ],
    );
  };

  const confirmDiscard = (id: string, label: string) => {
    showAlert(
      'Discard this change?',
      `“${label}” will be removed from this phone and never synced.`,
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => void discard(id) },
      ],
    );
  };

  const syncStatus = !online
    ? {
        title: 'Offline',
        subtitle:
          pendingCount > 0 ? `${pendingCount} waiting to sync` : 'Changes save on this phone',
        tone: 'amber' as const,
      }
    : pendingCount > 0
      ? {
          title: 'Syncing…',
          subtitle: `${pendingCount} change${pendingCount === 1 ? '' : 's'} left`,
          tone: 'water' as const,
        }
      : failedCount > 0
        ? {
            title: 'Needs attention',
            subtitle: `${failedCount} couldn’t sync`,
            tone: 'danger' as const,
          }
        : {
            title: 'All synced',
            subtitle: lastSyncedAt
              ? `Last sync ${timeAgo(lastSyncedAt).toLowerCase()}`
              : 'Nothing waiting to send',
            tone: 'teal' as const,
          };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="More" onBack={() => navigation.goBack()} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable
          onPress={() => setProfileOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
        >
          <ScreenHero
            eyebrow={USER_ROLE_LABEL[user.role]}
            title={user.name}
            meta={`+91 ${
              user.phone.length === 10 ? `${user.phone.slice(0, 5)} ${user.phone.slice(5)}` : user.phone
            }${shop ? ` · ${shop.name}` : ''}`}
            tone={failedCount > 0 ? 'danger' : !online ? 'alert' : 'brand'}
            right={
              <View style={styles.heroRight}>
                <View style={styles.editBtn}>
                  <IconEdit size={14} color={colors.white} />
                  <Text style={styles.editText}>Edit</Text>
                </View>
                <View style={styles.heroAvatar}>
                  <Avatar name={user.name} id={user.id} size={40} />
                </View>
              </View>
            }
            chips={[
              { label: 'Sync', value: online ? (pendingCount > 0 ? 'Syncing' : 'Synced') : 'Offline' },
              ...(myShops.length > 0 ? [{ label: 'Branches', value: myShops.length }] : []),
              ...(lowStock > 0 ? [{ label: 'Low stock', value: lowStock }] : []),
            ]}
          />
        </Pressable>

        <SectionTitle>Sync</SectionTitle>
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
        {mineElsewhere > 0 ? (
          <Text style={styles.footnote}>
            {mineElsewhere} change{mineElsewhere === 1 ? '' : 's'} you made at another branch{' '}
            {mineElsewhere === 1 ? 'is' : 'are'} waiting on this phone —{' '}
            {mineElsewhere === 1 ? 'it syncs' : 'they sync'} when you switch back to that branch.
          </Text>
        ) : null}
        {othersWaiting > 0 ? (
          <Text style={styles.footnote}>
            {othersWaiting} change{othersWaiting === 1 ? '' : 's'} from another teammate{' '}
            {othersWaiting === 1 ? 'is' : 'are'} waiting on this phone —{' '}
            {othersWaiting === 1 ? 'it syncs' : 'they sync'} when they sign in here.
          </Text>
        ) : null}
        {canManageTeam && teammates.length > 0 ? (
          <EdgeGroup>
            {teammates.map((item) => {
              const who = item.userName.split(/\s+/)[0] ?? 'A teammate';
              return (
                <View key={item.id} style={styles.failedRow}>
                  <View style={styles.failedCopy}>
                    <Text style={styles.failedTitle}>{describeOp(item.op)}</Text>
                    <Text style={styles.failedMeta}>
                      {`${who}'s · saved ${formatDateTime(item.createdAt)}${item.state === 'failed' ? ' · couldn’t sync' : ''}`}
                    </Text>
                    {item.error ? <Text style={styles.failedError}>{item.error}</Text> : null}
                  </View>
                  <View style={styles.failedActions}>
                    <Pressable onPress={() => confirmDiscardTheirs(item.id, who, describeOp(item.op))} hitSlop={6}>
                      <Text style={styles.discardText}>Discard</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </EdgeGroup>
        ) : null}

        {!isOwner ? (
          <>
            <SectionTitle>My earnings</SectionTitle>
            <EarningsCard />
          </>
        ) : null}

        <SectionTitle meta={shop ? `${shop.name} · code ${shop.code}` : undefined}>Branch</SectionTitle>
        {isOwner ? (
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
              subtitle="Sales, commission and days worked per person"
              onPress={() => navigation.navigate('StaffReport')}
            />
            <EdgeRow
              icon={<IconCalendarCheck size={19} color={colors.tealDeep} />}
              iconBg="#CCFBF1"
              title="Attendance"
              subtitle="Mark who worked today"
              onPress={() => navigation.navigate('Attendance')}
            />
            <EdgeRow
              icon={<IconUsers size={19} color="#5B21B6" />}
              iconBg="#EDE9FE"
              title="Team"
              subtitle="Add staff and managers, reset PINs"
              onPress={() => navigation.navigate('Team')}
            />
          </EdgeGroup>
        ) : isManager ? (
          <EdgeGroup>
            <EdgeRow
              icon={<IconCalendarCheck size={19} color={colors.tealDeep} />}
              iconBg="#CCFBF1"
              title="Attendance"
              subtitle="Mark who worked today"
              onPress={() => navigation.navigate('Attendance')}
            />
            <EdgeRow
              icon={<IconUsers size={19} color="#5B21B6" />}
              iconBg="#EDE9FE"
              title="Team"
              subtitle="Add staff and reset their PINs"
              onPress={() => navigation.navigate('Team')}
            />
          </EdgeGroup>
        ) : null}

        {isOwner ? (
          <EdgeGroup>
            <EdgeRow
              icon={<IconRupee size={19} color={colors.amberDeep} />}
              iconBg="#FEF3C7"
              title="Prices"
              subtitle="This branch’s prices and staff commission"
              onPress={() => navigation.navigate('Settings')}
            />
            <EdgeRow
              icon={<IconCar size={19} color={colors.waterDeep} />}
              title="Vehicles"
              subtitle="What this branch washes, by size"
              onPress={() => navigation.navigate('BranchVehicles')}
            />
            <EdgeRow
              icon={<IconSparkle size={19} color={colors.indigo} />}
              iconBg={colors.indigoPale}
              title="How this branch washes"
              subtitle="Shop, community and doorstep, and their teams"
              onPress={() => navigation.navigate('ServicePoints')}
            />
            <EdgeRow
              icon={<IconStore size={19} color={colors.waterDeep} />}
              title="Branch details"
              subtitle="Name, contact, hours, location, UPI, review link"
              onPress={() => navigation.navigate('BranchProfile')}
            />
            <EdgeRow
              icon={<IconBug size={19} color={colors.slateDeep} />}
              iconBg="#F1F5F9"
              title="Error log"
              subtitle={unseenErrors > 0 ? `${unseenErrors} new since you last looked` : 'App crashes and server errors'}
              right={
                unseenErrors > 0 ? <Pill label={unseenErrors > 99 ? '99+' : String(unseenErrors)} tone="danger" /> : undefined
              }
              onPress={() => navigation.navigate('ErrorLog')}
            />
          </EdgeGroup>
        ) : null}

        <EdgeGroup>
          <EdgeRow
            icon={<IconDrawer size={19} color={colors.tealDeep} />}
            iconBg="#CCFBF1"
            title="Cash drawer"
            subtitle="Count the cash box morning and night"
            onPress={() => navigation.navigate('Cash')}
          />
          <EdgeRow
            icon={<IconReceipt size={19} color={colors.waterDeep} />}
            title="Expenses"
            subtitle={isOwner ? 'Log and review shop spending' : 'Log what you spent for the shop'}
            onPress={() => navigation.navigate('Expenses')}
          />
          <EdgeRow
            icon={<IconBox size={19} color={lowStock > 0 ? colors.amberDeep : colors.waterDeep} />}
            iconBg={lowStock > 0 ? '#FEF3C7' : undefined}
            title="Inventory"
            subtitle={
              lowStock > 0
                ? `${lowStock} item${lowStock === 1 ? '' : 's'} running low — buy soon`
                : stock.length > 0
                  ? `${stock.length} item${stock.length === 1 ? '' : 's'} in stock · log what you use`
                  : isOwner
                    ? 'Track shampoo, wax, cloths and bill books'
                    : 'Log the stock you use'
            }
            right={lowStock > 0 ? <Pill label={String(lowStock)} tone="amber" /> : undefined}
            onPress={() => navigation.navigate('Inventory')}
          />
          <EdgeRow
            icon={<IconGift size={19} color={giftsOwed > 0 ? '#C2410C' : colors.amberDeep} />}
            iconBg={giftsOwed > 0 ? '#FFEDD5' : '#FEF3C7'}
            title="Rewards"
            subtitle={
              giftsOwed > 0
                ? `${giftsOwed} welcome gift item${giftsOwed === 1 ? '' : 's'} still owed`
                : rewardsOn
                  ? 'Stamp cards and welcome gifts are on'
                  : isOwner
                    ? 'Stamp cards for a free wash, and a welcome gift for new cars'
                    : 'Stamp cards and welcome gifts'
            }
            right={giftsOwed > 0 ? <Pill label={String(giftsOwed)} tone="amber" /> : undefined}
            onPress={() => navigation.navigate('Rewards')}
          />
          <EdgeRow
            icon={<IconCar size={19} color={colors.indigo} />}
            iconBg={colors.indigoPale}
            title="Vehicle size guide"
            subtitle="Which size (S, M, L, XL) every car and bike is priced as"
            onPress={() => navigation.navigate('VehicleGuide')}
          />
        </EdgeGroup>

        {customerApp.listed || myShops.length > 1 ? (
          <EdgeGroup>
            {customerApp.listed ? (
              <EdgeRow
                icon={<IconUserPlus size={19} color={colors.waterDeep} />}
                title="People asking"
                subtitle={
                  customerApp.openRequests > 0
                    ? `${customerApp.openRequests} waiting for a call`
                    : 'People who want us in their area'
                }
                right={
                  customerApp.openRequests > 0 ? (
                    <Pill label={String(customerApp.openRequests)} tone="danger" />
                  ) : undefined
                }
                onPress={() => navigation.navigate('ServiceRequests')}
              />
            ) : null}
            {customerApp.listed ? (
              <EdgeRow
                icon={<IconStar size={19} color={colors.amberDeep} />}
                iconBg="#FEF3C7"
                title="Customer feedback"
                subtitle={feedbackSubtitle(customerApp.openProblems, customerApp.pendingVehicles)}
                right={
                  customerApp.openProblems + customerApp.pendingVehicles > 0 ? (
                    <Pill
                      label={String(customerApp.openProblems + customerApp.pendingVehicles)}
                      tone="danger"
                    />
                  ) : undefined
                }
                onPress={() =>
                  navigation.navigate('AppFeedback', {
                    tab: !customerApp.openProblems && customerApp.pendingVehicles ? 'vehicles' : 'problems',
                  })
                }
              />
            ) : null}
            {myShops.length > 1 ? (
              <EdgeRow
                icon={<IconSync size={18} color={colors.waterDeep} />}
                title="Switch branch"
                subtitle={`You work at ${myShops.length} branches · also at the top of the home screen`}
                onPress={() => setBranchesOpen(true)}
              />
            ) : null}
          </EdgeGroup>
        ) : null}

        {businessAdmin ? (
          <>
            <SectionTitle>Mana Wash HQ</SectionTitle>
            <HqToolsGroup />
          </>
        ) : null}

        <SectionTitle>Account</SectionTitle>
        <AccountGroup onEditProfile={() => setProfileOpen(true)} senior={user.role !== 'staff' || businessAdmin} />

        <Text style={styles.version}>Sri Mana Wash Partner · v{APP_VERSION}</Text>
      </ScrollView>

      <EditProfileSheet visible={profileOpen} onClose={() => setProfileOpen(false)} />
      <ShopSwitcherSheet
        visible={branchesOpen}
        onClose={() => setBranchesOpen(false)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl, gap: spacing.sm },
  heroRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroAvatar: {
    borderRadius: 24,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 6,
  },
  editText: { ...typography.label, color: colors.white, fontSize: 12 },
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
