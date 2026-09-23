import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme';

interface ScreenHeaderProps {
  title: string;
  onBack: () => void;
}

/** The simple back-arrow + title header used by screens without a GradientHero of their
 * own (New Wash, Settings) — replaces the native stack header, which every screen now
 * opts out of in favor of owning its own top section. */
export function ScreenHeader({ title, onBack }: ScreenHeaderProps) {
  return (
    <View style={styles.row}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
        <Text style={styles.backArrow}>‹</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.waterPale,
  },
  backArrow: {
    fontSize: 24,
    lineHeight: 24,
    color: colors.waterDeep,
    fontWeight: '700',
  },
  title: {
    ...typography.heading,
    color: colors.waterInk,
    marginLeft: spacing.sm,
  },
  spacer: {
    flex: 1,
  },
});
