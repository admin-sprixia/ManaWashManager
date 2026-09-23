import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gradients, shadow, spacing, typography } from '../theme';

interface FabProps {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}

/** Primary floating action — reserved for the one most common job-board action (New Wash).
 * Sits above the home indicator with a press-scale and soft elevation so it stays reachable
 * while scrolling the list. */
export function Fab({ label, onPress, accessibilityLabel }: FabProps) {
  const insets = useSafeAreaInsets();
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    Animated.spring(scale, { toValue: 0.94, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  };
  const pressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  };

  return (
    <Animated.View
      style={[
        styles.wrap,
        shadow('lg'),
        { bottom: Math.max(insets.bottom, spacing.md) + spacing.sm, transform: [{ scale }] },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
      >
        <LinearGradient
          colors={gradients.fab as unknown as string[]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fab}
        >
          <View style={styles.plusWrap}>
            <Text style={styles.plus}>+</Text>
          </View>
          <Text style={styles.label}>{label}</Text>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: spacing.md,
    zIndex: 20,
  },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingLeft: spacing.sm,
    paddingRight: spacing.lg,
    borderRadius: 28,
    gap: spacing.sm,
  },
  plusWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: {
    color: colors.white,
    fontSize: 26,
    fontWeight: '600',
    lineHeight: 28,
    marginTop: -1,
  },
  label: {
    ...typography.bodyStrong,
    color: colors.white,
    fontSize: 16,
  },
});
