import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  IconBike,
  IconCar,
  IconPlus,
  Notice,
  colors,
  showAlert,
  showToast,
  spacing,
} from '@mana/ui';
import { EdgeGroup, EdgeRow, Pill, SectionLabel } from '../components/CardList';
import { api, send } from '../api/client';
import { errorMessage } from '../api/errors';
import type { Vehicle, VehicleRequest } from '../api/types';
import { MessageCard } from '../components/MessageCard';
import { SkeletonList } from '../components/Skeleton';
import { TabTitle } from '../components/TabTitle';
import { VehicleCard } from '../components/VehicleCard';
import { useRemote } from '../hooks/useRemote';
import type { MainStackParams, TabParams } from '../navigation/types';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParams, 'Vehicles'>,
  NativeStackScreenProps<MainStackParams>
>;

/** Every vehicle the car wash knows under this number, with its cards, offers and gifts. */
export function VehiclesScreen({ navigation }: Props) {
  const list = useRemote(() => send(api.vehicles.$get()));
  const vehicles = list.data?.vehicles ?? [];
  // Approved requests are already in the list as vehicles.
  const requests = (list.data?.requests ?? []).filter((r) => r.status !== 'approved');
  const manyBranches = new Set(vehicles.map((v) => v.branch.id)).size > 1;
  const now = new Date();

  const confirmRemove = (v: Vehicle) =>
    showAlert(
      `Remove ${v.registrationNumber}?`,
      'It disappears from this app only. The car wash keeps its washes, cards and gifts, and you can add it back any time.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void send(api.vehicles[':id'].$delete({ param: { id: v.id } }))
              .then(() => {
                showToast(`${v.registrationNumber} removed`);
                return list.reload();
              })
              .catch((err: unknown) => showToast(errorMessage(err), 'error'));
          },
        },
      ],
      { plain: true },
    );

  const cancelRequest = (r: VehicleRequest) =>
    showAlert(`Cancel adding ${r.registrationNumber}?`, undefined, [
      { text: 'Keep waiting', style: 'cancel' },
      {
        text: 'Cancel request',
        style: 'destructive',
        onPress: () => {
          void send(api['vehicle-requests'][':id'].cancel.$post({ param: { id: r.id } }))
            .then(() => list.reload())
            .catch((err: unknown) => {
              showToast(errorMessage(err), 'error');
              return list.reload();
            });
        },
      },
    ], { plain: true });

  const requestRow = (r: VehicleRequest) => {
    const pending = r.status === 'pending';
    const model = [r.make, r.model].filter(Boolean).join(' ') || r.type.name;
    const Icon = r.type.category === 'bike' ? IconBike : IconCar;
    return (
      <EdgeRow
        key={r.id}
        icon={<Icon size={19} color={pending ? colors.amberDeep : colors.danger} />}
        iconBg={pending ? colors.amberPale : colors.dangerPale}
        title={r.registrationNumber}
        subtitle={pending ? `${model} · tap to cancel` : r.reason ? `${model} · “${r.reason}”` : model}
        right={<Pill label={pending ? 'WAITING' : 'NOT ADDED'} tone={pending ? 'amber' : 'danger'} />}
        onPress={pending ? () => cancelRequest(r) : undefined}
        chevron={false}
      />
    );
  };

  return (
    <View style={styles.screen}>
      <TabTitle title="My vehicles" subtitle="Cards, offers and gifts for each one." />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.reload()} />}
      >
        {list.error && list.data ? (
          <View style={styles.pad}>
            <Notice tone="warning">{list.error}</Notice>
          </View>
        ) : null}

        {list.loading ? (
          <SkeletonList groups={[1]} />
        ) : list.error && !list.data ? (
          <MessageCard
            title="Couldn’t load your vehicles"
            body={list.error}
            action={{ label: 'Try again', onPress: () => void list.reload() }}
          />
        ) : (
          <>
            {requests.length > 0 ? (
              <>
                <SectionLabel>Waiting for the team</SectionLabel>
                <EdgeGroup>{requests.map(requestRow)}</EdgeGroup>
              </>
            ) : null}

            {vehicles.length === 0 ? (
              <MessageCard
                title="No vehicles yet"
                body="Your car or bike shows here after its first wash at MANA, or add it below."
              />
            ) : (
              vehicles.map((v) => (
                <View key={v.id}>
                  <SectionLabel>
                    {[v.type.name, manyBranches ? (v.branch.city ?? v.branch.name) : null].filter(Boolean).join(' · ')}
                  </SectionLabel>
                  <VehicleCard vehicle={v} now={now} onRemove={() => confirmRemove(v)} />
                </View>
              ))
            )}

            <SectionLabel>Another vehicle?</SectionLabel>
            <EdgeGroup>
              <EdgeRow
                icon={<IconPlus size={19} color={colors.waterDeep} />}
                title="Add a vehicle"
                subtitle="The team confirms it before it shows here"
                onPress={() => navigation.navigate('AddVehicle')}
              />
            </EdgeGroup>
          </>
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
