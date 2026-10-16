import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Circle, Defs, G, Path, RadialGradient, Stop } from 'react-native-svg';
import { BRAND_MARK, brandGradients, colors, shadow, spacing, typography } from '@mana/ui';

export const HERO_ALERT = ['#F59E0B', '#D97706', '#92400E'] as const;
export const HERO_TEAL = ['#0F766E', '#0B4F4A', '#062B28'] as const;
export const HERO_DANGER = ['#B91C1C', '#7F1D1D', '#450A0A'] as const;

/** Night indigo brand hero used across More / ops screens. */
export function ScreenHero({
  eyebrow,
  title,
  meta,
  chips,
  alert,
  tone,
  right,
  children,
}: {
  eyebrow: string;
  title: string;
  meta?: string;
  chips?: { label: string; value: string | number }[];
  alert?: boolean;
  /** Override gradient. Default brand hero. */
  tone?: 'brand' | 'teal' | 'alert' | 'danger';
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const g = brandGradients.hero;
  const palette =
    tone === 'teal'
      ? HERO_TEAL
      : tone === 'danger'
        ? HERO_DANGER
        : alert || tone === 'alert'
          ? HERO_ALERT
          : null;
  const heroColors = (palette ?? (g.colors as readonly string[])) as unknown as string[];
  return (
    <View style={heroStyles.wrap}>
      <LinearGradient
        colors={heroColors}
        locations={palette ? undefined : (g.locations as unknown as number[])}
        start={g.start}
        end={g.end}
        style={[heroStyles.stage, shadow('md')]}
      >
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 390 220">
          <Defs>
            <RadialGradient id="chromeGlow" cx="78%" cy="18%" r="50%">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.2" />
              <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="310" cy="40" r="110" fill="url(#chromeGlow)" />
          {[
            [30, 36, 1.3, 0.45],
            [88, 78, 1, 0.3],
            [160, 28, 1.2, 0.4],
            [340, 120, 1.1, 0.3],
          ].map(([x, y, r, o]) => (
            <Circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#FFFFFF" fillOpacity={o} />
          ))}
        </Svg>
        <Svg style={heroStyles.mark} width={150} height={150} viewBox="0 0 256 256">
          <G>
            <Path d={BRAND_MARK.drop} fill="#FFFFFF" fillOpacity={0.07} />
            <Path d={BRAND_MARK.arms} fill="#FFFFFF" fillOpacity={0.1} />
            <Path d={BRAND_MARK.centre} fill="#FFFFFF" fillOpacity={0.15} />
          </G>
        </Svg>

        <View style={heroStyles.top}>
          <Text style={heroStyles.eyebrow}>{eyebrow}</Text>
          {right}
        </View>
        <Text style={heroStyles.title} numberOfLines={2} adjustsFontSizeToFit>
          {title}
        </Text>
        {meta ? (
          <Text style={heroStyles.meta} numberOfLines={3}>
            {meta}
          </Text>
        ) : null}
        {chips && chips.length > 0 ? (
          <View style={heroStyles.chips}>
            {chips.map((c) => (
              <View key={c.label} style={heroStyles.chip}>
                <Text style={heroStyles.chipLabel}>{c.label}</Text>
                <Text style={heroStyles.chipValue}>{c.value}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {children}
      </LinearGradient>
    </View>
  );
}

/** Full-bleed hairline band of rows. */
export function Band({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[bandStyles.band, style]}>{children}</View>;
}

export function BandRow({
  icon,
  iconBg,
  title,
  subtitle,
  right,
  last,
  muted,
  onPress,
}: {
  icon?: React.ReactNode;
  iconBg?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  last?: boolean;
  muted?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <>
      {icon != null ? <View style={[bandStyles.icon, { backgroundColor: iconBg ?? colors.indigoPale }]}>{icon}</View> : null}
      <View style={bandStyles.copy}>
        <Text style={[bandStyles.title, muted && bandStyles.titleMuted]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={bandStyles.meta} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </>
  );

  if (!onPress) {
    return <View style={[bandStyles.row, !last && bandStyles.divider, muted && bandStyles.muted]}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.waterPale }}
      style={({ pressed }) => [
        bandStyles.row,
        !last && bandStyles.divider,
        pressed && bandStyles.pressed,
        muted && bandStyles.muted,
      ]}
      accessibilityRole="button"
    >
      {body}
    </Pressable>
  );
}

export function SectionTitle({ children, meta }: { children: string; meta?: string }) {
  return (
    <View style={bandStyles.sectionWrap}>
      <Text style={bandStyles.section}>{children}</Text>
      {meta ? <Text style={bandStyles.sectionMeta}>{meta}</Text> : null}
    </View>
  );
}

/** Soft info / tip strip under a hero. */
export function TipBand({ children, tone = 'indigo' }: { children: string; tone?: 'indigo' | 'amber' | 'teal' }) {
  const bg = tone === 'amber' ? '#FFFBEB' : tone === 'teal' ? '#F0FDFA' : colors.indigoPale;
  const fg = tone === 'amber' ? colors.amberDeep : tone === 'teal' ? colors.tealDeep : colors.indigo;
  return (
    <View style={[tipStyles.wrap, { backgroundColor: bg }]}>
      <Text style={[tipStyles.text, { color: fg }]}>{children}</Text>
    </View>
  );
}

const heroStyles = StyleSheet.create({
  wrap: { marginTop: spacing.xs, marginHorizontal: spacing.md },
  stage: {
    borderRadius: 28,
    padding: spacing.md + 4,
    gap: 6,
    overflow: 'hidden',
  },
  mark: { position: 'absolute', right: -22, top: -14 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { ...typography.label, fontSize: 13.5, color: 'rgba(255,255,255,0.75)' },
  title: {
    ...typography.display,
    fontSize: 28,
    color: colors.white,
    letterSpacing: -0.7,
    lineHeight: 32,
  },
  meta: { ...typography.label, fontSize: 13.5, color: 'rgba(255,255,255,0.88)', lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm + 2 },
  chip: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 72,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    gap: 2,
  },
  chipLabel: { ...typography.caption, fontSize: 10.5, color: 'rgba(255,255,255,0.72)', letterSpacing: 0.2 },
  chipValue: { ...typography.bodyStrong, fontSize: 16, color: colors.white, fontWeight: '800' },
});

const bandStyles = StyleSheet.create({
  band: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
    backgroundColor: colors.white,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pressed: { backgroundColor: colors.surface },
  muted: { opacity: 0.72 },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 3, minWidth: 0 },
  title: {
    ...typography.bodyStrong,
    fontSize: 15.5,
    color: colors.waterInk,
    fontWeight: '800',
  },
  titleMuted: { color: colors.slateDeep },
  meta: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slateDeep,
    letterSpacing: 0,
    lineHeight: 17,
  },
  sectionWrap: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: 2,
  },
  section: {
    ...typography.heading,
    fontSize: 16,
    color: colors.ink,
    letterSpacing: -0.2,
  },
  sectionMeta: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slate,
    letterSpacing: 0,
  },
});

const tipStyles = StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderRadius: 16,
  },
  text: {
    ...typography.caption,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0,
    fontWeight: '600',
  },
});
