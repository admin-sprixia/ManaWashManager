import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Button, IconAlert, IconEdit, IconMapPin, colors, radius, showToast, spacing, typography } from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { mapsLink, pointText } from '../utils/geo';
import { mapsEnabled, type Point } from '../utils/location';
import { LocationPicker } from '../screens/places/communityParts';

const BLUE = '#1D4ED8';
const BLUE_PALE = '#EFF6FF';

/**
 * Where the branch is: a Google map of the pin, its numbers and pincode, a link to open it in
 * Google Maps, and (owners) moving it — standing at the branch with the phone's location,
 * dragging the pin, or pasting the numbers from Google Maps. Its hub moves with it.
 */
export function BranchLocationCard({
  location,
  pincode,
  canEdit,
  onSaved,
}: {
  location: Point | null;
  pincode: string | null;
  canEdit: boolean;
  onSaved: (p: Point) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Point | null>(location);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(location);
    setError(null);
    setEditing(true);
  };

  const moved = draft != null && (location == null || pointText(draft) !== pointText(location));

  const save = async () => {
    if (!draft || !moved) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.shop.location.$put({ json: draft });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'Couldn’t save the location.'));
      const body = await res.json();
      showToast(body.hubMoved ? 'Branch location saved · the hub moved too' : 'Branch location saved');
      onSaved(body.location);
      setEditing(false);
    } catch (e) {
      setError(e instanceof NetworkError ? 'Saving the location needs a connection.' : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <View style={[styles.card, styles.cardEditing]}>
        <LocationPicker label="Branch location" what="the branch" value={draft} onChange={setDraft} start={location} />
        {error ? (
          <View style={styles.errorRow}>
            <IconAlert size={15} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button label="Cancel" variant="ghost" disabled={saving} onPress={() => setEditing(false)} />
          </View>
          <View style={styles.flex}>
            <Button label={moved ? 'Save location' : 'Not moved yet'} loading={saving} disabled={!moved} onPress={() => void save()} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {location && mapsEnabled ? (
        <View style={styles.map} pointerEvents="none">
          <MapView
            key={pointText(location)}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            liteMode
            initialRegion={{ ...location, latitudeDelta: 0.005, longitudeDelta: 0.005 }}
            scrollEnabled={false}
            zoomEnabled={false}
            toolbarEnabled={false}
          >
            <Marker coordinate={location} pinColor={BLUE} />
          </MapView>
        </View>
      ) : (
        <View style={[styles.map, styles.mapFallback]}>
          {[0, 1, 2, 3].map((i) => (
            <View key={`h${i}`} style={[styles.road, { top: `${18 + i * 22}%` }]} />
          ))}
          {[0, 1, 2].map((i) => (
            <View key={`v${i}`} style={[styles.roadV, { left: `${22 + i * 28}%` }]} />
          ))}
          <View style={[styles.pin, !location && styles.pinMissing]}>
            <IconMapPin size={22} color={colors.white} />
          </View>
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.row}>
          <View style={styles.icon}>
            <IconMapPin size={17} color={BLUE} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.label}>Branch location{pincode ? ` · ${pincode}` : ''}</Text>
            <Text style={styles.value}>{location ? pointText(location) : 'Not pinned yet'}</Text>
          </View>
        </View>
        <View style={styles.actions}>
          {location ? (
            <Pressable
              onPress={() => void Linking.openURL(mapsLink(location)).catch(() => undefined)}
              style={({ pressed }) => [styles.btn, styles.btnSoft, pressed && styles.pressed]}
              accessibilityRole="link"
            >
              <Text style={[styles.btnText, { color: BLUE }]}>Open in Google Maps</Text>
            </Pressable>
          ) : null}
          {canEdit ? (
            <Pressable
              onPress={startEdit}
              style={({ pressed }) => [styles.btn, styles.btnSolid, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <IconEdit size={14} color={colors.white} />
              <Text style={[styles.btnText, { color: colors.white }]}>{location ? 'Change location' : 'Pin the branch'}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderRadius: radius.xl, borderWidth: 1, borderColor: '#BFDBFE', overflow: 'hidden', backgroundColor: colors.white },
  cardEditing: { padding: spacing.md, gap: spacing.sm + 4, overflow: 'visible' },
  map: { height: 150, backgroundColor: BLUE_PALE },
  mapFallback: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  road: { position: 'absolute', left: 0, right: 0, height: 6, backgroundColor: '#DBEAFE' },
  roadV: { position: 'absolute', top: 0, bottom: 0, width: 6, backgroundColor: '#DBEAFE' },
  pin: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.white,
  },
  pinMissing: { backgroundColor: colors.slate },
  body: { padding: spacing.sm + 4, gap: spacing.sm + 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: BLUE_PALE },
  label: { ...typography.caption, fontSize: 11.5, fontWeight: '700', color: colors.slate, letterSpacing: 0.2 },
  value: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '800', color: colors.waterInk },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: { flex: 1, height: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  btnSoft: { backgroundColor: BLUE_PALE, borderWidth: 1, borderColor: '#BFDBFE' },
  btnSolid: { backgroundColor: BLUE },
  btnText: { ...typography.label, fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.8 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { ...typography.caption, fontSize: 13, color: colors.danger, letterSpacing: 0, flex: 1 },
});
