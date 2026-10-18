import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { PLACE_PHOTO_KIND_LABEL, type PlacePhotoKind, type ProposedSlot } from '@mana/domain';
import {
  Button,
  FieldLabel,
  IconCamera,
  IconMapPin,
  IconTrash,
  TextField,
  colors,
  spacing,
  typography,
} from '@mana/ui';
import { privateImage } from '../../api/client';
import { MultiSelectField } from '../../components/SelectField';
import { currentLocation, LocationError, mapsEnabled, type Point } from '../../utils/location';
import { mapsLink, parsePoint, pointText } from '../../utils/geo';
import { DAY_SELECT_OPTIONS, daysSummary } from './review/options';
import { TimeField } from './review/TimeField';

// ─── Location ────────────────────────────────────────────────────────────────

/** Where the map opens before anything is pinned: Nellore. */
const FALLBACK: Point = { latitude: 14.4426, longitude: 79.9865 };

/**
 * The community's gate: from the phone's GPS (standing at the gate), fine-tuned by dragging the
 * pin on a Google map. Builds without a Maps key show the numbers and a link to check them.
 */
export function LocationPicker({
  value,
  onChange,
  start,
  label = 'Gate location',
  what = 'the gate',
}: {
  value: Point | null;
  onChange: (p: Point) => void;
  start?: Point | null;
  label?: string;
  /** What's being pinned, for the hints: "the gate", "the branch". */
  what?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(!mapsEnabled && !value);
  const [text, setText] = useState(value ? pointText(value) : '');
  const [region, setRegion] = useState<Region>(() => {
    const p = value ?? start ?? FALLBACK;
    return { ...p, latitudeDelta: value ? 0.004 : 0.05, longitudeDelta: value ? 0.004 : 0.05 };
  });

  useEffect(() => {
    if (value) setText(pointText(value));
  }, [value]);

  const locate = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await currentLocation(`To pin ${what} where you are standing.`);
      onChange(p);
      setRegion({ ...p, latitudeDelta: 0.003, longitudeDelta: 0.003 });
    } catch (e) {
      setError(e instanceof LocationError ? e.message : 'Couldn’t find your location.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.group}>
      <FieldLabel>{label}</FieldLabel>
      {mapsEnabled ? (
        <View style={styles.mapWrap}>
          <MapView
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            region={region}
            onRegionChangeComplete={setRegion}
            onPress={(e) => onChange(e.nativeEvent.coordinate)}
            showsUserLocation
            toolbarEnabled={false}
          >
            {value ? <Marker coordinate={value} draggable onDragEnd={(e) => onChange(e.nativeEvent.coordinate)} pinColor={colors.tealDeep} /> : null}
          </MapView>
        </View>
      ) : null}
      <Button
        label="Use my current location"
        variant="secondary"
        icon={<IconMapPin size={18} color={colors.tealDeep} />}
        loading={busy}
        onPress={() => void locate()}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {value ? (
        <View style={styles.pointRow}>
          <Text style={styles.point}>{pointText(value)}</Text>
          <Pressable onPress={() => void Linking.openURL(mapsLink(value)).catch(() => undefined)} hitSlop={8} accessibilityRole="link">
            <Text style={styles.link}>Open in Google Maps</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.help}>
          {mapsEnabled ? `Stand at ${what} and tap the button, or tap the map where it is.` : `Stand at ${what} and tap the button, or type the location.`}
        </Text>
      )}
      {mapsEnabled && value ? <Text style={styles.help}>Drag the pin onto {what} if it’s a little off.</Text> : null}
      {typing ? (
        <TextField
          label="Or type it"
          value={text}
          onChangeText={(t) => {
            setText(t);
            const p = parsePoint(t);
            if (p) onChange(p);
          }}
          placeholder="14.43920, 79.97450"
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          hint={`In Google Maps, press and hold on ${what} and copy the numbers.`}
        />
      ) : (
        <Pressable onPress={() => setTyping(true)} hitSlop={8} accessibilityRole="button">
          <Text style={styles.link}>Type the location instead</Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Photos ──────────────────────────────────────────────────────────────────

export interface PhotoItem {
  id: string;
  kind: PlacePhotoKind;
}

/** A photo behind sign-in (the app's own photos), with a soft tile while it loads. */
export function PrivatePhoto({ path, style, fit = 'cover' }: { path: string; style: object; fit?: 'cover' | 'contain' }) {
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  useEffect(() => {
    let alive = true;
    void privateImage(path).then((s) => alive && setSource(s));
    return () => {
      alive = false;
    };
  }, [path]);
  return source ? <Image source={source} style={style} resizeMode={fit} /> : <View style={[style, styles.photoLoading]} />;
}

/** Where a community photo lives on the API. */
export const placePhotoPath = (placeId: string, photoId: string) => `/places/${placeId}/photos/${photoId}`;

/** A community's photos, newest last, each labelled with what it shows. */
export function PhotoStrip({
  placeId,
  photos,
  onAdd,
  onRemove,
  adding,
}: {
  placeId: string;
  photos: readonly PhotoItem[];
  onAdd?: () => void;
  onRemove?: (photo: PhotoItem) => void;
  adding?: boolean;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {photos.map((p) => (
        <View key={p.id} style={styles.photoCard}>
          <PrivatePhoto path={placePhotoPath(placeId, p.id)} style={styles.photo} />
          <View style={styles.photoFoot}>
            <Text style={styles.photoKind}>{PLACE_PHOTO_KIND_LABEL[p.kind]}</Text>
            {onRemove ? (
              <Pressable onPress={() => onRemove(p)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${PLACE_PHOTO_KIND_LABEL[p.kind]} photo`}>
                <IconTrash size={16} color={colors.danger} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
      {onAdd ? (
        <Pressable onPress={onAdd} disabled={adding} style={({ pressed }) => [styles.addPhoto, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Add a photo">
          {adding ? <ActivityIndicator color={colors.teal} /> : <IconCamera size={26} color={colors.tealDeep} />}
          <Text style={styles.addText}>{adding ? 'Uploading…' : 'Add photo'}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

/** A wash's after photo, full width. */
export function VisitPhoto({ placeId, visitId }: { placeId: string; visitId: string }) {
  return <PrivatePhoto path={`/places/${placeId}/visits/${visitId}/photo`} style={styles.visitPhoto} />;
}

// ─── Proposed days and times ─────────────────────────────────────────────────

/** One choice residents gave: days of the week and a time. */
export function SlotEditor({
  title,
  slot,
  onChange,
  onRemove,
}: {
  title: string;
  slot: ProposedSlot;
  onChange: (s: ProposedSlot) => void;
  onRemove?: () => void;
}) {
  return (
    <View style={styles.slot}>
      <View style={styles.slotHead}>
        <Text style={styles.slotTitle}>{title}</Text>
        {onRemove ? (
          <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${title}`}>
            <Text style={styles.remove}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
      <MultiSelectField
        label="Days"
        value={slot.days.map(String)}
        options={DAY_SELECT_OPTIONS}
        onChange={(days) => onChange({ ...slot, days: days.map(Number) })}
        min={1}
        round
        summarize={(picked) => daysSummary(picked.map((p) => p.value))}
        placeholder="Pick the days"
        sheetTitle={`${title} · days`}
        accent={TEAL}
        accentPale="#CCFBF1"
      />
      <TimeField value={slot.time} onChange={(time) => onChange({ ...slot, time })} />
    </View>
  );
}

const TEAL = colors.tealDeep;
const TEAL_MIST = '#F0FDFA';

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  mapWrap: { height: 230, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: TEAL_MIST,
    borderRadius: 12,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
  },
  point: { ...typography.bodyStrong, fontSize: 14, color: colors.waterInk, fontVariant: ['tabular-nums'] },
  link: { ...typography.label, color: TEAL, fontWeight: '700' },
  help: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0, lineHeight: 17 },
  error: { ...typography.label, color: colors.danger },
  strip: { gap: spacing.sm, paddingVertical: 2 },
  photoCard: { width: 140, borderRadius: 16, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.white },
  photo: { width: 140, height: 104 },
  photoLoading: { backgroundColor: TEAL_MIST },
  photoFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 7 },
  photoKind: { ...typography.caption, fontSize: 12, color: colors.waterInk, fontWeight: '800', letterSpacing: 0 },
  addPhoto: {
    width: 140,
    height: 136,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#5EEAD4',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: TEAL_MIST,
  },
  addText: { ...typography.label, color: TEAL, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  visitPhoto: { width: '100%', height: 220, borderRadius: 16 },
  slot: {
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  slotHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  slotTitle: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: TEAL },
  remove: { ...typography.label, color: colors.danger, fontWeight: '700' },
});
