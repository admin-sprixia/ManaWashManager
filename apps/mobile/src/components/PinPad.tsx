import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme';
import { IconBackspace } from './Icons';

interface PinPadProps {
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  disabled?: boolean;
  /** Bump this to shake the dots (wrong PIN). */
  errorKey?: number;
  /** Dark variant sits on the gradient hero; light sits on white sheets. */
  tone?: 'light' | 'dark';
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'] as const;

/**
 * A big-target numeric keypad with PIN dots — wet hands and gloves at a wash bay need
 * 64pt keys, not the tiny system number pad. Dots grow up to `maxLength` as digits arrive.
 */
export function PinPad({ value, onChange, maxLength = 6, disabled, errorKey = 0, tone = 'light' }: PinPadProps) {
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!errorKey) return;
    Animated.sequence(
      [10, -10, 7, -7, 3, 0].map((toValue) =>
        Animated.timing(shake, { toValue, duration: 45, useNativeDriver: true }),
      ),
    ).start();
  }, [errorKey, shake]);

  const press = (key: (typeof KEYS)[number]) => {
    if (disabled) return;
    if (key === 'back') onChange(value.slice(0, -1));
    else if (key && value.length < maxLength) onChange(value + key);
  };

  const dark = tone === 'dark';
  const slots = Math.max(4, Math.min(maxLength, value.length + (value.length < maxLength ? 1 : 0)));

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.dots, { transform: [{ translateX: shake }] }]}>
        {Array.from({ length: slots }).map((_, i) => {
          const filled = i < value.length;
          return (
            <View
              key={i}
              style={[
                styles.dot,
                dark ? styles.dotDark : styles.dotLight,
                filled && (dark ? styles.dotFilledDark : styles.dotFilledLight),
              ]}
            />
          );
        })}
      </Animated.View>

      <View style={styles.grid}>
        {KEYS.map((key, i) =>
          key === '' ? (
            <View key={i} style={styles.key} />
          ) : (
            <Pressable
              key={i}
              onPress={() => press(key)}
              onLongPress={key === 'back' ? () => onChange('') : undefined}
              disabled={disabled}
              android_ripple={{ color: dark ? 'rgba(255,255,255,0.18)' : colors.waterPale, borderless: true }}
              style={({ pressed }) => [
                styles.key,
                key !== 'back' && (dark ? styles.keyDark : styles.keyLight),
                pressed && styles.keyPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={key === 'back' ? 'Delete' : key}
            >
              {key === 'back' ? (
                <IconBackspace size={26} color={dark ? colors.white : colors.waterInk} />
              ) : (
                <Text style={[styles.keyText, dark && styles.keyTextDark]}>{key}</Text>
              )}
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}

const KEY_SIZE = 68;

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.lg },
  dots: { flexDirection: 'row', gap: 14, height: 18, alignItems: 'center' },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  dotLight: { borderColor: colors.waterLight },
  dotDark: { borderColor: 'rgba(255,255,255,0.6)' },
  dotFilledLight: { backgroundColor: colors.waterDeep, borderColor: colors.waterDeep },
  dotFilledDark: { backgroundColor: colors.white, borderColor: colors.white },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: KEY_SIZE * 3 + spacing.lg * 2,
    rowGap: spacing.sm + 4,
    columnGap: spacing.lg,
  },
  key: {
    width: KEY_SIZE,
    height: KEY_SIZE,
    borderRadius: KEY_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyLight: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  keyDark: { backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  keyPressed: { opacity: 0.6, transform: [{ scale: 0.96 }] },
  keyText: { ...typography.title, color: colors.waterInk, fontWeight: '600', fontSize: 28 },
  keyTextDark: { color: colors.white },
});
