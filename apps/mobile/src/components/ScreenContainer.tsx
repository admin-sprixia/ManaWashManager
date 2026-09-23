import React, { type PropsWithChildren } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme';

interface ScreenContainerProps extends PropsWithChildren {
  /** Screens with a GradientHero bleed color under the status bar — pass edges={['bottom']}
   * so the hero, not this container, owns the top inset. */
  edges?: Edge[];
  noPadding?: boolean;
}

/** Plain-white screens (Settings, New Wash) use the default padded container. Screens with a
 * GradientHero (Login, Job Board) pass noPadding + edges={['bottom']} and manage their own
 * top section. */
export function ScreenContainer({ children, edges, noPadding }: ScreenContainerProps) {
  return (
    <SafeAreaView style={[styles.container, noPadding && styles.noPadding]} edges={edges}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  noPadding: {
    paddingHorizontal: 0,
  },
});
