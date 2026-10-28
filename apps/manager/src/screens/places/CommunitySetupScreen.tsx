import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  bestTimeLabel,
  CONTACT_NAME_MAX,
  describeSlot,
  inspectionWarnings,
  MAX_PLACE_PHOTOS,
  MAX_PROPOSED_SLOTS,
  MIN_PROPOSED_SLOTS,
  missingForReview,
  normalizePhone,
  PARKING_LABEL,
  PERMISSION_LABEL,
  PLACE_LABEL_MAX,
  PLACE_LABEL_MIN,
  PLACE_NAME_MAX,
  PLACE_NOTES_MAX,
  PLACE_PHOTO_KIND_HINT,
  PLACE_PHOTO_KIND_LABEL,
  PLACE_PHOTO_KINDS,
  PLACE_TYPE_LABEL,
  PLACE_TYPES,
  POWER_LABEL,
  requiredPhotoKinds,
  SPACE_LABEL,
  WATER_LABEL,
  type Inspection,
  type PlacePhotoKind,
  type PlaceType,
  type ProposedSlot,
} from '@mana/domain';
import {
  Button,
  ChoiceChips,
  IconAlert,
  IconCalendar,
  IconCamera,
  IconCar,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconEdit,
  IconMapPin,
  IconPhone,
  IconPlus,
  IconShield,
  Notice,
  PhoneField,
  ScreenContainer,
  ScreenHeader,
  TextField,
  colors,
  formatPhone,
  radius,
  showAlert,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage, uploadPlacePhoto } from '../../api/client';
import { useAuth } from '../../api/auth';
import { NetworkError } from '../../api/network';
import { SheetNotice } from '../../components/SheetBits';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { pickPhotos } from '../../utils/photoPicker';
import type { Point } from '../../utils/location';
import { LocationPicker, PhotoStrip, SlotEditor } from './communityParts';
import { WarningList } from './kit';
import { choiceLabel } from './review/options';
import { TimeField } from './review/TimeField';
import { TEAL, TEAL_MIST, TEAL_PALE } from './panel/parts';
import { failure, useApiData, type PlaceDetail } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'CommunitySetup'>;

const options = <T extends string>(labels: Readonly<Record<T, string>>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
const TYPE_OPTIONS = PLACE_TYPES.map((value) => ({ value, label: PLACE_TYPE_LABEL[value] }));
const NEW_SLOT: ProposedSlot = { days: [6], time: '07:00' };
const countText = (n: number | undefined) => (n == null ? '' : String(n));
const textCount = (t: string) => (t.trim() ? Math.min(999, Number(t.replace(/\D/g, '')) || 0) : undefined);

type StepKey = 'place' | 'photos' | 'site' | 'vehicles' | 'contact' | 'choices' | 'review';

/** The visit, one step at a time: what the step is, its short name on the track, and what to do. */
const STEPS: readonly { key: StepKey; title: string; short: string; what: string; Icon: typeof IconMapPin }[] = [
  { key: 'place', title: 'The place', short: 'Place', Icon: IconMapPin, what: 'Name the community and pin its main gate. Stand at the gate when you pin it.' },
  { key: 'photos', title: 'Photos', short: 'Photos', Icon: IconCamera, what: 'Take one photo on each tab. Every tab says exactly what the photo must show.' },
  { key: 'site', title: 'Site check', short: 'Site', Icon: IconShield, what: 'Answer what you saw: the society’s answer, water, power, parking and space to wash.' },
  { key: 'vehicles', title: 'Vehicles & time', short: 'Vehicles', Icon: IconCar, what: 'Roughly how many cars and bikes are parked here, and when residents want the wash.' },
  { key: 'contact', title: 'Who to call', short: 'Contact', Icon: IconPhone, what: 'The secretary, or whoever looks after the community. Add the security guard if there is one.' },
  { key: 'choices', title: 'Days residents want', short: 'Days', Icon: IconCalendar, what: `Ask a few residents and add ${MIN_PROPOSED_SLOTS} to ${MAX_PROPOSED_SLOTS} choices of days and time, best first.` },
  { key: 'review', title: 'Check & send', short: 'Send', Icon: IconCheck, what: 'Look over every step, add a note for the team if you like, then send it to the owner.' },
];

/**
 * Setting a community up after visiting it, one clear step at a time: the place and its gate,
 * a photo on each tab, the site check, vehicles and time, who to call, the days residents want,
 * then a last look and send. Each Next saves the draft, so nothing is lost on site. Once live,
 * the team can still add photos and notes; everything else is the owner's.
 */
export function CommunitySetupScreen({ navigation, route }: Props) {
  const { isOwner } = useAuth();
  const placeId = route.params?.placeId ?? null;
  const detail = useApiData<PlaceDetail>(
    () => (placeId ? api.places[':id'].$get({ param: { id: placeId } }) : Promise.resolve(EMPTY)),
    'Couldn’t load this community.',
  );
  const place = placeId ? (detail.data?.place ?? null) : null;
  const { load } = detail;
  const openedWith = useRef(placeId);
  const scroll = useRef<ScrollView>(null);

  // A new draft was just saved: load it so photos can be added.
  useEffect(() => {
    if (placeId && placeId !== openedWith.current) void load();
  }, [placeId, load]);

  const [type, setType] = useState<PlaceType>('building');
  const [name, setName] = useState(route.params?.name ?? '');
  const [label, setLabel] = useState(route.params?.label ?? '');
  const [point, setPoint] = useState<Point | null>(route.params?.at ?? null);
  const [inspection, setInspection] = useState<Inspection>({});
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [securityName, setSecurityName] = useState('');
  const [securityPhone, setSecurityPhone] = useState('');
  const [slots, setSlots] = useState<ProposedSlot[]>([NEW_SLOT]);
  const [notes, setNotes] = useState('');
  const [photoKind, setPhotoKind] = useState<PlacePhotoKind>('gate');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<'save' | 'next' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  // Fill the form once from what's saved (not on every reload, so typing isn't lost).
  useEffect(() => {
    if (!place || filledFrom === place.id) return;
    setFilledFrom(place.id);
    setType(place.type);
    setName(place.name ?? '');
    setLabel(place.label);
    setPoint(place.location);
    setInspection(place.setup.inspection);
    setContactName(place.setup.contactName ?? '');
    setContactPhone(place.setup.contactPhone ?? '');
    setSecurityName(place.setup.securityName ?? '');
    setSecurityPhone(place.setup.securityPhone ?? '');
    setSlots(place.setup.slots.length ? place.setup.slots : place.stage === 'live' ? [] : [NEW_SLOT]);
    setNotes(place.setup.notes ?? '');
  }, [place, filledFrom]);

  const stage = place?.stage ?? 'draft';
  /** What this person may change: everything, only notes and photos, or nothing (with the owner). */
  const access = isOwner ? 'all' : stage === 'draft' ? 'all' : stage === 'live' ? 'notes' : 'none';
  const canEdit = access === 'all';
  const photos = useMemo(() => place?.photos ?? [], [place?.photos]);
  const photoKinds = useMemo(() => photos.map((x) => x.kind), [photos]);
  /**
   * The photos the owner needs (gate, parking, wash space, and the water and power points unless
   * there are none); the next one missing is the tab the camera opens on.
   */
  const requiredPhotos = requiredPhotoKinds(inspection);
  const neededPhotos = requiredPhotos.filter((k) => !photoKinds.includes(k));
  const nextNeeded = neededPhotos[0];
  useEffect(() => {
    if (nextNeeded) setPhotoKind(nextNeeded);
  }, [nextNeeded]);
  const missing = useMemo(
    () =>
      missingForReview({
        name: name.trim() || null,
        photos: photoKinds,
        inspection,
        slots,
        contactName: contactName.trim() || null,
        contactPhone: contactPhone.length === 10 ? contactPhone : null,
      }),
    [name, photoKinds, inspection, slots, contactName, contactPhone],
  );

  const set = <K extends keyof Inspection>(key: K, value: Inspection[K]) => setInspection((i) => ({ ...i, [key]: value }));

  // What each step still needs, in words: empty when the step is done.
  const needs: Record<StepKey, string[]> = {
    place: [
      !name.trim() ? 'the name' : null,
      label.trim().length < PLACE_LABEL_MIN ? 'the label people know it by' : null,
      !point ? 'the gate pin' : null,
    ].filter((x): x is string => x != null),
    photos: neededPhotos.map((k) => `${PLACE_PHOTO_KIND_LABEL[k].toLowerCase()} photo`),
    site: [
      inspection.permission == null ? 'the society’s answer' : null,
      inspection.water == null ? 'water' : null,
      inspection.power == null ? 'power point' : null,
      inspection.parking == null ? 'parking' : null,
      inspection.space == null ? 'space to wash' : null,
    ].filter((x): x is string => x != null),
    vehicles: inspection.cars == null && inspection.bikes == null ? ['how many cars or bikes'] : [],
    contact: [!contactName.trim() ? 'their name' : null, contactPhone.length !== 10 ? 'their number' : null].filter((x): x is string => x != null),
    choices: slots.length < MIN_PROPOSED_SLOTS ? [`${MIN_PROPOSED_SLOTS - slots.length} more choice${MIN_PROPOSED_SLOTS - slots.length === 1 ? '' : 's'}`] : [],
    review: missing,
  };
  const done = (k: StepKey) => needs[k].length === 0;

  // The team on a live community can only add photos and notes; the rest is the owner's.
  const steps = access === 'notes' ? STEPS.filter((s) => s.key === 'photos' || s.key === 'review') : STEPS;
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;
  const last = stepIndex >= steps.length - 1;

  const values = () => {
    if (!name.trim()) throw new Error('Add the community’s name, like “Lakshmi Towers”.');
    if (label.trim().length < PLACE_LABEL_MIN) throw new Error('Add a short label people know it by, like “Lakshmi Towers, Vedayapalem”.');
    if (!point) throw new Error('Pin the gate: stand there and tap “Use my current location”.');
    if (contactPhone && contactPhone.length !== 10) throw new Error('The contact’s number needs 10 digits.');
    if (securityPhone && securityPhone.length !== 10) throw new Error('The security guard’s number needs 10 digits.');
    return {
      type,
      name: name.trim() || null,
      label: label.trim(),
      latitude: point.latitude,
      longitude: point.longitude,
      inspection,
      contactName: contactName.trim() || null,
      contactPhone: contactPhone || null,
      securityName: securityName.trim() || null,
      securityPhone: securityPhone || null,
      slots,
      notes: notes.trim() || null,
    };
  };

  /** Saves what's on screen; returns the community's id, or null when it couldn't. */
  const save = async (): Promise<string | null> => {
    setError(null);
    try {
      if (access === 'notes' && placeId) {
        const res = await api.places[':id'].setup.$patch({ param: { id: placeId }, json: { notes: notes.trim() || null } });
        if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t save.'));
        return placeId;
      }
      const body = values();
      if (placeId) {
        const res = await api.places[':id'].setup.$patch({ param: { id: placeId }, json: body });
        if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t save.'));
        return placeId;
      }
      const res = await api.places.$post({ json: body });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t save the draft.'));
      const created = await res.json();
      navigation.setParams({ placeId: created.id });
      return created.id;
    } catch (e) {
      setError(e instanceof Error && !(e instanceof NetworkError) ? e.message : failure(e));
      return null;
    }
  };

  const go = (index: number) => {
    setError(null);
    setStepIndex(Math.max(0, Math.min(steps.length - 1, index)));
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  /** Next: the step must be done; the draft is saved on the way (the first Next creates it). */
  const onNext = async () => {
    // A draft moves on only when the step is done; a sent or live community can be looked through freely.
    if (canEdit && stage === 'draft' && !done(step.key) && step.key !== 'review') {
      setError(`Still needed on this step: ${needs[step.key].join(', ')}.`);
      return;
    }
    if (canEdit) {
      setBusy('next');
      const id = await save();
      setBusy(null);
      if (!id) return;
      if (!placeId) showToast('Draft saved. Now the photos.', 'success');
    }
    go(stepIndex + 1);
  };

  const onSaveOnly = async () => {
    setBusy('save');
    const id = await save();
    setBusy(null);
    if (!id) return;
    showToast('Saved', 'success');
    if (access === 'notes' || stage !== 'draft') navigation.goBack();
  };

  const onSend = async () => {
    setBusy('send');
    const id = await save();
    if (!id) return setBusy(null);
    try {
      const res = await api.places[':id'].submit.$post({ param: { id } });
      if (!res.ok) return setError(await apiErrorMessage(res, 'Couldn’t send it.'));
      showToast('Sent to the owner for approval', 'success');
      navigation.replace('Place', { placeId: id });
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(null);
    }
  };

  const addPhoto = async () => {
    if (!placeId) return;
    const picked = await pickPhotos(`${PLACE_PHOTO_KIND_LABEL[photoKind]} photo`, PLACE_PHOTO_KIND_HINT[photoKind]);
    const asset = picked?.assets?.[0];
    if (!asset?.uri) return;
    setUploading(true);
    try {
      const res = await uploadPlacePhoto(placeId, photoKind, { uri: asset.uri, contentType: asset.type ?? 'image/jpeg' });
      if (!res.ok) showToast(await apiErrorMessage(res, 'Couldn’t upload the photo.'), 'error');
      else await detail.load();
    } catch (e) {
      showToast(failure(e), 'error');
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (photo: { id: string; kind: PlacePhotoKind }) => {
    if (!placeId) return;
    showAlert('Remove this photo?', `The ${PLACE_PHOTO_KIND_LABEL[photo.kind].toLowerCase()} photo will be deleted.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void detail
            .run(() => api.places[':id'].photos[':photoId'].$delete({ param: { id: placeId, photoId: photo.id } }), 'Photo removed')
            .then((m) => m && showToast(m, 'error')),
      },
    ]);
  };

  const title = !placeId ? 'New community' : stage === 'live' ? 'Inspection & photos' : 'Community draft';

  if (placeId && !place) {
    return (
      <ScreenContainer noPadding>
        <View style={styles.headerPad}>
          <ScreenHeader title={title} onBack={() => navigation.goBack()} />
        </View>
        {detail.error ? (
          <View style={styles.pad}>
            <Notice tone="danger">{detail.error}</Notice>
            <Button label="Try again" variant="secondary" onPress={() => void detail.load()} />
          </View>
        ) : (
          <ActivityIndicator color={colors.water} style={styles.loading} />
        )}
      </ScreenContainer>
    );
  }

  // ─── Each step's fields ────────────────────────────────────────────────────

  const summaries: Record<Exclude<StepKey, 'review'>, { label: string; value: string; ok: boolean }[]> = {
    place: [
      { label: 'Kind', value: PLACE_TYPE_LABEL[type], ok: true },
      { label: 'Name', value: name.trim() || 'Not added', ok: !!name.trim() },
      { label: 'Label', value: label.trim() || 'Not added', ok: label.trim().length >= PLACE_LABEL_MIN },
      { label: 'Gate', value: point ? 'Pinned on the map' : 'Not pinned', ok: !!point },
    ],
    photos: requiredPhotos.map((k) => {
      const n = photoKinds.filter((x) => x === k).length;
      return { label: PLACE_PHOTO_KIND_LABEL[k], value: n ? `${n} taken` : 'Needed', ok: n > 0 };
    }),
    site: [
      { label: 'Society', value: inspection.permission ? PERMISSION_LABEL[inspection.permission] : 'Not answered', ok: inspection.permission != null },
      { label: 'Water', value: inspection.water ? WATER_LABEL[inspection.water] : 'Not answered', ok: inspection.water != null },
      { label: 'Power', value: inspection.power ? POWER_LABEL[inspection.power] : 'Not answered', ok: inspection.power != null },
      { label: 'Parking', value: inspection.parking ? PARKING_LABEL[inspection.parking] : 'Not answered', ok: inspection.parking != null },
      { label: 'Space', value: inspection.space ? SPACE_LABEL[inspection.space] : 'Not answered', ok: inspection.space != null },
    ],
    vehicles: [
      {
        label: 'Parked',
        value: inspection.cars == null && inspection.bikes == null ? 'Not counted' : `${inspection.cars ?? 0} cars, ${inspection.bikes ?? 0} bikes`,
        ok: inspection.cars != null || inspection.bikes != null,
      },
      { label: 'Best time', value: inspection.bestTime ? bestTimeLabel(inspection.bestTime) : 'Not set', ok: true },
    ],
    contact: [
      {
        label: 'Call',
        value:
          contactName.trim() || contactPhone
            ? `${contactName.trim() || 'No name'}${contactPhone.length === 10 ? ` · +91 ${formatPhone(contactPhone)}` : ''}`
            : 'Not added',
        ok: done('contact'),
      },
      ...(securityPhone || securityName.trim()
        ? [{ label: 'Security', value: `${securityName.trim() || 'Security'}${securityPhone.length === 10 ? ` · +91 ${formatPhone(securityPhone)}` : ''}`, ok: true }]
        : []),
    ],
    choices: slots.length ? slots.map((s, i) => ({ label: choiceLabel(i), value: describeSlot(s), ok: true })) : [{ label: 'Choices', value: 'None yet', ok: false }],
  };

  const fields: Record<StepKey, React.ReactNode> = {
    place: (
      <>
        <ChoiceChips label="What kind of place is it?" options={TYPE_OPTIONS} value={type} onChange={setType} required />
        <TextField label="Name" value={name} onChangeText={setName} maxLength={PLACE_NAME_MAX} placeholder="Lakshmi Towers" autoCapitalize="words" hint="What residents call it." />
        <TextField
          label="Label people know it by"
          value={label}
          onChangeText={setLabel}
          maxLength={PLACE_LABEL_MAX}
          placeholder="Lakshmi Towers, Vedayapalem"
          hint="The name and a landmark or area. Shown in the customer app and on the poster."
          autoCapitalize="words"
        />
        <LocationPicker value={point} onChange={setPoint} />
      </>
    ),
    photos: placeId ? (
      <>
        <View style={styles.tabs}>
          {PLACE_PHOTO_KINDS.map((k) => {
            const count = photoKinds.filter((x) => x === k).length;
            const needed = requiredPhotos.includes(k);
            const on = photoKind === k;
            return (
              <Pressable
                key={k}
                onPress={() => setPhotoKind(k)}
                style={[styles.tab, count ? styles.tabHave : needed ? styles.tabNeed : styles.tabOptional, on && styles.tabOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${PLACE_PHOTO_KIND_LABEL[k]}: ${count ? `${count} taken` : needed ? 'needed' : 'optional'}`}
              >
                {count ? <IconCheck size={12} color={TEAL} /> : null}
                <Text style={[styles.tabText, { color: count ? TEAL : needed ? colors.amberDeep : colors.slateDeep }]}>
                  {PLACE_PHOTO_KIND_LABEL[k]}
                  {count > 1 ? ` · ${count}` : !count && needed ? ' · needed' : !count ? ' · optional' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.shotCard}>
          <View style={styles.shotHead}>
            <IconCamera size={16} color={TEAL} />
            <Text style={styles.shotTitle}>{PLACE_PHOTO_KIND_LABEL[photoKind]} photo</Text>
          </View>
          <Text style={styles.shotHint}>{PLACE_PHOTO_KIND_HINT[photoKind]}</Text>
          <PhotoStrip
            placeId={placeId}
            photos={photos.filter((x) => x.kind === photoKind)}
            adding={uploading}
            addLabel={`Add ${PLACE_PHOTO_KIND_LABEL[photoKind].toLowerCase()} photo`}
            onAdd={access !== 'none' && photos.length < MAX_PLACE_PHOTOS ? () => void addPhoto() : undefined}
            onRemove={access !== 'none' ? removePhoto : undefined}
          />
        </View>
        <Text style={styles.small}>
          {neededPhotos.length
            ? `Still to take: ${neededPhotos.map((k) => PLACE_PHOTO_KIND_LABEL[k].toLowerCase()).join(', ')}.`
            : 'All the photos the owner needs are here.'}{' '}
          {photos.length}/{MAX_PLACE_PHOTOS} photos. The gate photo is shown to customers.
        </Text>
      </>
    ) : (
      <Text style={styles.small}>Go back to step 1 and tap Next to save the draft; then the photos open here.</Text>
    ),
    site: (
      <>
        <ChoiceChips label="1. Did the society agree?" options={options(PERMISSION_LABEL)} value={inspection.permission ?? null} onChange={(v) => set('permission', v)} required />
        <ChoiceChips label="2. Water" options={options(WATER_LABEL)} value={inspection.water ?? null} onChange={(v) => set('water', v)} required />
        <ChoiceChips label="3. Power point for the machine" options={options(POWER_LABEL)} value={inspection.power ?? null} onChange={(v) => set('power', v)} required />
        <ChoiceChips label="4. Parking" options={options(PARKING_LABEL)} value={inspection.parking ?? null} onChange={(v) => set('parking', v)} required />
        <ChoiceChips label="5. Space to wash" options={options(SPACE_LABEL)} value={inspection.space ?? null} onChange={(v) => set('space', v)} required />
        <WarningList items={inspectionWarnings(inspection)} />
      </>
    ),
    vehicles: (
      <>
        <View style={styles.row}>
          <View style={styles.flex}>
            <TextField label="Cars parked" value={countText(inspection.cars)} onChangeText={(t) => set('cars', textCount(t))} keyboardType="number-pad" placeholder="0" maxLength={3} />
          </View>
          <View style={styles.flex}>
            <TextField label="Bikes parked" value={countText(inspection.bikes)} onChangeText={(t) => set('bikes', textCount(t))} keyboardType="number-pad" placeholder="0" maxLength={3} />
          </View>
        </View>
        <Text style={styles.small}>A rough count is fine. It tells the owner if the community is worth it, and how big the team should be.</Text>
        <TimeField
          label="Best time to wash"
          value={inspection.bestTime ?? '06:30'}
          onChange={(t) => set('bestTime', t)}
          hint={inspection.bestTime ? 'When most residents want their car washed.' : 'Not set yet: pick the time most residents want.'}
        />
      </>
    ),
    contact: (
      <>
        <Text style={styles.groupTitle}>Who looks after the community</Text>
        <TextField label="Name" value={contactName} onChangeText={setContactName} maxLength={CONTACT_NAME_MAX} placeholder="Ramesh (secretary)" autoCapitalize="words" />
        <PhoneField label="Number" digits={contactPhone} onChangeDigits={setContactPhone} normalize={normalizePhone} />
        <View style={styles.divider} />
        <Text style={styles.groupTitle}>Security at the gate (optional)</Text>
        <TextField label="Security name" optional value={securityName} onChangeText={setSecurityName} maxLength={CONTACT_NAME_MAX} placeholder="Venkat (night guard)" autoCapitalize="words" />
        <PhoneField label="Security number (optional)" digits={securityPhone} onChangeDigits={setSecurityPhone} normalize={normalizePhone} />
      </>
    ),
    choices: (
      <>
        {slots.map((s, i) => (
          <SlotEditor
            key={i}
            title={choiceLabel(i)}
            slot={s}
            onChange={(next) => setSlots((all) => all.map((x, j) => (j === i ? next : x)))}
            onRemove={slots.length > 1 ? () => setSlots((all) => all.filter((_, j) => j !== i)) : undefined}
          />
        ))}
        {slots.length < MAX_PROPOSED_SLOTS ? (
          <Pressable onPress={() => setSlots((all) => [...all, NEW_SLOT])} style={({ pressed }) => [styles.addSlot, pressed && styles.pressed]} accessibilityRole="button">
            <IconPlus size={16} color={TEAL} />
            <Text style={styles.addSlotText}>{slots.length ? `Add ${choiceLabel(slots.length)}` : 'Add a choice'}</Text>
          </Pressable>
        ) : null}
        <Text style={styles.small}>
          {slots.length}/{MAX_PROPOSED_SLOTS} choices · at least {MIN_PROPOSED_SLOTS}. The owner picks the final days.
        </Text>
      </>
    ),
    review: (
      <>
        {steps
          .filter((s) => s.key !== 'review')
          .map((s) => {
            const rows = summaries[s.key as Exclude<StepKey, 'review'>];
            const ok = done(s.key);
            return (
              <View key={s.key} style={[styles.reviewCard, !ok && styles.reviewCardNeed]}>
                <View style={styles.reviewHead}>
                  <View style={[styles.reviewDot, ok ? styles.reviewDotOk : styles.reviewDotNeed]}>
                    {ok ? <IconCheck size={12} color={colors.white} /> : <IconAlert size={12} color={colors.white} />}
                  </View>
                  <Text style={styles.reviewTitle}>{s.title}</Text>
                  <Pressable onPress={() => go(steps.indexOf(s))} hitSlop={10} style={styles.reviewEdit} accessibilityRole="button" accessibilityLabel={`Change ${s.title}`}>
                    <IconEdit size={13} color={TEAL} />
                    <Text style={styles.reviewEditText}>{ok ? 'Change' : 'Finish'}</Text>
                  </Pressable>
                </View>
                {rows.map((r) => (
                  <View key={r.label} style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>{r.label}</Text>
                    <Text style={[styles.reviewValue, !r.ok && { color: colors.amberDeep }]} numberOfLines={2}>
                      {r.value}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}
        {access !== 'none' ? (
          <TextField
            label="Note for the team"
            optional
            value={notes}
            onChangeText={setNotes}
            maxLength={PLACE_NOTES_MAX}
            multiline
            placeholder="Enter by the back gate before 7. Watchman keeps the tap key."
          />
        ) : notes ? (
          <Text style={styles.small}>Note: {notes}</Text>
        ) : null}
      </>
    ),
  };

  // ─── The page ──────────────────────────────────────────────────────────────

  const Icon = step.Icon;
  const doneCount = steps.filter((s) => s.key !== 'review' && done(s.key)).length;
  const lead =
    access === 'none'
      ? 'It’s with the owner for approval. You can look, but not change it.'
      : access === 'notes'
        ? 'Add photos and notes. The owner changes the rest.'
        : step.what;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader
          title={title}
          onBack={() => navigation.goBack()}
          right={
            canEdit && placeId && stage === 'draft' ? (
              <Pressable onPress={() => void onSaveOnly()} disabled={busy != null} hitSlop={10} accessibilityRole="button">
                <Text style={styles.saveLink}>{busy === 'save' ? 'Saving…' : 'Save'}</Text>
              </Pressable>
            ) : undefined
          }
        />
      </View>

      {/* The step track: every step, the one you're on, and the ones that are done. */}
      <View style={styles.track}>
        <View style={styles.trackRow}>
          {steps.map((s, i) => {
            const on = i === stepIndex;
            const ok = s.key === 'review' ? missing.length === 0 : done(s.key);
            const reachable = !!placeId || i === 0;
            return (
              <React.Fragment key={s.key}>
                {i > 0 ? <View style={[styles.trackLine, i <= stepIndex && styles.trackLineOn]} /> : null}
                <Pressable
                  onPress={() => reachable && go(i)}
                  disabled={!reachable}
                  hitSlop={6}
                  style={[styles.trackDot, ok && styles.trackDotOk, on && styles.trackDotOn]}
                  accessibilityRole="button"
                  accessibilityLabel={`Step ${i + 1}: ${s.title}${ok ? ', done' : ''}`}
                >
                  {ok && !on ? <IconCheck size={13} color={colors.white} /> : <Text style={[styles.trackNum, on && styles.trackNumOn]}>{i + 1}</Text>}
                </Pressable>
              </React.Fragment>
            );
          })}
        </View>
        <View style={styles.trackLabelRow}>
          <Text style={styles.trackStep}>
            Step {stepIndex + 1} of {steps.length} · {step.short}
          </Text>
          <Text style={styles.trackDone}>
            {doneCount}/{steps.length - 1} done
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scroll} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {place?.setup.reviewNote && stage === 'draft' ? (
            <View style={styles.ownerNote}>
              <WarningList items={[`Owner’s note: ${place.setup.reviewNote}`]} />
            </View>
          ) : null}

          <View style={styles.stepHead}>
            <View style={styles.stepIcon}>
              <Icon size={22} color={TEAL} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepWhat}>{lead}</Text>
            </View>
          </View>

          <View style={styles.card}>
            {canEdit || step.key === 'photos' || step.key === 'review'
              ? fields[step.key]
              : summaries[step.key as Exclude<StepKey, 'review'>].map((r) => (
                  <View key={r.label} style={styles.reviewRow}>
                    <Text style={styles.reviewLabel}>{r.label}</Text>
                    <Text style={styles.reviewValue}>{r.value}</Text>
                  </View>
                ))}
          </View>

          {step.key !== 'review' && canEdit && needs[step.key].length ? (
            <Text style={styles.stillNeeded}>To finish this step: {needs[step.key].join(', ')}.</Text>
          ) : null}
        </ScrollView>

        <View style={styles.bottom}>
          {error ? (
            <SheetNotice tone="danger" icon={<IconAlert size={15} color={colors.danger} />}>
              {error}
            </SheetNotice>
          ) : last && stage === 'draft' && canEdit && missing.length ? (
            <Text style={styles.missing} numberOfLines={3}>
              To send it, add: {missing.join(', ')}
            </Text>
          ) : null}
          <View style={styles.actionRow}>
            {stepIndex > 0 ? (
              <Pressable onPress={() => go(stepIndex - 1)} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Back a step">
                <IconChevronLeft size={18} color={colors.slateDeep} />
                <Text style={styles.backText}>Back</Text>
              </Pressable>
            ) : null}
            <View style={styles.flex}>
              {!last ? (
                <Button
                  label={canEdit ? (placeId ? 'Save & next' : 'Save draft & next') : 'Next'}
                  size="lg"
                  icon={<IconChevronRight size={18} color={colors.white} />}
                  loading={busy === 'next'}
                  disabled={busy != null}
                  onPress={() => void onNext()}
                />
              ) : access === 'none' ? (
                <Button label="Close" size="lg" variant="secondary" onPress={() => navigation.goBack()} />
              ) : stage === 'draft' && canEdit ? (
                <Button label="Send to the owner" size="lg" loading={busy === 'send'} disabled={missing.length > 0 || busy != null} onPress={() => void onSend()} />
              ) : (
                <Button label="Save changes" size="lg" loading={busy === 'save'} disabled={busy != null} onPress={() => void onSaveOnly()} />
              )}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

/** Stands in for the detail request on a new community (nothing to load yet). */
const EMPTY = { ok: false, status: 204, json: () => Promise.resolve({}) };

const DOT = 28;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.md },
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  pad: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  pressed: { opacity: 0.75 },
  saveLink: { ...typography.label, fontSize: 15, fontWeight: '800', color: TEAL },

  track: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm, gap: spacing.xs + 2 },
  trackRow: { flexDirection: 'row', alignItems: 'center' },
  trackLine: { flex: 1, height: 2, backgroundColor: colors.border, marginHorizontal: 2 },
  trackLineOn: { backgroundColor: TEAL_PALE },
  trackDot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  trackDotOk: { backgroundColor: TEAL, borderColor: TEAL },
  trackDotOn: { width: DOT + 6, height: DOT + 6, borderRadius: (DOT + 6) / 2, backgroundColor: TEAL_MIST, borderColor: TEAL, borderWidth: 2.5 },
  trackNum: { ...typography.caption, fontSize: 12.5, fontWeight: '800', color: colors.slateDeep, letterSpacing: 0 },
  trackNumOn: { color: TEAL, fontSize: 14 },
  trackLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  trackStep: { ...typography.caption, fontSize: 12.5, fontWeight: '800', color: TEAL, letterSpacing: 0 },
  trackDone: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0 },

  scroll: { paddingBottom: spacing.xl },
  ownerNote: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  stepHead: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', paddingHorizontal: spacing.md, paddingTop: spacing.md },
  stepIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: TEAL_MIST,
    borderWidth: 1,
    borderColor: TEAL_PALE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTitle: { ...typography.heading, fontSize: 21, color: colors.ink, letterSpacing: -0.3 },
  stepWhat: { ...typography.body, fontSize: 14.5, lineHeight: 20, color: colors.slateDeep, marginTop: 2 },
  card: {
    marginTop: spacing.md,
    marginHorizontal: spacing.md,
    padding: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  stillNeeded: { ...typography.label, fontSize: 13, color: colors.amberDeep, paddingHorizontal: spacing.md + 4, marginTop: spacing.sm },
  small: { ...typography.caption, fontSize: 13, lineHeight: 18, color: colors.slateDeep, letterSpacing: 0 },
  groupTitle: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.ink },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },

  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 34, borderRadius: 17, borderWidth: 1 },
  tabHave: { backgroundColor: TEAL_MIST, borderColor: '#99F6E4' },
  tabNeed: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  tabOptional: { backgroundColor: colors.white, borderColor: colors.border },
  tabOn: { borderWidth: 2, borderColor: TEAL },
  tabText: { ...typography.caption, fontSize: 12.5, fontWeight: '800', letterSpacing: 0 },
  shotCard: { gap: spacing.sm, padding: spacing.sm + 4, borderRadius: radius.lg, backgroundColor: colors.surface },
  shotHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shotTitle: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.ink },
  shotHint: { ...typography.body, fontSize: 14, lineHeight: 19, color: colors.slateDeep },

  addSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#99F6E4',
    backgroundColor: TEAL_MIST,
  },
  addSlotText: { ...typography.label, color: TEAL, fontWeight: '800' },

  reviewCard: { gap: 6, padding: spacing.sm + 4, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  reviewCardNeed: { borderColor: '#FDE68A', backgroundColor: '#FFFDF5' },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 2 },
  reviewDot: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  reviewDotOk: { backgroundColor: TEAL },
  reviewDotNeed: { backgroundColor: colors.amberDeep },
  reviewTitle: { flex: 1, ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.ink },
  reviewEdit: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reviewEditText: { ...typography.label, fontSize: 13, fontWeight: '800', color: TEAL },
  reviewRow: { flexDirection: 'row', gap: spacing.sm },
  reviewLabel: { width: 84, ...typography.caption, fontSize: 13, color: colors.slate, letterSpacing: 0 },
  reviewValue: { flex: 1, ...typography.label, fontSize: 13.5, color: colors.waterInk },

  bottom: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  missing: { ...typography.caption, fontSize: 12.5, color: colors.amberDeep, fontWeight: '700', letterSpacing: 0, textAlign: 'center' },
  actionRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  backText: { ...typography.label, fontSize: 15, fontWeight: '800', color: colors.slateDeep },
});
