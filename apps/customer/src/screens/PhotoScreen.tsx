import React, { useState } from 'react';
import { FlatList, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { IconClose, colors, spacing, typography } from '@mana/ui';
import { PhotoImage } from '../components/PhotoImage';
import type { MainStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<MainStackParams, 'Photo'>;

/** Full-screen photos of one wash; swipe between them. */
export function PhotoScreen({ navigation, route }: Props) {
  const { photoIds, index } = route.params;
  const { width, height } = useWindowDimensions();
  const [current, setCurrent] = useState(Math.max(0, index));

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <FlatList
        data={photoIds}
        keyExtractor={(id) => id}
        horizontal
        pagingEnabled
        initialScrollIndex={Math.max(0, index)}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => <PhotoImage photoId={item} style={{ width, height }} resizeMode="contain" dark />}
      />
      <SafeAreaView style={styles.overlay} edges={['top']} pointerEvents="box-none">
        <View style={styles.bar}>
          <Text style={styles.counter}>
            {photoIds.length > 1 ? `${current + 1} of ${photoIds.length}` : ''}
          </Text>
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <IconClose size={20} color={colors.white} />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  counter: { ...typography.label, color: colors.white },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
