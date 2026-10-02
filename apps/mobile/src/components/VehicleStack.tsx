import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../theme';
import { vehicleImageFor } from './VehicleTypeIcon';

interface VehicleStackProps {
  names: string[];
  size?: number;
  max?: number;
}

/** Overlapping vehicle photos with a "+N" for the rest — a compact "which vehicles" summary. */
export function VehicleStack({ names, size = 32, max = 5 }: VehicleStackProps) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  // Wider than tall so the vehicle, not the dark backdrop, fills the crop.
  const ring = { width: Math.round(size * 1.4), height: size, borderRadius: size * 0.3, marginLeft: -size * 0.3 };
  return (
    <View style={[styles.row, { paddingLeft: size * 0.3 }]}>
      {shown.map((name) => (
        <View key={name} style={[styles.ring, ring]}>
          <Image source={vehicleImageFor(name)} style={styles.photo} resizeMode="cover" />
        </View>
      ))}
      {rest > 0 ? (
        <View style={[styles.ring, styles.more, ring]}>
          <Text style={[styles.moreText, { fontSize: size * 0.34 }]}>+{rest}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  ring: {
    borderWidth: 2,
    borderColor: colors.white,
    overflow: 'hidden',
    backgroundColor: colors.waterMidnight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: { width: '100%', height: '100%' },
  more: { backgroundColor: colors.waterPale },
  moreText: { ...typography.caption, fontWeight: '800', color: colors.waterDeep, letterSpacing: 0 },
});
