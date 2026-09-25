import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { IconCheck, IconCloudOff, IconAlert } from './Icons';

type Tone = 'success' | 'offline' | 'error';
interface ToastMessage {
  id: number;
  text: string;
  tone: Tone;
}

let counter = 0;
const listeners = new Set<(m: ToastMessage) => void>();

/** Fire-and-forget confirmation from anywhere (e.g. after navigating away from a form). */
export function showToast(text: string, tone: Tone = 'success'): void {
  const message = { id: ++counter, text, tone };
  listeners.forEach((l) => l(message));
}

const TONES: Record<Tone, { bg: string; fg: string; Icon: typeof IconCheck }> = {
  success: { bg: colors.waterInk, fg: colors.white, Icon: IconCheck },
  offline: { bg: '#78350F', fg: colors.white, Icon: IconCloudOff },
  error: { bg: '#7F1D1D', fg: colors.white, Icon: IconAlert },
};

/** Mounted once at the root; renders the latest toast above the bottom safe area. */
export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const listener = (m: ToastMessage) => setMessage(m);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
    const t = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() =>
        setMessage((current) => (current?.id === message.id ? null : current)),
      );
    }, 3200);
    return () => clearTimeout(t);
  }, [message, anim]);

  if (!message) return null;
  const tone = TONES[message.tone];

  return (
    <View pointerEvents="none" style={[styles.host, { bottom: Math.max(insets.bottom, spacing.md) + spacing.lg }]}>
      <Animated.View
        style={[
          styles.toast,
          shadow('lg'),
          { backgroundColor: tone.bg },
          {
            opacity: anim,
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
          },
        ]}
      >
        <tone.Icon size={16} color={tone.fg} />
        <Text style={[styles.text, { color: tone.fg }]}>{message.text}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: spacing.md, right: spacing.md, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 4,
    maxWidth: '100%',
  },
  text: { ...typography.label, textTransform: 'none', fontSize: 14, flexShrink: 1 },
});
