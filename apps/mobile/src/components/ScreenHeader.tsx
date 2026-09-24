import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme';
import { IconChevronLeft } from './Icons';

interface ScreenHeaderProps {
  title: string;
  onBack: () => void;
  /** Optional right-side action (e.g. a call button). */
  right?: React.ReactNode;
}

/** Back chevron + title used by screens without a GradientHero. */
export function ScreenHeader({ title, onBack, right }: ScreenHeaderProps) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <IconChevronLeft size={22} color={colors.waterDeep} />
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.right}>{right ?? <View style={styles.rightSpacer} />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.waterPale,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backPressed: {
    opacity: 0.7,
  },
  title: {
    ...typography.heading,
    color: colors.waterInk,
    flex: 1,
  },
  right: {
    minWidth: 40,
    alignItems: 'flex-end',
  },
  rightSpacer: {
    width: 40,
  },
});
