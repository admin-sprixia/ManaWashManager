import React, { memo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../theme';
import { catalogVehicleForType } from '../vehicleCatalog';
import { IconBike, IconCarSide } from './Icons';

const BIKE_WORDS = /bike|scoot|moped|cruiser|activa|two.?wheeler/i;

/** Two-wheeler or car, from a vehicle type's body type (or its name). */
export function vehicleKind(type: { name: string; bodyKey?: string | null; category?: string | null }): 'bike' | 'car' {
  if (type.category === 'bike' || type.category === 'car') return type.category;
  const known = catalogVehicleForType({ name: type.name, bodyKey: type.bodyKey });
  if (known) return known.category;
  return BIKE_WORDS.test(type.name) ? 'bike' : 'car';
}

/**
 * A vehicle drawn as an icon (a bike or a car) on a soft tile, filling the space a picture would.
 * The icon scales to the tile: from its style's width and height when they're numbers (drawn
 * once — lists have hundreds of these), else measured.
 */
export const VehicleArt = memo(function VehicleArt({
  name,
  bodyKey,
  category,
  style,
  tone = 'light',
}: {
  name: string;
  bodyKey?: string | null;
  category?: string | null;
  style?: StyleProp<ViewStyle>;
  /** 'dark' for tiles with white text over them. */
  tone?: 'light' | 'dark';
}) {
  const flat = StyleSheet.flatten(style) ?? {};
  const fixed = typeof flat.width === 'number' && typeof flat.height === 'number' ? Math.min(flat.width, flat.height) : null;
  const [measured, setMeasured] = useState(0);
  const box = fixed ?? measured;
  const kind = vehicleKind({ name, bodyKey, category });
  const size = box ? Math.max(16, Math.round(box * 0.5)) : 24;
  const Icon = kind === 'bike' ? IconBike : IconCarSide;
  return (
    <View
      style={[styles.tile, tone === 'dark' ? styles.dark : styles.light, style]}
      onLayout={fixed == null ? (e) => setMeasured(Math.min(e.nativeEvent.layout.width, e.nativeEvent.layout.height)) : undefined}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Icon size={size} color={tone === 'dark' ? 'rgba(255,255,255,0.92)' : colors.indigo} />
    </View>
  );
});

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  light: { backgroundColor: colors.indigoPale },
  dark: { backgroundColor: colors.indigoMid },
});
