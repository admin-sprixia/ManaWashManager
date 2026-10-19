import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { MAKE_LOGOS } from '../makeLogos';

/** Brand colours for the lettered badge of makes with no logo in MAKE_LOGOS. */
const BADGE_COLORS: Record<string, string> = {
  Ather: '#1B9E4B',
  'Simple Energy': '#111827',
  LML: '#1D4ED8',
  Oben: '#0F172A',
  Tork: '#D7262E',
  Okaya: '#0E7A3E',
};
const PALETTE = ['#4F5BD5', '#0E7490', '#B45309', '#047857', '#7C3AED', '#BE123C', '#1D4ED8'];

function badgeColor(make: string) {
  if (BADGE_COLORS[make]) return BADGE_COLORS[make];
  let h = 0;
  for (const ch of make) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

function initials(make: string) {
  const words = make.split(/[\s-]+/).filter(Boolean);
  if (words.length > 1) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return make.slice(0, make.length <= 3 ? 3 : 2).toUpperCase();
}

/** The make's own logo on a small 4:3 tile, or its initials on a brand-coloured one. */
export function MakeLogo({ make, height = 32 }: { make: string; height?: number }) {
  const box = {
    width: Math.round((height * 4) / 3),
    height,
    borderRadius: Math.round(height * 0.24),
  };
  const logo = MAKE_LOGOS[make];
  if (logo) {
    return (
      <View style={[styles.tile, box]}>
        <Image source={logo} style={styles.image} resizeMode="cover" />
      </View>
    );
  }
  const text = initials(make.trim() || '?');
  return (
    <View style={[styles.badge, box, { backgroundColor: badgeColor(make) }]}>
      <Text
        style={[styles.initials, { fontSize: height * (text.length > 2 ? 0.32 : 0.4) }]}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    overflow: 'hidden',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  image: { width: '100%', height: '100%' },
  badge: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.white, fontWeight: '800', letterSpacing: 0.3 },
});
