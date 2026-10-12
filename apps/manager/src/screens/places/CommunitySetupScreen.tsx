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
  EdgePanel,
  IconPlus,
  Notice,
  PhoneField,
  ScreenContainer,
  ScreenHeader,
  SectionLabel,
  TextField,
  colors,
  showAlert,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage, uploadPlacePhoto } from '../../api/client';
import { useAuth } from '../../api/auth';
import { NetworkError } from '../../api/network';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { pickPhotos } from '../../utils/photoPicker';
import type { Point } from '../../utils/location';
import { LocationPicker, PhotoStrip, SlotEditor } from './communityParts';
import { failure, useApiData, type PlaceDetail } from './shared';

type Props = NativeStackScreenProps<RootStackParamList, 'CommunitySetup'>;

const options = <T extends string>(labels: Readonly<Record<T, string>>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
const TYPE_OPTIONS = PLACE_TYPES.map((value) => ({ value, label: PLACE_TYPE_LABEL[value] }));
const KIND_OPTIONS = PLACE_PHOTO_KINDS.map((value) => ({ value, label: PLACE_PHOTO_KIND_LABEL[value] }));
const NEW_SLOT: ProposedSlot = { days: [6], time: '07:00' };
const SLOT_TITLES = ['1st choice', '2nd choice', '3rd choice'];

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
          <View style={styles.pad}>
            {place?.setup.reviewNote && stage === 'draft' ? (
              <Notice tone="warning" title="Sent back by the owner">
                {place.setup.reviewNote}
              </Notice>
            ) : null}
            {access === 'none' ? <Notice>It’s with the owner for approval. They can send it back if something needs changing.</Notice> : null}
            {access === 'notes' ? <Notice>This community is live. You can add notes and photos; the owner changes the rest.</Notice> : null}
          </View>

          <SectionLabel>The place</SectionLabel>
          <EdgePanel style={styles.panel}>
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
          </EdgePanel>

          <SectionLabel right={`${photos.length}/${MAX_PLACE_PHOTOS}`}>Photos</SectionLabel>
          <EdgePanel style={styles.panel}>
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
                <Text style={styles.help}>The gate, where cars park, the water point and the building. The first photo is shown to customers.</Text>
              </>
            ) : (
              <Text style={styles.help}>Save the draft first, then add photos of the gate, parking and water point.</Text>
            )}
          </EdgePanel>

          {canEdit ? (
            <>
              <SectionLabel>What you found</SectionLabel>
              <EdgePanel style={styles.panel}>
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
              </EdgePanel>

              <SectionLabel>Who to call there</SectionLabel>
              <EdgePanel style={styles.panel}>
                <TextField label="Secretary or watchman" optional value={contactName} onChangeText={setContactName} maxLength={CONTACT_NAME_MAX} placeholder="Ramesh (secretary)" autoCapitalize="words" />
                <PhoneField label="Their number" digits={contactPhone} onChangeDigits={setContactPhone} normalize={normalizePhone} />
              </EdgePanel>

              <SectionLabel>Days and time residents want</SectionLabel>
              <EdgePanel style={styles.panel}>
                <Text style={styles.help}>Ask a few residents. Give the owner a first and second choice; they pick the final days and team.</Text>
                {slots.map((s, i) => (
                  <SlotEditor
                    key={i}
                    title={SLOT_TITLES[i]!}
                    slot={s}
                    onChange={(next) => setSlots((all) => all.map((x, j) => (j === i ? next : x)))}
                    onRemove={slots.length > 1 ? () => setSlots((all) => all.filter((_, j) => j !== i)) : undefined}
                  />
                ))}
                {slots.length < MAX_PROPOSED_SLOTS ? (
                  <Pressable onPress={() => setSlots((all) => [...all, NEW_SLOT])} style={styles.addSlot} accessibilityRole="button">
                    <IconPlus size={16} color={colors.waterDeep} />
                    <Text style={styles.addSlotText}>Add another choice</Text>
                  </Pressable>
                ) : null}
              </EdgePanel>
            </>
          ) : null}

          {access !== 'none' ? (
            <>
              <SectionLabel>Notes</SectionLabel>
              <EdgePanel style={styles.panel}>
                <TextField
                  label="Anything the team should know"
                  optional
                  value={notes}
                  onChangeText={setNotes}
                  maxLength={PLACE_NOTES_MAX}
                  multiline
                  placeholder="Enter by the back gate before 7. Watchman keeps the tap key."
                />
              </EdgePanel>
            </>
          ) : null}

          {access !== 'none' ? (
            <View style={styles.pad}>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              {stage === 'draft' && placeId ? (
                <>
                  {missing.length ? <Text style={styles.help}>To send for approval, add: {missing.join(', ')}.</Text> : null}
                  <Button label="Send for approval" size="lg" loading={busy === 'send'} disabled={missing.length > 0 || busy != null} onPress={() => void onSend()} />
                  <Button label="Save draft" variant="secondary" loading={busy === 'save'} disabled={busy != null} onPress={() => void onSave()} />
                </>
              ) : (
                <Button label={placeId ? 'Save' : 'Save draft'} size="lg" loading={busy === 'save'} disabled={busy != null} onPress={() => void onSave()} />
              )}
            </View>
          ) : null}
          <View style={styles.bottomPad} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

/** Stands in for the detail request on a new community (nothing to load yet). */
const EMPTY = { ok: false, status: 204, json: () => Promise.resolve({}) };

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.md },
  headerPad: { paddingHorizontal: spacing.md },
  loading: { marginTop: spacing.xl },
  scroll: { paddingTop: spacing.sm },
  panel: { gap: spacing.md },
  pad: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  help: { ...typography.caption, color: colors.slate },
  readOnly: { ...typography.bodyStrong, color: colors.waterInk },
  error: { ...typography.label, color: colors.danger },
  addSlot: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.sm },
  addSlotText: { ...typography.label, color: colors.waterDeep, fontWeight: '700' },
  bottomPad: { height: spacing.xxl },
});
