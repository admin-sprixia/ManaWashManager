import React, { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { JobStatus } from '@mana/domain';
import {
  IconBan,
  IconCash,
  IconCheck,
  IconClock,
  IconCloudOff,
  IconDroplet,
  IconPlay,
  IconSparkle,
  IconWhatsApp,
} from '../Icons';
import { colors, radius, shadow, spacing, statusColors, typography } from '../../theme';
import type { BoardJob } from '../../offline/types';
import { formatRupees } from '../../utils/format';
import { customerLine, firstName, formatTime, isToday, STATUS_LABEL, vehicleHeadline } from '../../utils/jobs';

function StatusIcon({ status }: { status: JobStatus }) {
  const fg = statusColors[status].fg;
  switch (status) {
    case 'waiting':
      return <IconClock size={18} color={fg} />;
    case 'washing':
      return <IconDroplet size={18} color={fg} />;
    case 'ready':
      return <IconSparkle size={18} color={fg} />;
    case 'paid':
      return <IconCash size={18} color={fg} />;
    default:
      return <IconBan size={18} color={fg} />;
  }
}

interface PrimaryAction {
  label: string;
  tone: 'water' | 'amber';
  icon: React.ReactNode;
}

function primaryAction(job: BoardJob): PrimaryAction | null {
  if (job.status === 'waiting') {
    return { label: 'Start wash', tone: 'water', icon: <IconPlay size={12} color={colors.white} /> };
  }
  if (job.status === 'washing') {
    return { label: 'Mark ready', tone: 'water', icon: <IconCheck size={13} color={colors.white} /> };
  }
  if (job.status === 'ready') {
    return {
      label: `Collect ${formatRupees(job.total)}`,
      tone: 'amber',
      icon: <IconCash size={14} color={colors.white} />,
    };
  }
  return null;
}

interface JobRowProps {
  job: BoardJob;
  busy: boolean;
  first: boolean;
  onOpen: (job: BoardJob) => void;
  onAction: (job: BoardJob) => void;
  onThankYou: (job: BoardJob) => void;
}

/** One job on the board: who/what at a glance, and the single next step as a button. */
export const JobRow = memo(function JobRow({ job, busy, first, onOpen, onAction, onThankYou }: JobRowProps) {
  const tone = statusColors[job.status];
  const headline = vehicleHeadline(job);
  const isVoid = job.status === 'void';
  const action = primaryAction(job);
  const when = isToday(job.createdAt) ? formatTime(job.createdAt) : 'Earlier';
  const by =
    job.status === 'paid' && job.paidBy
      ? firstName(job.paidBy.name)
      : job.createdBy
        ? firstName(job.createdBy.name)
        : null;

  return (
    <Pressable
      onPress={() => onOpen(job)}
      android_ripple={{ color: colors.waterPale }}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${headline.title}, ${headline.meta}, ${customerLine(job)}, ${STATUS_LABEL[job.status]}, ${formatRupees(job.total)}. Open details`}
    >
      <View style={[styles.statusIcon, { backgroundColor: tone.bg }]}>
        <StatusIcon status={job.status} />
      </View>

      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text style={[styles.title, isVoid && styles.voided]} numberOfLines={1}>
            {headline.title}
          </Text>
          <Text style={[styles.price, isVoid && styles.voided]}>{formatRupees(job.total)}</Text>
        </View>

        <Text style={styles.meta} numberOfLines={1}>
          {headline.meta}
          <Text style={styles.dot}>  ·  </Text>
          {customerLine(job)}
        </Text>

        <View style={styles.bottomLine}>
          <View style={styles.statusLine}>
            <View style={[styles.statusDot, { backgroundColor: tone.border }]} />
            <Text style={[styles.statusText, { color: tone.fg }]}>{STATUS_LABEL[job.status]}</Text>
            <Text style={styles.subtle} numberOfLines={1}>
              {`  ·  ${when}${by ? `  ·  ${by}` : ''}`}
            </Text>
          </View>

          {action ? (
            <Pressable
              onPress={() => onAction(job)}
              disabled={busy}
              hitSlop={8}
              style={({ pressed }) => [
                styles.actionBtn,
                action.tone === 'amber' ? styles.actionAmber : styles.actionWater,
                (pressed || busy) && styles.actionPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={action.label}
            >
              {busy ? <ActivityIndicator size="small" color={colors.white} /> : action.icon}
              <Text style={styles.actionLabel}>{action.label}</Text>
            </Pressable>
          ) : job.status === 'paid' ? (
            <Pressable
              onPress={() => onThankYou(job)}
              hitSlop={8}
              style={({ pressed }) => [styles.thanksBtn, pressed && styles.actionPressed]}
              accessibilityRole="button"
              accessibilityLabel="Send thank-you on WhatsApp"
            >
              <IconWhatsApp size={17} />
              <Text style={styles.thanksLabel}>Thank you</Text>
            </Pressable>
          ) : null}
        </View>

        {job.syncState ? (
          <View style={[styles.syncTag, job.syncState === 'failed' && styles.syncTagFailed]}>
            <IconCloudOff size={12} color={job.syncState === 'failed' ? colors.danger : colors.amberDeep} />
            <Text style={[styles.syncText, job.syncState === 'failed' && styles.syncTextFailed]}>
              {job.syncState === 'failed' ? 'Not synced — open More to review' : 'Saved on this phone · will sync'}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm + 4,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowFirst: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowPressed: { backgroundColor: colors.surface },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  body: { flex: 1, gap: 3 },
  topLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  title: { ...typography.heading, color: colors.waterInk, fontSize: 17, letterSpacing: -0.2, flex: 1 },
  price: { ...typography.heading, color: colors.waterInk, fontSize: 17, letterSpacing: -0.2 },
  voided: { color: colors.slate, textDecorationLine: 'line-through' },
  meta: { ...typography.body, color: colors.slateDeep, fontSize: 14 },
  dot: { color: colors.slate },
  bottomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: 6,
  },
  statusLine: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  statusText: { ...typography.caption, fontWeight: '700', letterSpacing: 0, fontSize: 12 },
  subtle: { ...typography.caption, color: colors.slate, letterSpacing: 0, fontSize: 12, flexShrink: 1 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md - 2,
    minHeight: 38,
    borderRadius: radius.pill,
    ...shadow('sm'),
  },
  actionWater: { backgroundColor: colors.water },
  actionAmber: { backgroundColor: colors.amber },
  actionPressed: { opacity: 0.78 },
  actionLabel: { ...typography.label, color: colors.white, fontSize: 13 },
  thanksBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md - 2,
    minHeight: 38,
    borderRadius: radius.pill,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  thanksLabel: { ...typography.label, color: colors.tealDeep, fontSize: 13 },
  syncTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 6,
    backgroundColor: '#FFFBEB',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.amberLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  syncTagFailed: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  syncText: { ...typography.caption, color: colors.amberDeep, fontSize: 11, fontWeight: '700', letterSpacing: 0 },
  syncTextFailed: { color: colors.danger },
});
