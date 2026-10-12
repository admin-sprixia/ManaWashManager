import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MAX_VEHICLES_PER_JOIN, PARKING_NOTE_MAX, formatInr } from '@mana/domain';
import {
  BottomSheet,
  Button,
  FieldMessage,
  IconPlus,
  Notice,
  TextField,
  colors,
  radius,
  spacing,
} from '@mana/ui';
import { api, send } from '../../api/client';
import { ApiError, errorMessage } from '../../api/errors';
import type { Membership, MenuVehicleType, PlaceInfo, Vehicle } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import { EdgePanel, SectionLabel } from '../../components/CardList';
import { PlaceHeaderCard, placeTitle } from '../../components/places/PlaceCard';
import { UnitPicker, type UnitValue } from '../../components/places/UnitPicker';
import { VehicleChoiceCard } from '../../components/places/VehicleChoiceCard';
import { ScreenHeader } from '../../components/ScreenHeader';
import { VehicleTypePicker } from '../../components/VehicleTypePicker';
import { usePageStyle } from '../../layout/Layout';
import type { JoinStackParams } from '../../navigation/types';
import { deadlineLine, washDayLine } from '../../places/format';
import { useJoinMode } from '../../places/joinMode';
import { setPendingJoin } from '../../places/pendingJoin';
import { defaultChoice, servesType, summarize, type Choice } from '../../places/pricing';
import { currentLocation } from '../../utils/location';

type Props = NativeStackScreenProps<JoinStackParams, 'JoinPlace'>;

interface DraftVehicle {
  key: string;
  type: MenuVehicleType;
  /** A vehicle the customer already has at this branch (Flow D). */
  vehicleId: string | null;
  plate: string | null;
  choice: Choice | null;
}

interface Loaded {
  info: PlaceInfo;
  /** A customer's vehicles at this place's branch, and their membership here if any. */
  vehicles: Vehicle[];
  member: Membership | null;
}

let draftKey = 0;

/**
 * Joining a place in one screen: the place, your flat, each vehicle with its plan or one wash,
 * and what it costs. At the place you're in at once; from elsewhere the team confirms first.
 */
export function JoinPlaceScreen({ navigation, route }: Props) {
  const pageStyle = usePageStyle();
  const mode = useJoinMode();
  const { signedIn, signOut } = useAuth();
  const params = route.params;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; missing: boolean } | null>(null);
  const [name, setName] = useState('');
  const [parking, setParking] = useState('');
  const [unit, setUnit] = useState<UnitValue>(null);
  const [drafts, setDrafts] = useState<DraftVehicle[]>([]);
  const [adding, setAdding] = useState(false);
  const [errors, setErrors] = useState<{ unit?: string; vehicles?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const seeded = useRef(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const placeId = 'code' in params ? (await send(api.places['by-code'][':code'].$get({ param: { code: params.code } }))).place.id : params.placeId;
      const [info, vehicles, home] = await Promise.all([
        send(api.places[':id'].$get({ param: { id: placeId } })),
        mode.kind === 'customer' ? send(api.vehicles.$get()).then((r) => r.vehicles) : Promise.resolve([] as Vehicle[]),
        mode.kind === 'customer' ? send(api.home.places.$get()).then((r) => r.memberships) : Promise.resolve([] as Membership[]),
      ]);
      setLoaded({
        info,
        vehicles: vehicles.filter((v) => v.branch.id === info.place.branchId),
        member: home.find((m) => m.place.id === info.place.id) ?? null,
      });
    } catch (err) {
      setLoadError({ message: errorMessage(err), missing: err instanceof ApiError && err.status === 404 });
    }
  }, [params, mode.kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const info = loaded?.info ?? null;
  const member = loaded?.member ?? null;
  const servedTypes = useMemo(() => (info ? info.menu.vehicleTypes.filter((t) => servesType(info.menu, t.id)) : []), [info]);
  const onPlace = useMemo(() => new Set(member?.vehicles.flatMap((v) => (v.vehicle ? [v.vehicle.id] : [])) ?? []), [member]);
  const yourVehicles = (loaded?.vehicles ?? []).filter(
    (v) => !onPlace.has(v.id) && !drafts.some((d) => d.vehicleId === v.id) && info != null && servesType(info.menu, v.type.id),
  );

  const addVehicle = useCallback(
    (type: MenuVehicleType, vehicle?: { id: string; plate: string }) => {
      if (!info) return;
      setDrafts((list) => [
        ...list,
        { key: `v${++draftKey}`, type, vehicleId: vehicle?.id ?? null, plate: vehicle?.plate ?? null, choice: defaultChoice(info.menu, type.id) },
      ]);
      setErrors((e) => ({ ...e, vehicles: undefined }));
      setAdding(false);
    },
    [info],
  );

  // A customer's one vehicle here is added for them; anyone else starts by picking a vehicle.
  useEffect(() => {
    if (!loaded || seeded.current) return;
    seeded.current = true;
    const only = loaded.vehicles.filter((v) => !onPlace.has(v.id) && servesType(loaded.info.menu, v.type.id));
    const type = only.length === 1 ? loaded.info.menu.vehicleTypes.find((t) => t.id === only[0]!.type.id) : undefined;
    if (type) addVehicle(type, { id: only[0]!.id, plate: only[0]!.registrationNumber });
  }, [loaded, onPlace, addVehicle]);

  const summaries = info
    ? drafts.map((d) => ({ draft: d, summary: d.choice ? summarize(info, d.type.id, d.choice) : null }))
    : [];
  const payNow = summaries.reduce((n, s) => n + (s.summary?.firstPayment ?? 0), 0);
  const firstWash = info
    ? summaries
        .map((s) => (s.summary ? info.firstWash[String(s.summary.perWeek)] : null))
        .filter((w): w is { day: string; payBy: string } => w != null)
        .sort((a, b) => a.day.localeCompare(b.day))[0] ?? null
    : null;

  const submit = async () => {
    if (!info) return;
    const found: typeof errors = {};
    if (!member && !unit) found.unit = info.place.type === 'building' ? 'Pick your flat.' : 'Pick or type your house number.';
    if (!drafts.length) found.vehicles = 'Add the vehicle to wash.';
    else if (drafts.some((d) => !d.choice)) found.vehicles = 'Pick a plan or a wash for each vehicle.';
    setErrors(found);
    setSubmitError(null);
    if (Object.keys(found).length) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const location = 'placeId' in params && params.location ? params.location : await currentLocation().catch(() => null);
      const body = {
        name: name.trim() || null,
        unit: member ? null : unit,
        parkingNote: parking.trim() || null,
        location,
        via: 'code' in params ? 'qr' : 'app',
        vehicles: drafts.map((d) => ({
          vehicleTypeId: d.vehicleId ? null : d.type.id,
          vehicleId: d.vehicleId,
          choice: d.choice!,
        })),
      };
      const placeLabel = placeTitle(info.place);
      if (mode.kind === 'ticket') {
        const result = await send(api.join.$post({ json: { ticket: mode.pass.ticket, placeId: info.place.id, ...body } }));
        if (!result.session) throw new ApiError('You’ve joined. Sign in again to see your plan.', 200, 'signed_out');
        setPendingJoin({ result, placeLabel });
        await signedIn(result.session.token, result.session.account);
      } else {
        const result = await send(api.places[':id'].join.$post({ param: { id: info.place.id }, json: body }));
        navigation.replace('JoinResult', { result, placeLabel });
      }
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'ticket_expired' || err.code === 'signed_out')) {
        await signOut(err.message);
        return;
      }
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const header = <ScreenHeader title={member ? 'Add a vehicle' : 'Join your place'} onBack={() => navigation.goBack()} />;

  if (!info) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {header}
        <View style={[styles.center, pageStyle]}>
          {loadError ? (
            <>
              <Notice tone="warning">{loadError.message}</Notice>
              {loadError.missing ? (
                <Button label="Go back" variant="secondary" onPress={() => navigation.goBack()} />
              ) : (
                <Button label="Try again" variant="secondary" onPress={() => void load()} />
              )}
            </>
          ) : (
            <ActivityIndicator color={colors.water} size="large" />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const noun = info.place.type === 'building' ? 'Flat' : 'House';
  const canAdd = drafts.length < MAX_VEHICLES_PER_JOIN;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      {header}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.content, pageStyle]} keyboardShouldPersistTaps="handled">
          <PlaceHeaderCard place={info.place} branchName={info.place.branchName} />

          {member ? (
            <View style={styles.pad}>
              <Notice tone="success" title="You’re a member here">
                {`${noun} ${member.unit}. Add another vehicle and pick its plan.`}
              </Notice>
            </View>
          ) : (
            <>
              <SectionLabel>Your {noun.toLowerCase()}</SectionLabel>
              <EdgePanel>
                <UnitPicker
                  units={info.units}
                  noun={noun}
                  value={unit}
                  onChange={(v) => {
                    setUnit(v);
                    setErrors((e) => ({ ...e, unit: undefined }));
                  }}
                  error={errors.unit}
                />
                {mode.kind === 'ticket' ? (
                  <TextField label="Your name" optional value={name} onChangeText={setName} autoCapitalize="words" maxLength={60} />
                ) : null}
                <TextField
                  label="Where it’s parked"
                  optional
                  value={parking}
                  onChangeText={setParking}
                  placeholder={info.place.type === 'building' ? 'e.g. Basement, slot 14' : 'e.g. In front of the gate'}
                  maxLength={PARKING_NOTE_MAX}
                />
              </EdgePanel>
            </>
          )}

          <SectionLabel right={drafts.length > 1 ? `${drafts.length} vehicles` : undefined}>Vehicles to wash</SectionLabel>
          <View style={styles.vehicles}>
            {drafts.map((d) => (
              <VehicleChoiceCard
                key={d.key}
                info={info}
                type={d.type}
                plate={d.plate}
                choice={d.choice}
                onChange={(choice) => {
                  setDrafts((list) => list.map((x) => (x.key === d.key ? { ...x, choice } : x)));
                  setErrors((e) => ({ ...e, vehicles: undefined }));
                }}
                onRemove={() => setDrafts((list) => list.filter((x) => x.key !== d.key))}
              />
            ))}
            {canAdd ? (
              <Pressable
                onPress={() => setAdding(true)}
                style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
                accessibilityRole="button"
              >
                <IconPlus size={18} color={colors.indigo} />
                <Text style={styles.addText}>{drafts.length ? 'Add another vehicle' : 'Add your vehicle'}</Text>
              </Pressable>
            ) : null}
            {errors.vehicles ? (
              <View style={styles.pad}>
                <FieldMessage error={errors.vehicles} />
              </View>
            ) : null}
          </View>

          {summaries.some((s) => s.summary) ? (
            <>
              <SectionLabel>Summary</SectionLabel>
              <EdgePanel>
                {summaries.map(({ draft, summary }) =>
                  summary ? (
                    <View key={draft.key} style={styles.line}>
                      <Text style={styles.lineTitle} numberOfLines={2}>
                        {draft.plate ?? draft.type.name} · {summary.title}
                      </Text>
                      <Text style={styles.lineAmount}>{formatInr(summary.total)}</Text>
                    </View>
                  ) : null,
                )}
                <View style={styles.rule} />
                <View style={styles.line}>
                  <Text style={styles.totalLabel}>To pay before the first wash</Text>
                  <Text style={styles.total}>{formatInr(payNow)}</Text>
                </View>
                {firstWash ? (
                  <Text style={styles.when}>
                    First wash {washDayLine(firstWash.day, info.place.washTime)} · pay before {deadlineLine(firstWash.payBy)}
                  </Text>
                ) : null}
                <Text style={styles.note}>You pay online after joining. Washers never collect money.</Text>
              </EdgePanel>
            </>
          ) : null}

          <View style={styles.footer}>
            {errors.unit || errors.vehicles ? (
              <Notice tone="danger">Check the highlighted parts.</Notice>
            ) : submitError ? (
              <Notice tone="danger">{submitError}</Notice>
            ) : null}
            <Button label={member ? 'Add to my place' : `Join ${placeTitle(info.place)}`} size="lg" loading={submitting} onPress={() => void submit()} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomSheet visible={adding} onClose={() => setAdding(false)} title="Which vehicle?" subtitle="Each vehicle gets its own plan.">
        <View style={styles.sheet}>
          {yourVehicles.length ? (
            <View style={styles.yours}>
              {yourVehicles.map((v) => {
                const type = info.menu.vehicleTypes.find((t) => t.id === v.type.id);
                if (!type) return null;
                return (
                  <Pressable
                    key={v.id}
                    onPress={() => addVehicle(type, { id: v.id, plate: v.registrationNumber })}
                    style={({ pressed }) => [styles.yourRow, pressed && styles.addPressed]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.yourPlate}>{v.registrationNumber}</Text>
                    <Text style={styles.yourType}>{[v.make, v.model].filter(Boolean).join(' ') || v.type.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <VehicleTypePicker
            label={yourVehicles.length ? 'Or a new one: pick its type' : 'Pick its type'}
            types={servedTypes}
            value={null}
            onChange={(id) => {
              const type = servedTypes.find((t) => t.id === id);
              if (type) addVehicle(type);
            }}
            hint="The washer notes the number plate at the first wash."
          />
          {!servedTypes.length ? <Notice tone="warning">This team doesn’t wash vehicles here yet.</Notice> : null}
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  content: { paddingBottom: spacing.xl },
  pad: { paddingHorizontal: 16, paddingTop: 16 },
  vehicles: { gap: 12 },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    paddingVertical: 16,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.indigoMist,
    backgroundColor: colors.white,
  },
  addPressed: { backgroundColor: colors.indigoPale },
  addText: { fontSize: 15.5, fontWeight: '800', color: colors.indigo },
  line: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  lineTitle: { flex: 1, fontSize: 14.5, color: colors.slateDeep },
  lineAmount: { fontSize: 15, fontWeight: '700', color: colors.ink },
  rule: { height: 1, backgroundColor: colors.border },
  totalLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.ink },
  total: { fontSize: 20, fontWeight: '800', color: colors.ink },
  when: { fontSize: 14, fontWeight: '600', color: colors.indigo },
  note: { fontSize: 12.5, color: colors.slate },
  footer: { paddingHorizontal: 16, paddingTop: spacing.lg, gap: spacing.md },
  sheet: { gap: spacing.md },
  yours: { gap: 8 },
  yourRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  yourPlate: { fontSize: 14, fontWeight: '800', letterSpacing: 0.8, color: colors.ink },
  yourType: { flex: 1, fontSize: 14, color: colors.slateDeep },
});
