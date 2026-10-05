import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gradient, IconCarSide, IconDropletOutline, IconHome, IconPerson, IconStore, brandGradients, colors } from '@mana/ui';
import type { TabParams } from '../navigation/types';

const ICONS: Record<keyof TabParams, typeof IconHome> = {
  Home: IconHome,
  Washes: IconDropletOutline,
  Vehicles: IconCarSide,
  Visit: IconStore,
  Profile: IconPerson,
};

/** The bottom bar: a floating white rounded bar, with the active tab's icon on an indigo pill. */
export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.bar} accessibilityRole="tablist">
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key]!;
          const label = typeof options.title === 'string' ? options.title : route.name;
          const focused = state.index === index;
          const Icon = ICONS[route.name as keyof TabParams];

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLongPress={onLongPress}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
            >
              <View style={[styles.iconSlot, focused && styles.iconSlotOn]}>
                {focused ? <Gradient spec={brandGradients.tabPill} style={StyleSheet.absoluteFill} /> : null}
                <Icon size={22} color={focused ? colors.white : colors.slate} />
              </View>
              <Text style={[styles.label, focused && styles.labelOn]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The strip the bar floats in. It reserves layout space, so every tab's content ends above it.
  wrap: { paddingHorizontal: 14, paddingTop: 6, backgroundColor: colors.surface },
  bar: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderRadius: 28,
    backgroundColor: '#FDFDFF',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingTop: 2 },
  iconSlot: {
    width: 52,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconSlotOn: {
    backgroundColor: colors.indigoMid,
  },
  label: { fontSize: 11, fontWeight: '700', color: colors.slate },
  labelOn: { color: colors.indigoMid },
});
