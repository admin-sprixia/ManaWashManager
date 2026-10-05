import React from 'react';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useIsFocused, type CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { REFERRAL_OFFER_TEXT } from '@mana/domain';
import { api, send } from '../api/client';
import { useAccount } from '../auth/AuthProvider';
import { useBranches } from '../branches/BranchesProvider';
import { useRemote } from '../hooks/useRemote';
import type { MainStackParams, TabParams } from '../navigation/types';
import { HomeView } from './HomeView';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParams, 'Home'>,
  NativeStackScreenProps<MainStackParams>
>;

/** How often a wash on the board is checked while Home is open. */
const LIVE_POLL_MS = 20_000;

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** At a glance: today's wash live, the latest wash, free washes on the way, offers and gifts. */
export function HomeScreen({ navigation }: Props) {
  const account = useAccount();
  const { byId } = useBranches();
  const focused = useIsFocused();
  const home = useRemote(() =>
    Promise.all([send(api.washes.$get({ query: { limit: '1' } })), send(api.vehicles.$get())]),
  );
  const [liveActive, setLiveActive] = React.useState(false);
  const live = useRemote(() => send(api.live.$get()), { pollMs: liveActive ? LIVE_POLL_MS : null });
  const liveWashes = live.data?.washes ?? [];
  React.useEffect(() => setLiveActive(liveWashes.length > 0), [liveWashes.length]);
  const now = new Date();

  return (
    <HomeView
      greeting={greeting(now)}
      firstName={account.name?.split(' ')[0]}
      branchLine={account.branches.map((b) => (b.city ? `${b.name}, ${b.city}` : b.name)).join(' · ') || 'MANA Car Wash'}
      referralOffer={REFERRAL_OFFER_TEXT}
      now={now}
      latest={home.data?.[0].washes[0] ?? null}
      vehicles={home.data?.[1].vehicles ?? []}
      liveWashes={liveWashes}
      branchOf={byId}
      loading={home.loading}
      refreshing={home.refreshing}
      error={home.error}
      hasData={home.data != null}
      focused={focused}
      onRefresh={() => void Promise.all([home.reload(), live.reload()])}
      onRetry={() => void home.reload()}
      onProfile={() => navigation.navigate('Profile')}
      onOpenWash={(id) => navigation.navigate('WashDetail', { id })}
      onSeeAllWashes={() => navigation.navigate('Washes')}
      onInvite={() => navigation.navigate('Refer')}
      onHelp={() => navigation.navigate('Help')}
    />
  );
}
