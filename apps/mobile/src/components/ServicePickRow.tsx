import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors, spacing, typography } from '../theme';

export type ServiceGroup = 'Wash' | 'Interior' | 'Protect' | 'Add-ons' | 'Other';

export const GROUP_TONE: Record<
  ServiceGroup,
  { bg: string; fg: string; accent: string }
> = {
  Wash: { bg: '#E0F2FE', fg: '#0369A1', accent: '#0EA5E9' },
  Interior: { bg: '#CCFBF1', fg: '#115E59', accent: '#0D9488' },
  Protect: { bg: '#EDE9FE', fg: '#5B21B6', accent: '#8B5CF6' },
  'Add-ons': { bg: '#FEF3C7', fg: '#B45309', accent: '#F59E0B' },
  Other: { bg: '#F1F5F9', fg: '#475569', accent: '#94A3B8' },
};

function GroupIcon({ group, color }: { group: ServiceGroup; color: string }) {
  const stroke = color;
  if (group === 'Wash') {
    return (
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Path
          d="M12 3 C12 3 6 10 6 14.5 A6 6 0 0 0 18 14.5 C18 10 12 3 12 3 Z"
          stroke={stroke}
          strokeWidth={2}
          fill={stroke}
          fillOpacity={0.2}
        />
      </Svg>
    );
  }
  if (group === 'Interior') {
    return (
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Path d="M4 14 L7 8 H17 L20 14" stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
        <Rect x="3" y="14" width="18" height="4" rx="1.5" stroke={stroke} strokeWidth={2} />
        <Circle cx="8" cy="18.5" r="1.5" fill={stroke} />
        <Circle cx="16" cy="18.5" r="1.5" fill={stroke} />
      </Svg>
    );
  }
  if (group === 'Protect') {
    return (
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Path
          d="M12 3 L19 6.5 V12 C19 16.5 15.5 20 12 21 C8.5 20 5 16.5 5 12 V6.5 L12 3 Z"
          stroke={stroke}
          strokeWidth={2}
          fill={stroke}
          fillOpacity={0.18}
        />
      </Svg>
    );
  }
  if (group === 'Add-ons') {
    return (
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Path d="M12 4 L13.5 9.5 L19 11 L13.5 12.5 L12 18 L10.5 12.5 L5 11 L10.5 9.5 Z" fill={stroke} />
      </Svg>
    );
  }
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="7" stroke={stroke} strokeWidth={2} />
    </Svg>
  );
}

interface ServicePickRowProps {
  name: string;
  group: ServiceGroup;
  priceLabel: string;
  selected: boolean;
  onPress: () => void;
  /** Draw a hairline under the row (omit on the last item). */
  showDivider?: boolean;
}

/** Edge-to-edge service row — no card chrome, just a clean selectable list line. */
export function ServicePickRow({
  name,
  group,
  priceLabel,
  selected,
  onPress,
  showDivider = true,
}: ServicePickRowProps) {
  const tone = GROUP_TONE[group];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        showDivider && styles.rowDivider,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: selected ? 'rgba(255,255,255,0.9)' : tone.bg }]}>
        <GroupIcon group={group} color={selected ? colors.waterDeep : tone.accent} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.name, selected && styles.nameOn]} numberOfLines={2}>
          {name}
        </Text>
        <Text style={[styles.meta, selected ? styles.metaOn : { color: tone.fg }]}>{group}</Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.price, selected && styles.priceOn]}>{priceLabel}</Text>
        <View style={[styles.check, selected && styles.checkOn, !selected && { borderColor: tone.accent }]}>
          {selected ? <Text style={styles.checkMark}>✓</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 72,
    backgroundColor: colors.white,
  },
  rowSelected: {
    backgroundColor: colors.waterPale,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: {
    opacity: 0.88,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 16,
  },
  nameOn: {
    color: colors.waterInk,
  },
  meta: {
    ...typography.caption,
    fontWeight: '600',
  },
  metaOn: {
    color: colors.waterDeep,
  },
  right: {
    alignItems: 'flex-end',
    gap: 8,
  },
  price: {
    ...typography.bodyStrong,
    color: colors.waterDeep,
    fontSize: 16,
  },
  priceOn: {
    color: colors.waterDeep,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: colors.water,
    borderColor: colors.water,
  },
  checkMark: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 13,
  },
});
