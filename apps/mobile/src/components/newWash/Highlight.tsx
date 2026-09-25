import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { colors, typography } from '../../theme';

/** Renders `text` with the first case-insensitive occurrence of `needle` emphasised. */
export function Highlight({
  text,
  needle,
  style,
  highlightStyle,
  numberOfLines = 1,
}: {
  text: string;
  needle?: string | null;
  style?: StyleProp<TextStyle>;
  highlightStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const at = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (!needle || at < 0) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {text}
      </Text>
    );
  }
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {text.slice(0, at)}
      <Text style={[styles.hit, highlightStyle]}>{text.slice(at, at + needle.length)}</Text>
      {text.slice(at + needle.length)}
    </Text>
  );
}

/** A registration number styled like the physical plate, so staff match it at a glance. */
export function PlateBadge({
  plate,
  needle,
  size = 'md',
  tone = 'light',
}: {
  plate: string;
  needle?: string | null;
  size?: 'sm' | 'md';
  tone?: 'light' | 'glass';
}) {
  return (
    <View
      style={[styles.plate, size === 'sm' && styles.plateSm, tone === 'glass' && styles.plateGlass]}
    >
      <Highlight
        text={plate}
        needle={needle}
        style={[
          styles.plateText,
          size === 'sm' && styles.plateTextSm,
          tone === 'glass' && styles.plateTextGlass,
        ]}
        highlightStyle={tone === 'glass' ? styles.hitGlass : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { color: colors.water, fontWeight: '800' },
  hitGlass: { color: colors.white, textDecorationLine: 'underline' },
  plate: {
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: colors.white,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  plateSm: { paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  plateGlass: { backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.5)' },
  plateText: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 14,
    letterSpacing: 1.3,
    fontWeight: '700',
  },
  plateTextSm: { fontSize: 12, letterSpacing: 1 },
  plateTextGlass: { color: colors.white },
});
