import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { colors, radius, spacing, typography } from '../theme';

type Kind = 'bike' | 'scooter' | 'hatch' | 'sedan' | 'suvMini' | 'suvLarge' | 'generic';

const IMAGES: Record<Kind, ImageSourcePropType> = {
  hatch: require('../assets/vehicles/vehicle-hatchback.png'),
  sedan: require('../assets/vehicles/vehicle-sedan.png'),
  suvMini: require('../assets/vehicles/vehicle-suv-mini.png'),
  suvLarge: require('../assets/vehicles/vehicle-suv-large.png'),
  bike: require('../assets/vehicles/vehicle-bike.png'),
  scooter: require('../assets/vehicles/vehicle-scooter.png'),
  generic: require('../assets/vehicles/vehicle-sedan.png'),
};

export function resolveVehicleKind(name: string): Kind {
  const n = name.toLowerCase();
  if (/scoot|activa|moped|step[- ]?through/.test(n)) return 'scooter';
  if (n.includes('bike') || n.includes('two')) return 'bike';
  if (n.includes('large') && (n.includes('suv') || n.includes('xuv'))) return 'suvLarge';
  if (n.includes('mini') && n.includes('suv')) return 'suvMini';
  if (n.includes('suv') || n.includes('xuv') || n.includes('muv')) return 'suvLarge';
  if (n.includes('sedan')) return 'sedan';
  if (n.includes('hatch')) return 'hatch';
  return 'generic';
}

export function vehicleImageFor(name: string): ImageSourcePropType {
  return IMAGES[resolveVehicleKind(name)];
}

/** @deprecated Prefer VehicleTypeCard */
export function VehicleTypeIcon({ name, size = 72 }: { name: string; selected?: boolean; size?: number }) {
  return (
    <View style={[styles.thumbShell, { width: size, height: size }]}>
      <Image source={vehicleImageFor(name)} style={{ width: size, height: size }} resizeMode="cover" />
    </View>
  );
}

interface VehicleTypeCardProps {
  name: string;
  selected: boolean;
  onPress: () => void;
  /** Smaller tile so ~2.5 cards fit on screen, hinting that the row scrolls. */
  compact?: boolean;
}

export const VEHICLE_CARD_COMPACT_WIDTH = 142;

/**
 * Gallery-style vehicle picker tile — cinematic photo, glass caption, soft selection glow.
 * Unselected cards dim slightly so the active one feels like the hero.
 */
export function VehicleTypeCard({ name, selected, onPress, compact = false }: VehicleTypeCardProps) {
  const scale = useRef(new Animated.Value(selected ? 1 : 0.94)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: selected ? 1 : 0.94,
      useNativeDriver: true,
      friction: 7,
      tension: 80,
    }).start();
  }, [selected, scale]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityHint="Double tap to select or deselect"
        style={[styles.cardWrap, compact && styles.cardWrapCompact, selected && styles.cardWrapOn]}
      >
        <View style={[styles.card, compact && styles.cardCompact, selected && styles.cardOn]}>
          <Image source={vehicleImageFor(name)} style={styles.photo} resizeMode="cover" />

          {/* Soft top highlight */}
          <LinearGradient
            colors={['rgba(255,255,255,0.22)', 'transparent']}
            style={styles.topSheen}
            pointerEvents="none"
          />

          {/* Bottom cinematic fade */}
          <LinearGradient
            colors={['transparent', 'rgba(8,47,73,0.25)', 'rgba(8,47,73,0.88)']}
            locations={[0.4, 0.7, 1]}
            style={styles.scrim}
            pointerEvents="none"
          />

          {selected && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Selected</Text>
            </View>
          )}

          <View style={styles.caption}>
            <Text style={styles.captionEyebrow}>VEHICLE</Text>
            <Text style={styles.captionTitle} numberOfLines={2}>
              {name}
            </Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const CARD_W = 168;
const CARD_H = 220;

const styles = StyleSheet.create({
  thumbShell: {
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  cardWrap: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 28,
    opacity: 0.72,
  },
  cardWrapCompact: {
    width: VEHICLE_CARD_COMPACT_WIDTH,
    height: 178,
    borderRadius: 22,
  },
  cardWrapOn: {
    opacity: 1,
    // Ambient glow under the selected card
    shadowColor: colors.water,
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  card: {
    flex: 1,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: colors.waterMidnight,
  },
  cardCompact: { borderRadius: 22 },
  cardOn: {
    borderWidth: 2,
    borderColor: 'rgba(125,211,252,0.95)',
  },
  photo: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  topSheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 56,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  badge: {
    position: 'absolute',
    top: spacing.sm + 2,
    right: spacing.sm + 2,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  badgeText: {
    ...typography.caption,
    color: colors.waterDeep,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  caption: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    gap: 2,
  },
  captionEyebrow: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.65)',
    letterSpacing: 1.4,
    fontSize: 10,
  },
  captionTitle: {
    ...typography.heading,
    color: colors.white,
    fontSize: 18,
    letterSpacing: -0.3,
  },
});
