import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import {
  BEST_TIME_LABEL,
  describeSlot,
  formatClock,
  inspectionWarnings,
  PARKING_LABEL,
  PERMISSION_LABEL,
  PLACE_PHOTO_KIND_LABEL,
  POWER_LABEL,
  SPACE_LABEL,
  WATER_LABEL,
  WEEKDAY_SHORT,
  type Inspection,
  type PlacePhotoKind,
  type ProposedSlot,
} from '@mana/domain';
import {
  Button,
  ChoiceChips,
  FieldLabel,
  IconCamera,
  IconMapPin,
  IconTrash,
  TextField,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { privateImage } from '../../api/client';
import { currentLocation, LocationError, mapsEnabled, type Point } from '../../utils/location';
import { mapsLink, parsePoint, pointText } from '../../utils/geo';
import { ToggleChips } from '../business/shared';

/** Wash times residents usually ask for: early mornings, and evenings after work. */
const TIMES = ['05:30', '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '16:00', '16:30', '17:00', '17:30', '18:00'];
export const TIME_OPTIONS = TIMES.map((value) => ({ value, label: formatClock(value) }));
export const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: String(d), label: WEEKDAY_SHORT[d]! }));

/** Time chips that keep an unusual saved time selectable. */
export function TimeChips({ label, value, onChange }: { label?: string; value: string; onChange: (t: string) => void }) {
  const options = TIMES.includes(value) ? TIME_OPTIONS : [{ value, label: formatClock(value) }, ...TIME_OPTIONS];
  return <ChoiceChips label={label} options={options} value={value} onChange={onChange} />;
}

// ─── Location ────────────────────────────────────────────────────────────────

/** Where the map opens before anything is pinned: Nellore. */
const FALLBACK: Point = { latitude: 14.4426, longitude: 79.9865 };

/**
 * The community's gate: from the phone's GPS (standing at the gate), fine-tuned by dragging the
 * pin on a Google map. Builds without a Maps key show the numbers and a link to check them.
 */
export function LocationPicker({ value, onChange, start }: { value: Point | null; onChange: (p: Point) => void; start?: Point | null }) {
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
      const p = await currentLocation();
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
      <FieldLabel>Gate location</FieldLabel>
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
            {value ? <Marker coordinate={value} draggable onDragEnd={(e) => onChange(e.nativeEvent.coordinate)} pinColor={colors.waterDeep} /> : null}
          </MapView>
        </View>
      ) : null}
      <Button
        label="Use my current location"
        variant="secondary"
        icon={<IconMapPin size={18} color={colors.waterDeep} />}
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
          {mapsEnabled ? 'Stand at the gate and tap the button, or tap the map where the gate is.' : 'Stand at the gate and tap the button.'}
        </Text>
      )}
      {mapsEnabled && value ? <Text style={styles.help}>Drag the pin onto the gate if it’s a little off.</Text> : null}
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
          hint="In Google Maps, press and hold on the gate and copy the numbers."
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

function PrivatePhoto({ path, style }: { path: string; style: object }) {
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  useEffect(() => {
    let alive = true;
    void privateImage(path).then((s) => alive && setSource(s));
    return () => {
      alive = false;
    };
  }, [path]);
  return source ? <Image source={source} style={style} resizeMode="cover" /> : <View style={[style, styles.photoLoading]} />;
}

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
          <PrivatePhoto path={`/places/${placeId}/photos/${p.id}`} style={styles.photo} />
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
          {adding ? <ActivityIndicator color={colors.water} /> : <IconCamera size={26} color={colors.waterDeep} />}
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
      <ToggleChips
        label="Days"
        options={DAY_OPTIONS}
        value={slot.days.map(String)}
        onChange={(days) => onChange({ ...slot, days: days.map(Number) })}
        min={1}
      />
      <TimeChips label="Time" value={slot.time} onChange={(time) => onChange({ ...slot, time })} />
    </View>
  );
}

// ─── What the inspection found ───────────────────────────────────────────────

export function inspectionLines(i: Inspection): { label: string; value: string }[] {
  const vehicles = [i.cars != null ? `${i.cars} cars` : null, i.bikes != null ? `${i.bikes} bikes` : null].filter(Boolean).join(', ');
  return [
    i.permission ? { label: 'Society', value: PERMISSION_LABEL[i.permission] } : null,
    i.water ? { label: 'Water', value: WATER_LABEL[i.water] } : null,
    i.power ? { label: 'Power', value: POWER_LABEL[i.power] } : null,
    i.parking ? { label: 'Parking', value: PARKING_LABEL[i.parking] } : null,
    i.space ? { label: 'Space', value: SPACE_LABEL[i.space] } : null,
    vehicles ? { label: 'About', value: vehicles } : null,
    i.bestTime ? { label: 'Best time', value: BEST_TIME_LABEL[i.bestTime] } : null,
  ].filter((l): l is { label: string; value: string } => l != null);
}

/** The inspection as a short read-out for the owner (warnings first). */
export function InspectionSummary({
  inspection,
  slots,
  contactName,
  contactPhone,
  notes,
}: {
  inspection: Inspection;
  slots: readonly ProposedSlot[];
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
}) {
  const lines = inspectionLines(inspection);
  const warnings = inspectionWarnings(inspection);
  return (
    <View style={styles.summary}>
      {warnings.map((w) => (
        <Text key={w} style={styles.warning}>
          {w}
        </Text>
      ))}
      {lines.map((l) => (
        <View key={l.label} style={styles.line}>
          <Text style={styles.lineLabel}>{l.label}</Text>
          <Text style={styles.lineValue}>{l.value}</Text>
        </View>
      ))}
      {slots.map((s, i) => (
        <View key={i} style={styles.line}>
          <Text style={styles.lineLabel}>{i === 0 ? '1st choice' : i === 1 ? '2nd choice' : '3rd choice'}</Text>
          <Text style={styles.lineValue}>{describeSlot(s)}</Text>
        </View>
      ))}
      {contactPhone ? (
        <View style={styles.line}>
          <Text style={styles.lineLabel}>Contact</Text>
          <Text style={styles.lineValue}>
            {contactName ? `${contactName} · ` : ''}
            {contactPhone}
          </Text>
        </View>
      ) : null}
      {notes ? <Text style={styles.notes}>{notes}</Text> : null}
      {!lines.length && !slots.length && !contactPhone && !notes ? <Text style={styles.help}>Nothing filled in yet.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  mapWrap: { height: 230, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  pointRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  point: { ...typography.bodyStrong, color: colors.waterInk, fontVariant: ['tabular-nums'] },
  link: { ...typography.label, color: colors.waterDeep, fontWeight: '700' },
  help: { ...typography.caption, color: colors.slate },
  error: { ...typography.label, color: colors.danger },
  strip: { gap: spacing.sm, paddingVertical: 2 },
  photoCard: { width: 132, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  photo: { width: 132, height: 100 },
  photoLoading: { backgroundColor: colors.waterPale },
  photoFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 6 },
  photoKind: { ...typography.caption, color: colors.slateDeep, fontWeight: '700' },
  addPhoto: {
    width: 132,
    height: 130,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.water,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.waterPale,
  },
  addText: { ...typography.label, color: colors.waterDeep, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  visitPhoto: { width: '100%', height: 220, borderRadius: radius.md },
  slot: { gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  slotHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  slotTitle: { ...typography.bodyStrong, color: colors.waterInk },
  remove: { ...typography.label, color: colors.danger, fontWeight: '700' },
  summary: { gap: 6 },
  warning: { ...typography.label, color: colors.amberDeep, fontWeight: '700' },
  line: { flexDirection: 'row', gap: spacing.md },
  lineLabel: { ...typography.label, color: colors.slate, width: 92 },
  lineValue: { ...typography.label, color: colors.waterInk, flex: 1, fontWeight: '600' },
  notes: { ...typography.label, color: colors.slateDeep, marginTop: 4 },
});
