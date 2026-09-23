import React, { useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { colors, gradients, radius, shadow, spacing, typography } from '../theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
}

/** Shared button. Primary wraps the gradient inside a clipped shell so Android elevation
 * never paints the classic “white box” over the fill. */
export function Button({ label, onPress, variant = 'primary', size = 'md', disabled, loading }: ButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const isDisabled = disabled || loading;
  const height = size === 'lg' ? 56 : 48;

  const pressIn = () => {
    if (isDisabled) return;
    Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  };
  const pressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 4 }).start();
  };

  const content = loading ? (
    <ActivityIndicator color={variant === 'primary' ? colors.white : colors.water} />
  ) : (
    <Text
      style={[
        styles.label,
        size === 'lg' && styles.labelLg,
        variant === 'primary' ? styles.primaryLabel : styles.secondaryLabel,
        variant === 'ghost' && styles.ghostLabel,
      ]}
    >
      {label}
    </Text>
  );

  if (variant === 'primary') {
    return (
      <Animated.View
        style={[
          styles.shell,
          shadow('sm'),
          { transform: [{ scale }], opacity: isDisabled ? 0.45 : 1 },
        ]}
      >
        <Pressable
          onPress={onPress}
          onPressIn={pressIn}
          onPressOut={pressOut}
          disabled={isDisabled}
          android_ripple={{ color: 'rgba(255,255,255,0.2)' }}
          style={styles.pressFill}
        >
          <LinearGradient
            colors={gradients.primaryButton as unknown as string[]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.base, { height }]}
          >
            {content}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={{ transform: [{ scale }], opacity: isDisabled ? 0.45 : 1 }}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={isDisabled}
        android_ripple={{ color: colors.waterPale }}
        style={[
          styles.base,
          { height },
          variant === 'secondary' && styles.secondary,
          variant === 'ghost' && styles.ghost,
        ]}
      >
        {content}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radius.md,
    backgroundColor: colors.waterDeep,
    overflow: 'hidden',
  },
  pressFill: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  base: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  secondary: {
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.water,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  label: {
    ...typography.bodyStrong,
    fontSize: 16,
  },
  labelLg: {
    fontSize: 17,
  },
  primaryLabel: {
    color: colors.white,
  },
  secondaryLabel: {
    color: colors.water,
  },
  ghostLabel: {
    color: colors.waterDeep,
  },
});
