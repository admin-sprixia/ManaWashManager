import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

const TINTS = [
  { bg: '#E0F2FE', fg: '#0369A1' },
  { bg: '#CCFBF1', fg: '#115E59' },
  { bg: '#EDE9FE', fg: '#5B21B6' },
  { bg: '#FEF3C7', fg: '#B45309' },
  { bg: '#FCE7F3', fg: '#9D174D' },
  { bg: '#DCFCE7', fg: '#166534' },
] as const;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Initials avatar with a stable per-person tint, so the same teammate is recognisable everywhere. */
export function Avatar({ name, id, size = 40, muted }: { name: string; id?: string; size?: number; muted?: boolean }) {
  const key = id ?? name;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const tint = muted ? { bg: '#F1F5F9', fg: colors.slate } : TINTS[hash % TINTS.length]!;

  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: tint.bg }]}>
      <Text style={[styles.text, { color: tint.fg, fontSize: size * 0.38 }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '700', letterSpacing: 0.3 },
});
