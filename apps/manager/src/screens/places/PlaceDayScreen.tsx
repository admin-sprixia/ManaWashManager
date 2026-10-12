import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { formatDay, isValidRegistration, normalizeRegistration } from '@mana/domain';
import {
  BottomSheet,
  Button,
  ChoiceChips,
  EdgeGroup,
  EdgeRow,
  IconBike,
  IconCamera,
  IconCar,
  IconWhatsApp,
  Notice,
  Pill,
  ScreenContainer,
  ScreenHeader,
  SectionLabel,
  TextField,
  colors,
  showToast,
  spacing,
  typography,
  type PillTone,
} from '@mana/ui';
import { api, apiErrorMessage, uploadVisitPhoto, type ApiResponse } from '../../api/client';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { formatTime } from '../../utils/jobs';
import { washLocation, type Point } from '../../utils/location';
import { pickPhotos } from '../../utils/photoPicker';
import { openWhatsApp } from '../../utils/whatsapp';
import { VisitPhoto } from './communityParts';
import { failure, istToday, placeTitle, useApiData, type WashDay, type WashDayRow } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'PlaceDay'>;

const OUTCOME: Record<'done' | 'not_found' | 'missed' | 'skipped', { label: string; tone: PillTone }> = {
  done: { label: 'WASHED', tone: 'teal' },
  not_found: { label: 'NOT FOUND', tone: 'amber' },
  missed: { label: 'MISSED', tone: 'slate' },
  skipped: { label: 'SKIPPED', tone: 'slate' },
};

function rowPill(r: WashDayRow): { label: string; tone: PillTone } {
  if (r.visit) return OUTCOME[r.visit.outcome];
  return r.paid ? { label: 'PAID', tone: 'water' } : { label: 'NOT PAID', tone: 'danger' };
}

const distanceText = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

/** "Ravi · 7:12 am" — who recorded it and when. */
function visitLine(v: NonNullable<WashDayRow['visit']>): string {
  if (v.byCustomer) return 'By the customer';
  return [v.by, formatTime(v.at)].filter(Boolean).join(' · ');
}

function rowSubtitle(r: WashDayRow): string {
  if (r.visit) {
    return [visitLine(r.visit), r.visit.far && r.visit.distanceM != null ? `${distanceText(r.visit.distanceM)} away` : null, r.visit.hasPhoto ? 'Photo' : null]
      .filter(Boolean)
      .join(' · ');
  }
  return [r.firstWash ? 'First wash · note the plate' : null, r.parkingNote, r.customer.name].filter(Boolean).join(' · ') || r.title;
}

/**
 * A place's wash-day list: every vehicle due, by flat, with Paid or Not paid. The washer records
 * each one (the number plate on a first wash). Not-paid vehicles can't be marked washed.
 */
export function PlaceDayScreen({ navigation, route }: Props) {
  const { placeId } = route.params;
  const [day, setDay] = useState(route.params.day ?? istToday());
  const list = useApiData<WashDay>(() => api.places[':id'].day[':day'].$get({ param: { id: placeId, day } }), 'Couldn’t load the wash day.');
  const [open, setOpen] = useState<string | null>(null);

  const shownDay = useRef(day);
  useEffect(() => {
    if (shownDay.current === day) return;
    shownDay.current = day;
    void list.load();
    // Only a change of day; the hook already loads on focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const data = list.data?.day === day ? list.data : null;
  const rows = data?.rows ?? [];
  const today = istToday();
  const dayOptions = useMemo(() => {
    const days = [...new Set([today, ...(list.data?.place.nextWashDays ?? []), day])].sort();
    return days.map((d) => ({ value: d, label: d === today ? 'Today' : formatDay(d) }));
  }, [list.data, day, today]);

  const done = rows.filter((r) => r.visit?.outcome === 'done').length;
  const unpaid = rows.filter((r) => !r.paid && !r.visit).length;
  const row = rows.find((r) => r.orderId === open) ?? null;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title={list.data ? placeTitle(list.data.place) : 'Wash day'} onBack={() => navigation.goBack()} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} />}>
        <View style={styles.pad}>
          <ChoiceChips options={dayOptions} value={day} onChange={setDay} />
        </View>
        {!data ? (
          list.error ? (
            <View style={styles.pad}>
              <Notice tone="danger">{list.error}</Notice>
            </View>
          ) : (
            <ActivityIndicator color={colors.water} style={styles.loading} />
          )
        ) : rows.length ? (
          <>
            <SectionLabel right={`${done} of ${rows.length} washed`}>{unpaid ? `${unpaid} not paid · don’t wash` : 'All paid'}</SectionLabel>
            <EdgeGroup>
              {rows.map((r) => {
                const pill = rowPill(r);
                return (
                  <EdgeRow
                    key={r.orderId}
                    icon={r.vehicle.category === 'bike' ? <IconBike size={18} color={colors.waterDeep} /> : <IconCar size={18} color={colors.waterDeep} />}
                    title={`${r.unit} · ${r.vehicle.registrationNumber ?? r.vehicle.typeName}`}
                    subtitle={rowSubtitle(r)}
                    tone={r.visit || !r.paid ? 'muted' : 'default'}
                    right={<Pill label={pill.label} tone={pill.tone} />}
                    onPress={() => setOpen(r.orderId)}
                  />
                );
              })}
            </EdgeGroup>
          </>
        ) : (
          <Text style={[styles.help, styles.pad]}>Nobody is due on {formatDay(day)}.</Text>
        )}
        <View style={styles.bottomPad} />
      </ScrollView>
      <VisitSheet
        row={row}
        placeId={placeId}
        placeName={list.data ? placeTitle(list.data.place) : ''}
        atPlaceMeters={list.data?.atPlaceMeters ?? 200}
        day={day}
        canRecord={day <= today}
        onClose={() => setOpen(null)}
        run={list.run}
        reload={list.load}
      />
    </ScreenContainer>
  );
}

function VisitSheet({
  row,
  placeId,
  placeName,
  atPlaceMeters,
  day,
  canRecord,
  onClose,
  run,
  reload,
}: {
  row: WashDayRow | null;
  placeId: string;
  placeName: string;
  atPlaceMeters: number;
  day: string;
  canRecord: boolean;
  onClose: () => void;
  run: (call: () => Promise<ApiResponse>, done?: string) => Promise<string | null>;
  reload: () => Promise<void>;
}) {
  const [plate, setPlate] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Where the phone is, asked as the sheet opens so recording doesn't wait for it. */
  const where = useRef<Promise<Point | null> | null>(null);

  useEffect(() => {
    setPlate('');
    setError(null);
    setBusy(null);
    where.current = row && !row.visit && row.paid && canRecord ? washLocation() : null;
  }, [row?.orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!row) return <BottomSheet visible={false} onClose={onClose} title="" />;
  const needsPlate = row.vehicle.registrationNumber == null;

  const addPhoto = async () => {
    if (!row.visit) return;
    const visitId = row.visit.id;
    const picked = await pickPhotos('After photo', 'A photo of the clean vehicle, for the customer and the owner.');
    const asset = picked?.assets?.[0];
    if (!asset?.uri) return;
    setBusy('photo');
    setError(null);
    try {
      const res = await uploadVisitPhoto(placeId, visitId, { uri: asset.uri, contentType: asset.type ?? 'image/jpeg' });
      if (!res.ok) setError(await apiErrorMessage(res, 'Couldn’t upload the photo.'));
      else {
        showToast('Photo added', 'success');
        await reload();
      }
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(null);
    }
  };

  const tellCustomer = () => {
    const name = row.customer.name?.trim().split(/\s+/)[0];
    const vehicle = row.vehicle.registrationNumber ?? row.vehicle.typeName;
    const when = row.visit && !row.visit.byCustomer ? ` at ${formatTime(row.visit.at)}` : '';
    void openWhatsApp(
      row.customer.phone,
      `Hi${name ? ` ${name}` : ''}, your ${vehicle} at ${placeName} was washed today${when}. Thank you! — MANA Car Wash`,
    );
  };

  const record = async (outcome: 'done' | 'not_found' | 'missed') => {
    let plateBody: { registrationNumber: string } | null = null;
    if (outcome === 'done' && needsPlate && plate.trim()) {
      const reg = normalizeRegistration(plate);
      if (!isValidRegistration(reg)) return setError('Enter the number like AP39AB1234.');
      plateBody = { registrationNumber: reg };
    }
    setBusy(outcome);
    setError(null);
    const at = (await where.current?.catch(() => null)) ?? null;
    const message = await run(
      () => api.places[':id'].visits.$post({ param: { id: placeId }, json: { orderId: row.orderId, date: day, outcome, plate: plateBody, at } }),
      outcome === 'done' ? 'Washed' : outcome === 'not_found' ? 'Noted · the office will check' : 'Noted as missed',
    );
    setBusy(null);
    if (message) setError(message);
    // A washed vehicle stays open for the after photo.
    else if (outcome !== 'done') onClose();
  };

  const undo = async () => {
    if (!row.visit) return;
    const visitId = row.visit.id;
    setBusy('undo');
    const message = await run(() => api.places[':id'].visits[':visitId'].$delete({ param: { id: placeId, visitId } }), 'Undone');
    setBusy(null);
    if (message) setError(message);
    else onClose();
  };

  const payLink = async () => {
    setBusy('link');
    setError(null);
    try {
      const res = await api.places.orders[':id']['payment-link'].$post({ param: { id: row.orderId } });
      const body = (await res.json()) as { message?: string; phone?: string | null };
      if (!res.ok || !body.message) setError(body.message ?? 'Couldn’t make the payment link.');
      else await openWhatsApp(body.phone ?? row.customer.phone, body.message);
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      dismissable={busy == null}
      title={`${row.unit} · ${row.vehicle.registrationNumber ?? row.vehicle.typeName}`}
      subtitle={`${row.title}${row.kind === 'plan' ? ` · ${row.washesLeft} washes left` : ''}`}
    >
      <View style={styles.sheet}>
        {row.visit ? (
          <>
            <Notice tone={row.visit.outcome === 'done' ? 'success' : 'info'}>
              {`${row.visit.outcome === 'done' ? 'Washed' : `Recorded as ${OUTCOME[row.visit.outcome].label.toLowerCase()}`} · ${visitLine(row.visit)}`}
            </Notice>
            {row.visit.far && row.visit.distanceM != null ? (
              <Notice tone="warning">{`Recorded ${distanceText(row.visit.distanceM)} from the community (more than ${atPlaceMeters} m away).`}</Notice>
            ) : null}
            {row.visit.hasPhoto ? <VisitPhoto placeId={placeId} visitId={row.visit.id} /> : null}
            {row.visit.outcome === 'done' && !row.visit.byCustomer ? (
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Button
                    label={row.visit.hasPhoto ? 'Change photo' : 'After photo'}
                    variant="secondary"
                    icon={<IconCamera size={18} color={colors.waterDeep} />}
                    loading={busy === 'photo'}
                    onPress={() => void addPhoto()}
                  />
                </View>
                <View style={styles.flex}>
                  <Button label="Tell customer" variant="secondary" icon={<IconWhatsApp size={18} />} onPress={tellCustomer} />
                </View>
              </View>
            ) : null}
            {!row.visit.byCustomer ? <Button label="Undo" variant="ghost" loading={busy === 'undo'} onPress={() => void undo()} /> : null}
          </>
        ) : !row.paid ? (
          <>
            <Notice tone="danger" title="Not paid">
              Please don’t wash this vehicle. Send the payment link; it shows Paid here once they pay.
            </Notice>
            <Button label="Send payment link on WhatsApp" loading={busy === 'link'} onPress={() => void payLink()} />
          </>
        ) : !canRecord ? (
          <Notice tone="info">You can record this on the day.</Notice>
        ) : (
          <>
            {needsPlate ? (
              <TextField
                label="Number plate"
                optional
                value={plate}
                onChangeText={(t) => setPlate(t.toUpperCase())}
                placeholder="AP39AB1234"
                autoCapitalize="characters"
                autoCorrect={false}
                hint="Saved on their vehicle, so the next wash shows it."
              />
            ) : null}
            <Button label="Washed" size="lg" loading={busy === 'done'} onPress={() => void record('done')} />
            <View style={styles.row}>
              <View style={styles.flex}>
                <Button label="Not found" variant="secondary" loading={busy === 'not_found'} onPress={() => void record('not_found')} />
              </View>
              <View style={styles.flex}>
                <Button label="Missed" variant="ghost" loading={busy === 'missed'} onPress={() => void record('missed')} />
              </View>
            </View>
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.sm },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 14 },
  sheet: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  error: { ...typography.label, color: colors.danger },
  bottomPad: { height: spacing.xxl },
});
