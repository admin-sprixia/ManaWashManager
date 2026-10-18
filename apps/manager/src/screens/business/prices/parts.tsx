import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconEdit, colors, radius, spacing, typography } from '@mana/ui';
import { CARD_SHADOW } from '../shared';

/** The three ways to buy, each with its own colour across Base prices. */
export const TONE = {
  hub: { main: colors.indigo, pale: colors.indigoPale, line: colors.indigoMist, ink: colors.indigo },
  community: { main: colors.indigoBright, pale: '#EEF0FF', line: '#C9D0FA', ink: '#3B4CC0' },
  home: { main: colors.tealDeep, pale: '#E6F7F3', line: '#A7E3D6', ink: colors.tealDeep },
  amber: { main: colors.amber, pale: colors.amberPale, line: colors.amberLight, ink: colors.amberDeep },
} as const;
export type Tone = keyof typeof TONE;

/** One of the three tabs, with an example price so the difference shows at a glance. */
export function ModeCard({
  tone,
  icon,
  label,
  price,
  caption,
  selected,
  onPress,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  price: string;
  caption: string;
  selected: boolean;
  onPress: () => void;
}) {
  const t = TONE[tone];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.mode,
        { borderColor: selected ? t.main : colors.border, backgroundColor: selected ? t.main : colors.white },
        pressed && styles.pressed,
      ]}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}: ${price}, ${caption}`}
    >
      <View style={[styles.modeIcon, { backgroundColor: selected ? 'rgba(255,255,255,0.18)' : t.pale }]}>{icon}</View>
      <Text style={[styles.modeLabel, { color: selected ? 'rgba(255,255,255,0.85)' : colors.slateDeep }]}>{label}</Text>
      <Text style={[styles.modePrice, { color: selected ? colors.white : t.ink }]} numberOfLines={1} adjustsFontSizeToFit>
        {price}
      </Text>
      <Text style={[styles.modeCaption, { color: selected ? 'rgba(255,255,255,0.75)' : colors.slate }]} numberOfLines={1}>
        {caption}
      </Text>
    </Pressable>
  );
}

export interface FlowStep {
  label: string;
  value: string;
  tone?: Tone;
  /** The result: drawn filled. */
  strong?: boolean;
}

/** "Hub ₹499 → −10% → ₹449": how a price is worked out, step by step. */
export function FlowStrip({ steps, joins }: { steps: FlowStep[]; joins: string[] }) {
  return (
    <View style={styles.flow}>
      {steps.map((s, i) => {
        const t = TONE[s.tone ?? 'hub'];
        return (
          <React.Fragment key={s.label}>
            {i > 0 ? <Text style={styles.flowJoin}>{joins[i - 1] ?? '→'}</Text> : null}
            <View style={[styles.flowStep, { backgroundColor: s.strong ? t.main : t.pale, borderColor: s.strong ? t.main : t.line }]}>
              <Text style={[styles.flowLabel, { color: s.strong ? 'rgba(255,255,255,0.8)' : colors.slateDeep }]} numberOfLines={1}>
                {s.label}
              </Text>
              <Text style={[styles.flowValue, { color: s.strong ? colors.white : t.ink }]} numberOfLines={1} adjustsFontSizeToFit>
                {s.value}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

/** A white rounded card with a title, an optional line under it and an Edit action. */
export function Panel({
  title,
  subtitle,
  onEdit,
  editLabel = 'Edit',
  children,
}: {
  title: string;
  subtitle?: string;
  onEdit?: () => void;
  editLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <View style={styles.panelCopy}>
          <Text style={styles.panelTitle}>{title}</Text>
          {subtitle ? <Text style={styles.panelSub}>{subtitle}</Text> : null}
        </View>
        {onEdit ? (
          <Pressable
            onPress={onEdit}
            hitSlop={8}
            style={({ pressed }) => [styles.edit, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${editLabel} ${title}`}
          >
            <IconEdit size={15} color={colors.indigo} />
            <Text style={styles.editText}>{editLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** A big number with what it is, for a 2 × 2 grid of settings. */
export function StatTile({
  tone,
  icon,
  label,
  value,
  hint,
  onPress,
}: {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  onPress?: () => void;
}) {
  const t = TONE[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: t.pale, borderColor: t.line }, pressed && styles.pressed]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label}: ${value}`}
    >
      <View style={styles.tileTop}>
        <View style={[styles.tileIcon, { backgroundColor: colors.white }]}>{icon}</View>
        <Text style={styles.tileLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={[styles.tileValue, { color: t.ink }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.tileHint} numberOfLines={2}>
        {hint}
      </Text>
    </Pressable>
  );
}

/** A small round-cornered choice, filled when picked. */
export function Pill({ label, on, tone = 'hub', onPress }: { label: string; on: boolean; tone?: Tone; onPress: () => void }) {
  const t = TONE[tone];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { borderColor: on ? t.main : colors.border, backgroundColor: on ? t.main : colors.white },
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.pillText, { color: on ? colors.white : colors.slateDeep }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export const partStyles = StyleSheet.create({
  /** Two tiles side by side. */
  tileRow: { flexDirection: 'row', gap: spacing.sm },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  note: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },
});

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },

  mode: {
    flex: 1,
    minWidth: 0,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    padding: spacing.sm + 4,
    gap: 2,
    ...CARD_SHADOW,
  },
  modeIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  modeLabel: { ...typography.label, fontSize: 13, fontWeight: '700' },
  modePrice: { ...typography.heading, fontSize: 22, letterSpacing: -0.4 },
  modeCaption: { ...typography.caption, fontSize: 11.5, letterSpacing: 0 },

  flow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginHorizontal: spacing.md,
  },
  flowStep: { borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: spacing.sm + 4, paddingVertical: 8, minWidth: 74 },
  flowLabel: { ...typography.caption, fontSize: 11, letterSpacing: 0.2, fontWeight: '700' },
  flowValue: { ...typography.bodyStrong, fontSize: 16, fontWeight: '800' },
  flowJoin: { fontSize: 18, fontWeight: '800', color: colors.slate },

  panel: {
    marginHorizontal: spacing.md,
    padding: spacing.md,
    gap: spacing.sm + 2,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...CARD_SHADOW,
  },
  panelHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  panelCopy: { flex: 1, gap: 3, minWidth: 0 },
  panelTitle: { ...typography.heading, fontSize: 17, color: colors.waterInk, letterSpacing: -0.2 },
  panelSub: { ...typography.body, fontSize: 13.5, lineHeight: 19, color: colors.slateDeep },
  edit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.indigoPale,
  },
  editText: { ...typography.label, fontSize: 13, color: colors.indigo, fontWeight: '800' },

  tile: { flex: 1, minWidth: 0, borderRadius: radius.lg, borderWidth: 1, padding: spacing.sm + 4, gap: 4 },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tileIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { flex: 1, ...typography.label, fontSize: 13, color: colors.slateDeep, fontWeight: '700' },
  tileValue: { ...typography.heading, fontSize: 24, letterSpacing: -0.5, marginTop: 2 },
  tileHint: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0, lineHeight: 16 },

  pill: { paddingHorizontal: spacing.sm + 6, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1.5, maxWidth: 240 },
  pillText: { fontSize: 13.5, fontWeight: '700' },
});
