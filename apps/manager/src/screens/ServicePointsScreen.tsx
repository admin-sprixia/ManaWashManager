import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import { Button, Notice, ScreenContainer, ScreenHeader, colors, spacing } from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { ScreenHero, SectionTitle } from '../components/ScreenChrome';
import { BranchTypesCard } from '../components/BranchTypesCard';

type Props = NativeStackScreenProps<RootStackParamList, 'ServicePoints'>;
type Data = InferResponseType<(typeof api)['branch']['points']['$get'], 200>;

const failure = (e: unknown) => (e instanceof NetworkError ? 'No connection. Try again.' : 'Something went wrong.');

/**
 * How this branch washes: what it offers — at the shop, at communities, at homes. Everything else
 * follows from elsewhere: the vehicles from Vehicles, the location and how far the branch serves
 * from Branch details.
 */
export function ServicePointsScreen({ navigation }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.branch.points.$get();
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t load how this branch washes.'));
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error && !(e instanceof NetworkError) ? e.message : failure(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const live = data?.services?.live ?? { hub: false, community: false, doorstep: false };
  const offers = [live.hub && 'Shop', live.community && 'Community', live.doorstep && 'Doorstep'].filter((x): x is string => !!x);
  // One distance for the branch (set in Branch details); its hub and team share it.
  const reach = data?.points.find((p) => p.active && p.radiusKm != null)?.radiusKm ?? null;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="How this branch washes" onBack={() => navigation.goBack()} />
      </View>
      {!data ? (
        error ? (
          <View style={styles.pad}>
            <Notice tone="danger">{error}</Notice>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.water} style={styles.loading} />
        )
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <ScreenHero
            eyebrow="HOW THIS BRANCH WASHES"
            title={offers.length ? offers.join(' + ') : 'Nothing switched on'}
            meta="Switch on how customers get a wash at this branch: at the shop, at communities, or at home."
            chips={[
              { label: 'Offers', value: `${offers.length} of 3` },
              { label: 'Serves up to', value: reach != null ? `${reach} km` : '—' },
            ]}
          />

          <SectionTitle meta="Within what Mana Wash HQ’s agreement allows">What this branch offers</SectionTitle>
          <View style={styles.pad}>
            <BranchTypesCard onChanged={() => void load()} />
          </View>
          <View style={styles.bottomPad} />
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.xs, gap: spacing.sm },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  bottomPad: { height: spacing.xxl },
});
