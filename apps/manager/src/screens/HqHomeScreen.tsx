import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import {
  Avatar,
  IconEdit,
  IconPlus,
  IconStore,
  IconSync,
  ScreenContainer,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { EdgeGroup, EdgeRow, Pill } from '../components/EdgeList';
import { ScreenHero, SectionTitle } from '../components/ScreenChrome';
import { HqToolsGroup } from '../components/HqToolsGroup';
import { AccountGroup } from '../components/AccountGroup';
import { EditProfileSheet } from '../components/EditProfileSheet';
import { ShopSwitcherSheet } from '../components/ShopSwitcherSheet';
import { api } from '../api/client';
import { useAuth } from '../api/auth';
import { useShop } from '../offline/ShopProvider';
import { CacheKeys, readCache, writeCache } from '../offline/cache';
import { APP_VERSION } from '../config/app';
import { formatRupees } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'HqHome'>;
type Overview = InferResponseType<(typeof api)['business']['overview']['$get'], 200>;
type Branch = Overview['branches'][number];

function formatPhone(phone: string): string {
  return `+91 ${phone.length === 10 ? `${phone.slice(0, 5)} ${phone.slice(5)}` : phone}`;
}

function branchLine(b: Branch): string {
  const parts = [`${b.today.washes} ${b.today.washes === 1 ? 'wash' : 'washes'} paid today`];
  if (b.openWashes > 0) parts.push(`${b.openWashes} in progress`);
  return `${b.code} · ${parts.join(' · ')}`;
}

/**
 * Home for Mana Wash HQ people who work at no branch: today across every branch, HQ's tools and
 * their account. There are no washes, cash or team board here, because there is no branch.
 */
export function HqHomeScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { info, myShops } = useShop();
  const [switching, setSwitching] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.business.overview.$get();
      if (!res.ok) return;
      const next = await res.json();
      setOverview(next);
      setOffline(false);
      void writeCache(CacheKeys.hqOverview, next);
    } catch {
      setOffline(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void readCache<Overview>(CacheKeys.hqOverview).then((last) => {
        if (alive && last) setOverview((now) => now ?? last);
      });
      void load();
      return () => {
        alive = false;
      };
    }, [load]),
  );

  if (!user) return null;

  const branches = overview?.branches.filter((b) => b.status !== 'closed') ?? [];
  const open = branches.filter((b) => b.status === 'active').length;
  const paidToday = branches.reduce((sum, b) => sum + b.today.takings, 0);
  const inProgress = branches.reduce((sum, b) => sum + b.openWashes, 0);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <ScreenContainer noPadding>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.water}
            colors={[colors.water]}
          />
        }
      >
        <Pressable onPress={() => setProfileOpen(true)} accessibilityRole="button" accessibilityLabel="Edit profile">
          <ScreenHero
            eyebrow="Mana Wash HQ"
            title={user.name}
            meta={`${formatPhone(user.phone)}${info ? ` · ${info.name}` : ''}`}
            tone="brand"
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
            chips={
              overview
                ? [
                    { label: 'Branches open', value: open },
                    { label: 'Paid today', value: formatRupees(paidToday) },
                    { label: 'In progress', value: inProgress },
                  ]
                : undefined
            }
          />
        </Pressable>

        <SectionTitle meta={offline ? 'Offline · last numbers' : 'Pull down to refresh'}>Today at your branches</SectionTitle>
        {!overview ? (
          offline ? (
            <Text style={styles.footnote}>Connect to the internet to see today’s numbers.</Text>
          ) : (
            <ActivityIndicator color={colors.water} style={styles.loading} />
          )
        ) : branches.length === 0 ? (
          <EdgeGroup>
            <EdgeRow
              icon={<IconPlus size={18} color={colors.waterDeep} />}
              title="Open your first branch"
              subtitle="Pick the town, name it and add its owner"
              onPress={() => navigation.navigate('OpenBranch')}
            />
          </EdgeGroup>
        ) : (
          <EdgeGroup>
            {branches.map((b) => (
              <EdgeRow
                key={b.id}
                icon={<IconStore size={19} color={b.status === 'paused' ? colors.amberDeep : colors.waterDeep} />}
                iconBg={b.status === 'paused' ? '#FEF3C7' : undefined}
                title={b.name}
                subtitle={branchLine(b)}
                right={
                  b.status === 'paused' ? (
                    <Pill label="Paused" tone="amber" />
                  ) : (
                    <Text style={styles.amount}>{formatRupees(b.today.takings)}</Text>
                  )
                }
                onPress={() => navigation.navigate('BusinessBranch', { branchId: b.id })}
              />
            ))}
          </EdgeGroup>
        )}

        <SectionTitle>HQ tools</SectionTitle>
        <HqToolsGroup sizeGuide />

        {myShops.length > 1 ? (
          <>
            <SectionTitle>Your branches</SectionTitle>
            <EdgeGroup>
              <EdgeRow
                icon={<IconSync size={18} color={colors.waterDeep} />}
                title="Switch branch"
                subtitle={`You also work at ${myShops.length - 1 === 1 ? 'a branch' : `${myShops.length - 1} branches`}. Open it to wash, take cash and run the team.`}
                onPress={() => setSwitching(true)}
              />
            </EdgeGroup>
          </>
        ) : null}

        <SectionTitle>Account</SectionTitle>
        <AccountGroup onEditProfile={() => setProfileOpen(true)} senior />

        <Text style={styles.footnote}>
          This is Mana Wash HQ, not a branch, so washes, cash and the team board aren’t here.
          {myShops.length > 1 ? ' Switch branch above to work at your branch.' : ''}
        </Text>
        <Text style={styles.version}>Sri Mana Wash Partner · v{APP_VERSION}</Text>
      </ScrollView>

      <EditProfileSheet visible={profileOpen} onClose={() => setProfileOpen(false)} />
      <ShopSwitcherSheet visible={switching} onClose={() => setSwitching(false)} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  heroRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroAvatar: { borderRadius: 24, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)' },
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
  amount: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15, marginRight: spacing.xs },
  loading: { marginVertical: spacing.lg },
  footnote: {
    ...typography.caption,
    color: colors.slate,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    letterSpacing: 0,
  },
  version: { ...typography.caption, color: colors.slate, textAlign: 'center', marginTop: spacing.lg },
});
