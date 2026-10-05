import React, { type PropsWithChildren, type ReactElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gradient, IconChevronRight, brandGradients, colors, radius, shadow } from '@mana/ui';

export { Pill, RowIconButton } from '@mana/ui';

/**
 * The customer app's list surface: an uppercase section title over a white block that runs from the
 * left edge of the screen to the right, with a hairline between rows. There are no gaps and no
 * separate cards. The props match the shared list in @mana/ui (which the manager app keeps), so a
 * screen picks this look by changing its import, not its code.
 */

/** Where a row's divider starts: under the text when the row has an icon tile, else at the padding. */
const DIVIDER_UNDER_TEXT = 74;
const DIVIDER_PLAIN = 16;

/** Uppercase section title above a block. */
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
      {typeof right === 'string' ? <Text style={styles.labelRight}>{right}</Text> : right}
    </View>
  );
}

/** A full-width white block; every row after the first gets a hairline above it. */
export function EdgeGroup({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.group, style]}>
      {rows.map((child, i) => {
        const hasIcon = React.isValidElement(child) && child.type === EdgeRow && Boolean((child as ReactElement<EdgeRowProps>).props.icon);
        return (
          <View key={i}>
            {i > 0 ? <View style={[styles.divider, { left: hasIcon ? DIVIDER_UNDER_TEXT : DIVIDER_PLAIN }]} /> : null}
            {child}
          </View>
        );
      })}
    </View>
  );
}

/** A full-width white block with padding, for content that isn't rows: forms, bills, photos. */
export function EdgePanel({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.group, styles.panel, style]}>{children}</View>;
}

export interface EdgeRowProps {
  icon?: ReactNode;
  /** Colour behind the icon. Omit for the soft indigo tile. */
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
  iconBg,
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
      {icon ? (
        iconBg ? (
          <View style={[styles.tile, { backgroundColor: iconBg }]}>{icon}</View>
        ) : (
          <Gradient spec={brandGradients.tile} style={[styles.tile, styles.tileSoft]}>
            {icon}
          </Gradient>
        )
      ) : null}
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
      {chevron ? <IconChevronRight size={16} color={CHEVRON} /> : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: colors.indigoPale }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && styles.disabled]}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
    >
      {body}
    </Pressable>
  );
}

/** The soft slate-indigo chevron every list row ends with. */
export const CHEVRON = '#B3BAD6';

/** The hairline colour between rows and around blocks. */
export const HAIRLINE = '#E9EDFC';

/** The rounded shadowed card shell, for the rich one-off items (not for lists of rows). */
export const cardShell = {
  marginHorizontal: 16,
  borderRadius: radius.lg,
  backgroundColor: colors.white,
  borderWidth: 1,
  borderColor: HAIRLINE,
  ...shadow('md'),
} as const;

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 26,
    marginBottom: 10,
    marginHorizontal: 20,
  },
  label: { fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: colors.slateDeep },
  labelRight: { fontSize: 12.5, fontWeight: '600', color: colors.slate },
  group: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: HAIRLINE,
  },
  panel: { paddingHorizontal: 16, paddingVertical: 16, gap: 14 },
  divider: { position: 'absolute', top: 0, right: 0, height: 1, backgroundColor: HAIRLINE, zIndex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 64,
    backgroundColor: colors.white,
  },
  pressed: { backgroundColor: colors.surface },
  disabled: { opacity: 0.5 },
  tile: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tileSoft: { borderWidth: 1, borderColor: 'rgba(84,104,212,0.14)' },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 16.5, fontWeight: '700', color: colors.ink, letterSpacing: -0.1 },
  titleDanger: { color: colors.danger },
  titleMuted: { color: colors.slate },
  subtitle: { fontSize: 13.5, color: colors.slateDeep },
});
