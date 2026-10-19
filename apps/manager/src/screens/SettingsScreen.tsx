import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import {
  ScreenContainer,
  ScreenHeader,
  showAlert,
  showToast,
  IconPlus,
  IconTrash,
  colors,
  radius,
  shadow,
  spacing,
  typography,
} from '@mana/ui';
import { Band, BandRow, ScreenHero, SectionTitle } from '../components/ScreenChrome';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { BranchPricesPane } from './branchPrices/BranchPricesPane';
import type { BranchSheet, SheetService } from './branchPrices/types';
import { isVehicleClassKey, parseVehicleCategory, VEHICLE_CLASSES, type VehicleClassKey } from '@mana/domain';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Network = InferResponseType<(typeof api)['services']['network']['$get'], 200>;
type SettingsScreenProps = NativeStackScreenProps<RootStackParamList, 'Settings'>;

/** The group (Car, Three-wheeler, Farm & machines…) of each vehicle the branch washes. */
function groupsOf(rows: Array<{ category: string; classKey?: string }>): VehicleClassKey[] {
  return rows.map((vt) =>
    vt.classKey && isVehicleClassKey(vt.classKey) ? vt.classKey : parseVehicleCategory(vt.category) === 'bike' ? 'twoWheeler' : 'car',
  );
}

/**
 * This branch's prices: Mana Wash HQ's services from the branch's price book, by vehicle group
 * and size. Branches sell HQ's services only; the owner sets shop prices inside HQ's limits and
 * may stop offering a service when HQ allows it. Owner only.
 */
export function SettingsScreen({ navigation }: SettingsScreenProps) {
  const [washed, setWashed] = useState<VehicleClassKey[]>([]);
  const [network, setNetwork] = useState<Network | null>(null);
  const [sheet, setSheet] = useState<BranchSheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<VehicleClassKey>('car');

  const load = useCallback(async () => {
    try {
      const [typesRes, networkRes, sheetRes] = await Promise.all([
        api.services['vehicle-types'].$get({ query: {} }),
        api.services.network.$get(),
        api.services['branch-prices'].$get(),
      ]);
      if (!typesRes.ok || !sheetRes.ok) throw new Error(await apiErrorMessage(sheetRes.ok ? typesRes : sheetRes, 'Couldn’t load the prices.'));
      setWashed(groupsOf(await typesRes.json()));
      setSheet(await sheetRes.json());
      if (networkRes.ok) setNetwork(await networkRes.json());
      setError(null);
    } catch (e) {
      setError(e instanceof NetworkError ? 'Prices need a connection. Check your internet and come back.' : (e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // One tab per group the branch washes (chosen when it opened, changed in More › Vehicles).
  const groups = useMemo(() => {
    const list = VEHICLE_CLASSES.filter((c) => washed.includes(c.key));
    return list.length > 0 ? list : VEHICLE_CLASSES.filter((c) => c.key === 'car' || c.key === 'twoWheeler');
  }, [washed]);
  useEffect(() => {
    if (!groups.some((g) => g.key === group)) setGroup(groups[0]!.key);
  }, [groups, group]);
  const groupDef = VEHICLE_CLASSES.find((c) => c.key === group) ?? VEHICLE_CLASSES[1]!;

  const stopOffering = (service: SheetService) =>
    showAlert(
      `Stop offering ${service.name} here?`,
      'It disappears from New Wash at this branch. Other branches keep it, and you can bring it back any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop offering',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                const res = await api.services[':id'].$delete({ param: { id: service.id } });
                if (!res.ok) return showToast(await apiErrorMessage(res, 'Couldn’t stop offering it.'), 'error');
                await load();
                showToast(`${service.name} is off the menu here`);
              } catch (e) {
                showToast(e instanceof NetworkError ? 'This needs a connection.' : 'Something went wrong.', 'error');
              }
            })();
          },
        },
      ],
      { icon: <IconTrash size={26} color={colors.danger} /> },
    );

  const bringBack = async (serviceId: string, name: string) => {
    try {
      const res = await api.services[':id'].hidden.$put({ param: { id: serviceId }, json: { hidden: false } });
      if (!res.ok) return showToast(await apiErrorMessage(res, 'Couldn’t bring it back.'), 'error');
      await load();
      showToast(`${name} is back on the menu`);
    } catch (e) {
      showToast(e instanceof NetworkError ? 'This needs a connection.' : 'Something went wrong.', 'error');
    }
  };

  const groupCells = sheet?.services.flatMap((s) => s.cells.filter((c) => c.classKey === group)) ?? [];
  const ownPrices = groupCells.filter((c) => c.hub?.own).length;
  const hqServices = sheet?.services.filter((s) => s.cells.some((c) => c.classKey === group)).length ?? 0;
  const vehicleCount = sheet?.groups.find((g) => g.key === group)?.sizes.reduce((n, z) => n + z.vehicles.length, 0) ?? 0;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="This branch’s prices" onBack={() => navigation.goBack()} />
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHero
          eyebrow={`THIS BRANCH · ${groupDef.name.toUpperCase()}`}
          title={sheet ? `${sheet.bookName} prices` : 'Your prices'}
          meta={
            !sheet
              ? 'Mana Wash HQ’s prices for each vehicle you wash.'
              : sheet.policy.branchOverrides
                ? `HQ’s prices for this branch. You can charge ${sheet.policy.maxDecreasePct}% less to ${sheet.policy.maxIncreasePct}% more.`
                : 'HQ’s prices for this branch. HQ has fixed them for every branch.'
          }
          chips={[
            { label: 'Your prices', value: ownPrices },
            { label: 'HQ services', value: hqServices },
            { label: 'Vehicles', value: vehicleCount },
          ]}
        />

        <View style={styles.segmentWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groupScroll}>
            <View style={styles.segment}>
              {groups.map((c) => {
                const on = group === c.key;
                return (
                  <Pressable
                    key={c.key}
                    onPress={() => setGroup(c.key)}
                    style={[styles.segmentBtn, on && styles.segmentBtnOn]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.segmentLabel, on && styles.segmentLabelOn]}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>

        {sheet && sheet.services.length > 0 ? (
          <BranchPricesPane
            sheet={sheet}
            groupKey={group}
            onChanged={load}
            onStopOffering={sheet.policy.branchCanHideServices ? stopOffering : undefined}
          />
        ) : sheet ? (
          <Text style={[styles.note, styles.pad]}>Mana Wash HQ hasn’t priced any services for this branch yet.</Text>
        ) : null}

        {network && network.hidden.length > 0 ? (
          <>
            <SectionTitle meta="HQ services you stopped selling here">Not offered at this branch</SectionTitle>
            <Band style={styles.band}>
              {network.hidden.map((h, i) => (
                <BandRow
                  key={h.id}
                  title={h.name}
                  muted
                  last={i === network.hidden.length - 1}
                  right={
                    <Pressable
                      onPress={() => void bringBack(h.id, h.name)}
                      style={({ pressed }) => [styles.offerPill, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Offer ${h.name} again`}
                    >
                      <IconPlus size={12} color={colors.waterDeep} />
                      <Text style={styles.offerPillText}>Offer again</Text>
                    </Pressable>
                  }
                />
              ))}
            </Band>
          </>
        ) : null}

        {error ? <Text style={[styles.error, styles.pad]}>{error}</Text> : null}
        <View style={styles.bottomPad} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  pad: { paddingHorizontal: spacing.md },
  content: { paddingTop: spacing.xs, gap: spacing.sm },
  segmentWrap: { paddingHorizontal: spacing.md },
  band: { marginTop: spacing.xs },
  pressed: { opacity: 0.85 },
  groupScroll: { flexGrow: 1 },
  segment: { flexGrow: 1, flexDirection: 'row', backgroundColor: '#E8F1F8', borderRadius: radius.pill, padding: 4 },
  segmentBtn: {
    flexGrow: 1,
    flexBasis: 'auto',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  segmentBtnOn: { backgroundColor: colors.white, ...shadow('sm') },
  segmentLabel: { ...typography.bodyStrong, fontSize: 15, color: colors.slateDeep },
  segmentLabelOn: { color: colors.waterDeep, fontWeight: '700' },
  offerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
  },
  offerPillText: { ...typography.label, color: colors.waterDeep, fontWeight: '700' },
  note: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, ...typography.label },
  bottomPad: { height: spacing.xxl },
});
