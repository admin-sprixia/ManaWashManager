import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { distanceKm } from '@mana/domain';
import { IconMapPin, IconStore, colors, radius, spacing, typography } from '@mana/ui';
import { api } from '../../../api/client';
import { mapsLink, pointText } from '../../../utils/geo';
import { mapsEnabled, type Point } from '../../../utils/location';
import { useApiData } from '../shared';

type Points = { points: { kind: string; name: string; latitude: number | null; longitude: number | null; active: boolean }[] };

const BLUE = '#1D4ED8';
const BLUE_PALE = '#EFF6FF';

const directions = (from: Point, to: Point) =>
  `https://www.google.com/maps/dir/?api=1&origin=${from.latitude},${from.longitude}&destination=${to.latitude},${to.longitude}`;

/** Where the gate is: a small map, how far it is from the hub, and links to open it in Google Maps. */
export function LocationCard({ point }: { point: Point }) {
  const points = useApiData<Points>(() => api.branch.points.$get(), 'Couldn’t load the hub.');
  const hubs = (points.data?.points ?? []).filter(
    (p): p is Points['points'][number] & { latitude: number; longitude: number } => p.kind === 'hub' && p.active && p.latitude != null && p.longitude != null,
  );
  const nearest = hubs
    .map((h) => ({ hub: h, km: distanceKm(h, point) }))
    .sort((a, b) => a.km - b.km)[0];
  const km = nearest ? (nearest.km < 10 ? nearest.km.toFixed(1) : String(Math.round(nearest.km))) : null;
  // About 25 km/h through town on a two-wheeler with the kit.
  const minutes = nearest ? Math.max(5, Math.round((nearest.km / 25) * 60)) : null;

  return (
    <View style={styles.card}>
      {mapsEnabled ? (
        <View style={styles.map} pointerEvents="none">
          <MapView
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            liteMode
            initialRegion={{ ...point, latitudeDelta: 0.006, longitudeDelta: 0.006 }}
            scrollEnabled={false}
            zoomEnabled={false}
            toolbarEnabled={false}
          >
            <Marker coordinate={point} pinColor={BLUE} />
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
          <View style={styles.pin}>
            <IconMapPin size={22} color={colors.white} />
          </View>
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: BLUE_PALE }]}>
            <IconMapPin size={17} color={BLUE} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.label}>Gate location</Text>
            <Text style={styles.value}>{pointText(point)}</Text>
          </View>
        </View>
        {nearest ? (
          <View style={styles.row}>
            <View style={[styles.icon, { backgroundColor: colors.indigoPale }]}>
              <IconStore size={17} color={colors.indigo} />
            </View>
            <View style={styles.copy}>
              <Text style={styles.label}>From {nearest.hub.name}</Text>
              <Text style={styles.value}>
                {km} km · about {minutes} min by bike
              </Text>
            </View>
          </View>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            onPress={() => void Linking.openURL(mapsLink(point)).catch(() => undefined)}
            style={({ pressed }) => [styles.btn, styles.btnSoft, pressed && styles.pressed]}
            accessibilityRole="link"
          >
            <Text style={[styles.btnText, { color: BLUE }]}>Open in Maps</Text>
          </Pressable>
          {nearest ? (
            <Pressable
              onPress={() => void Linking.openURL(directions(nearest.hub, point)).catch(() => undefined)}
              style={({ pressed }) => [styles.btn, styles.btnSolid, pressed && styles.pressed]}
              accessibilityRole="link"
            >
              <Text style={[styles.btnText, { color: colors.white }]}>Directions</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, borderColor: '#BFDBFE', overflow: 'hidden', backgroundColor: colors.white },
  map: { height: 140, backgroundColor: BLUE_PALE },
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
  body: { padding: spacing.sm + 4, gap: spacing.sm + 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 1 },
  label: { ...typography.caption, fontSize: 11.5, fontWeight: '700', color: colors.slate, letterSpacing: 0.2 },
  value: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '800', color: colors.waterInk },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: { flex: 1, height: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  btnSoft: { backgroundColor: BLUE_PALE, borderWidth: 1, borderColor: '#BFDBFE' },
  btnSolid: { backgroundColor: BLUE },
  btnText: { ...typography.label, fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.8 },
});
