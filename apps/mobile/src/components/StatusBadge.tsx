import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { JobStatus } from '@mana/domain';
import { radius, spacing, statusColors, typography } from '../theme';

const STATUS_LABEL: Record<JobStatus, string> = {
  waiting: 'Waiting',
  washing: 'Washing',
  ready: 'Ready',
  paid: 'Paid',
  void: 'Void',
};

/** Soft filled pill per job status — slate (waiting) → blue (washing) → amber (ready,
 * needs attention) → teal (paid). Amber is the only warm accent in the system on purpose. */
export function StatusBadge({ status }: { status: JobStatus }) {
  const tone = statusColors[status];
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
      <View style={[styles.dot, { backgroundColor: tone.border }]} />
      <Text style={[styles.label, { color: tone.fg }]}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    ...typography.label,
    fontSize: 12,
    letterSpacing: 0.3,
  },
});
