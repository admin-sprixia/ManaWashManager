import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import { Button, IconCar, IconChevronRight, Notice, ScreenContainer, ScreenHeader, colors, showToast, spacing } from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useShop } from '../offline/ShopProvider';
import { Band, BandRow, ScreenHero } from '../components/ScreenChrome';
import { BranchVehiclesPane } from './business/BranchVehiclesPane';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'BranchVehicles'>;
type Data = InferResponseType<(typeof api)['branch']['vehicles']['$get'], 200>;

/**
 * The kinds of vehicle this branch washes, on the same screen and the same list as Mana Wash HQ's
 * page for the branch: a switch here shows there, in New Wash and in the customer app. Owner only.
 */
export function BranchVehiclesScreen({ navigation }: Props) {
  const { info } = useShop();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.branch.vehicles.$get();
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t load your vehicles.'));
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof NetworkError ? 'Vehicles need a connection. Check your internet and come back.' : (e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const save = async (next: string[], what: string): Promise<string | null> => {
    try {
      const res = await api.branch.vehicles.$put({ json: { bodyTypeIds: next } });
      if (!res.ok) return apiErrorMessage(res, 'Couldn’t save the vehicles.');
      await load();
      showToast(what, 'success');
      return null;
    } catch (e) {
      return e instanceof NetworkError ? 'Changing vehicles needs a connection.' : 'Something went wrong.';
    }
  };

  const classOf = new Map(data?.bodyTypes.map((b) => [b.id, b.classId]) ?? []);
  const keyOf = new Map(data?.classes.map((c) => [c.id, c.key]) ?? []);
  const groupsAll = new Set(data?.bodyTypes.map((b) => b.classId)).size;
  const groupsOn = new Set(data?.vehicles.map((id) => classOf.get(id))).size;
  const kindsIn = (keys: string[]) => (data?.vehicles ?? []).filter((id) => keys.includes(keyOf.get(classOf.get(id) ?? '') ?? '')).length;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Vehicles" onBack={() => navigation.goBack()} />
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
            eyebrow={`VEHICLES · ${(info?.name ?? 'THIS BRANCH').toUpperCase()}`}
            title={`${data.vehicles.length} of ${data.bodyTypes.length} kinds on`}
            meta="Switch on what this branch washes. Staff pick one on every new wash; its size, and so its price, is HQ’s."
            chips={[
              { label: 'Groups', value: `${groupsOn} of ${groupsAll}` },
              { label: 'Two-wheelers', value: kindsIn(['twoWheeler']) },
              { label: 'Cars & more', value: data.vehicles.length - kindsIn(['twoWheeler']) },
            ]}
          />
          <BranchVehiclesPane catalog={data} branchName={info?.name ?? 'this branch'} value={data.vehicles} onSave={save} heading={false} />
          <Band style={styles.band}>
            <BandRow
              icon={<IconCar size={19} color={colors.indigo} />}
              iconBg={colors.indigoPale}
              title="Vehicle size guide"
              subtitle="Which size every car and bike model is priced as"
              right={<IconChevronRight size={16} color={colors.slate} />}
              last
              onPress={() => navigation.navigate('VehicleGuide')}
            />
          </Band>
          <View style={styles.bottomPad} />
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.sm, gap: spacing.md },
  band: { marginTop: spacing.xs },
  bottomPad: { height: spacing.xxl },
});
