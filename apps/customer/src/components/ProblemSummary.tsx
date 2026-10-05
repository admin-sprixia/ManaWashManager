import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PROBLEM_KIND_LABELS, type ProblemKind } from '@mana/domain';
import { colors, formatDateTime, spacing } from '@mana/ui';
import { Pill } from './CardList';

interface ProblemLike {
  kind: ProblemKind;
  status: 'open' | 'resolved';
  resolution: string | null;
  createdAt: string;
  details?: string;
}

/** One report as a list row: what it was about, whether the team sorted it, and what they said. */
export function ProblemSummary({ problem, context }: { problem: ProblemLike; context?: string }) {
  const open = problem.status === 'open';
  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <Text style={styles.kind}>{PROBLEM_KIND_LABELS[problem.kind]}</Text>
        <Pill label={open ? 'TEAM IS LOOKING' : 'RESOLVED'} tone={open ? 'amber' : 'teal'} />
      </View>
      <Text style={styles.meta}>
        {context ? `${context} · ` : ''}
        {formatDateTime(problem.createdAt)}
      </Text>
      {problem.details ? <Text style={styles.details}>{problem.details}</Text> : null}
      {problem.resolution ? (
        <View style={styles.reply}>
          <Text style={styles.replyLabel}>Reply from the team</Text>
          <Text style={styles.replyText}>{problem.resolution}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 4, paddingHorizontal: spacing.md, paddingVertical: 14, backgroundColor: colors.white },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  kind: { fontSize: 16.5, fontWeight: '700', color: colors.ink, flex: 1 },
  meta: { fontSize: 13.5, color: colors.slateDeep },
  details: { fontSize: 14, lineHeight: 20, color: colors.slateDeep },
  reply: { marginTop: 4, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, gap: 2 },
  replyLabel: { fontSize: 12, fontWeight: '800', color: colors.indigoMid },
  replyText: { fontSize: 14, lineHeight: 20, color: colors.ink },
});
