import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconCheck, IconShield, colors, radius, spacing, typography } from '@mana/ui';
import { formatDateTime } from '../../../utils/format';
import { TEAL, TEAL_MIST } from '../panel/parts';
import { OWNER_CHECKS } from './options';
import type { ReviewContext, ReviewTab } from './types';

interface Event {
  key: string;
  title: string;
  by?: string | null;
  at?: string | null;
  note?: string | null;
  color: string;
  /** The step happening now (no date yet). */
  current?: boolean;
}

/** The community's way here, oldest first: the visit, any send-back, the request, the approval. */
function timeline(ctx: ReviewContext): Event[] {
  const { place } = ctx;
  const s = place.setup;
  const events: Event[] = [
    { key: 'draft', title: 'Visited and saved as a draft', by: s.createdBy?.name, at: place.createdAt, color: colors.indigo },
  ];
  if (s.reviewNote && s.reviewedAt && place.stage !== 'live') {
    events.push({ key: 'back', title: 'Sent back to the team', by: s.reviewedBy?.name, at: s.reviewedAt, note: s.reviewNote, color: '#DC2626' });
  }
  if (s.submittedAt) events.push({ key: 'sent', title: 'Sent for approval', at: s.submittedAt, color: '#D97706' });
  if (place.stage === 'live') events.push({ key: 'live', title: 'Approved and live', by: s.reviewedBy?.name, at: s.reviewedAt, color: colors.teal });
  else events.push({ key: 'now', title: place.stage === 'review' ? 'Waiting for your approval' : 'Still a draft with the team', color: colors.slate, current: true });
  return events.sort((a, b) => (a.current ? 1 : b.current ? -1 : (a.at ?? '').localeCompare(b.at ?? '')));
}

function ApproveBody({ ctx }: { ctx: ReviewContext }) {
  const { checks, toggleCheck } = ctx.settings;
  const done = OWNER_CHECKS.filter((c) => checks.includes(c.key)).length;
  const events = timeline(ctx);

  return (
    <>
      <View style={styles.progressHead}>
        <Text style={styles.label}>Before you approve</Text>
        <Text style={[styles.progressText, done === OWNER_CHECKS.length && { color: TEAL }]}>
          {done} of {OWNER_CHECKS.length} done
        </Text>
      </View>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${(done / OWNER_CHECKS.length) * 100}%` }]} />
      </View>
      <View style={styles.checks}>
        {OWNER_CHECKS.map((c) => {
          const on = checks.includes(c.key);
          return (
            <Pressable
              key={c.key}
              onPress={() => toggleCheck(c.key)}
              style={({ pressed }) => [styles.check, on && styles.checkOn, pressed && styles.pressed]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <View style={[styles.box, on && styles.boxOn]}>{on ? <IconCheck size={13} color={colors.white} /> : null}</View>
              <View style={styles.checkCopy}>
                <Text style={[styles.checkLabel, on && { color: TEAL }]}>{c.label}</Text>
                <Text style={styles.checkCaption}>{c.caption}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.label, styles.logLabel]}>Activity</Text>
      <View style={styles.log}>
        {events.map((e, i) => (
          <View key={e.key} style={styles.event}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: e.current ? colors.white : e.color, borderColor: e.color }, e.current && styles.dotCurrent]} />
              {i < events.length - 1 ? <View style={styles.line} /> : null}
            </View>
            <View style={styles.eventCopy}>
              <Text style={[styles.eventTitle, { color: e.current ? colors.slateDeep : colors.waterInk }]}>{e.title}</Text>
              {e.by || e.at ? (
                <Text style={styles.eventMeta}>{[e.by, e.at ? formatDateTime(e.at) : null].filter(Boolean).join('  ·  ')}</Text>
              ) : null}
              {e.note ? (
                <View style={styles.note}>
                  <Text style={styles.noteText}>“{e.note}”</Text>
                </View>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

/** The owner's last checks and how the community got here. Reviews only. */
export const approveTab: ReviewTab = {
  key: 'approve',
  label: 'Approve',
  title: 'Approve',
  icon: (c) => <IconShield size={17} color={c} />,
  show: (c) => !c.settings.live,
  state: (c) => (c.settings.checksDone ? 'done' : 'needed'),
  summary: (c) => {
    const done = OWNER_CHECKS.filter((k) => c.settings.checks.includes(k.key)).length;
    return done === OWNER_CHECKS.length ? 'All checked · ready to go live' : `${done} of ${OWNER_CHECKS.length} checks done`;
  },
  Body: ApproveBody,
};

const styles = StyleSheet.create({
  pressed: { opacity: 0.8 },
  label: { ...typography.caption, fontSize: 12.5, fontWeight: '700', color: colors.slateDeep, letterSpacing: 0.1 },
  progressHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  progressText: { ...typography.label, fontSize: 13, fontWeight: '800', color: colors.amberDeep },
  bar: { height: 8, borderRadius: 4, backgroundColor: '#E2E8F0', overflow: 'hidden', marginTop: -spacing.sm },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.teal },
  checks: { gap: spacing.sm },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    padding: spacing.sm + 4,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  checkOn: { borderColor: colors.teal, backgroundColor: TEAL_MIST },
  box: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  checkCopy: { flex: 1, gap: 2 },
  checkLabel: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '800', color: colors.waterInk },
  checkCaption: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },
  logLabel: { marginTop: spacing.sm },
  log: { gap: 0 },
  event: { flexDirection: 'row', gap: spacing.sm + 4 },
  rail: { width: 16, alignItems: 'center' },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, marginTop: 3 },
  dotCurrent: { borderStyle: 'dashed' },
  line: { flex: 1, width: 2, backgroundColor: '#E2E8F0', marginVertical: 2, borderRadius: 1 },
  eventCopy: { flex: 1, gap: 2, paddingBottom: spacing.md },
  eventTitle: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '800' },
  eventMeta: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0 },
  note: { marginTop: 4, padding: spacing.sm + 2, borderRadius: radius.md, backgroundColor: '#FEF2F2', borderLeftWidth: 3, borderLeftColor: '#DC2626' },
  noteText: { ...typography.body, fontSize: 13.5, lineHeight: 19, color: colors.waterInk },
});
