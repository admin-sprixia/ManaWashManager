import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { colors, gradients, radius, typography } from '../theme';

interface FabProps {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  /** Collapse to the icon only (Material "extended FAB" behaviour while scrolling). */
  collapsed?: boolean;
  bottom: number;
}

const SIZE = 60;

/** Primary screen action, pinned bottom-right within easy thumb reach. */
export function Fab({ label, icon, onPress, collapsed = false, bottom }: FabProps) {
  const progress = useRef(new Animated.Value(collapsed ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: collapsed ? 0 : 1, duration: 180, useNativeDriver: false }).start();
  }, [collapsed, progress]);

  const labelWidth = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 108] });

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.shadow, pressed && styles.pressed]}
      >
        <LinearGradient
          colors={gradients.fab as unknown as string[]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fab}
        >
          <View style={styles.icon}>{icon}</View>
          <Animated.View style={{ width: labelWidth, opacity: progress, overflow: 'hidden' }}>
            <Text style={styles.label} numberOfLines={1}>
              {label}
            </Text>
          </Animated.View>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 16 },
  shadow: {
    borderRadius: radius.pill,
    shadowColor: colors.waterDeep,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  pressed: { transform: [{ scale: 0.96 }] },
  fab: {
    height: SIZE,
    minWidth: SIZE,
    borderRadius: SIZE / 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  icon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  label: { ...typography.bodyStrong, color: colors.white, fontSize: 16, paddingLeft: 10 },
});
