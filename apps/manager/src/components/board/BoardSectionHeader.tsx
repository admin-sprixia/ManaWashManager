import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@mana/ui';

/** The small uppercase heading over each list on the home board ("READY FOR PICKUP  3"). */
export function BoardSectionHeader({
  title,
  count,
  tone = 'default',
  action,
}: {
  title: string;
  count?: number;
  /** `alert`: something here needs someone. */
  tone?: 'default' | 'alert';
  action?: { label: string; onPress: () => void };
}) {
  const alert = tone === 'alert';
  return (
    <View style={styles.row}>
      {alert ? <View style={styles.alertDot} /> : null}
      <Text style={[styles.title, alert && styles.titleAlert]}>{title}</Text>
      {count != null ? <Text style={[styles.count, alert && styles.countAlert]}>{count}</Text> : null}
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={10} style={styles.action} accessibilityRole="button">
          <Text style={styles.actionText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  alertDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.amber },
  title: {
    ...typography.label,
    color: colors.slateDeep,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontSize: 12,
  },
  titleAlert: { color: colors.amberDeep },
  count: { ...typography.label, color: colors.slate, fontSize: 12 },
  countAlert: { color: colors.amberDeep },
  action: { marginLeft: 'auto' },
  actionText: { ...typography.label, fontSize: 13, color: colors.tealDeep, fontWeight: '700' },
});
