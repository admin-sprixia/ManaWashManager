import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ScreenContainer,
  ScreenHeader,
  Avatar,
  showToast,
  showAlert,
  IconAlert,
  IconBox,
  IconBug,
  IconCalendarCheck,
  IconChart,
  IconCheck,
  IconCloudOff,
  IconDrawer,
  IconEdit,
  IconGift,
  IconStar,
  IconLock,
  IconPerson,
  IconPlus,
  IconLogout,
  IconMapPin,
  IconReceipt,
  IconSettings,
  IconShare,
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
import { EdgeGroup, EdgeRow, Pill, SectionLabel } from '../components/EdgeList';
import { SetPinSheet } from '../components/SetPinSheet';
import { EditProfileSheet } from '../components/EditProfileSheet';
import { ReviewLinkSheet } from '../components/ReviewLinkSheet';
import { ShopDetailsSheet } from '../components/ShopDetailsSheet';
import { ShopSwitcherSheet } from '../components/ShopSwitcherSheet';
import { EarningsCard } from '../components/EarningsCard';
import { formatShopCode, isPaidPro, type ProFeature } from '@mana/domain';
import { shareShopInvite } from '../utils/shopInvite';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { useSync } from '../offline/SyncProvider';
import { useShop } from '../offline/ShopProvider';
import { usePlan, useProPill } from '../offline/PlanProvider';
import { showUpgrade } from '../components/UpgradeSheet';
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
  const { user, isOwner, signOut, signIn } = useAuth();
  const {
    online,
    syncing,
    lastSyncedAt,
    myItems,
    items,
    pendingCount,
    failedCount,
    syncNow,
    retry,
    discard,
  } = useSync();
  const [pinOpen, setPinOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [branches, setBranches] = useState<'list' | 'add' | null>(null);
  const {
    googleReviewUrl,
    unseenErrors,
    joinRequests,
    info: shop,
    stock,
    lowStock,
    myShops,
    canAddShop,
    rewards,
    rewardsOn,
    customerApp,
  } = useShop();
  const giftsOwed = rewards?.giftsOwed ?? 0;
  const { plan, isPro, washesUsed } = usePlan();
  const proPill = useProPill();

  if (!user) return null;

  /** Pro rows open as usual on Pro; on Free they explain the feature and offer the upgrade. */
  const openPro = (feature: ProFeature, go: () => void) =>
    isPro ? go() : showUpgrade({ kind: 'feature', feature });
  // Unknown plan (offline, first load): let the server decide.
  const canOpenBranch = !plan || isPaidPro(plan);

  const planRow = !plan
    ? null
    : plan.state === 'trial' && isPro
      ? {
          title: `Pro trial · ${plan.daysLeft} day${plan.daysLeft === 1 ? '' : 's'} left`,
          subtitle: 'Upgrade anytime — the trial days you have left carry on',
          pill: <Pill label="TRIAL" tone={(plan.daysLeft ?? 99) <= 3 ? 'amber' : 'water'} />,
        }
      : isPro
        ? {
            title: plan.state === 'grace' ? 'Pro · payment due' : 'Pro',
            subtitle:
              plan.state === 'grace'
                ? 'The last payment didn’t go through — tap to check'
                : 'Unlimited washes and every feature',
            pill: plan.state === 'grace' ? <Pill label="ACTION" tone="amber" /> : <Pill label="PRO" tone="teal" />,
          }
        : {
            title: 'Free plan',
            subtitle: `${washesUsed} of ${plan.limits.washesPerMonth ?? '∞'} washes this month · see what Pro adds`,
            pill: <Pill label="UPGRADE" tone="water" />,
          };

  const failed = myItems.filter((i) => i.state === 'failed');
  const othersWaiting = items.filter((i) => i.userId !== user.id).length;

  const confirmSignOut = () => {
    const waiting = myItems.length;
    showAlert(
      'Sign out?',
      waiting > 0
        ? `${waiting} change${waiting === 1 ? '' : 's'} haven’t synced yet. They stay safely on this phone and will sync the next time you sign in here.`
        : 'You’ll sign back in with your number and PIN.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
      ],
      { icon: <IconLogout size={26} color={colors.danger} /> },
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
            subtitle: `Last sync ${timeAgo(lastSyncedAt).toLowerCase()}`,
            tone: 'teal' as const,
          };

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
              +91{' '}
              {user.phone.length === 10
                ? `${user.phone.slice(0, 5)} ${user.phone.slice(5)}`
                : user.phone}
            </Text>
          </View>
          <View style={styles.editBtn}>
            <IconEdit size={15} color={colors.waterDeep} />
            <Text style={styles.editText}>Edit</Text>
          </View>
        </Pressable>

        {shop ? (
          <>
            <SectionLabel>Shop</SectionLabel>
            <EdgeGroup>
              <EdgeRow
                icon={<IconStore size={19} color={colors.waterDeep} />}
                title={shop.name}
                subtitle={
                  isOwner
                    ? `Shop ID ${formatShopCode(shop.code)} · tap to rename or invite`
                    : `Shop ID ${formatShopCode(shop.code)} · new teammates use it to ask to join`
                }
                right={
                  isOwner ? (
                    <Pill label="Edit" tone="water" />
                  ) : (
                    <IconShare size={18} color={colors.water} />
                  )
                }
                chevron={false}
                onPress={() => (isOwner ? setShopOpen(true) : shareShopInvite(shop))}
              />
              {isOwner && myShops.length > 1 ? (
                <EdgeRow
                  icon={<IconSync size={18} color={colors.waterDeep} />}
                  title="Switch shop"
                  subtitle={`You run ${myShops.length} shops · also at the top of the home screen`}
                  onPress={() => setBranches('list')}
                />
              ) : isOwner && canAddShop ? (
                <EdgeRow
                  icon={<IconPlus size={18} color={colors.waterDeep} />}
                  title="Open another shop"
                  subtitle="Got a second branch? Run both from this login"
                  right={canOpenBranch ? undefined : <Pill label="PRO" tone="slate" />}
                  onPress={() =>
                    canOpenBranch ? setBranches('add') : showUpgrade({ kind: 'feature', feature: 'branches' })
                  }
                />
              ) : null}
            </EdgeGroup>
          </>
        ) : null}

        {isOwner && planRow ? (
          <>
            <SectionLabel>Your plan</SectionLabel>
            <EdgeGroup>
              <EdgeRow
                icon={<IconSparkle size={19} color={colors.waterDeep} />}
                title={planRow.title}
                subtitle={planRow.subtitle}
                right={planRow.pill}
                onPress={() => navigation.navigate('Plan')}
              />
            </EdgeGroup>
          </>
        ) : null}

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
            {othersWaiting} change{othersWaiting === 1 ? '' : 's'} from another teammate{' '}
            {othersWaiting === 1 ? 'is' : 'are'} waiting on this phone —{' '}
            {othersWaiting === 1 ? 'it syncs' : 'they sync'} when they sign in here.
          </Text>
        ) : null}

        {!isOwner && isPro ? (
          <>
            <SectionLabel>My earnings</SectionLabel>
            <EarningsCard />
          </>
        ) : null}

        <SectionLabel>Shift</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={<IconDrawer size={19} color={colors.tealDeep} />}
            iconBg="#CCFBF1"
            title="Cash drawer"
            subtitle="Count the cash box morning and night"
            right={proPill}
            onPress={() => openPro('cashDrawer', () => navigation.navigate('Cash'))}
          />
          <EdgeRow
            icon={<IconReceipt size={19} color={colors.waterDeep} />}
            title="Expenses"
            subtitle={isOwner ? 'Log and review shop spending' : 'Log what you spent for the shop'}
            right={proPill}
            onPress={() => openPro('expenses', () => navigation.navigate('Expenses'))}
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
            right={isPro && lowStock > 0 ? <Pill label={String(lowStock)} tone="amber" /> : proPill}
            onPress={() => openPro('inventory', () => navigation.navigate('Inventory'))}
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
            right={isPro && giftsOwed > 0 ? <Pill label={String(giftsOwed)} tone="amber" /> : proPill}
            onPress={() => openPro('rewards', () => navigation.navigate('Rewards'))}
          />
        </EdgeGroup>

        {customerApp.listed || isOwner ? (
          <>
            <SectionLabel>MANA Car Wash app</SectionLabel>
            <EdgeGroup>
              {customerApp.listed ? (
                <EdgeRow
                  icon={<IconUserPlus size={19} color={colors.waterDeep} />}
                  title="Service requests"
                  subtitle={
                    customerApp.openRequests > 0
                      ? `${customerApp.openRequests} waiting for a call`
                      : 'People asking for doorstep washing'
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
              {isOwner ? (
                <EdgeRow
                  icon={<IconMapPin size={19} color={colors.tealDeep} />}
                  iconBg="#CCFBF1"
                  title="Branch in the app"
                  subtitle="Address, hours, and where you wash"
                  onPress={() => navigation.navigate('ServiceArea')}
                />
              ) : null}
            </EdgeGroup>
          </>
        ) : null}

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
                subtitle="Sales, commission and days worked per person"
                right={proPill}
                onPress={() => openPro('staffReport', () => navigation.navigate('StaffReport'))}
              />
              <EdgeRow
                icon={<IconCalendarCheck size={19} color={colors.tealDeep} />}
                iconBg="#CCFBF1"
                title="Attendance"
                subtitle="Mark who worked today"
                right={proPill}
                onPress={() => openPro('attendance', () => navigation.navigate('Attendance'))}
              />
              <EdgeRow
                icon={<IconUsers size={19} color="#5B21B6" />}
                iconBg="#EDE9FE"
                title="Team"
                subtitle={
                  joinRequests > 0
                    ? `${joinRequests} waiting to join`
                    : 'Add staff, roles, access and PINs'
                }
                right={
                  joinRequests > 0 ? <Pill label={String(joinRequests)} tone="danger" /> : undefined
                }
                onPress={() => navigation.navigate('Team')}
              />
              <EdgeRow
                icon={<IconSettings size={19} color={colors.amberDeep} />}
                iconBg="#FEF3C7"
                title="Services & prices"
                subtitle="Price list and staff commission"
                onPress={() => navigation.navigate('Settings')}
              />
              <EdgeRow
                icon={<IconStar size={19} color={colors.amberDeep} />}
                iconBg="#FEF3C7"
                title="Google review link"
                subtitle={
                  googleReviewUrl
                    ? 'Added to thank-you messages'
                    : 'Not set — thank-you messages skip the review ask'
                }
                right={!googleReviewUrl ? <Pill label="Set up" tone="amber" /> : undefined}
                onPress={() => setReviewOpen(true)}
              />
              <EdgeRow
                icon={<IconBug size={19} color={colors.slateDeep} />}
                iconBg="#F1F5F9"
                title="Error log"
                subtitle={
                  unseenErrors > 0
                    ? `${unseenErrors} new since you last looked`
                    : 'App crashes and server errors'
                }
                right={
                  unseenErrors > 0 ? (
                    <Pill label={unseenErrors > 99 ? '99+' : String(unseenErrors)} tone="danger" />
                  ) : undefined
                }
                onPress={() => navigation.navigate('ErrorLog')}
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
            title="Change PIN"
            subtitle="Your sign-in code on this or any shop phone"
            onPress={() => setPinOpen(true)}
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

        <Text style={styles.version}>MANA Wash Manager · v{APP_VERSION}</Text>
      </ScrollView>

      <EditProfileSheet visible={profileOpen} onClose={() => setProfileOpen(false)} />
      <ReviewLinkSheet visible={reviewOpen} onClose={() => setReviewOpen(false)} />
      <ShopDetailsSheet visible={shopOpen} onClose={() => setShopOpen(false)} />
      <ShopSwitcherSheet
        visible={branches != null}
        startWith={branches ?? 'list'}
        onClose={() => setBranches(null)}
      />

      <SetPinSheet
        visible={pinOpen}
        title="Change your PIN"
        subtitle={`For +91 ${user.phone}`}
        askCurrent={user.hasPin}
        onClose={() => setPinOpen(false)}
        onSubmit={async (pin, currentPin) => {
          try {
            const res = await api.auth.pin.$put({ json: { pin, currentPin } });
            if (!res.ok) {
              const message = await apiErrorMessage(res, 'Couldn’t save your PIN.');
              return res.status === 401 || res.status === 423 ? { currentPinError: message } : message;
            }
            const session = await res.json();
            if ('token' in session) {
              await signIn(session.token, { ...session.user, role: session.user.role === 'owner' ? 'owner' : 'staff' });
            }
            setPinOpen(false);
            showToast('PIN saved. Other phones signed in as you will need the new PIN.');
            return null;
          } catch (e) {
            return e instanceof NetworkError
              ? 'Setting a PIN needs a connection.'
              : 'Couldn’t save your PIN.';
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
