import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { IconCheck, colors, radius, shadow, spacing, typography } from '@mana/ui';

export const TEAL = colors.tealDeep;
export const TEAL_MID = colors.teal;
export const TEAL_PALE = '#CCFBF1';
export const TEAL_MIST = '#F0FDFA';

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Lakshmi Towers" → "LT", "Sai" → "SA". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}

/** Washed out of due, as a ring; a tick once everything is recorded. */
export function ProgressRing({ done, total, size = 46 }: { done: number; total: number; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const finished = total > 0 && done >= total;
  if (finished) {
    return (
      <View style={[ring.done, { width: size, height: size, borderRadius: size / 2 }]}>
        <IconCheck size={20} color={colors.white} />
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={TEAL_PALE} strokeWidth={stroke} fill="none" />
        {pct > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={TEAL_MID}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      <View style={ring.center}>
        <Text style={ring.value} numberOfLines={1} adjustsFontSizeToFit>
          {done}
          <Text style={ring.of}>/{total}</Text>
        </Text>
      </View>
    </View>
  );
}

/** Rounded square with a community's initials, like an app icon. */
export function PlaceTile({ name, muted, tone = 'teal' }: { name: string; muted?: boolean; tone?: 'teal' | 'amber' | 'slate' }) {
  const t = muted ? 'slate' : tone;
  const bg = t === 'amber' ? '#FEF3C7' : t === 'slate' ? colors.surface : TEAL_PALE;
  const fg = t === 'amber' ? colors.amberDeep : t === 'slate' ? colors.slate : TEAL;
  return (
    <View style={[tile.box, { backgroundColor: bg }]}>
      <Text style={[tile.text, { color: fg }]}>{initials(name)}</Text>
    </View>
  );
}

export type ChipTone = 'teal' | 'danger' | 'amber' | 'slate' | 'water';

const CHIP: Record<ChipTone, { bg: string; fg: string; border: string }> = {
  teal: { bg: '#ECFDF5', fg: TEAL, border: '#A7F3D0' },
  danger: { bg: '#FEF2F2', fg: colors.danger, border: '#FECACA' },
  amber: { bg: '#FFFBEB', fg: colors.amberDeep, border: colors.amberLight },
  slate: { bg: '#F1F5F9', fg: colors.slateDeep, border: '#E2E8F0' },
  water: { bg: colors.waterPale, fg: colors.waterDeep, border: '#BAE6FD' },
};

/** Small rounded fact under a row ("2 not paid"). */
export function Chip({ label, tone = 'slate', icon }: { label: string; tone?: ChipTone; icon?: React.ReactNode }) {
  const c = CHIP[tone];
  return (
    <View style={[chip.box, { backgroundColor: c.bg, borderColor: c.border }]}>
      {icon}
      <Text style={[chip.text, { color: c.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** The one next step on a row, like "Collect ₹300" on the hub board. */
export function ActionPill({
  label,
  onPress,
  tone = 'teal',
  icon,
}: {
  label: string;
  onPress: () => void;
  tone?: 'teal' | 'amber' | 'soft';
  icon?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        pill.box,
        tone === 'amber' ? pill.amber : tone === 'soft' ? pill.soft : pill.teal,
        pressed && pill.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {icon}
      <Text style={[pill.text, tone === 'soft' && pill.textSoft]}>{label}</Text>
    </Pressable>
  );
}

/** A full-width white row with hairlines, the same shape as a job on the hub board. */
export function PanelRow({
  leading,
  title,
  meta,
  status,
  right,
  footer,
  first,
  muted,
  onPress,
  accessibilityLabel,
}: {
  leading: React.ReactNode;
  title: string;
  meta?: string | null;
  /** A coloured dot + short state ("Washing · since 7:12 am"). */
  status?: { label: string; color: string; extra?: string | null } | null;
  right?: React.ReactNode;
  footer?: React.ReactNode;
  first?: boolean;
  muted?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      android_ripple={onPress ? { color: TEAL_MIST } : undefined}
      style={({ pressed }) => [row.box, first && row.first, pressed && onPress && row.pressed]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      {leading}
      <View style={row.body}>
        <View style={row.top}>
          <Text style={[row.title, muted && row.muted]} numberOfLines={1}>
            {title}
          </Text>
          {right}
        </View>
        {meta ? (
          <Text style={row.meta} numberOfLines={2}>
            {meta}
          </Text>
        ) : null}
        {status ? (
          <View style={row.statusLine}>
            <View style={[row.dot, { backgroundColor: status.color }]} />
            <Text style={[row.status, { color: status.color }]}>{status.label}</Text>
            {status.extra ? (
              <Text style={row.subtle} numberOfLines={1}>
                {`  ·  ${status.extra}`}
              </Text>
            ) : null}
          </View>
        ) : null}
        {footer ? <View style={row.footer}>{footer}</View> : null}
      </View>
    </Pressable>
  );
}

/** A quiet one-line row for "nothing here" moments inside a section. */
export function QuietRow({ title, body, first }: { title: string; body?: string; first?: boolean }) {
  return (
    <View style={[row.box, row.quiet, first && row.first]}>
      <View style={row.body}>
        <Text style={row.quietTitle}>{title}</Text>
        {body ? <Text style={row.meta}>{body}</Text> : null}
      </View>
    </View>
  );
}

const ring = StyleSheet.create({
  done: { backgroundColor: TEAL_MID, alignItems: 'center', justifyContent: 'center' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  value: { ...typography.label, fontSize: 13, fontWeight: '800', color: colors.waterInk },
  of: { fontSize: 10.5, fontWeight: '700', color: colors.slate },
});

const tile = StyleSheet.create({
  box: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  text: { ...typography.label, fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
});

const chip = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  text: { ...typography.caption, fontSize: 11, fontWeight: '700', letterSpacing: 0, flexShrink: 1 },
});

const pill = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md - 4,
    minHeight: 34,
    borderRadius: radius.pill,
  },
  teal: { backgroundColor: TEAL_MID, ...shadow('sm') },
  amber: { backgroundColor: colors.amber, ...shadow('sm') },
  soft: { backgroundColor: TEAL_MIST, borderWidth: 1, borderColor: '#A7F3D0' },
  pressed: { opacity: 0.78 },
  text: { ...typography.label, fontSize: 13, color: colors.white, fontWeight: '700' },
  textSoft: { color: TEAL },
});

const row = StyleSheet.create({
  box: {
    flexDirection: 'row',
    gap: spacing.sm + 4,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  first: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.surface },
  body: { flex: 1, gap: 3, minWidth: 0, justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.heading, fontSize: 16.5, letterSpacing: -0.2, color: colors.waterInk, flex: 1 },
  muted: { color: colors.slateDeep },
  meta: { ...typography.body, fontSize: 13.5, lineHeight: 18, color: colors.slateDeep },
  statusLine: { flexDirection: 'row', alignItems: 'center', marginTop: 2, minWidth: 0 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  status: { ...typography.caption, fontSize: 12, fontWeight: '700', letterSpacing: 0 },
  subtle: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0, flexShrink: 1 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  quiet: { paddingVertical: spacing.md },
  quietTitle: { ...typography.bodyStrong, fontSize: 15, color: colors.slateDeep },
});
