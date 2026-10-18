import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  BEST_TIME_LABEL,
  CONTACT_NAME_MAX,
  MAX_PLACE_PHOTOS,
  MAX_PROPOSED_SLOTS,
  missingForReview,
  normalizePhone,
  PARKING_LABEL,
  PERMISSION_LABEL,
  PLACE_LABEL_MAX,
  PLACE_LABEL_MIN,
  PLACE_NAME_MAX,
  PLACE_NOTES_MAX,
  PLACE_PHOTO_KIND_LABEL,
  PLACE_PHOTO_KINDS,
  PLACE_TYPE_LABEL,
  PLACE_TYPES,
  POWER_LABEL,
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
  IconEdit,
  IconPlus,
  Notice,
  PhoneField,
  ScreenContainer,
  ScreenHeader,
  TextField,
  colors,
  radius,
  showAlert,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage, uploadPlacePhoto } from '../../api/client';
import { useAuth } from '../../api/auth';
import { NetworkError } from '../../api/network';
import { ScreenHero } from '../../components/ScreenChrome';
import { SheetNotice } from '../../components/SheetBits';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { pickPhotos } from '../../utils/photoPicker';
import type { Point } from '../../utils/location';
import { LocationPicker, PhotoStrip, SlotEditor } from './communityParts';
import { Checklist, FormSection, StickyActions, WarningList } from './kit';
import { choiceLabel } from './review/options';
import { TEAL, TEAL_MIST } from './panel/parts';
import { failure, useApiData, type PlaceDetail } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'CommunitySetup'>;

const options = <T extends string>(labels: Readonly<Record<T, string>>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
const TYPE_OPTIONS = PLACE_TYPES.map((value) => ({ value, label: PLACE_TYPE_LABEL[value] }));
const KIND_OPTIONS = PLACE_PHOTO_KINDS.map((value) => ({ value, label: PLACE_PHOTO_KIND_LABEL[value] }));
const NEW_SLOT: ProposedSlot = { days: [6], time: '07:00' };
const countText = (n: number | undefined) => (n == null ? '' : String(n));
const textCount = (t: string) => (t.trim() ? Math.min(999, Number(t.replace(/\D/g, '')) || 0) : undefined);

/**
 * Setting a community up after visiting it: where the gate is, photos, what the visit found
 * (water, parking, the society's yes), who to call, and the days and times residents asked for.
 * Saved as a draft, then sent to the owner for approval. Once live, the team can still add notes
 * and photos; the rest is the owner's.
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
  const [slots, setSlots] = useState<ProposedSlot[]>([NEW_SLOT]);
  const [notes, setNotes] = useState('');
  const [photoKind, setPhotoKind] = useState<PlacePhotoKind>('gate');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filledFrom, setFilledFrom] = useState<string | null>(null);

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
    setSlots(place.setup.slots.length ? place.setup.slots : place.stage === 'live' ? [] : [NEW_SLOT]);
    setNotes(place.setup.notes ?? '');
  }, [place, filledFrom]);

  const stage = place?.stage ?? 'draft';
  /** What this person may change: everything, only notes and photos, or nothing (with the owner). */
  const access = isOwner ? 'all' : stage === 'draft' ? 'all' : stage === 'live' ? 'notes' : 'none';
  const canEdit = access === 'all';
  const photos = place?.photos ?? [];
  const missing = useMemo(
    () => missingForReview({ photos: photos.length, inspection, slots, contactPhone: contactPhone.length === 10 ? contactPhone : null }),
    [photos.length, inspection, slots, contactPhone],
  );

  const set = <K extends keyof Inspection>(key: K, value: Inspection[K]) => setInspection((i) => ({ ...i, [key]: value }));

  const values = () => {
    if (label.trim().length < PLACE_LABEL_MIN) throw new Error('Add a short label people know it by, like “Lakshmi Towers, Vedayapalem”.');
    if (!point) throw new Error('Pin the gate: stand there and tap “Use my current location”.');
    if (contactPhone && contactPhone.length !== 10) throw new Error('The contact’s number needs 10 digits.');
    return {
      type,
      name: name.trim() || null,
      label: label.trim(),
      latitude: point.latitude,
      longitude: point.longitude,
      inspection,
      contactName: contactName.trim() || null,
      contactPhone: contactPhone || null,
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

  const onSave = async () => {
    setBusy('save');
    const id = await save();
    setBusy(null);
    if (!id) return;
    if (!placeId) showToast('Draft saved. Now add photos of the gate and parking.', 'success');
    else {
      showToast('Saved', 'success');
      navigation.goBack();
    }
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
    const picked = await pickPhotos(`${PLACE_PHOTO_KIND_LABEL[photoKind]} photo`, 'A clear photo helps the owner decide without visiting.');
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
  const placeDone = label.trim().length >= PLACE_LABEL_MIN && point != null;
  const foundDone =
    inspection.permission != null && inspection.water != null && inspection.parking != null && (inspection.cars != null || inspection.bikes != null);
  const checklist = [
    { label: 'Name & gate pin', done: placeDone },
    { label: 'Photos', done: photos.length > 0 },
    { label: 'Society’s answer', done: inspection.permission != null },
    { label: 'Water & parking', done: inspection.water != null && inspection.parking != null },
    { label: 'Vehicle count', done: inspection.cars != null || inspection.bikes != null },
    { label: 'Contact number', done: contactPhone.length === 10 },
    { label: 'Days residents want', done: slots.length > 0 },
  ];

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

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title={title} onBack={() => navigation.goBack()} />
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ScreenHero
            tone="teal"
            eyebrow={!placeId ? 'After visiting' : stage === 'live' ? 'Live community' : stage === 'review' ? 'With the owner' : 'Draft'}
            title={name.trim() || label.trim() || 'A new community'}
            meta={
              access === 'notes'
                ? 'You can add notes and photos. The owner changes the rest.'
                : access === 'none'
                  ? 'It’s with the owner for approval. They can send it back if something needs changing.'
                  : 'Fill in what you saw at the gate. Save any time, then send it to the owner.'
            }
            chips={[
              { label: 'Photos', value: `${photos.length}/${MAX_PLACE_PHOTOS}` },
              { label: 'Ready', value: `${checklist.filter((c) => c.done).length}/${checklist.length}` },
              { label: 'Choices', value: slots.length },
            ]}
          />

          {place?.setup.reviewNote && stage === 'draft' ? (
            <View style={styles.pad}>
              <WarningList items={[`Owner’s note: ${place.setup.reviewNote}`]} />
            </View>
          ) : null}

          {canEdit && stage !== 'live' ? (
            <View style={styles.checkCard}>
              <Checklist items={checklist} />
            </View>
          ) : null}

          <FormSection step={1} done={placeDone} title="The place" caption="What it’s called and where the gate is.">
            {canEdit ? (
              <>
                <ChoiceChips label="Kind" options={TYPE_OPTIONS} value={type} onChange={setType} />
                <TextField label="Name" optional value={name} onChangeText={setName} maxLength={PLACE_NAME_MAX} placeholder="Lakshmi Towers" autoCapitalize="words" />
                <TextField
                  label="Label people know it by"
                  value={label}
                  onChangeText={setLabel}
                  maxLength={PLACE_LABEL_MAX}
                  placeholder="Lakshmi Towers, Vedayapalem"
                  hint="Shown in the customer app and on the poster."
                  autoCapitalize="words"
                />
                <LocationPicker value={point} onChange={setPoint} />
              </>
            ) : (
              <Text style={styles.readOnly}>
                {PLACE_TYPE_LABEL[type]} · {name || label}
              </Text>
            )}
          </FormSection>

          <FormSection
            step={2}
            done={photos.length > 0}
            title="Photos"
            caption="The gate, where cars park, the water point. The first one is shown to customers."
            right={<Text style={styles.count}>{`${photos.length}/${MAX_PLACE_PHOTOS}`}</Text>}
          >
            {placeId ? (
              <>
                {access !== 'none' ? <ChoiceChips label="Next photo shows" options={KIND_OPTIONS} value={photoKind} onChange={setPhotoKind} /> : null}
                <PhotoStrip
                  placeId={placeId}
                  photos={photos}
                  adding={uploading}
                  onAdd={access !== 'none' && photos.length < MAX_PLACE_PHOTOS ? () => void addPhoto() : undefined}
                  onRemove={access !== 'none' ? removePhoto : undefined}
                />
              </>
            ) : (
              <TipBandInline>Save the draft first, then add photos of the gate, parking and water point.</TipBandInline>
            )}
          </FormSection>

          {canEdit ? (
            <>
              <FormSection step={3} done={foundDone} title="What you found" caption="Answer what you can. The owner reads this before approving.">

                <ChoiceChips label="Did the society agree?" options={options(PERMISSION_LABEL)} value={inspection.permission ?? null} onChange={(v) => set('permission', v)} />
                <ChoiceChips label="Water" options={options(WATER_LABEL)} value={inspection.water ?? null} onChange={(v) => set('water', v)} />
                <ChoiceChips label="Power point for the machine" options={options(POWER_LABEL)} value={inspection.power ?? null} onChange={(v) => set('power', v)} />
                <ChoiceChips label="Parking" options={options(PARKING_LABEL)} value={inspection.parking ?? null} onChange={(v) => set('parking', v)} />
                <ChoiceChips label="Space to wash" options={options(SPACE_LABEL)} value={inspection.space ?? null} onChange={(v) => set('space', v)} />
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <TextField
                      label="About how many cars"
                      value={countText(inspection.cars)}
                      onChangeText={(t) => set('cars', textCount(t))}
                      keyboardType="number-pad"
                      placeholder="0"
                      maxLength={3}
                    />
                  </View>
                  <View style={styles.flex}>
                    <TextField
                      label="Bikes"
                      value={countText(inspection.bikes)}
                      onChangeText={(t) => set('bikes', textCount(t))}
                      keyboardType="number-pad"
                      placeholder="0"
                      maxLength={3}
                    />
                  </View>
                </View>
                <ChoiceChips label="Best time to wash" options={options(BEST_TIME_LABEL)} value={inspection.bestTime ?? null} onChange={(v) => set('bestTime', v)} />
              </FormSection>

              <FormSection step={4} done={contactPhone.length === 10} title="Who to call there" caption="The secretary or watchman, for gate access and water.">
                <TextField label="Secretary or watchman" optional value={contactName} onChangeText={setContactName} maxLength={CONTACT_NAME_MAX} placeholder="Ramesh (secretary)" autoCapitalize="words" />
                <PhoneField label="Their number" digits={contactPhone} onChangeDigits={setContactPhone} normalize={normalizePhone} />
              </FormSection>

              <FormSection
                step={5}
                done={slots.length > 0}
                title="Days residents want"
                caption={`Ask a few residents. Add up to ${MAX_PROPOSED_SLOTS} choices, best first; the owner picks the final days.`}
                right={<Text style={styles.count}>{`${slots.length}/${MAX_PROPOSED_SLOTS}`}</Text>}
              >
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
                  <Pressable
                    onPress={() => setSlots((all) => [...all, NEW_SLOT])}
                    style={({ pressed }) => [styles.addSlot, pressed && styles.pressed]}
                    accessibilityRole="button"
                  >
                    <IconPlus size={16} color={TEAL} />
                    <Text style={styles.addSlotText}>{slots.length ? `Add ${choiceLabel(slots.length)}` : 'Add a choice'}</Text>
                  </Pressable>
                ) : null}
              </FormSection>
            </>
          ) : null}

          {access !== 'none' ? (
            <>
              <FormSection icon={<IconEdit size={13} color={TEAL} />} title="Notes" caption="Anything that helps the team on wash day.">
                <TextField
                  label="Anything the team should know"
                  optional
                  value={notes}
                  onChangeText={setNotes}
                  maxLength={PLACE_NOTES_MAX}
                  multiline
                  placeholder="Enter by the back gate before 7. Watchman keeps the tap key."
                />
              </FormSection>
            </>
          ) : null}
          <View style={styles.bottomPad} />
        </ScrollView>

        {access !== 'none' ? (
          <StickyActions
            note={
              error ? (
                <SheetNotice tone="danger" icon={<IconAlert size={15} color={colors.danger} />}>
                  {error}
                </SheetNotice>
              ) : stage === 'draft' && placeId && missing.length ? (
                <Text style={styles.missing} numberOfLines={2}>
                  To send it, add: {missing.join(', ')}
                </Text>
              ) : undefined
            }
          >
            {stage === 'draft' && placeId ? (
              <View style={styles.actionRow}>
                <View style={styles.flex}>
                  <Button label="Save draft" variant="secondary" loading={busy === 'save'} disabled={busy != null} onPress={() => void onSave()} />
                </View>
                <View style={styles.flexWide}>
                  <Button label="Send for approval" loading={busy === 'send'} disabled={missing.length > 0 || busy != null} onPress={() => void onSend()} />
                </View>
              </View>
            ) : (
              <Button label={placeId ? 'Save' : 'Save draft'} size="lg" loading={busy === 'save'} disabled={busy != null} onPress={() => void onSave()} />
            )}
          </StickyActions>
        ) : null}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

/** A soft hint inside a section, before there's anything to show. */
function TipBandInline({ children }: { children: string }) {
  return (
    <View style={styles.inlineTip}>
      <Text style={styles.inlineTipText}>{children}</Text>
    </View>
  );
}

/** Stands in for the detail request on a new community (nothing to load yet). */
const EMPTY = { ok: false, status: 204, json: () => Promise.resolve({}) };

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexWide: { flex: 1.4 },
  row: { flexDirection: 'row', gap: spacing.md },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.xs },
  pad: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  checkCard: {
    marginTop: spacing.md,
    marginHorizontal: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.white,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  count: { ...typography.label, fontSize: 13, fontWeight: '800', color: TEAL },
  readOnly: { ...typography.bodyStrong, color: colors.waterInk },
  missing: { ...typography.caption, fontSize: 12.5, color: colors.amberDeep, fontWeight: '700', letterSpacing: 0, textAlign: 'center' },
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
  pressed: { opacity: 0.75 },
  inlineTip: { backgroundColor: TEAL_MIST, borderRadius: radius.md, padding: spacing.sm + 4 },
  inlineTipText: { ...typography.caption, fontSize: 13, color: TEAL, fontWeight: '600', letterSpacing: 0, lineHeight: 18 },
  bottomPad: { height: spacing.lg },
});
