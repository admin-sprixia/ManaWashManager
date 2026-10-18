import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconAlert, IconCheck, colors, radius, spacing, typography } from '@mana/ui';
import { TEAL, TEAL_MIST, TEAL_PALE } from './panel/parts';

/**
 * Building blocks shared by the community screens (the community page, setup, review and wash
 * settings), so they read as one flow: numbered sections, a fixed action bar, fact tiles.
 */

/** A titled section: a step number (or tick when done) or an icon, then a white full-width band. */
export function FormSection({
  step,
  icon,
  title,
  caption,
  done,
  right,
  flush,
  children,
}: {
  step?: number;
  icon?: React.ReactNode;
  title: string;
  caption?: string;
  done?: boolean;
  right?: React.ReactNode;
  /** No inner padding: for rows that run edge to edge. */
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        {step != null || icon ? (
          <View style={[styles.badge, done && styles.badgeDone]}>
            {done ? (
              <IconCheck size={13} color={colors.white} />
            ) : step != null ? (
              <Text style={styles.badgeText}>{step}</Text>
            ) : (
              icon
            )}
          </View>
        ) : null}
        <View style={styles.sectionCopy}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {caption ? <Text style={styles.sectionCaption}>{caption}</Text> : null}
        </View>
        {right}
      </View>
      <View style={[styles.band, flush && styles.bandFlush]}>{children}</View>
    </View>
  );
}

/** The screen's main buttons, pinned under the scroll so they're always in reach. */
export function StickyActions({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <View style={styles.sticky}>
      {note}
      {children}
    </View>
  );
}

/** Amber lines that make the owner look twice ("The society hasn't agreed yet"). */
export function WarningList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <View style={styles.warnings}>
      {items.map((w) => (
        <View key={w} style={styles.warning}>
          <IconAlert size={14} color={colors.amberDeep} />
          <Text style={styles.warningText}>{w}</Text>
        </View>
      ))}
    </View>
  );
}

const STAGES = [
  { key: 'draft', label: 'Visit & draft' },
  { key: 'review', label: 'Owner review' },
  { key: 'live', label: 'Live' },
] as const;

/** Where a community is on its way to going live. */
export function StageTrack({ stage }: { stage: 'draft' | 'review' | 'live' }) {
  const at = STAGES.findIndex((s) => s.key === stage);
  return (
    <View style={styles.track}>
      {STAGES.map((s, i) => {
        const done = i < at;
        const current = i === at;
        return (
          <React.Fragment key={s.key}>
            {i > 0 ? <View style={[styles.trackLine, i <= at && styles.trackLineOn]} /> : null}
            <View style={styles.trackStep}>
              <View style={[styles.trackDot, done && styles.trackDotDone, current && styles.trackDotCurrent]}>
                {done ? <IconCheck size={11} color={colors.white} /> : <Text style={[styles.trackNum, current && styles.trackNumOn]}>{i + 1}</Text>}
              </View>
              <Text style={[styles.trackLabel, (done || current) && styles.trackLabelOn]} numberOfLines={1}>
                {s.label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

/** What's ready and what's still missing, as a progress bar and ticks. */
export function Checklist({ items }: { items: { label: string; done: boolean }[] }) {
  const done = items.filter((i) => i.done).length;
  return (
    <View style={styles.checklist}>
      <View style={styles.checkHead}>
        <Text style={styles.checkTitle}>{done === items.length ? 'Ready to send' : `${done} of ${items.length} ready`}</Text>
        <Text style={styles.checkPct}>{Math.round((done / Math.max(1, items.length)) * 100)}%</Text>
      </View>
      <View style={styles.checkBar}>
        <View style={[styles.checkFill, { width: `${(done / Math.max(1, items.length)) * 100}%` }]} />
      </View>
      <View style={styles.checkItems}>
        {items.map((i) => (
          <View key={i.label} style={[styles.checkItem, i.done && styles.checkItemDone]}>
            {i.done ? <IconCheck size={11} color={TEAL} /> : <View style={styles.checkHole} />}
            <Text style={[styles.checkText, i.done && styles.checkTextDone]}>{i.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** A square shortcut ("QR poster", "Share link"), two or more to a row. */
export function ActionTile({
  icon,
  label,
  caption,
  onPress,
  tone = 'teal',
}: {
  icon: React.ReactNode;
  label: string;
  caption?: string;
  onPress: () => void;
  tone?: 'teal' | 'indigo' | 'amber';
}) {
  const bg = tone === 'indigo' ? colors.indigoPale : tone === 'amber' ? '#FEF3C7' : TEAL_PALE;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.tileIcon, { backgroundColor: bg }]}>{icon}</View>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
      {caption ? (
        <Text style={styles.tileCaption} numberOfLines={2}>
          {caption}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function TileRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.tileRow}>{children}</View>;
}

/** A choice as stacked cards with a line of explanation each, for decisions that need one. */
export function OptionCards<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string; caption: string; tone?: 'teal' | 'amber' | 'slate' }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.options} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        const accent = o.tone === 'amber' ? colors.amberDeep : o.tone === 'slate' ? colors.slateDeep : TEAL;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [styles.option, on && { borderColor: accent, backgroundColor: o.tone === 'amber' ? '#FFFBEB' : o.tone === 'slate' ? colors.surface : TEAL_MIST }, pressed && styles.tilePressed]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <View style={[styles.radio, on && { borderColor: accent }]}>{on ? <View style={[styles.radioDot, { backgroundColor: accent }]} /> : null}</View>
            <View style={styles.optionCopy}>
              <Text style={[styles.optionLabel, on && { color: accent }]}>{o.label}</Text>
              <Text style={styles.optionCaption}>{o.caption}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A flat or house number as a small tile ("A-204"), the leading mark on a member row. */
export function UnitTile({ unit, tone = 'teal' }: { unit: string; tone?: 'teal' | 'danger' | 'slate' }) {
  const bg = tone === 'danger' ? '#FEF2F2' : tone === 'slate' ? colors.surface : TEAL_PALE;
  const fg = tone === 'danger' ? colors.danger : tone === 'slate' ? colors.slateDeep : TEAL;
  return (
    <View style={[styles.unit, { backgroundColor: bg }]}>
      <Text style={[styles.unitText, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {unit}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, marginTop: spacing.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingHorizontal: spacing.md },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: TEAL_PALE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDone: { backgroundColor: colors.teal },
  badgeText: { ...typography.label, fontSize: 12.5, fontWeight: '800', color: TEAL },
  sectionCopy: { flex: 1, gap: 1 },
  sectionTitle: { ...typography.heading, fontSize: 16, color: colors.ink, letterSpacing: -0.2 },
  sectionCaption: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0, lineHeight: 17 },
  band: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  bandFlush: { padding: 0, gap: 0 },

  sticky: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 4,
    paddingBottom: spacing.sm + 4,
    gap: spacing.sm,
    shadowColor: '#062B28',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -3 },
    elevation: 8,
  },

  warnings: { gap: 6 },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
  },
  warningText: { ...typography.label, fontSize: 13, color: colors.amberDeep, fontWeight: '700', flex: 1 },

  track: { flexDirection: 'row', alignItems: 'flex-start' },
  trackStep: { alignItems: 'center', gap: 6, width: 84 },
  trackLine: { flex: 1, height: 2, backgroundColor: '#E2E8F0', marginTop: 11, borderRadius: 1 },
  trackLineOn: { backgroundColor: colors.teal },
  trackDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackDotDone: { backgroundColor: colors.teal, borderColor: colors.teal },
  trackDotCurrent: { borderColor: colors.teal },
  trackNum: { ...typography.caption, fontSize: 11, fontWeight: '800', color: colors.slate },
  trackNumOn: { color: TEAL },
  trackLabel: { ...typography.caption, fontSize: 11.5, fontWeight: '700', color: colors.slate, letterSpacing: 0 },
  trackLabelOn: { color: TEAL },

  checklist: { gap: spacing.sm },
  checkHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  checkTitle: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },
  checkPct: { ...typography.label, fontSize: 13, fontWeight: '800', color: TEAL },
  checkBar: { height: 8, borderRadius: 4, backgroundColor: TEAL_PALE, overflow: 'hidden' },
  checkFill: { height: 8, borderRadius: 4, backgroundColor: colors.teal },
  checkItems: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: '#F1F5F9',
  },
  checkItemDone: { backgroundColor: '#ECFDF5' },
  checkHole: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: colors.slate },
  checkText: { ...typography.caption, fontSize: 11.5, fontWeight: '700', color: colors.slateDeep, letterSpacing: 0 },
  checkTextDone: { color: TEAL },

  tileRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md },
  tile: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.sm + 4,
    gap: 4,
    shadowColor: '#062B28',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  tilePressed: { opacity: 0.8 },
  tileIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  tileLabel: { ...typography.bodyStrong, fontSize: 14, fontWeight: '800', color: colors.waterInk },
  tileCaption: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 15 },

  options: { gap: spacing.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    padding: spacing.sm + 6,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  optionCopy: { flex: 1, gap: 2 },
  optionLabel: { ...typography.bodyStrong, fontSize: 15, fontWeight: '800', color: colors.waterInk },
  optionCaption: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },

  unit: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  unitText: { ...typography.label, fontSize: 13.5, fontWeight: '800', letterSpacing: 0.2 },
});
