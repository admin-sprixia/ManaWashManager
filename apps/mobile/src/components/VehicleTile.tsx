import React from 'react';
import { ActivityIndicator, Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { IconCheck, IconPlus } from './Icons';

interface VehicleTileProps {
  label: string;
  /** Example models under the name, e.g. "Swift, i20, Alto". */
  hint?: string;
  image: ImageSourcePropType;
  width: number;
  selected: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/** Selectable vehicle photo with its name underneath; a teal ring and tick when selected. */
export function VehicleTile({ label, hint, image, width, selected, busy, disabled, onPress }: VehicleTileProps) {
  const photoHeight = Math.round(width * 0.74);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [{ width }, pressed && styles.pressed]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={label}
    >
      <View style={[styles.frame, { height: photoHeight }, selected && styles.frameOn]}>
        <Image source={image} style={styles.photo} resizeMode="cover" />
        {selected ? <View style={styles.tint} /> : null}
        <View style={[styles.badge, selected || busy ? styles.badgeOn : styles.badgeOff]}>
          {busy ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : selected ? (
            <IconCheck size={12} color={colors.white} />
          ) : (
            <IconPlus size={12} color={colors.white} />
          )}
        </View>
      </View>
      <Text style={[styles.label, selected && styles.labelOn]} numberOfLines={2}>
        {label}
      </Text>
      {hint ? (
        <Text style={styles.hint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.8, transform: [{ scale: 0.96 }] },
  frame: {
    borderRadius: radius.md + 2,
    overflow: 'hidden',
    backgroundColor: colors.waterMidnight,
    borderWidth: 2.5,
    borderColor: 'transparent',
  },
  frameOn: { borderColor: colors.teal, ...shadow('sm') },
  photo: { width: '100%', height: '100%' },
  tint: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(13, 148, 136, 0.14)' },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeOn: { backgroundColor: colors.teal, borderWidth: 2, borderColor: colors.white },
  badgeOff: { backgroundColor: 'rgba(8, 47, 73, 0.45)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)' },
  label: {
    ...typography.caption,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0,
    color: colors.waterInk,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.xs + 2,
    paddingHorizontal: 2,
  },
  labelOn: { color: colors.tealDeep, fontWeight: '800' },
  hint: {
    ...typography.caption,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0,
    color: colors.slate,
    textAlign: 'center',
    paddingHorizontal: 2,
  },
});
