import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Notice, colors, spacing } from '@mana/ui';
import { SectionLabel } from '../components/CardList';
import { useAccount } from '../auth/AuthProvider';
import { useBranches } from '../branches/BranchesProvider';
import { BranchCard } from '../components/BranchCard';
import { MessageCard } from '../components/MessageCard';
import { PriceList } from '../components/PriceList';
import { SkeletonList } from '../components/Skeleton';
import { TabTitle } from '../components/TabTitle';

/** Where to find MANA: each branch's address, hours, contact buttons and price list. */
export function VisitScreen() {
  const account = useAccount();
  const { branches, loading, error, reload } = useBranches();
  const [refreshing, setRefreshing] = React.useState(false);
  const now = new Date();

  // Their own branches first; the others still useful when they're out of town.
  const mine = new Set(account.branches.map((b) => b.id));
  const sorted = [...branches].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)));
  const many = sorted.length > 1;

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  return (
    <View style={styles.screen}>
      <TabTitle title="Visit us" subtitle="Hours, directions and prices." />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {error && branches.length > 0 ? (
          <View style={styles.pad}>
            <Notice tone="warning">{error}</Notice>
          </View>
        ) : null}
        {branches.length === 0 ? (
          loading ? (
            <SkeletonList groups={[4]} />
          ) : (
            <MessageCard
              title="Couldn’t load our branches"
              body={error ?? 'Check your connection and try again.'}
              action={{ label: 'Try again', onPress: () => void refresh() }}
            />
          )
        ) : (
          sorted.map((b) => (
            <View key={b.id}>
              <SectionLabel>{many ? (b.city ?? b.name) : 'Branch'}</SectionLabel>
              <BranchCard branch={b} now={now} />
              {b.services.length > 0 ? (
                <>
                  <SectionLabel>{many ? `Prices at ${b.city ?? b.name}` : 'Prices'}</SectionLabel>
                  <PriceList branch={b} />
                </>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: spacing.xl },
  pad: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
});
