import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import {
  BottomSheet,
  Button,
  ChoiceChips,
  IconAlert,
  IconChevronRight,
  IconHome,
  IconMapPin,
  IconPlus,
  Notice,
  Pill,
  ScreenContainer,
  ScreenHeader,
  TextField,
  colors,
  showToast,
  spacing,
} from '@mana/ui';
import { SERVICE_POINT_NAME_MAX, SERVICE_RADIUS_MAX_KM, SERVICE_RADIUS_MIN_KM, type DeliveryMode } from '@mana/domain';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { parsePoint } from '../utils/geo';
import { ToggleChips } from './business/shared';
import { Band, BandRow, ScreenHero, SectionTitle, TipBand } from '../components/ScreenChrome';
import { SheetHead, SheetNotice, SheetPill } from '../components/SheetBits';

type Props = NativeStackScreenProps<RootStackParamList, 'ServicePoints'>;
type Data = InferResponseType<(typeof api)['branch']['points']['$get'], 200>;
type Point = Data['points'][number];

const kindOptions = (homeWash: boolean): { value: DeliveryMode; label: string }[] => [
  { value: 'hub', label: 'Shop / hub' },
  { value: 'doorstep', label: homeWash ? 'Doorstep team' : 'Community team' },
];
const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

const failure = (e: unknown) => (e instanceof NetworkError ? 'No connection. Try again.' : 'Something went wrong.');

/**
 * How this branch washes: its shop (hub) and doorstep teams, the vehicles each takes and how far
 * the doorstep team goes. The branch's menu and its doorstep prices follow from these.
 */
export function ServicePointsScreen({ navigation }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Point | DeliveryMode | null>(null);

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

  const save = async (values: PointValues, id: string | null): Promise<string | null> => {
    try {
      const res = id
        ? await api.branch.points[':id'].$patch({ param: { id }, json: values })
        : await api.branch.points.$post({ json: values });
      if (!res.ok) return apiErrorMessage(res, 'Couldn’t save.');
      setEditing(null);
      showToast(id ? 'Saved · menu updated' : 'Added · menu updated', 'success');
      await load();
      return null;
    } catch (e) {
      return failure(e);
    }
  };

  const className = (id: string) => data?.classes.find((c) => c.id === id)?.name ?? '';
  const active = data?.points.filter((p) => p.active) ?? [];
  const homeWash = data?.homeWash ?? false;
  const hasTeam = data?.points.some((p) => p.kind === 'doorstep') ?? false;
  const hubCount = data?.points.filter((p) => p.kind === 'hub').length ?? 0;
  const teamCount = data?.points.filter((p) => p.kind === 'doorstep').length ?? 0;

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
            title={hubCount + teamCount === 0 ? 'No places yet' : `${active.length} working ${active.length === 1 ? 'place' : 'places'}`}
            meta={
              homeWash
                ? 'Your shop, your doorstep teams, and the vehicles each one takes.'
                : 'Your shop, your community team, and the vehicles each one takes.'
            }
            chips={[
              { label: 'Shops', value: hubCount },
              { label: homeWash ? 'Doorstep' : 'Community', value: teamCount },
              { label: 'Off', value: data.points.length - active.length },
            ]}
          />
          <TipBand>
            {homeWash
              ? 'Customers come to your shop, your team goes to them, or both. The vehicles each one takes decide your menu, and a doorstep team gets the doorstep prices.'
              : 'Customers come to your shop, and your community team washes plan cars at communities. The vehicles each one takes decide your menu. Washing at single homes is off for now.'}
          </TipBand>
          <SectionTitle meta="Tap one to change it">Where you wash</SectionTitle>
          <Band style={styles.band}>
            {data.points.map((p) => (
              <BandRow
                key={p.id}
                icon={
                  p.kind === 'hub' ? (
                    <IconHome size={19} color={p.active ? colors.waterDeep : colors.slate} />
                  ) : (
                    <IconMapPin size={19} color={p.active ? colors.tealDeep : colors.slate} />
                  )
                }
                iconBg={p.kind === 'hub' ? colors.waterPale : '#CCFBF1'}
                title={p.name}
                subtitle={[
                  p.kind === 'hub' ? 'At the shop' : homeWash ? 'Doorstep' : 'Communities',
                  p.classIds.map(className).join(', '),
                  p.radiusKm != null ? `within ${p.radiusKm} km` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                muted={!p.active}
                right={p.active ? <IconChevronRight size={16} color={colors.slate} /> : <Pill label="OFF" tone="slate" />}
                onPress={() => setEditing(p)}
              />
            ))}
            {!hasTeam ? (
              <BandRow
                icon={<IconPlus size={18} color={colors.waterDeep} />}
                title={homeWash ? 'Add a doorstep team' : 'Add a community team'}
                subtitle={homeWash ? 'Wash at customers’ homes and communities' : 'Wash plan cars at communities'}
                onPress={() => setEditing('doorstep')}
              />
            ) : null}
            <BandRow
              icon={<IconPlus size={18} color={colors.waterDeep} />}
              title={hasTeam ? 'Add another team or shop' : 'Add another shop'}
              onPress={() => setEditing(hasTeam ? 'doorstep' : 'hub')}
              last
            />
          </Band>
          <View style={styles.bottomPad} />
        </ScrollView>
      )}
      {data ? (
        <PointSheet
          classes={data.classes}
          homeWash={homeWash}
          point={editing && typeof editing === 'object' ? editing : null}
          kind={typeof editing === 'string' ? editing : null}
          visible={editing != null}
          lastActive={editing != null && typeof editing === 'object' && editing.active && active.length <= 1}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      ) : null}
    </ScreenContainer>
  );
}

interface PointValues {
  kind: DeliveryMode;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radiusKm: number | null;
  classIds: string[];
  active?: boolean;
}

function PointSheet({
  classes,
  homeWash,
  point,
  kind: newKind,
  visible,
  lastActive,
  onClose,
  onSave,
}: {
  classes: Data['classes'];
  homeWash: boolean;
  point: Point | null;
  kind: DeliveryMode | null;
  visible: boolean;
  lastActive: boolean;
  onClose: () => void;
  onSave: (values: PointValues, id: string | null) => Promise<string | null>;
}) {
  const [kind, setKind] = useState<DeliveryMode>('hub');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [radius, setRadius] = useState('');
  const [classIds, setClassIds] = useState<string[]>([]);
  const [active, setActive] = useState<'yes' | 'no'>('yes');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const k = point?.kind ?? newKind ?? 'hub';
    setKind(k);
    setName(point?.name ?? (k === 'doorstep' ? (homeWash ? 'Doorstep team' : 'Community team') : 'Shop'));
    setLocation(point?.latitude != null && point.longitude != null ? `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}` : '');
    setRadius(point?.radiusKm != null ? String(point.radiusKm) : '');
    setClassIds(point?.classIds ?? classes.filter((c) => c.key === 'car' || c.key === 'twoWheeler').map((c) => c.id));
    setActive(point?.active === false ? 'no' : 'yes');
    setError(null);
    setBusy(false);
  }, [visible, point, newKind, classes, homeWash]);

  const save = async () => {
    if (!name.trim()) return setError('Enter a name, like “Community team”.');
    if (classIds.length === 0) return setError('Pick at least one kind of vehicle.');
    const at = location.trim() ? parsePoint(location) : null;
    if (location.trim() && !at) return setError('Paste the location as “latitude, longitude”, e.g. 14.49360, 79.98840.');
    const km = radius.trim() ? Number(radius) : null;
    if (km != null && (!Number.isFinite(km) || km < SERVICE_RADIUS_MIN_KM || km > SERVICE_RADIUS_MAX_KM)) {
      return setError(`The distance is ${SERVICE_RADIUS_MIN_KM} to ${SERVICE_RADIUS_MAX_KM} km.`);
    }
    if (km != null && !at) return setError('Set the location before the distance.');
    setBusy(true);
    setError(null);
    const message = await onSave(
      {
        kind,
        name: name.trim(),
        latitude: at?.latitude ?? null,
        longitude: at?.longitude ?? null,
        radiusKm: km,
        classIds,
        ...(point ? { active: active === 'yes' } : {}),
      },
      point?.id ?? null,
    );
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={point ? point.name : kind === 'doorstep' ? (homeWash ? 'New doorstep team' : 'New community team') : 'New shop'}
      footer={<Button label={point ? 'Save' : 'Add'} size="lg" loading={busy} onPress={() => void save()} />}
    >
      <SheetHead
        tone={kind === 'doorstep' ? 'teal' : 'indigo'}
        icon={
          kind === 'doorstep' ? (
            <IconMapPin size={22} color={colors.tealDeep} />
          ) : (
            <IconHome size={22} color={colors.indigo} />
          )
        }
        title={kind === 'doorstep' ? (homeWash ? 'Doorstep team' : 'Community team') : 'Shop / hub'}
        caption={
          kind === 'doorstep'
            ? homeWash
              ? 'Washes at customers’ homes and communities.'
              : 'Washes plan cars at communities.'
            : 'Customers bring their vehicle to you.'
        }
        right={point && !point.active ? <SheetPill tone="amber" label="Off" /> : undefined}
      />
      <ChoiceChips label="Kind" options={kindOptions(homeWash)} value={kind} onChange={setKind} />
      <TextField label="Name" value={name} onChangeText={setName} maxLength={SERVICE_POINT_NAME_MAX} autoCapitalize="words" />
      <ToggleChips
        label="Vehicles it washes"
        options={classes.map((c) => ({ value: c.id, label: c.name }))}
        value={classIds}
        onChange={setClassIds}
        min={1}
        hint={kind === 'doorstep' ? 'A farm team can take tractors even when the shop can’t.' : undefined}
      />
      <TextField
        label={kind === 'doorstep' ? 'Where the team starts from' : 'Location'}
        optional
        placeholder="14.49360, 79.98840"
        value={location}
        onChangeText={setLocation}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        hint="In Google Maps, press and hold to drop a pin and copy the numbers."
      />
      <TextField
        label="How far it goes (km)"
        optional
        placeholder="10"
        value={radius}
        onChangeText={(t) => setRadius(t.replace(/[^\d.]/g, ''))}
        keyboardType="decimal-pad"
        hint={
          kind !== 'doorstep'
            ? undefined
            : homeWash
              ? 'People within this distance can book a doorstep wash in the app.'
              : 'Communities within this distance can be started. People nearby can ask for one in the app.'
        }
      />
      {point ? (
        lastActive ? (
          <SheetNotice tone="amber">This is the branch’s only working place, so it stays on.</SheetNotice>
        ) : (
          <ChoiceChips label="Working now" options={YES_NO} value={active} onChange={setActive} />
        )
      ) : null}
      {error ? (
        <SheetNotice tone="danger" icon={<IconAlert size={14} color={colors.danger} />}>
          {error}
        </SheetNotice>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.xs, gap: spacing.sm },
  band: { marginTop: spacing.xs },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  bottomPad: { height: spacing.xxl },
});
