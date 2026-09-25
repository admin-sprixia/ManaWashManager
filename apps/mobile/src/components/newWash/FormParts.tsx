import React, { forwardRef } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { IconCheck } from '../Icons';
import { colors, radius, spacing, typography } from '../../theme';

export type StepState = 'done' | 'active' | 'upcoming';

interface StepHeaderProps {
  index: number;
  title: string;
  state: StepState;
  /** One-line summary shown once the step has an answer (e.g. "Hatchback", "3 selected"). */
  summary?: string | null;
  hint?: string;
}

/** Numbered section title that turns into a checkmark once the step is complete. */
export function StepHeader({ index, title, state, summary, hint }: StepHeaderProps) {
  return (
    <View style={styles.stepHeader} accessibilityRole="header">
      <View
        style={[
          styles.stepBadge,
          state === 'done' && styles.stepBadgeDone,
          state === 'active' && styles.stepBadgeActive,
        ]}
      >
        {state === 'done' ? (
          <IconCheck size={14} color={colors.white} />
        ) : (
          <Text style={[styles.stepNumber, state === 'active' && styles.stepNumberActive]}>
            {index}
          </Text>
        )}
      </View>
      <View style={styles.stepCopy}>
        <Text style={[styles.stepTitle, state === 'upcoming' && styles.stepTitleMuted]}>
          {title}
        </Text>
        {hint ? <Text style={styles.stepHint}>{hint}</Text> : null}
      </View>
      {summary ? (
        <Text style={styles.stepSummary} numberOfLines={1}>
          {summary}
        </Text>
      ) : null}
    </View>
  );
}

interface FieldRowProps extends TextInputProps {
  icon: React.ReactNode;
  label: string;
  valid?: boolean;
  prefix?: string;
  last?: boolean;
  /** Visual treatment for the vehicle number — reads like a real number plate. */
  plate?: boolean;
  trailing?: React.ReactNode;
}

/** One labelled input in an edge-to-edge group: icon, floating label, value, validity tick. */
export const FieldRow = forwardRef<TextInput, FieldRowProps>(function FieldRow(
  { icon, label, valid, prefix, last, plate, trailing, style, ...input },
  ref,
) {
  return (
    <View style={[styles.field, !last && styles.fieldDivider]}>
      <View style={styles.fieldIcon}>{icon}</View>
      <View style={styles.fieldBody}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.fieldInputRow}>
          {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
          <TextInput
            ref={ref}
            placeholderTextColor="#A7B4C5"
            disableFullscreenUI
            style={[styles.input, plate && styles.plateInput, style]}
            {...input}
          />
        </View>
      </View>
      {trailing ??
        (valid ? (
          <View style={styles.validTick} accessibilityLabel={`${label} looks good`}>
            <IconCheck size={12} color={colors.white} />
          </View>
        ) : null)}
    </View>
  );
});

const styles = StyleSheet.create({
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg + 4,
    paddingBottom: spacing.sm + 2,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  stepBadgeActive: { borderColor: colors.water, backgroundColor: colors.water },
  stepBadgeDone: { borderColor: colors.teal, backgroundColor: colors.teal },
  stepNumber: { ...typography.label, color: colors.slate, fontSize: 12 },
  stepNumberActive: { color: colors.white },
  stepCopy: { flex: 1 },
  stepTitle: { ...typography.heading, color: colors.waterInk, fontSize: 18, letterSpacing: -0.2 },
  stepTitleMuted: { color: colors.slateDeep },
  stepHint: { ...typography.caption, color: colors.slate, letterSpacing: 0, marginTop: 1 },
  stepSummary: {
    ...typography.label,
    color: colors.tealDeep,
    fontSize: 13,
    maxWidth: 150,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.white,
    minHeight: 68,
  },
  fieldDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  fieldIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldBody: { flex: 1 },
  fieldLabel: { ...typography.caption, color: colors.slate, letterSpacing: 0.2, fontSize: 12 },
  fieldInputRow: { flexDirection: 'row', alignItems: 'center' },
  prefix: { fontSize: 17, fontWeight: '600', color: colors.slateDeep, marginRight: 6 },
  input: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: colors.waterInk,
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
  plateInput: { letterSpacing: 1.6, fontWeight: '700' },
  validTick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
