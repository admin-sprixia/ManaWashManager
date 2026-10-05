import React, { type PropsWithChildren, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import { IconChevronRight } from './Icons';

/**
 * The list surface both apps share: uppercase section labels over full-bleed white groups with
 * hairline borders — no floating cards.
 */

/** Uppercase section label above an edge-to-edge group. */
export function SectionLabel({
  children,
  right,
  style,
}: PropsWithChildren<{ right?: ReactNode; style?: StyleProp<ViewStyle> }>) {
  return (
    <View style={[styles.labelRow, style]}>
      <Text style={styles.label} accessibilityRole="header">
        {children}
      </Text>
      {right}
    </View>
  );
}

/** Full-bleed white group with hairline borders; each child is a row with a divider under it. */
export function EdgeGroup({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.group, style]}>
      {rows.map((child, i) => (
        <View key={i} style={i < rows.length - 1 ? styles.divider : undefined}>
          {child}
        </View>
      ))}
    </View>
  );
}

/** Full-bleed white block with padding, for content that isn't rows: forms, bills, photos. */
export function EdgePanel({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.group, styles.panel, style]}>{children}</View>;
}

interface EdgeRowProps {
  icon?: ReactNode;
  /** Tint behind the icon. */
  iconBg?: string;
  title: string;
  subtitle?: string;
  /** Lines the title may wrap to (one by default). */
  titleLines?: number;
  right?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  tone?: 'default' | 'danger' | 'muted';
  disabled?: boolean;
}

export function EdgeRow({
  icon,
  iconBg = colors.waterPale,
  title,
  subtitle,
  titleLines = 1,
  right,
  onPress,
  chevron = Boolean(onPress),
  tone = 'default',
  disabled,
}: EdgeRowProps) {
  const body = (
    <>
      {icon ? <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>{icon}</View> : null}
      <View style={styles.copy}>
        <Text
          style={[styles.title, tone === 'danger' && styles.titleDanger, tone === 'muted' && styles.titleMuted]}
          numberOfLines={titleLines}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {chevron ? <IconChevronRight size={18} /> : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: colors.waterPale }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && styles.disabled]}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
    >
      {body}
    </Pressable>
  );
}

export type PillTone = 'water' | 'amber' | 'teal' | 'slate' | 'danger';

/** Small rounded count / status pill for the right side of a row. */
export function Pill({ label, tone = 'water' }: { label: string; tone?: PillTone }) {
  const palette = PILL_TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[styles.pillText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

/** Round icon button for a row's right side (call, WhatsApp). */
export function RowIconButton({
  icon,
  label,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon}
    </Pressable>
  );
}

const PILL_TONES = {
  water: { bg: colors.waterPale, border: colors.border, fg: colors.waterDeep },
  amber: { bg: '#FEF3C7', border: colors.amberLight, fg: colors.amberDeep },
  teal: { bg: '#CCFBF1', border: '#99F6E4', fg: colors.tealDeep },
  slate: { bg: '#F1F5F9', border: '#E2E8F0', fg: colors.slateDeep },
  danger: { bg: '#FEE2E2', border: '#FECACA', fg: colors.danger },
} as const;

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.slateDeep,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontSize: 12,
  },
  group: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  panel: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm + 4,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
    minHeight: 60,
    backgroundColor: colors.white,
  },
  pressed: { backgroundColor: colors.surface },
  disabled: { opacity: 0.5 },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 2 },
  title: { ...typography.bodyStrong, color: colors.waterInk },
  titleDanger: { color: colors.danger },
  titleMuted: { color: colors.slate },
  subtitle: { ...typography.caption, color: colors.slateDeep, fontSize: 13, letterSpacing: 0 },
  pill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  pillText: { ...typography.caption, fontWeight: '700', fontSize: 11, letterSpacing: 0.3 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
