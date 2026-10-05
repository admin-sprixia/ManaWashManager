import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import { IconAlert, IconCheck, IconClock } from './Icons';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, { bg: string; border: string; fg: string }> = {
  info: { bg: colors.waterPale, border: colors.border, fg: colors.waterDeep },
  success: { bg: '#F0FDFA', border: '#99F6E4', fg: colors.tealDeep },
  warning: { bg: '#FFFBEB', border: colors.amberLight, fg: colors.amberDeep },
  danger: { bg: '#FEF2F2', border: '#FECACA', fg: colors.danger },
};

interface NoticeProps {
  tone?: Tone;
  title?: string;
  children: string;
}

/** A tinted box for one message: why you were signed out, a request's status, a warning. */
export function Notice({ tone = 'info', title, children }: NoticeProps) {
  const t = TONES[tone];
  const Icon = tone === 'success' ? IconCheck : tone === 'info' ? IconClock : IconAlert;
  return (
    <View style={[styles.box, { backgroundColor: t.bg, borderColor: t.border }]} accessibilityRole="alert">
      <View style={styles.icon}>
        <Icon size={16} color={t.fg} />
      </View>
      <View style={styles.copy}>
        {title ? <Text style={[styles.title, { color: t.fg }]}>{title}</Text> : null}
        <Text style={[styles.body, { color: t.fg }]}>{children}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
  },
  icon: { marginTop: 2 },
  copy: { flex: 1, gap: 2 },
  title: { ...typography.bodyStrong, fontSize: 15 },
  body: { ...typography.label, fontSize: 14, fontWeight: '500', lineHeight: 20 },
});
