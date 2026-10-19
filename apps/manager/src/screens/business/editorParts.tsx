import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { colors, radius, shadow, spacing, typography } from '@mana/ui';

/** One section of an HQ editor page (a service, a plan): a white card with a title and badge. */
export function EditorCard({
  title,
  badge,
  badgeWarn,
  right,
  children,
}: {
  title: string;
  badge?: string;
  badgeWarn?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.card, shadow('sm')]}>
      <View style={styles.cardHead}>
        <Text style={[styles.cardTitle, styles.flex]}>{title}</Text>
        {badge ? (
          <View style={[styles.badge, badgeWarn && styles.badgeWarn]}>
            <Text style={[styles.badgeText, badgeWarn && styles.badgeTextWarn]}>{badge}</Text>
          </View>
        ) : null}
        {right}
      </View>
      {children}
    </View>
  );
}

/** A yes / no setting with a line of explanation. */
export function SwitchRow({ title, subtitle, value, onChange }: { title: string; subtitle: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.flex}>
        <Text style={styles.switchTitle}>{title}</Text>
        <Text style={styles.switchSub}>{subtitle}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.indigo, false: colors.border }} thumbColor={colors.white} accessibilityLabel={title} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: { backgroundColor: colors.white, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm + 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: { ...typography.heading, fontSize: 17, color: colors.ink, letterSpacing: -0.2 },
  badge: { paddingHorizontal: 10, height: 26, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: colors.indigoPale },
  badgeWarn: { backgroundColor: '#FEE2E2' },
  badgeText: { ...typography.caption, fontSize: 12, color: colors.indigo, fontWeight: '800', letterSpacing: 0 },
  badgeTextWarn: { color: colors.danger },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  switchTitle: { ...typography.bodyStrong, fontSize: 14.5, color: colors.ink, fontWeight: '700' },
  switchSub: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
});
