import React, { useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { IconClose } from './Icons';

interface BottomSheetProps extends PropsWithChildren {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Pinned under the scrollable body — primary actions live here so they never scroll away. */
  footer?: React.ReactNode;
  /** Block backdrop / back-button dismissal while a request is in flight. */
  dismissable?: boolean;
}

const DISMISS_DISTANCE = 110;

/** The app's one sheet surface: payment, reasons, PIN, team edits, expense entry. */
export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  footer,
  dismissable = true,
  children,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const close = () => {
    if (dismissable) onClose();
  };

  const dragY = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(close);
  closeRef.current = close;
  const dismissableRef = useRef(dismissable);
  dismissableRef.current = dismissable;

  useEffect(() => {
    if (visible) dragY.setValue(0);
  }, [visible, dragY]);

  // Android doesn't resize a translucent modal for the keyboard, and KeyboardAvoidingView
  // miscounts it by the status bar — so lift the sheet by the keyboard's own height.
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android' || !visible) return;
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      setKeyboard(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
      setKeyboard(0);
    };
  }, [visible]);

  // Drag the handle / title down to dismiss; a short pull springs back.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          dismissableRef.current && g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => dragY.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > DISMISS_DISTANCE || g.vy > 1.2) {
            Animated.timing(dragY, { toValue: 800, duration: 180, useNativeDriver: true }).start(
              () => closeRef.current(),
            );
          } else {
            Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [dragY],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
      statusBarTranslucent
    >
      <KeyboardAvoidingView style={styles.flex} behavior="padding" enabled={Platform.OS === 'ios'}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close" />
        <Animated.View
          style={[
            styles.sheet,
            shadow('lg'),
            {
              paddingBottom: Math.max(insets.bottom, spacing.md),
              marginBottom: keyboard,
              transform: [{ translateY: dragY }],
            },
          ]}
        >
          <View {...pan.panHandlers}>
            <View style={styles.handleZone}>
              <View style={styles.handle} />
            </View>
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text style={styles.title}>{title}</Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              <Pressable
                onPress={close}
                hitSlop={10}
                style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <IconClose size={18} color={colors.slateDeep} />
              </Pressable>
            </View>
          </View>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 14, 43, 0.5)',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '90%',
  },
  handleZone: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: 2 },
  handle: {
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: '#DDE3FA',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  headerCopy: { flex: 1, gap: 4 },
  title: {
    ...typography.heading,
    color: colors.ink,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  subtitle: {
    ...typography.body,
    color: colors.slateDeep,
    fontSize: 14.5,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  body: { flexGrow: 0 },
  bodyContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
});
