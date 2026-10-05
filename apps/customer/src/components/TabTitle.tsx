import React from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { BrandMark, GradientHero } from '@mana/ui';

/** Light status-bar icons while a screen with an indigo hero is in view. */
export function LightStatusBar() {
  const focused = useIsFocused();
  return focused ? <StatusBar barStyle="light-content" /> : null;
}

/** The indigo hero at the top of a tab: the logo, the screen's title and a line of help. */
export function TabTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <GradientHero>
      <LightStatusBar />
      <View style={styles.wrap}>
        <View style={styles.brand} accessible accessibilityLabel="MANA">
          <BrandMark size={22} variant="onDark" />
          <Text style={styles.brandText}>MANA</Text>
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </GradientHero>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 30 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandText: { color: 'rgba(255,255,255,0.95)', fontSize: 12, fontWeight: '800', letterSpacing: 2.4 },
  title: { color: '#FFFFFF', fontSize: 32, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6, marginTop: 18 },
  subtitle: { color: 'rgba(255,255,255,0.85)', fontSize: 15, marginTop: 4 },
});
