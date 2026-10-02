import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GradientHero } from '../GradientHero';
import { IconChevronLeft, IconEdit } from '../Icons';
import { colors, radius, spacing, typography } from '../../theme';

interface AuthHeroProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  /** The number being signed in, shown as a glass pill; tapping it changes the number. */
  phoneChip?: { label: string; onPress: () => void };
  /** The first screen gets more air above the title. */
  tall?: boolean;
}

/** Sign-in header: brand row, then the step's large title on the water gradient. */
export function AuthHero({ title, subtitle, onBack, phoneChip, tall }: AuthHeroProps) {
  return (
    <GradientHero>
      <View style={[styles.content, tall && styles.contentTall]}>
        <View style={styles.topRow}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              style={({ pressed }) => [styles.back, pressed && styles.glassPressed]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <IconChevronLeft size={20} color={colors.white} />
            </Pressable>
          ) : null}
          <View style={styles.brand} accessible accessibilityLabel="MANA Wash Manager">
            <View style={styles.logo}>
              <Text style={styles.logoText}>M</Text>
            </View>
            <View>
              <Text style={styles.wordmark}>MANA</Text>
              <Text style={styles.product}>Wash Manager</Text>
            </View>
          </View>
        </View>

        <View style={[styles.copy, tall && styles.copyTall]}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          {phoneChip ? (
            <Pressable
              onPress={phoneChip.onPress}
              style={({ pressed }) => [styles.chip, pressed && styles.glassPressed]}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`${phoneChip.label}. Change number`}
            >
              <Text style={styles.chipText}>{phoneChip.label}</Text>
              <View style={styles.chipDivider} />
              <IconEdit size={13} color={colors.white} />
              <Text style={styles.chipAction}>Change</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </GradientHero>
  );
}

const textShadow = {
  textShadowColor: 'rgba(8,47,73,0.25)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
};

const glass = {
  backgroundColor: 'rgba(255,255,255,0.16)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.3)',
};

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    // The white sheet below overlaps the hero by radius.xl.
    paddingBottom: spacing.lg + radius.xl,
  },
  contentTall: { paddingBottom: spacing.xl + radius.xl },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4, minHeight: 42 },
  back: {
    ...glass,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassPressed: { backgroundColor: 'rgba(255,255,255,0.3)' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: {
    ...glass,
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: colors.white, fontSize: 19, fontWeight: '800' },
  wordmark: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 3,
    lineHeight: 18,
    ...textShadow,
  },
  product: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.3,
    lineHeight: 15,
  },
  copy: { marginTop: spacing.lg, gap: 6 },
  copyTall: { marginTop: spacing.xxl },
  title: {
    ...typography.title,
    color: colors.white,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.6,
    ...textShadow,
  },
  subtitle: {
    ...typography.body,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 15,
    lineHeight: 21,
    ...textShadow,
  },
  chip: {
    ...glass,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingLeft: 14,
    paddingRight: 12,
    paddingVertical: 7,
    marginTop: spacing.sm,
  },
  chipText: { ...typography.bodyStrong, color: colors.white, fontSize: 15, letterSpacing: 0.3 },
  chipDivider: {
    width: StyleSheet.hairlineWidth,
    height: 16,
    backgroundColor: 'rgba(255,255,255,0.5)',
    marginHorizontal: 4,
  },
  chipAction: { ...typography.label, color: colors.white, fontSize: 13 },
});
