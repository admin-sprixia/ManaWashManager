import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  MAX_VEHICLES_PER_REQUEST,
  PLACE_KINDS,
  PLACE_KIND_LABELS,
  PREFERRED_TIMES,
  PREFERRED_TIME_LABELS,
  SERVICE_REQUEST_ADDRESS_MAX,
  SERVICE_REQUEST_NOTES_MAX,
  type PlaceKind,
  type PreferredTime,
} from '@mana/domain';
import {
  Button,
  ChoiceChips,
  Counter,
  FieldLabel,
  FieldMessage,
  IconBike,
  IconCar,
  IconMapPin,
  Notice,
  TextField,
  colors,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { EdgePanel, SectionLabel } from '../../components/CardList';
import { ScreenHeader } from '../../components/ScreenHeader';
import { api, send } from '../../api/client';
import { ApiError, errorMessage } from '../../api/errors';
import type { RequestPass } from '../../api/session';
import type { AreaCheck, ServiceArea } from '../../api/types';
import { useAuth } from '../../auth/AuthProvider';
import type { RequestStackParams } from '../../navigation/types';
import { currentLocation, type Coordinates } from '../../utils/location';

type Props = NativeStackScreenProps<RequestStackParams, 'RequestForm'> & { pass: RequestPass };

const PLACE_OPTIONS = PLACE_KINDS.map((value) => ({ value, label: PLACE_KIND_LABELS[value] }));
const TIME_OPTIONS = PREFERRED_TIMES.map((value) => ({ value, label: PREFERRED_TIME_LABELS[value] }));

/** What to call the building's name, by kind of place (houses don't have one). */
const PLACE_NAME_LABEL: Partial<Record<PlaceKind, string>> = {
  apartment: 'Apartment name',
  small_building: 'Building name',
  office: 'Office or company name',
  other: 'Place name',
};

type Errors = Partial<Record<'place' | 'name' | 'address' | 'placeKind' | 'vehicles', string>>;

/** "Request service": where, what kind of place, how many vehicles, when, and who to call. */
export function RequestFormScreen({ navigation, route, pass }: Props) {
  const from = route.params?.from;
  const { signOut } = useAuth();

  const [areas, setAreas] = useState<ServiceArea[] | null>(null);
  const [location, setLocation] = useState<Coordinates | null>(from?.location ?? null);
  const [areaId, setAreaId] = useState<string | null>(from?.area?.id ?? null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [check, setCheck] = useState<AreaCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const [name, setName] = useState(from?.name ?? '');
  const [address, setAddress] = useState(from?.address ?? '');
  const [placeKind, setPlaceKind] = useState<PlaceKind | null>((from?.placeKind as PlaceKind | undefined) ?? null);
  const [placeName, setPlaceName] = useState(from?.placeName ?? '');
  const [homeText, setHomeText] = useState(from?.homeText ?? '');
  const [cars, setCars] = useState(from?.cars ?? 1);
  const [bikes, setBikes] = useState(from?.bikes ?? 0);
  const [preferredTime, setPreferredTime] = useState<PreferredTime | null>(
    (from?.preferredTime as PreferredTime | null | undefined) ?? null,
  );
  const [notes, setNotes] = useState(from?.notes ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    send(api['service-areas'].$get())
      .then((r) => setAreas(r.areas))
      .catch(() => setAreas([]));
  }, []);

  // Each new place is checked against where MANA washes.
  useEffect(() => {
    if (!location && !areaId) {
      setCheck(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    send(api['service-area'].check.$post({ json: { location, areaId } }))
      .then((r) => !cancelled && setCheck(r))
      .catch(() => !cancelled && setCheck(null))
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [location, areaId]);

  const areaOptions = useMemo(
    () => (areas ?? []).map((a) => ({ value: a.id, label: a.pincode ? `${a.name} · ${a.pincode}` : a.name })),
    [areas],
  );

  const shareLocation = async () => {
    setLocating(true);
    setLocationError(null);
    try {
      setLocation(await currentLocation());
      setErrors((e) => ({ ...e, place: undefined }));
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : 'Couldn’t find your location.');
    } finally {
      setLocating(false);
    }
  };

  const validate = (): Errors => {
    const next: Errors = {};
    if (!location && !areaId) next.place = 'Share your location or pick your area.';
    if (!name.trim()) next.name = 'Enter your name.';
    if (address.trim().length < 5) next.address = 'Enter your address, with a landmark if you can.';
    if (!placeKind) next.placeKind = 'Pick the kind of place.';
    if (cars + bikes < 1) next.vehicles = 'Add at least one car or bike.';
    return next;
  };

  const submit = async () => {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0 || !placeKind) {
      setSubmitError('Check the highlighted fields.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await send(
        api['service-requests'].$post({
          json: {
            ticket: pass.ticket,
            name: name.trim(),
            location,
            areaId,
            address: address.trim(),
            placeKind,
            placeName: PLACE_NAME_LABEL[placeKind] ? placeName.trim() || null : null,
            homeText: homeText.trim() || null,
            cars,
            bikes,
            preferredTime,
            notes: notes.trim() || null,
          },
        }),
      );
      showToast(from ? 'Request updated' : 'Request sent');
      navigation.goBack();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await signOut('Enter your number again to send your request.');
        return;
      }
      if (err instanceof ApiError && err.code === 'already_customer') {
        navigation.goBack();
        return;
      }
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const placeNameLabel = placeKind ? PLACE_NAME_LABEL[placeKind] : undefined;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScreenHeader title={from ? 'Change your request' : 'Request service'} onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <SectionLabel>Where should we come?</SectionLabel>
          <EdgePanel style={styles.section}>
            <Button
              label={location ? 'Location shared · update' : 'Use my current location'}
              variant={location ? 'secondary' : 'primary'}
              icon={<IconMapPin size={18} color={location ? colors.water : colors.white} />}
              loading={locating}
              onPress={() => void shareLocation()}
            />
            {locationError ? <FieldMessage error={locationError} /> : null}
            {areas == null ? (
              <ActivityIndicator color={colors.water} />
            ) : areaOptions.length > 0 ? (
              <ChoiceChips
                label={location ? 'Your area (optional)' : 'Or pick your area'}
                options={areaOptions}
                value={areaId}
                onChange={(id) => {
                  setAreaId((current) => (current === id ? null : id));
                  setErrors((e) => ({ ...e, place: undefined }));
                }}
              />
            ) : null}
            <FieldMessage error={errors.place} />
            {checking ? (
              <ActivityIndicator color={colors.water} />
            ) : check?.served ? (
              <Notice tone="success" title="Good news">
                {`${check.branch.name}${check.branch.city ? `, ${check.branch.city}` : ''} washes in your area.`}
              </Notice>
            ) : check && !check.served ? (
              <Notice tone="warning" title="We’re not in your area yet">
                Send your details anyway. We’ll let you know when MANA starts washing near you.
              </Notice>
            ) : null}
          </EdgePanel>

          <SectionLabel>Your place</SectionLabel>
          <EdgePanel style={styles.section}>
            <ChoiceChips
              label="Kind of place"
              options={PLACE_OPTIONS}
              value={placeKind}
              onChange={(v) => {
                setPlaceKind(v);
                setErrors((e) => ({ ...e, placeKind: undefined }));
              }}
              error={errors.placeKind}
            />
            {placeNameLabel ? (
              <TextField label={placeNameLabel} optional value={placeName} onChangeText={setPlaceName} maxLength={80} />
            ) : null}
            <TextField
              label={placeKind === 'house' ? 'House number' : 'Flat or house number'}
              optional
              value={homeText}
              onChangeText={setHomeText}
              maxLength={40}
            />
            <TextField
              label="Address"
              placeholder="Street, area, landmark"
              value={address}
              onChangeText={(t) => {
                setAddress(t);
                if (errors.address) setErrors((e) => ({ ...e, address: undefined }));
              }}
              multiline
              maxLength={SERVICE_REQUEST_ADDRESS_MAX}
              error={errors.address}
            />
          </EdgePanel>

          <SectionLabel>Vehicles to wash</SectionLabel>
          <EdgePanel style={styles.section}>
            <Counter
              label="Cars"
              icon={<IconCar size={20} color={colors.waterDeep} />}
              value={cars}
              onChange={(v) => {
                setCars(v);
                setErrors((e) => ({ ...e, vehicles: undefined }));
              }}
              max={MAX_VEHICLES_PER_REQUEST}
            />
            <Counter
              label="Bikes"
              icon={<IconBike size={20} color={colors.waterDeep} />}
              value={bikes}
              onChange={(v) => {
                setBikes(v);
                setErrors((e) => ({ ...e, vehicles: undefined }));
              }}
              max={MAX_VEHICLES_PER_REQUEST}
            />
            <FieldMessage error={errors.vehicles} />
            <ChoiceChips
              label="Best time (optional)"
              options={TIME_OPTIONS}
              value={preferredTime}
              onChange={(v) => setPreferredTime((current) => (current === v ? null : v))}
            />
          </EdgePanel>

          <SectionLabel>Who should we call?</SectionLabel>
          <EdgePanel style={styles.section}>
            <View style={styles.callRow}>
              <FieldLabel>Number</FieldLabel>
              <Text style={styles.callPhone}>+91 {pass.phone}</Text>
            </View>
            <TextField
              label="Your name"
              value={name}
              onChangeText={(t) => {
                setName(t);
                if (errors.name) setErrors((e) => ({ ...e, name: undefined }));
              }}
              autoCapitalize="words"
              maxLength={60}
              error={errors.name}
            />
            <TextField
              label="Anything else?"
              optional
              placeholder="Parking spot, gate timings…"
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={SERVICE_REQUEST_NOTES_MAX}
            />
          </EdgePanel>

          {submitError ? <Notice tone="danger">{submitError}</Notice> : null}
          <Button
            label={from ? 'Save changes' : 'Send request'}
            size="lg"
            loading={submitting}
            onPress={() => void submit()}
          />
          <Text style={styles.footnote}>
            The MANA team will call you to agree the price and a time. Nothing is charged in the app.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  header: { paddingHorizontal: spacing.md },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  section: { gap: spacing.md },
  sectionTitle: { ...typography.heading, color: colors.waterInk },
  callRow: { gap: 4 },
  callPhone: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 17 },
  footnote: { ...typography.caption, color: colors.slate, letterSpacing: 0, textAlign: 'center', lineHeight: 17 },
});
