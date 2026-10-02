import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { colors, gradients, radius, shadow, spacing, typography } from '../theme';
import { IconAlert, IconCheck, IconCloudOff } from './Icons';

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
  icon?: ReactNode;
}

type Tone = 'info' | 'warning' | 'danger';

export interface AlertOptions {
  /** Defaults to danger when a button is destructive, otherwise info. */
  tone?: Tone;
  icon?: ReactNode;
}

interface AlertRequest {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  options: AlertOptions;
}

let counter = 0;
const listeners = new Set<(r: AlertRequest) => void>();

/** Drop-in for `Alert.alert` in the MANA look. Buttons run after the dialog has closed. */
export function showAlert(
  title: string,
  message?: string,
  buttons: AlertButton[] = [{ text: 'OK' }],
  options: AlertOptions = {},
): void {
  const request = { id: ++counter, title, message, buttons, options };
  listeners.forEach((l) => l(request));
}

const TONES: Record<Tone, { bg: string; fg: string; Icon: typeof IconAlert }> = {
  info: { bg: colors.waterPale, fg: colors.waterDeep, Icon: IconCheck },
  warning: { bg: '#FEF3C7', fg: colors.amberDeep, Icon: IconCloudOff },
  danger: { bg: '#FEE2E2', fg: colors.danger, Icon: IconAlert },
};

/** Mounted once at the root; shows one dialog at a time and queues the rest. */
export function AlertHost() {
  const [queue, setQueue] = useState<AlertRequest[]>([]);
  const anim = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const current = queue[0] ?? null;
  const currentId = current?.id;

  useEffect(() => {
    const listener = (r: AlertRequest) => setQueue((q) => [...q, r]);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (currentId == null) return;
    closing.current = false;
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 5 }).start();
  }, [currentId, anim]);

  if (!current) return null;

  const close = (button?: AlertButton) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(anim, { toValue: 0, duration: 140, useNativeDriver: true }).start(() => {
      setQueue((q) => q.slice(1));
      button?.onPress?.();
    });
  };

  const { buttons, options } = current;
  const cancel = buttons.find((b) => b.style === 'cancel');
  const dismiss = () => close(cancel ?? (buttons.length === 1 ? buttons[0] : undefined));

  const tone = TONES[options.tone ?? (buttons.some((b) => b.style === 'destructive') ? 'danger' : 'info')];
  const actions = buttons.filter((b) => b !== cancel);
  const stacked = buttons.length > 2 || buttons.some((b) => b.icon);
  const choices = actions.filter((b) => b.style !== 'destructive').length > 1;
  const ordered = stacked ? [...actions, ...(cancel ? [cancel] : [])] : [...(cancel ? [cancel] : []), ...actions];

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <View style={styles.center}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]}>
          <Pressable style={styles.backdrop} onPress={dismiss} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          style={[
            styles.card,
            shadow('lg'),
            {
              opacity: anim,
              transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
            },
          ]}
          accessibilityRole="alert"
        >
          <View style={[styles.iconCircle, { backgroundColor: tone.bg }]}>
            {options.icon ?? <tone.Icon size={26} color={tone.fg} />}
          </View>
          <Text style={styles.title}>{current.title}</Text>
          {current.message ? <Text style={styles.message}>{current.message}</Text> : null}
          <View style={[styles.actions, stacked ? styles.actionsStacked : styles.actionsRow]}>
            {ordered.map((b) => (
              <DialogButton
                key={b.text}
                button={b}
                stretch={!stacked}
                soft={choices}
                lone={buttons.length === 1}
                onPress={() => close(b)}
              />
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function DialogButton({
  button,
  stretch,
  soft,
  lone,
  onPress,
}: {
  button: AlertButton;
  stretch: boolean;
  /** Several equal choices (gallery / camera) read better as light buttons than stacked gradients. */
  soft: boolean;
  lone: boolean;
  onPress: () => void;
}) {
  const isCancel = button.style === 'cancel';
  const isDanger = button.style === 'destructive';
  const isSoft = soft && !isCancel && !isDanger;
  const label = (
    <View style={styles.buttonRow}>
      {button.icon}
      <Text
        style={[
          styles.buttonLabel,
          isCancel ? styles.cancelLabel : isSoft ? styles.softLabel : styles.solidLabel,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {button.text}
      </Text>
    </View>
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        stretch && styles.stretch,
        isCancel && styles.cancelButton,
        isDanger && styles.dangerButton,
        isSoft && styles.softButton,
        pressed && styles.pressed,
      ]}
    >
      {isCancel || isDanger || isSoft ? (
        label
      ) : (
        <LinearGradient
          colors={gradients.primaryButton as unknown as string[]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fill, lone && styles.loneFill]}
        >
          {label}
        </LinearGradient>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  backdrop: { flex: 1, backgroundColor: 'rgba(8, 47, 73, 0.5)' },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg + 4,
    paddingBottom: spacing.lg,
    alignItems: 'center',
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { ...typography.heading, fontSize: 20, color: colors.waterInk, textAlign: 'center' },
  message: {
    ...typography.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.slateDeep,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  actions: { alignSelf: 'stretch', marginTop: spacing.lg, gap: spacing.sm },
  actionsRow: { flexDirection: 'row' },
  actionsStacked: { flexDirection: 'column' },
  button: { height: 50, borderRadius: radius.md, overflow: 'hidden', justifyContent: 'center' },
  stretch: { flex: 1 },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  loneFill: { borderRadius: radius.md },
  cancelButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  dangerButton: { backgroundColor: colors.danger },
  softButton: { backgroundColor: colors.waterPale },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  buttonLabel: { ...typography.bodyStrong, fontSize: 16 },
  solidLabel: { color: colors.white },
  cancelLabel: { color: colors.waterInk },
  softLabel: { color: colors.waterDeep },
  pressed: { opacity: 0.8 },
});
