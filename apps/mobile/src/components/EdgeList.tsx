import React, { type PropsWithChildren, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import { IconChevronRight } from './Icons';

/** Uppercase section label above an edge-to-edge group. */
export function SectionLabel({ children, right }: PropsWithChildren<{ right?: ReactNode }>) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label}>{children}</Text>
      {right}
    </View>
  );
}

/** Full-bleed white group with hairline borders — the app's list surface (no floating cards). */
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

interface EdgeRowProps {
  icon?: ReactNode;
  /** Tint behind the icon. */
  iconBg?: string;
  title: string;
  subtitle?: string;
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
          numberOfLines={1}
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
      accessibilityLabel={title}
    >
      {body}
    </Pressable>
  );
}

/** Small rounded count / status pill for the right side of a row. */
export function Pill({
  label,
  tone = 'water',
}: {
  label: string;
  tone?: 'water' | 'amber' | 'teal' | 'slate' | 'danger';
}) {
  const palette = PILL_TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[styles.pillText, { color: palette.fg }]}>{label}</Text>
    </View>
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
});
