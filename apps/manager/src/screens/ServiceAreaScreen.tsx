import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import {
  clockMinutes,
  isValidClock,
  isValidPhone,
  normalizePhone,
  SERVICE_AREA_NAME_MAX,
  SERVICE_RADIUS_MAX_KM,
  SERVICE_RADIUS_MIN_KM,
  WEEKDAY_LABELS,
} from '@mana/domain';
import {
  Button,
  ChoiceChips,
  IconMapPin,
  Notice,
  PhoneField,
  ScreenContainer,
  ScreenHeader,
  TextField,
  colors,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { EdgeGroup, EdgeRow, Pill, SectionLabel } from '../components/EdgeList';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'ServiceArea'>;
type Settings = InferResponseType<(typeof api)['service-area']['$get'], 200>;
type Area = Settings['areas'][number];

/** "14.4936, 79.9884" (as Google Maps copies it) → a point; null when it isn't one. */
function parsePoint(text: string): { latitude: number; longitude: number } | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

type OffDay = 'none' | '0' | '1' | '2' | '3' | '4' | '5' | '6';
const OFF_DAY_OPTIONS: { value: OffDay; label: string }[] = [
  { value: 'none', label: 'Open every day' },
  ...WEEKDAY_LABELS.map((d, i) => ({ value: String(i) as OffDay, label: d.slice(0, 3) })),
];

/** "7", "7:30", "0730", "07:30" → "07:00"/"07:30"; null when it isn't a time. */
function normalizeClock(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return null;
  const value = `${m[1]!.padStart(2, '0')}:${m[2] ?? '00'}`;
  return isValidClock(value) ? value : null;
}

const formatPoint = (p: { latitude: number; longitude: number }) => `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;

function failure(err: unknown): string {
  return err instanceof NetworkError ? 'No connection. Try again.' : err instanceof Error ? err.message : 'Something went wrong.';
}

/**
 * Where this branch washes, for the MANA Car Wash app: a hub point with a radius, and named areas
 * customers can pick when they don't share their location. Owner only.
 */
export function ServiceAreaScreen({ navigation }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [point, setPoint] = useState('');
  const [radius, setRadius] = useState('');
  const [hubError, setHubError] = useState<string | null>(null);
  const [savingHub, setSavingHub] = useState(false);
  const [areaName, setAreaName] = useState('');
  const [pincode, setPincode] = useState('');
  const [areaError, setAreaError] = useState<string | null>(null);
  const [addingArea, setAddingArea] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [weeklyOff, setWeeklyOff] = useState<OffDay>('none');
  const [contactError, setContactError] = useState<string | null>(null);
  const [savingContact, setSavingContact] = useState(false);

  const apply = useCallback((next: Settings) => {
    setSettings(next);
    setPoint(next.hub ? formatPoint(next.hub) : '');
    setRadius(next.radiusKm != null ? String(next.radiusKm) : '');
    setAddress(next.contact.address ?? '');
    setContactPhone(next.contact.phone ?? '');
    setOpensAt(next.contact.opensAt ?? '');
    setClosesAt(next.contact.closesAt ?? '');
    setWeeklyOff(next.contact.weeklyOff == null ? 'none' : (String(next.contact.weeklyOff) as OffDay));
  }, []);

  const saveContact = async () => {
    const opens = normalizeClock(opensAt);
    const closes = normalizeClock(closesAt);
    if (address.trim() && address.trim().length < 5) return setContactError('Enter the full address.');
    if (contactPhone && !isValidPhone(contactPhone)) return setContactError('Enter a valid 10-digit mobile number.');
    if ((opensAt.trim() && !opens) || (closesAt.trim() && !closes)) {
      return setContactError('Write times as 24-hour clock, e.g. 07:00 and 20:30.');
    }
    if (!opens !== !closes) return setContactError('Set both opening and closing times, or neither.');
    if (opens && closes && clockMinutes(closes) <= clockMinutes(opens)) {
      return setContactError('Closing time must be after opening time.');
    }
    setContactError(null);
    setSavingContact(true);
    try {
      const res = await api['service-area'].contact.$put({
        json: {
          address: address.trim() || null,
          phone: contactPhone || null,
          opensAt: opens,
          closesAt: closes,
          weeklyOff: weeklyOff === 'none' ? null : Number(weeklyOff),
        },
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      apply(await res.json());
      showToast('Contact and hours saved');
    } catch (err) {
      setContactError(failure(err));
    } finally {
      setSavingContact(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const res = await api['service-area'].$get();
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      apply(await res.json());
      setLoadError(null);
    } catch (err) {
      setLoadError(failure(err));
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveHub = async (clear = false) => {
    const hub = clear ? null : parsePoint(point);
    const km = clear ? null : radius.trim() ? Number(radius) : null;
    if (!clear) {
      if (!hub) return setHubError('Paste the location as “latitude, longitude”, e.g. 14.49360, 79.98840.');
      if (km == null || !Number.isFinite(km) || km < SERVICE_RADIUS_MIN_KM || km > SERVICE_RADIUS_MAX_KM) {
        return setHubError(`Radius is ${SERVICE_RADIUS_MIN_KM} to ${SERVICE_RADIUS_MAX_KM} km.`);
      }
    }
    setHubError(null);
    setSavingHub(true);
    try {
      const res = await api['service-area'].$put({
        json: { latitude: hub?.latitude ?? null, longitude: hub?.longitude ?? null, radiusKm: km },
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      apply(await res.json());
      showToast(clear ? 'Hub removed' : 'Service area saved');
    } catch (err) {
      setHubError(failure(err));
    } finally {
      setSavingHub(false);
    }
  };

  const addArea = async () => {
    const name = areaName.trim();
    if (name.length < 2) return setAreaError('Enter the area name.');
    if (pincode.trim() && !/^\d{6}$/.test(pincode.trim())) return setAreaError('A pincode has 6 digits.');
    setAreaError(null);
    setAddingArea(true);
    try {
      const res = await api['service-area'].areas.$post({ json: { name, pincode: pincode.trim() || null } });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      setAreaName('');
      setPincode('');
      showToast(`${name} added`);
      await load();
    } catch (err) {
      setAreaError(failure(err));
    } finally {
      setAddingArea(false);
    }
  };

  const toggleArea = async (area: Area) => {
    setTogglingId(area.id);
    try {
      const res = await api['service-area'].areas[':id'].$patch({
        param: { id: area.id },
        json: { active: !area.active },
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      await load();
    } catch (err) {
      showToast(failure(err), 'error');
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Branch in the app" onBack={() => navigation.goBack()} />
      </View>
      {!settings ? (
        loadError ? (
          <View style={styles.pad}>
            <Notice tone="danger">{loadError}</Notice>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.water} style={styles.loading} />
        )
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.pad}>
              {settings.inCustomerApp ? (
                <Notice tone="success" title="Listed in the MANA Car Wash app">
                  People nearby can find this branch, see your starting prices and ask for doorstep washing.
                </Notice>
              ) : (
                <Notice tone="info" title="Not listed in the app yet">
                  Set your service area now. Sprixia lists your branch in the MANA Car Wash app when it’s ready.
                </Notice>
              )}
            </View>

            <SectionLabel>Contact and hours</SectionLabel>
            <View style={[styles.pad, styles.card]}>
              <Text style={styles.help}>
                Customers see this on the branch page, with buttons to call you and get directions.
              </Text>
              <TextField
                label="Address"
                placeholder="Main Road, near Bus Stand, Kovur"
                value={address}
                onChangeText={(t) => {
                  setAddress(t);
                  if (contactError) setContactError(null);
                }}
                maxLength={300}
                multiline
                autoCapitalize="words"
              />
              <PhoneField
                label="Phone for customers"
                digits={contactPhone}
                onChangeDigits={(d) => {
                  setContactPhone(d);
                  if (contactError) setContactError(null);
                }}
                normalize={normalizePhone}
                hint="Customers call this number, or message it on WhatsApp."
              />
              <View style={styles.row}>
                <View style={styles.flex}>
                  <TextField
                    label="Opens at"
                    placeholder="07:00"
                    value={opensAt}
                    onChangeText={(t) => {
                      setOpensAt(t.replace(/[^\d:]/g, '').slice(0, 5));
                      if (contactError) setContactError(null);
                    }}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
                <View style={styles.flex}>
                  <TextField
                    label="Closes at"
                    placeholder="20:00"
                    value={closesAt}
                    onChangeText={(t) => {
                      setClosesAt(t.replace(/[^\d:]/g, '').slice(0, 5));
                      if (contactError) setContactError(null);
                    }}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
              </View>
              <ChoiceChips<OffDay>
                label="Weekly holiday"
                options={OFF_DAY_OPTIONS}
                value={weeklyOff}
                onChange={setWeeklyOff}
                error={contactError}
              />
              <Button label="Save contact and hours" onPress={() => void saveContact()} loading={savingContact} />
            </View>

            <SectionLabel>Hub and radius</SectionLabel>
            <View style={[styles.pad, styles.card]}>
              <Text style={styles.help}>
                In Google Maps, press and hold your shop to drop a pin, copy the numbers it shows, and paste them here.
              </Text>
              <TextField
                label="Hub location"
                placeholder="14.49360, 79.98840"
                value={point}
                onChangeText={(t) => {
                  setPoint(t);
                  if (hubError) setHubError(null);
                }}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
              />
              <TextField
                label="Radius (km)"
                placeholder="8"
                value={radius}
                onChangeText={(t) => {
                  setRadius(t.replace(/[^\d.]/g, ''));
                  if (hubError) setHubError(null);
                }}
                keyboardType="decimal-pad"
                hint="People within this distance of the hub are in your area."
                error={hubError}
              />
              <Button label="Save hub" onPress={() => void saveHub()} loading={savingHub} />
              {settings.hub ? (
                <Button label="Remove hub" variant="ghost" onPress={() => void saveHub(true)} disabled={savingHub} />
              ) : null}
            </View>

            <SectionLabel>Areas</SectionLabel>
            <Text style={[styles.help, styles.pad]}>
              For people who don’t share their location: they pick their area from this list.
            </Text>
            {settings.areas.length > 0 ? (
              <EdgeGroup>
                {settings.areas.map((a) => (
                  <EdgeRow
                    key={a.id}
                    icon={<IconMapPin size={19} color={a.active ? colors.waterDeep : colors.slate} />}
                    title={a.name}
                    subtitle={a.pincode ? `Pincode ${a.pincode}` : undefined}
                    tone={a.active ? 'default' : 'muted'}
                    right={
                      togglingId === a.id ? (
                        <ActivityIndicator color={colors.water} />
                      ) : (
                        <Pill label={a.active ? 'ON' : 'OFF'} tone={a.active ? 'teal' : 'slate'} />
                      )
                    }
                    chevron={false}
                    onPress={() => void toggleArea(a)}
                  />
                ))}
              </EdgeGroup>
            ) : null}
            <View style={[styles.pad, styles.card]}>
              <TextField
                label="Add an area"
                placeholder="Kovur"
                value={areaName}
                onChangeText={(t) => {
                  setAreaName(t);
                  if (areaError) setAreaError(null);
                }}
                maxLength={SERVICE_AREA_NAME_MAX}
                autoCapitalize="words"
              />
              <TextField
                label="Pincode"
                optional
                placeholder="524137"
                value={pincode}
                onChangeText={(t) => setPincode(t.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                error={areaError}
              />
              <Button label="Add area" variant="secondary" onPress={() => void addArea()} loading={addingArea} />
              <Text style={styles.help}>Tap an area to turn it off or on.</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingBottom: spacing.xl },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  card: { paddingVertical: spacing.md },
  help: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', gap: spacing.md },
});
