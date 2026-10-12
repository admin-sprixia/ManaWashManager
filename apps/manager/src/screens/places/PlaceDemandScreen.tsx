import React from 'react';
import { ActivityIndicator, Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Button,
  EdgeGroup,
  EdgePanel,
  EdgeRow,
  IconMapPin,
  Notice,
  Pill,
  ScreenContainer,
  ScreenHeader,
  SectionLabel,
  colors,
  formatDateTime,
  spacing,
  typography,
} from '@mana/ui';
import { START_COMMUNITY_AT } from '@mana/domain';
import { api } from '../../api/client';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { mapsLink } from '../../utils/geo';
import { useApiData, type Demand } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'PlaceDemand'>;

const vehiclesLine = (cars: number, bikes: number) =>
  [cars ? `${cars} ${cars === 1 ? 'car' : 'cars'}` : null, bikes ? `${bikes} ${bikes === 1 ? 'bike' : 'bikes'}` : null].filter(Boolean).join(', ');

/**
 * Where people are asking for MANA: open "Call me back" requests grouped by where they are,
 * biggest first. Starting a place there invites everyone nearby to join it in one tap.
 */
export function PlaceDemandScreen({ navigation }: Props) {
  const demand = useApiData<Demand>(() => api.places.demand.$get(), 'Couldn’t load the requests.');
  const clusters = demand.data?.clusters ?? [];
  const byArea = demand.data?.byArea ?? [];

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="People asking" onBack={() => navigation.goBack()} />
      </View>
      {!demand.data ? (
        demand.error ? (
          <View style={styles.pad}>
            <Notice tone="danger">{demand.error}</Notice>
            <Button label="Try again" variant="secondary" onPress={() => void demand.load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.water} style={styles.loading} />
        )
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={demand.refreshing} onRefresh={() => void demand.refresh()} />}>
          {!clusters.length && !byArea.length ? (
            <Text style={[styles.help, styles.pad]}>No open requests right now. When people ask from the MANA Car Wash app, they show here by place.</Text>
          ) : null}
          {clusters.map((c, i) => (
            <View key={c.requestIds[0]} style={i > 0 ? styles.gap : undefined}>
              <EdgePanel style={styles.cluster}>
                <View style={styles.clusterHead}>
                  <Text style={styles.title} numberOfLines={2}>
                    {c.landmarks[0] ?? 'Near a pinned spot'}
                  </Text>
                  <Pill label={`${c.requests} ${c.requests === 1 ? 'REQUEST' : 'REQUESTS'}`} tone={c.requests >= START_COMMUNITY_AT ? 'teal' : 'water'} />
                </View>
                <Text style={styles.meta}>
                  {vehiclesLine(c.cars, c.bikes)} · latest {formatDateTime(c.latestAt)}
                </Text>
                {c.landmarks.length > 1 ? <Text style={styles.meta}>Also: {c.landmarks.slice(1).join(' · ')}</Text> : null}
                {c.requests >= START_COMMUNITY_AT ? <Text style={styles.ready}>Enough neighbours to start. Visit and inspect it.</Text> : null}
                <View style={styles.actions}>
                  <View style={styles.flex}>
                    <Button label="Map" variant="secondary" icon={<IconMapPin size={16} color={colors.waterDeep} />} onPress={() => void Linking.openURL(mapsLink(c.center)).catch(() => undefined)} />
                  </View>
                  <View style={styles.flex}>
                    <Button
                      label="Start community"
                      onPress={() => navigation.navigate('CommunitySetup', { at: c.center, label: c.landmarks[0] ?? undefined })}
                    />
                  </View>
                </View>
              </EdgePanel>
            </View>
          ))}
          {byArea.length ? (
            <>
              <SectionLabel>Picked an area only</SectionLabel>
              <EdgeGroup>
                {byArea.map((a) => (
                  <EdgeRow key={a.area} title={a.area} right={<Pill label={String(a.requests)} tone="slate" />} onPress={() => navigation.navigate('ServiceRequests')} />
                ))}
              </EdgeGroup>
            </>
          ) : null}
          <View style={styles.bottomPad} />
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.sm },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  gap: { marginTop: spacing.sm },
  cluster: { gap: 6 },
  clusterHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.bodyStrong, color: colors.waterInk, flex: 1 },
  meta: { fontSize: 13.5, color: colors.slateDeep },
  ready: { ...typography.label, color: colors.tealDeep, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex: { flex: 1 },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20 },
  bottomPad: { height: spacing.xxl },
});
