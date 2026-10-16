import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Circle, Defs, G, Path, RadialGradient, Stop } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import type { InferResponseType } from 'hono/client';
import {
  BottomSheet,
  BRAND_MARK,
  Button,
  FieldLabel,
  FieldMessage,
  TextField,
  brandGradients,
  colors,
  radius,
  shadow,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { BP_PER_PERCENT } from '@mana/domain';
import { api, apiErrorMessage, type ApiResponse } from '../../api/client';
import { NetworkError } from '../../api/network';

export type Catalog = InferResponseType<(typeof api)['business']['catalog']['$get'], 200>;
export type CatalogService = Catalog['services'][number];
export type CatalogClass = Catalog['classes'][number];

export const CARD_SHADOW = {
  shadowColor: '#0C1442',
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

export const HERO_ALERT = ['#F59E0B', '#D97706', '#92400E'] as const;
export const HERO_TEAL = ['#0F766E', '#0B4F4A', '#062B28'] as const;

export function failure(e: unknown): string {
  return e instanceof NetworkError ? 'This needs a connection. Check your internet and try again.' : 'Something went wrong.';
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Brand or alert hero used across Business catalog screens. */
export function CatalogHero({
  eyebrow,
  title,
  meta,
  chips,
  alert,
  right,
}: {
  eyebrow: string;
  title: string;
  meta: string;
  chips?: { label: string; value: string | number }[];
  alert?: boolean;
  right?: React.ReactNode;
}) {
  const g = brandGradients.hero;
  const heroColors = (alert ? HERO_ALERT : (g.colors as readonly string[])) as unknown as string[];
  return (
    <View style={heroStyles.wrap}>
      <LinearGradient
        colors={heroColors}
        locations={alert ? undefined : (g.locations as unknown as number[])}
        start={g.start}
        end={g.end}
        style={[heroStyles.stage, shadow('md')]}
      >
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 390 220">
          <Defs>
            <RadialGradient id="glow" cx="78%" cy="18%" r="50%">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.2" />
              <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx="310" cy="40" r="110" fill="url(#glow)" />
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
        <Text style={heroStyles.meta} numberOfLines={2}>
          {meta}
        </Text>
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
      </LinearGradient>
    </View>
  );
}

/** White rounded band of rows. */
export function Band({ children }: { children: React.ReactNode }) {
  return <View style={bandStyles.band}>{children}</View>;
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
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  last?: boolean;
  muted?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      android_ripple={onPress ? { color: colors.waterPale } : undefined}
      style={({ pressed }) => [
        bandStyles.row,
        !last && bandStyles.divider,
        pressed && onPress && bandStyles.pressed,
        muted && bandStyles.muted,
      ]}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <View style={[bandStyles.icon, { backgroundColor: iconBg }]}>{icon}</View>
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
    </Pressable>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <Text style={bandStyles.section}>{children}</Text>;
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
    fontSize: 30,
    color: colors.white,
    letterSpacing: -0.7,
    lineHeight: 34,
  },
  meta: { ...typography.label, fontSize: 13.5, color: 'rgba(255,255,255,0.88)', lineHeight: 18 },
  chips: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm + 2 },
  chip: {
    flex: 1,
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
  chipValue: { ...typography.bodyStrong, fontSize: 17, color: colors.white, fontWeight: '800' },
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
  section: {
    ...typography.heading,
    fontSize: 16,
    color: colors.ink,
    letterSpacing: -0.2,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },
});

/**
 * The business catalog for an admin screen: loaded whenever the screen comes into view, and
 * `run` sends a change and reloads, so every screen shows what the server now holds.
 */
export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.business.catalog.$get();
      if (!res.ok) {
        setError(
          res.status === 403
            ? 'Only business admins can change the business price list.'
            : await apiErrorMessage(res, 'Couldn’t load the business price list.'),
        );
        return;
      }
      setCatalog(await res.json());
      setError(null);
    } catch (e) {
      setError(failure(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /** Sends a change; resolves with an error message, or null once saved and reloaded. */
  const run = useCallback(
    async (call: () => Promise<ApiResponse>, done?: string): Promise<string | null> => {
      try {
        const res = await call();
        if (!res.ok) return apiErrorMessage(res, 'Couldn’t save that.');
        await load();
        if (done) showToast(done, 'success');
        return null;
      } catch (e) {
        return failure(e);
      }
    },
    [load],
  );

  return { catalog, error, load, run };
}

/** "15" for 1500 basis points, "-7.5" for -750. */
export const bpToText = (bp: number) => String(bp / BP_PER_PERCENT);
/** A typed percentage → basis points; null when it isn't a number. */
export function textToBp(text: string): number | null {
  const t = text.trim();
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * BP_PER_PERCENT) : null;
}
export const formatPercent = (bp: number) => `${bp > 0 ? '+' : ''}${bp / BP_PER_PERCENT}%`;
export const paiseToText = (paise: number | null | undefined) => (paise == null ? '' : String(paise / 100));

/** Pick any number of options; at least `min` stay picked. */
export function ToggleChips<T extends string>({
  label,
  options,
  value,
  onChange,
  min = 0,
  error,
  hint,
}: {
  label?: string;
  options: readonly { value: T; label: string }[];
  value: readonly T[];
  onChange: (next: T[]) => void;
  min?: number;
  error?: string | null;
  hint?: string;
}) {
  const toggle = (v: T) => {
    const on = value.includes(v);
    if (on && value.length <= min) return;
    onChange(on ? value.filter((x) => x !== v) : [...value, v]);
  };
  return (
    <View style={styles.group}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <View style={styles.chips}>
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <Pressable
              key={o.value}
              onPress={() => toggle(o.value)}
              style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <FieldMessage error={error} hint={hint} />
    </View>
  );
}

/** Renames one thing: a text field, Save, and the server's answer under it. */
export function NameSheet({
  visible,
  title,
  label,
  initial,
  maxLength,
  onClose,
  onSave,
}: {
  visible: boolean;
  title: string;
  label: string;
  initial: string;
  maxLength: number;
  onClose: () => void;
  onSave: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible) return;
    setName(initial);
    setError(null);
    setBusy(false);
  }, [visible, initial]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError('Enter a name.');
    setBusy(true);
    const message = await onSave(trimmed);
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={title}
      footer={<Button label="Save" size="lg" loading={busy} onPress={() => void save()} />}
    >
      <TextField
        label={label}
        value={name}
        onChangeText={(t) => {
          setName(t);
          if (error) setError(null);
        }}
        maxLength={maxLength}
        autoFocus
        autoCapitalize="words"
        error={error}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  group: { gap: 7 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  chipOn: { backgroundColor: colors.waterDeep, borderColor: colors.waterDeep },
  chipText: { fontSize: 14.5, fontWeight: '600', color: colors.slateDeep },
  chipTextOn: { color: colors.white },
  pressed: { opacity: 0.7 },
});
