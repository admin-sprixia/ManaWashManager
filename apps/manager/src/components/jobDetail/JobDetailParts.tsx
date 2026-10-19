import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { IconChevronLeft, IconChevronRight, MakeLogo, brandGradients, colors, radius, spacing, typography } from '@mana/ui';
import { HERO_DANGER, HERO_TEAL } from '../ScreenChrome';

export type HeroTone = 'brand' | 'teal' | 'danger';

/**
 * The top of a wash: full width, in the colour of where it stands (indigo on the board, teal
 * paid, red voided). Back, status, the vehicle, the amount and the steps.
 */
export function JobHero({
  tone,
  status,
  make,
  title,
  subtitle,
  amount,
  amountNote,
  steps,
  current,
  onBack,
}: {
  tone: HeroTone;
  status: string;
  make: string | null;
  title: string;
  subtitle: string;
  amount: string;
  amountNote: string;
  /** Step labels; omitted for a voided wash. */
  steps: string[] | null;
  /** Index of the step it's at. */
  current: number;
  onBack: () => void;
}) {
  const g = brandGradients.hero;
  const palette = tone === 'teal' ? HERO_TEAL : tone === 'danger' ? HERO_DANGER : null;
  return (
    <LinearGradient
      colors={(palette ?? (g.colors as readonly string[])) as unknown as string[]}
      locations={palette ? undefined : (g.locations as unknown as number[])}
      start={g.start}
      end={g.end}
      style={hero.wrap}
    >
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 390 300" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <RadialGradient id="jobGlow" cx="85%" cy="10%" r="55%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.18" />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Circle cx="330" cy="30" r="150" fill="url(#jobGlow)" />
      </Svg>

      <View style={hero.top}>
        <Pressable onPress={onBack} hitSlop={10} style={hero.back} accessibilityRole="button" accessibilityLabel="Back">
          <IconChevronLeft size={20} color={colors.white} />
        </Pressable>
        <View style={hero.status}>
          <View style={hero.statusDot} />
          <Text style={hero.statusText}>{status}</Text>
        </View>
      </View>

      <View style={hero.vehicle}>
        <View style={hero.copy}>
          <Text style={hero.title} numberOfLines={2}>
            {title}
          </Text>
          <Text style={hero.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        {make ? (
          <View style={hero.logo}>
            <MakeLogo make={make} height={36} />
          </View>
        ) : null}
      </View>

      <Text style={hero.amount}>{amount}</Text>
      <Text style={hero.amountNote}>{amountNote}</Text>

      {steps ? (
        <View style={hero.steps}>
          {steps.map((label, i) => (
            <View key={label} style={hero.step}>
              <View style={[hero.bar, i <= current && hero.barDone]} />
              <Text style={[hero.stepLabel, i === current && hero.stepLabelOn]}>{label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </LinearGradient>
  );
}

/** A small heading over a section of the sheet. */
export function SheetHeading({ children, action }: { children: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={parts.heading}>
      <Text style={parts.headingText}>{children}</Text>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={10} accessibilityRole="button">
          <Text style={parts.headingAction}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** One fact as label and value; tappable ones get a chevron. */
export function FactRow({
  label,
  value,
  note,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'default' | 'good' | 'warn';
  onPress?: () => void;
}) {
  const body = (
    <>
      <Text style={parts.factLabel}>{label}</Text>
      <View style={parts.factValueWrap}>
        <Text
          style={[parts.factValue, tone === 'good' && parts.good, tone === 'warn' && parts.warn]}
          numberOfLines={2}
        >
          {value}
        </Text>
        {note ? <Text style={parts.factNote}>{note}</Text> : null}
      </View>
      {onPress ? <IconChevronRight size={16} color={colors.slate} /> : null}
    </>
  );
  if (!onPress) return <View style={parts.fact}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [parts.fact, pressed && parts.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
    >
      {body}
    </Pressable>
  );
}

const hero = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl + spacing.md, overflow: 'hidden' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.white },
  statusText: { ...typography.label, color: colors.white, fontSize: 12.5 },
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  copy: { flex: 1, gap: 4 },
  title: { ...typography.display, color: colors.white, fontSize: 28, lineHeight: 33, letterSpacing: -0.5 },
  subtitle: { ...typography.body, color: 'rgba(255,255,255,0.78)', fontSize: 14, letterSpacing: 0.6, fontWeight: '600' },
  logo: { padding: 4, borderRadius: 12, backgroundColor: colors.white },
  amount: { ...typography.display, color: colors.white, fontSize: 40, lineHeight: 46, letterSpacing: -1, marginTop: spacing.lg },
  amountNote: { ...typography.caption, color: 'rgba(255,255,255,0.72)', fontSize: 13, letterSpacing: 0 },
  steps: { flexDirection: 'row', gap: 6, marginTop: spacing.lg },
  step: { flex: 1, gap: 6 },
  bar: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)' },
  barDone: { backgroundColor: colors.white },
  stepLabel: { ...typography.caption, color: 'rgba(255,255,255,0.6)', fontSize: 11.5, letterSpacing: 0 },
  stepLabelOn: { color: colors.white, fontWeight: '800' },
});

const parts = StyleSheet.create({
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
  },
  headingText: {
    ...typography.label,
    color: colors.slate,
    fontSize: 11.5,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  headingAction: { ...typography.label, color: colors.indigo, fontSize: 13 },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { opacity: 0.6 },
  factLabel: { ...typography.body, color: colors.slate, fontSize: 14, width: 112 },
  factValueWrap: { flex: 1, alignItems: 'flex-end', gap: 2 },
  factValue: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 14.5, textAlign: 'right' },
  factNote: { ...typography.caption, color: colors.slate, fontSize: 12, letterSpacing: 0, textAlign: 'right' },
  good: { color: colors.tealDeep },
  warn: { color: colors.amberDeep },
});
