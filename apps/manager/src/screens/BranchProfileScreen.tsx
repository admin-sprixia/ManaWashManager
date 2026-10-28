import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { InferResponseType } from 'hono/client';
import {
  clockMinutes,
  isValidPhone,
  MAX_WEEKLY_OFF_DAYS,
  normalizePhone,
  SERVICE_AREA_NAME_MAX,
  WEEKDAY_LABELS,
} from '@mana/domain';
import {
  Button,
  IconBuilding,
  IconCalendar,
  IconClock,
  IconLock,
  IconMapPin,
  IconPerson,
  IconPhone,
  IconPlus,
  IconShield,
  IconStar,
  IconStore,
  IconTag,
  IconUpi,
  Notice,
  Pill,
  PhoneField,
  ScreenContainer,
  ScreenHeader,
  TextField,
  colors,
  radius,
  shadow,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useShop } from '../offline/ShopProvider';
import { BranchLocationCard } from '../components/BranchLocationCard';
import { TimeField, formatAmPm } from '../components/TimeField';
import { UpiSheet } from '../components/UpiSheet';
import { ReviewLinkSheet } from '../components/ReviewLinkSheet';
import { BandRow, ScreenHero } from '../components/ScreenChrome';
import { Pill as ChoicePill, TONE } from './business/prices/parts';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'BranchProfile'>;
type Settings = InferResponseType<(typeof api)['service-area']['$get'], 200>;
type Details = InferResponseType<(typeof api)['shop']['details']['$get'], 200>;
type Area = Settings['areas'][number];

/** The week as shown, Monday first (Sunday = 0, as stored). */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** How far the branch serves customers, in km: the app's area and its team's reach. */
const REACH_KM = [3, 5, 10, 15, 20, 30];

type Tab = 'name' | 'contact' | 'location' | 'pay' | 'app' | 'hq';
const TABS: { key: Tab; label: string; Icon: (p: { size?: number; color?: string }) => React.ReactElement }[] = [
  { key: 'name', label: 'Name', Icon: IconStore },
  { key: 'contact', label: 'Contact & hours', Icon: IconClock },
  { key: 'location', label: 'Location', Icon: IconMapPin },
  { key: 'pay', label: 'UPI & review', Icon: IconUpi },
  { key: 'app', label: 'In the app', Icon: IconPhone },
  { key: 'hq', label: 'From HQ', Icon: IconLock },
];

const OPENED = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });


function failure(err: unknown): string {
  return err instanceof NetworkError ? 'No connection. Try again.' : err instanceof Error ? err.message : 'Something went wrong.';
}

/**
 * Everything about this branch the owner can change, on one page: its name, contact and hours,
 * weekly holiday, where it is, and how far the Mana Wash app finds it — and, below, what Mana
 * Wash HQ set when it opened the branch. Owner only.
 */
export function BranchProfileScreen({ navigation }: Props) {
  const { info, refresh, upiId, googleReviewUrl } = useShop();
  const [upiOpen, setUpiOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [tab, setTab] = useState<Tab>('name');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [address, setAddress] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [offDays, setOffDays] = useState<number[]>([]);
  const [contactError, setContactError] = useState<string | null>(null);
  const [savingContact, setSavingContact] = useState(false);

  const [radiusError, setRadiusError] = useState<string | null>(null);
  const [savingRadius, setSavingRadius] = useState<number | null>(null);

  const [areaName, setAreaName] = useState('');
  const [pincode, setPincode] = useState('');
  const [areaError, setAreaError] = useState<string | null>(null);
  const [addingArea, setAddingArea] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const apply = useCallback((next: Settings) => {
    setSettings(next);
    setAddress(next.contact.address ?? '');
    setContactPhone(next.contact.phone ?? '');
    setOpensAt(next.contact.opensAt ?? '');
    setClosesAt(next.contact.closesAt ?? '');
    setOffDays(next.contact.weeklyOffDays ?? (next.contact.weeklyOff != null ? [next.contact.weeklyOff] : []));
  }, []);

  const load = useCallback(async () => {
    try {
      const [areaRes, detailsRes] = await Promise.all([api['service-area'].$get(), api.shop.details.$get()]);
      if (!areaRes.ok) throw new Error(await apiErrorMessage(areaRes));
      apply(await areaRes.json());
      if (detailsRes.ok) {
        const body = await detailsRes.json();
        setDetails(body);
        setName(body.name);
        setCity(body.city ?? '');
      }
      setLoadError(null);
    } catch (err) {
      setLoadError(failure(err));
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const savedName = details?.name ?? info?.name ?? '';
  const savedCity = details?.city ?? info?.city ?? '';
  const trimmedName = name.trim().replace(/\s+/g, ' ');
  const nameChanged = trimmedName !== savedName || city.trim() !== savedCity;

  const saveName = async () => {
    if (trimmedName.length < 2) return setNameError('Enter the branch name.');
    setNameError(null);
    setSavingName(true);
    try {
      const res = await api.shop.info.$put({ json: { name: trimmedName, city: city.trim() || null } });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t save the name.'));
      setDetails((d) => (d ? { ...d, name: trimmedName, city: city.trim() || null } : d));
      await refresh();
      showToast('Name saved');
    } catch (err) {
      setNameError(err instanceof NetworkError ? 'Changing the name needs a connection.' : failure(err));
    } finally {
      setSavingName(false);
    }
  };

  const saveContact = async () => {
    const opens = opensAt || null;
    const closes = closesAt || null;
    if (address.trim() && address.trim().length < 5) return setContactError('Enter the full address.');
    if (contactPhone && !isValidPhone(contactPhone)) return setContactError('Enter a valid 10-digit mobile number.');
    if (!opens !== !closes) return setContactError('Set both the opening and the closing time, or neither.');
    if (opens && closes && clockMinutes(closes) <= clockMinutes(opens)) {
      return setContactError(`Closing time must be after ${formatAmPm(opens)}.`);
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
          weeklyOffDays: offDays,
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

  // One distance for the branch, around its pin: the app's area, and how far its team goes.
  const location = details?.location ?? settings?.hub ?? null;
  const saveRadius = async (km: number) => {
    if (!location) return setRadiusError('Pin the branch on the map first.');
    if (savingRadius != null || settings?.radiusKm === km) return;
    setRadiusError(null);
    setSavingRadius(km);
    try {
      const res = await api['service-area'].$put({ json: { ...location, radiusKm: km } });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      apply(await res.json());
      showToast(`Serving customers up to ${km} km away`);
    } catch (err) {
      setRadiusError(failure(err));
    } finally {
      setSavingRadius(null);
    }
  };

  const addArea = async () => {
    const area = areaName.trim();
    if (area.length < 2) return setAreaError('Enter the area name.');
    if (pincode.trim() && !/^\d{6}$/.test(pincode.trim())) return setAreaError('A pincode has 6 digits.');
    setAreaError(null);
    setAddingArea(true);
    try {
      const res = await api['service-area'].areas.$post({ json: { name: area, pincode: pincode.trim() || null } });
      if (!res.ok) throw new Error(await apiErrorMessage(res));
      setAreaName('');
      setPincode('');
      showToast(`${area} added`);
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

  const contact = settings?.contact;
  const hours = contact?.opensAt && contact.closesAt ? `${formatAmPm(contact.opensAt)} – ${formatAmPm(contact.closesAt)}` : 'Not set';
  const savedOff = contact?.weeklyOffDays ?? [];
  const holiday = savedOff.length ? WEEK.filter((d) => savedOff.includes(d)).map((d) => WEEKDAY_LABELS[d]!.slice(0, 3)).join(', ') : 'None';
  const toggleDay = (d: number) => {
    if (contactError) setContactError(null);
    if (offDays.includes(d)) return setOffDays(offDays.filter((x) => x !== d));
    if (offDays.length >= MAX_WEEKLY_OFF_DAYS) return setContactError('Leave at least one day open.');
    setOffDays([...offDays, d]);
  };
  const openDays = WEEK.filter((d) => !offDays.includes(d));
  const status = details?.status ?? info?.status ?? 'active';
  const code = details?.code ?? info?.code ?? '—';
  const activeAreas = settings?.areas.filter((a) => a.active).length ?? 0;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Branch details" onBack={() => navigation.goBack()} />
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
            <ScreenHero
              eyebrow={`BRANCH ${code}`}
              title={savedName || 'Your branch'}
              tone={status === 'paused' ? 'alert' : 'brand'}
              meta={[savedCity, status === 'paused' ? 'Paused by Mana Wash HQ' : 'Open for washes'].filter(Boolean).join(' · ')}
              chips={[
                { label: 'Hours', value: hours },
                { label: 'Holiday', value: holiday },
                { label: 'In the app', value: settings.inCustomerApp ? 'Live' : 'Pending' },
              ]}
            />

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
              <View style={styles.tabs} accessibilityRole="tablist">
                {TABS.map((t) => {
                  const on = tab === t.key;
                  return (
                    <Pressable
                      key={t.key}
                      onPress={() => setTab(t.key)}
                      style={[styles.tab, on && styles.tabOn]}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                    >
                      <t.Icon size={15} color={on ? colors.indigo : colors.slateDeep} />
                      <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            {tab === 'name' ? (
              <Card icon={<IconStore size={18} color={colors.indigo} />} tint={colors.indigoPale} title="The name customers see" subtitle="On WhatsApp messages, bills, reports and in the app.">
                <TextField
                  label="Branch name"
                  placeholder="e.g. Kovur"
                  value={name}
                  onChangeText={(t) => {
                    setName(t);
                    if (nameError) setNameError(null);
                  }}
                  maxLength={60}
                  autoCapitalize="words"
                />
                <TextField
                  label="City"
                  optional
                  placeholder="e.g. Kovur"
                  value={city}
                  onChangeText={setCity}
                  maxLength={40}
                  autoCapitalize="words"
                  error={nameError}
                />
                <View style={styles.preview}>
                  <Text style={styles.previewLabel}>On a bill it reads</Text>
                  <Text style={styles.previewValue} numberOfLines={1}>
                    {[trimmedName || 'Your branch', city.trim()].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Button label={nameChanged ? 'Save name' : 'No changes yet'} onPress={() => void saveName()} disabled={!nameChanged} loading={savingName} />
              </Card>
            ) : null}

            {tab === 'contact' ? (
              <>
                <Card icon={<IconPhone size={18} color={colors.tealDeep} />} tint="#CCFBF1" title="How customers reach you" subtitle="On your branch page in the Mana Wash app, with Call and WhatsApp buttons.">
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
                </Card>
                <Card icon={<IconClock size={18} color={colors.amberDeep} />} tint="#FEF3C7" title="Opening hours" subtitle="What customers see in the app. Washes can still be added at any time.">
                  <View style={styles.row}>
                    <TimeField
                      label="Opens at"
                      value={opensAt}
                      onChange={(v) => {
                        setOpensAt(v);
                        if (contactError) setContactError(null);
                      }}
                    />
                    <TimeField
                      label="Closes at"
                      value={closesAt}
                      onChange={(v) => {
                        setClosesAt(v);
                        if (contactError) setContactError(null);
                      }}
                    />
                  </View>

                  <View style={styles.weekHead}>
                    <Text style={styles.weekLabel}>Days open</Text>
                    <Text style={styles.weekHint}>Tap a day to close it</Text>
                  </View>
                  <View style={styles.week}>
                    {WEEK.map((d) => {
                      const closed = offDays.includes(d);
                      return (
                        <Pressable
                          key={d}
                          onPress={() => toggleDay(d)}
                          style={({ pressed }) => [styles.day, closed ? styles.dayClosed : styles.dayOpen, pressed && styles.pressed]}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: !closed }}
                          accessibilityLabel={`${WEEKDAY_LABELS[d]}: ${closed ? 'closed' : 'open'}`}
                        >
                          <Text style={[styles.dayName, closed && styles.dayNameClosed]}>{WEEKDAY_LABELS[d]!.slice(0, 3)}</Text>
                          <Text style={[styles.dayState, closed && styles.dayStateClosed]}>{closed ? 'Closed' : 'Open'}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <View style={styles.summary}>
                    <Text style={styles.summaryText}>
                      {opensAt && closesAt ? `Open ${formatAmPm(opensAt)} to ${formatAmPm(closesAt)}` : 'Opening times not set yet'}
                    </Text>
                    <Text style={styles.summaryHint}>
                      {offDays.length === 0
                        ? 'Open all 7 days of the week'
                        : `${openDays.length} ${openDays.length === 1 ? 'day' : 'days'} a week · closed ${WEEK.filter((d) => offDays.includes(d))
                            .map((d) => WEEKDAY_LABELS[d])
                            .join(', ')}`}
                    </Text>
                  </View>
                  {contactError ? <Text style={styles.error}>{contactError}</Text> : null}
                  <Button label="Save contact and hours" onPress={() => void saveContact()} loading={savingContact} />
                </Card>
              </>
            ) : null}

            {tab === 'location' ? (
              <>
                <View style={styles.pad}>
                  <BranchLocationCard
                    location={location}
                    pincode={details?.pincode ?? null}
                    canEdit
                    onSaved={(next) => {
                      setDetails((d) => (d ? { ...d, location: next } : d));
                      setSettings((s) => (s ? { ...s, hub: next } : s));
                    }}
                  />
                </View>
                <Card icon={<IconMapPin size={18} color={TONE.community.main} />} tint={TONE.community.pale} title="How far you serve customers" subtitle="Around the pin above: people this far away find you in the app, and your team goes this far.">
                  <View style={styles.pills}>
                    {REACH_KM.map((km) => (
                      <ChoicePill
                        key={km}
                        tone="community"
                        label={savingRadius === km ? 'Saving…' : `${km} km`}
                        on={settings.radiusKm === km}
                        onPress={() => void saveRadius(km)}
                      />
                    ))}
                  </View>
                  <Text style={radiusError ? styles.error : styles.help}>
                    {radiusError ??
                      (!location
                        ? 'Pin the branch on the map first.'
                        : settings.radiusKm != null
                          ? `Now up to ${settings.radiusKm} km from the branch.`
                          : 'Not set yet: pick a distance.')}
                  </Text>
                </Card>
              </>
            ) : null}

            {tab === 'pay' ? (
              <>
                <Card
                  icon={<IconUpi size={18} color={colors.waterDeep} />}
                  tint={colors.waterPale}
                  title="UPI QR code"
                  subtitle="Shown on the phone when a customer pays by UPI, so they scan and pay this branch directly."
                >
                  <View style={[styles.setting, upiId ? styles.settingOn : styles.settingOff]}>
                    <View style={[styles.statusDot, { backgroundColor: upiId ? colors.teal : colors.amber }]} />
                    <View style={styles.flex}>
                      <Text style={styles.settingLabel}>{upiId ? 'UPI ID' : 'Not set yet'}</Text>
                      <Text style={styles.settingValue} numberOfLines={1}>
                        {upiId ?? 'Add your UPI ID to show a QR when customers pay'}
                      </Text>
                    </View>
                  </View>
                  <Button label={upiId ? 'Change UPI ID' : 'Add UPI ID'} variant={upiId ? 'secondary' : 'primary'} onPress={() => setUpiOpen(true)} />
                </Card>
                <Card
                  icon={<IconStar size={18} color={colors.amberDeep} />}
                  tint="#FEF3C7"
                  title="Google review link"
                  subtitle="The WhatsApp bill’s Rate us button opens it, so happy customers can rate you on Google."
                >
                  <View style={[styles.setting, googleReviewUrl ? styles.settingOn : styles.settingOff]}>
                    <View style={[styles.statusDot, { backgroundColor: googleReviewUrl ? colors.teal : colors.amber }]} />
                    <View style={styles.flex}>
                      <Text style={styles.settingLabel}>{googleReviewUrl ? 'On WhatsApp bills' : 'Not set yet'}</Text>
                      <Text style={styles.settingValue} numberOfLines={1}>
                        {googleReviewUrl ?? 'Rate us just says thank you'}
                      </Text>
                    </View>
                  </View>
                  <Button
                    label={googleReviewUrl ? 'Change review link' : 'Add review link'}
                    variant={googleReviewUrl ? 'secondary' : 'primary'}
                    onPress={() => setReviewOpen(true)}
                  />
                </Card>
              </>
            ) : null}

            {tab === 'app' ? (
              <>
                <View style={[styles.status, settings.inCustomerApp ? styles.statusLive : styles.statusPending]}>
                  <View style={[styles.statusDot, { backgroundColor: settings.inCustomerApp ? colors.teal : colors.amber }]} />
                  <View style={styles.flex}>
                    <Text style={styles.statusTitle}>{settings.inCustomerApp ? 'Listed in the Mana Wash app' : 'Not listed yet'}</Text>
                    <Text style={styles.statusBody}>
                      {settings.inCustomerApp
                        ? 'People nearby find this branch, see your starting prices and join a community near them.'
                        : 'Fill in your contact, location and areas; Sprixia lists the branch when it’s ready.'}
                    </Text>
                  </View>
                </View>
                <Card
                  icon={<IconMapPin size={18} color={colors.waterDeep} />}
                  tint={colors.waterPale}
                  title={`Areas · ${activeAreas} on`}
                  subtitle="For people who don’t share their location: they pick their area from this list. Tap one to switch it off or on."
                  flush
                >
                  {settings.areas.length > 0 ? (
                    settings.areas.map((a, i) => (
                      <BandRow
                        key={a.id}
                        icon={<IconMapPin size={18} color={a.active ? colors.waterDeep : colors.slate} />}
                        title={a.name}
                        subtitle={a.pincode ? `Pincode ${a.pincode}` : undefined}
                        muted={!a.active}
                        right={togglingId === a.id ? <ActivityIndicator color={colors.water} /> : <Pill label={a.active ? 'ON' : 'OFF'} tone={a.active ? 'teal' : 'slate'} />}
                        last={i === settings.areas.length - 1}
                        onPress={() => void toggleArea(a)}
                      />
                    ))
                  ) : (
                    <Text style={[styles.help, styles.cardPad]}>No areas yet. Add the first one below.</Text>
                  )}
                </Card>
                <Card icon={<IconPlus size={18} color={colors.indigo} />} tint={colors.indigoPale} title="Add an area">
                  <TextField
                    label="Area name"
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
                </Card>
              </>
            ) : null}

            {tab === 'hq' ? (
              <Card icon={<IconLock size={18} color={colors.slateDeep} />} tint="#F1F5F9" title="Set by Mana Wash HQ" subtitle="When the branch opened. Ask HQ to change any of these." flush>
                <InfoRow icon={<IconTag size={16} color={colors.indigo} />} tint={colors.indigoPale} label="Branch code" value={code} />
                <InfoRow icon={<IconBuilding size={16} color="#5B21B6" />} tint="#EDE9FE" label="Business" value={details?.business ?? '—'} />
                <InfoRow icon={<IconCalendar size={16} color={colors.waterDeep} />} tint={colors.waterPale} label="Opened on" value={details ? OPENED.format(new Date(details.openedAt)) : '—'} />
                <InfoRow
                  icon={<IconShield size={16} color={status === 'paused' ? colors.amberDeep : colors.tealDeep} />}
                  tint={status === 'paused' ? '#FEF3C7' : '#CCFBF1'}
                  label="Status"
                  value={status === 'paused' ? `Paused${details?.statusReason ? ` · ${details.statusReason}` : ''}` : 'Active'}
                />
                <InfoRow
                  icon={<IconPerson size={16} color={colors.tealDeep} />}
                  tint="#CCFBF1"
                  label={details && details.owners.length > 1 ? 'Owners' : 'Owner'}
                  value={details?.owners.length ? details.owners.join(', ') : '—'}
                  last
                />
              </Card>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
      <UpiSheet visible={upiOpen} onClose={() => setUpiOpen(false)} />
      <ReviewLinkSheet visible={reviewOpen} onClose={() => setReviewOpen(false)} />
    </ScreenContainer>
  );
}

/** A white section card: a tinted icon, a title and a line, then its fields. */
function Card({
  icon,
  tint,
  title,
  subtitle,
  flush,
  children,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  subtitle?: string;
  /** Rows run edge to edge (a list) instead of padded fields. */
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.cardIcon, { backgroundColor: tint }]}>{icon}</View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{title}</Text>
          {subtitle ? <Text style={styles.cardSub}>{subtitle}</Text> : null}
        </View>
      </View>
      <View style={flush ? styles.cardList : styles.cardBody}>{children}</View>
    </View>
  );
}

/** One fact HQ set: an icon, what it is, and its value. */
function InfoRow({ icon, tint, label, value, last }: { icon: React.ReactNode; tint: string; label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.info, !last && styles.infoDivider]}>
      <View style={[styles.infoIcon, { backgroundColor: tint }]}>{icon}</View>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.xs, paddingBottom: spacing.xxl, gap: spacing.md },
  pad: { paddingHorizontal: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  help: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },
  error: { ...typography.caption, fontSize: 12.5, color: colors.danger, letterSpacing: 0 },

  tabsScroll: { paddingHorizontal: spacing.md },
  tabs: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: radius.pill, backgroundColor: '#E8F1F8' },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  tabOn: { backgroundColor: colors.white, ...shadow('sm') },
  tabText: { ...typography.bodyStrong, fontSize: 14, color: colors.slateDeep },
  tabTextOn: { color: colors.indigo, fontWeight: '800' },

  card: {
    marginHorizontal: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow('sm'),
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm + 2, padding: spacing.md, paddingBottom: spacing.sm },
  cardIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...typography.bodyStrong, fontSize: 16, fontWeight: '800', color: colors.waterInk },
  cardSub: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17, marginTop: 2 },
  cardBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, paddingTop: spacing.xs, gap: spacing.md },
  cardList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  cardPad: { padding: spacing.md },

  preview: { borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.sm + 4, gap: 2 },
  previewLabel: { ...typography.caption, fontSize: 11.5, color: colors.slate, letterSpacing: 0.3, fontWeight: '700' },
  previewValue: { ...typography.bodyStrong, fontSize: 15.5, fontWeight: '800', color: colors.waterInk },

  status: { marginHorizontal: spacing.md, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm + 2, padding: spacing.md, borderRadius: radius.xl, borderWidth: 1 },
  statusLive: { backgroundColor: '#F0FDFA', borderColor: '#99F6E4' },
  statusPending: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  statusTitle: { ...typography.bodyStrong, fontSize: 15.5, fontWeight: '800', color: colors.waterInk },
  statusBody: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17, marginTop: 2 },

  pressed: { opacity: 0.8 },
  weekHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  weekLabel: { ...typography.caption, fontSize: 12, fontWeight: '800', color: colors.slateDeep, letterSpacing: 0.6, textTransform: 'uppercase' },
  weekHint: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  week: { flexDirection: 'row', gap: 6 },
  day: { flex: 1, minWidth: 0, height: 58, borderRadius: radius.lg, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', gap: 2 },
  dayOpen: { backgroundColor: '#ECFDF5', borderColor: '#6EE7B7' },
  dayClosed: { backgroundColor: '#F8FAFC', borderColor: colors.border, borderStyle: 'dashed' },
  dayName: { ...typography.bodyStrong, fontSize: 14, fontWeight: '800', color: '#065F46' },
  dayNameClosed: { color: colors.slate },
  dayState: { ...typography.caption, fontSize: 10.5, fontWeight: '700', color: '#047857', letterSpacing: 0 },
  dayStateClosed: { color: colors.slate },
  setting: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, padding: spacing.sm + 4, borderRadius: radius.lg, borderWidth: 1 },
  settingOn: { backgroundColor: '#F0FDFA', borderColor: '#99F6E4' },
  settingOff: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  settingLabel: { ...typography.caption, fontSize: 11.5, fontWeight: '800', color: colors.slateDeep, letterSpacing: 0.3 },
  settingValue: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '700', color: colors.waterInk },
  summary: { borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.sm + 4, gap: 2 },
  summaryText: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '700', color: colors.waterInk, lineHeight: 20 },
  summaryHint: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },

  info: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4 },
  infoDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  infoIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  infoLabel: { ...typography.label, fontSize: 13.5, color: colors.slateDeep, width: 100 },
  infoValue: { ...typography.bodyStrong, fontSize: 14.5, color: colors.ink, fontWeight: '700', flex: 1, textAlign: 'right' },
});
