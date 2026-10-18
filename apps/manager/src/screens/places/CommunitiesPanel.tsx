import React, { forwardRef, useImperativeHandle } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Button, Notice, colors, spacing } from '@mana/ui';
import { api } from '../../api/client';
import { useAuth } from '../../api/auth';
import { useApiData, type Demand, type Overview, type PlaceListItem } from './shared';
import { AllCommunitiesSection } from './panel/AllCommunitiesSection';
import { NeedsYouSection } from './panel/NeedsYouSection';
import { PeopleAskingSection } from './panel/PeopleAskingSection';
import { TodaySection } from './panel/TodaySection';
import { WeekSection } from './panel/WeekSection';
import type { Nav } from './panel/types';

export interface CommunitiesPanelHandle {
  refresh: () => Promise<void>;
}

/**
 * The Communities tab, in the order people need it: what's waiting on someone, today's wash
 * days, the days coming up, every community, and where people are asking for us. Lives in the
 * home screen's tab and on the Communities screen; the parent owns scrolling and refresh.
 */
export const CommunitiesPanel = forwardRef<CommunitiesPanelHandle>(function CommunitiesPanel(_props, ref) {
  const nav = useNavigation<Nav>();
  const { isOwner } = useAuth();
  const overview = useApiData<Overview>(() => api.places.overview.$get({ query: {} }), 'Couldn’t load this week.');
  const list = useApiData<{ places: PlaceListItem[] }>(() => api.places.$get(), 'Couldn’t load your communities.');
  const demand = useApiData<Demand>(() => api.places.demand.$get(), 'Couldn’t load the requests.');

  useImperativeHandle(
    ref,
    () => ({
      refresh: async () => {
        await Promise.all([overview.refresh(), list.refresh(), demand.refresh()]);
      },
    }),
    [overview, list, demand],
  );

  if (!list.data && !list.error) {
    return <ActivityIndicator color={colors.teal} style={styles.loading} />;
  }

  const places = list.data?.places ?? [];
  const days = overview.data?.days ?? [];
  const [today, ...coming] = days;

  return (
    <View style={styles.root}>
      {list.error && !list.data ? (
        <View style={styles.error}>
          <Notice tone="danger">{list.error}</Notice>
          <Button label="Try again" variant="secondary" onPress={() => void list.refresh()} />
        </View>
      ) : null}
      {overview.error && !overview.data ? (
        <View style={styles.error}>
          <Notice tone="warning">{overview.error}</Notice>
        </View>
      ) : null}

      <NeedsYouSection places={places} isOwner={isOwner} nav={nav} />
      <TodaySection today={today} next={coming.find((d) => d.places.length)} nav={nav} />
      <WeekSection days={coming} nav={nav} />
      <AllCommunitiesSection live={places.filter((p) => p.stage === 'live')} nav={nav} />
      <PeopleAskingSection demand={demand.data} nav={nav} />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { paddingBottom: spacing.md },
  loading: { marginTop: spacing.xl },
  error: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm },
});
