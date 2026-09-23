import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors, radius, shadow, spacing, typography } from '../theme';

export type ServiceGroup = 'Wash' | 'Interior' | 'Protect' | 'Add-ons' | 'Other';

export const GROUP_TONE: Record<ServiceGroup, { bg: string; fg: string; accent: string; gradient: [string, string] }> = {
  Wash: { bg: '#E0F2FE', fg: '#0369A1', accent: '#0EA5E9', gradient: ['#38BDF8', '#0369A1'] },
  Interior: { bg: '#CCFBF1', fg: '#115E59', accent: '#0D9488', gradient: ['#2DD4BF', '#0F766E'] },
  Protect: { bg: '#EDE9FE', fg: '#5B21B6', accent: '#8B5CF6', gradient: ['#A78BFA', '#6D28D9'] },
  'Add-ons': { bg: '#FEF3C7', fg: '#B45309', accent: '#F59E0B', gradient: ['#FBBF24', '#D97706'] },
  Other: { bg: '#F1F5F9', fg: '#475569', accent: '#94A3B8', gradient: ['#94A3B8', '#475569'] },
};

function GroupIcon({ group, color }: { group: ServiceGroup; color: string }) {
  const stroke = color;
  if (group === 'Wash') {
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
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
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
        <Path d="M4 14 L7 8 H17 L20 14" stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
        <Rect x="3" y="14" width="18" height="4" rx="1.5" stroke={stroke} strokeWidth={2} />
        <Circle cx="8" cy="18.5" r="1.5" fill={stroke} />
        <Circle cx="16" cy="18.5" r="1.5" fill={stroke} />
      </Svg>
    );
  }
  if (group === 'Protect') {
    return (
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
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
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
        <Path d="M12 4 L13.5 9.5 L19 11 L13.5 12.5 L12 18 L10.5 12.5 L5 11 L10.5 9.5 Z" fill={stroke} />
      </Svg>
    );
  }
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
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
}

/** Full-width premium service row — icon badge, name, price, clear selected fill. */
export function ServicePickRow({ name, group, priceLabel, selected, onPress }: ServicePickRowProps) {
  const tone = GROUP_TONE[group];

  if (selected) {
    return (
      <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: true }}>
        <LinearGradient
          colors={tone.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.row, styles.rowSelected, shadow('md')]}
        >
          <View style={styles.iconOn}>
            <GroupIcon group={group} color={tone.fg} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.nameOn} numberOfLines={2}>
              {name}
            </Text>
            <Text style={styles.metaOn}>{group}</Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.priceOn}>{priceLabel}</Text>
            <View style={styles.checkOn}>
              <Text style={styles.checkMark}>✓</Text>
            </View>
          </View>
        </LinearGradient>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: false }}
      style={[styles.row, styles.rowOff, shadow('sm')]}
    >
      <View style={[styles.iconOff, { backgroundColor: tone.bg }]}>
        <GroupIcon group={group} color={tone.accent} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.nameOff} numberOfLines={2}>
          {name}
        </Text>
        <Text style={[styles.metaOff, { color: tone.fg }]}>{group}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.priceOff}>{priceLabel}</Text>
        <View style={[styles.checkOff, { borderColor: tone.accent }]} />
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
    borderRadius: radius.xl,
    minHeight: 84,
  },
  rowOff: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowSelected: {
    borderWidth: 0,
  },
  iconOff: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 3,
  },
  nameOff: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 16,
  },
  nameOn: {
    ...typography.bodyStrong,
    color: colors.white,
    fontSize: 16,
  },
  metaOff: {
    ...typography.caption,
    fontWeight: '600',
  },
  metaOn: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
  },
  right: {
    alignItems: 'flex-end',
    gap: 8,
  },
  priceOff: {
    ...typography.heading,
    color: colors.waterDeep,
    fontSize: 18,
  },
  priceOn: {
    ...typography.heading,
    color: colors.white,
    fontSize: 18,
  },
  checkOff: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
  },
  checkOn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMark: {
    color: colors.waterDeep,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 14,
  },
});
