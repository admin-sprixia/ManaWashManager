import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GradientHero, IconChevronLeft, colors } from '@mana/ui';
import { LightStatusBar } from './TabTitle';

interface ScreenHeaderProps {
  title: string;
  onBack: () => void;
  /** Optional right-side action or status (e.g. a status pill). */
  right?: React.ReactNode;
}

/** The indigo header of a screen opened from a tab: a back button, the title and an optional right-hand item. */
export function ScreenHeader({ title, onBack, right }: ScreenHeaderProps) {
  return (
    <GradientHero>
      <LightStatusBar />
      <View style={styles.row}>
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <IconChevronLeft size={22} color={colors.white} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        <View style={styles.right}>{right ?? <View style={styles.spacer} />}</View>
      </View>
    </GradientHero>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 26 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  backPressed: { backgroundColor: 'rgba(255,255,255,0.3)' },
  title: { flex: 1, color: colors.white, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  right: { minWidth: 40, alignItems: 'flex-end' },
  spacer: { width: 40 },
});
