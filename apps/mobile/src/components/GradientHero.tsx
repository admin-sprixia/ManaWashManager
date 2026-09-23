import React, { type PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { gradients, radius } from '../theme';

interface GradientHeroProps extends PropsWithChildren {
  /** Extra height beyond the safe-area top inset. Omit to size from content. */
  height?: number;
}

/** Soft water-gradient band at the top of Login and the Job Board. Includes a safe-area
 * top inset and faint decorative orbs so the hero feels like atmosphere, not a flat slab. */
export function GradientHero({ children, height }: GradientHeroProps) {
  const insets = useSafeAreaInsets();
  const sized = height != null;

  return (
    <LinearGradient
      colors={gradients.hero as unknown as string[]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={[styles.hero, sized ? { minHeight: height + insets.top } : null, { paddingTop: insets.top }]}
    >
      <View pointerEvents="none" style={styles.orbLarge} />
      <View pointerEvents="none" style={styles.orbSmall} />
      <View style={[styles.content, sized && styles.contentFill]}>{children}</View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    overflow: 'hidden',
    position: 'relative',
  },
  content: {
    zIndex: 1,
  },
  contentFill: {
    flex: 1,
  },
  orbLarge: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255,255,255,0.12)',
    top: -60,
    right: -40,
  },
  orbSmall: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(94,234,212,0.18)',
    bottom: -30,
    left: -20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
});
