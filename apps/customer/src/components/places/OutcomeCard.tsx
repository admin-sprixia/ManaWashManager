import React, { type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { IconAlert, IconCheck, IconClock, colors, radius, shadow, spacing } from '@mana/ui';

export type OutcomeTone = 'done' | 'waiting' | 'working' | 'failed';

const TONE: Record<OutcomeTone, { bg: string; fg: string }> = {
  done: { bg: colors.tealPale, fg: colors.teal },
  waiting: { bg: colors.amberPale, fg: colors.amberDeep },
  working: { bg: colors.indigoPale, fg: colors.indigo },
  failed: { bg: colors.dangerPale, fg: colors.danger },
};

/** The big answer at the top of a result screen: "You're in!", "Payment received", and so on. */
export function OutcomeCard({ tone, title, body, children }: { tone: OutcomeTone; title: string; body?: string; children?: ReactNode }) {
  const { bg, fg } = TONE[tone];
  return (
    <View style={styles.card}>
      <View style={[styles.mark, { backgroundColor: bg }]}>
        {tone === 'done' ? (
          <IconCheck size={30} color={fg} />
        ) : tone === 'waiting' ? (
          <IconClock size={30} color={fg} />
        ) : tone === 'failed' ? (
          <IconAlert size={30} color={fg} />
        ) : (
          <ActivityIndicator color={fg} size="large" />
        )}
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {children ? <View style={styles.extra}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E9EDFC',
    ...shadow('md'),
  },
  mark: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  title: { fontSize: 24, fontWeight: '800', color: colors.ink, textAlign: 'center', letterSpacing: -0.3 },
  body: { marginTop: 8, fontSize: 15.5, lineHeight: 22, color: colors.slateDeep, textAlign: 'center' },
  extra: { marginTop: spacing.md, alignSelf: 'stretch', gap: spacing.sm },
});
