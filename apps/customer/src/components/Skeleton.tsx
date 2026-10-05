import React from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { colors } from '@mana/ui';
import { EdgeGroup } from './CardList';

/** One grey block with a light band sweeping across it. */
export function Shimmer({ style }: { style?: StyleProp<ViewStyle> }) {
  const [width, setWidth] = React.useState(0);
  const x = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: 1300, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [x]);
  const band = width * 0.6;
  return (
    <View style={[styles.block, style]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { width: band, transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-band, width] }) }] },
          ]}
        >
          <LinearGradient
            colors={['rgba(245,247,255,0)', 'rgba(245,247,255,0.95)', 'rgba(245,247,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** A list row's shape while it loads: an icon tile, two lines and an amount. */
export function SkeletonRow({ tile = true }: { tile?: boolean }) {
  return (
    <View style={styles.row}>
      {tile ? <Shimmer style={styles.tile} /> : null}
      <View style={styles.copy}>
        <Shimmer style={{ height: 15, width: '58%' }} />
        <Shimmer style={{ height: 12, width: '36%', marginTop: 9 }} />
      </View>
      <Shimmer style={{ height: 15, width: 46 }} />
    </View>
  );
}

/** Blocks of row shapes in the layout of a list screen. */
export function SkeletonList({ groups = [4, 3] }: { groups?: number[] }) {
  return (
    <View>
      {groups.map((rows, g) => (
        <View key={g}>
          <View style={styles.label}>
            <Shimmer style={{ height: 12, width: g === 0 ? 120 : 100, borderRadius: 6 }} />
          </View>
          <EdgeGroup>
            {Array.from({ length: rows }, (_, i) => (
              <SkeletonRow key={i} />
            ))}
          </EdgeGroup>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { borderRadius: 10, backgroundColor: '#E9EDFB', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, minHeight: 72, backgroundColor: colors.white },
  tile: { width: 44, height: 44, borderRadius: 14 },
  copy: { flex: 1 },
  label: { marginTop: 26, marginBottom: 10, marginHorizontal: 20 },
});
