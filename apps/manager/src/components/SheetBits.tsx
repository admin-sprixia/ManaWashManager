import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@mana/ui';

export type SheetTone = 'indigo' | 'teal' | 'amber' | 'danger';

export const SHEET_TONES: Record<SheetTone, { bg: string; fg: string; chip: string; border: string }> = {
  indigo: { bg: colors.indigoPale, fg: colors.indigo, chip: colors.white, border: colors.indigoMist },
  teal: { bg: '#F0FDFA', fg: colors.tealDeep, chip: colors.tealPale, border: '#99F6E4' },
  amber: { bg: '#FFFBEB', fg: colors.amberDeep, chip: colors.amberPale, border: '#FDE68A' },
  danger: { bg: '#FEF2F2', fg: colors.danger, chip: colors.dangerPale, border: '#FECACA' },
};

/** Soft tinted card at the top of a sheet: an icon chip, a headline and one line of context. */
export function SheetHead({
  icon,
  title,
  caption,
  tone = 'indigo',
  right,
}: {
  icon: React.ReactNode;
  title: string;
  caption?: string;
  tone?: SheetTone;
  right?: React.ReactNode;
}) {
  const t = SHEET_TONES[tone];
  return (
    <View style={[styles.head, { backgroundColor: t.bg, borderColor: t.border }]}>
      <View style={[styles.headIcon, { backgroundColor: t.chip }]}>{icon}</View>
      <View style={styles.headCopy}>
        <Text style={[styles.headTitle, { color: t.fg }]} numberOfLines={2}>
          {title}
        </Text>
        {caption ? (
          <Text style={styles.headCaption} numberOfLines={3}>
            {caption}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/** Inline note / error strip with an optional leading icon. */
export function SheetNotice({
  tone = 'indigo',
  icon,
  children,
}: {
  tone?: SheetTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = SHEET_TONES[tone];
  return (
    <View style={[styles.notice, { backgroundColor: t.bg, borderColor: t.border }]}>
      {icon}
      <Text style={[styles.noticeText, { color: t.fg }]}>{children}</Text>
    </View>
  );
}

/** Small tinted status pill ("Link is on", "This phone"). */
export function SheetPill({ label, tone = 'indigo' }: { label: string; tone?: SheetTone }) {
  const t = SHEET_TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.chip === colors.white ? colors.indigoPale : t.chip }]}>
      <Text style={[styles.pillText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

/** Uppercase-free field label used above every input in a sheet. */
export function SheetLabel({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label}>{children}</Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    padding: spacing.md - 2,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  headIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headCopy: { flex: 1, gap: 2 },
  headTitle: { ...typography.bodyStrong, fontSize: 16, fontWeight: '800' },
  headCaption: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  noticeText: { ...typography.caption, fontSize: 12.5, lineHeight: 18, letterSpacing: 0, flex: 1, fontWeight: '600' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    height: 26,
    borderRadius: radius.pill,
  },
  pillText: { ...typography.caption, fontSize: 12, fontWeight: '800', letterSpacing: 0 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, fontWeight: '700', letterSpacing: 0.1 },
});
