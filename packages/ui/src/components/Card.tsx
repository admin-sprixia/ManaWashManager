import React, { type PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, shadow, spacing } from '../theme';

interface CardProps extends PropsWithChildren {
  style?: StyleProp<ViewStyle>;
  elevation?: 'sm' | 'md' | 'lg';
  accent?: boolean;
}

/** The one card surface every grouped section uses — soft shadow, rounded corners, optional
 * left accent bar (used to mark the currently-active item, e.g. a job in progress). */
export function Card({ children, style, elevation = 'sm', accent }: CardProps) {
  return <View style={[styles.card, shadow(elevation), accent && styles.accent, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(219, 234, 254, 0.6)',
  },
  accent: {
    borderLeftWidth: 4,
    borderLeftColor: colors.water,
  },
});
