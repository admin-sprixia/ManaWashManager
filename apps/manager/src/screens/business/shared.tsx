import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { InferResponseType } from 'hono/client';
import { BottomSheet, Button, FieldLabel, FieldMessage, TextField, colors, radius, showToast, spacing } from '@mana/ui';
import { BP_PER_PERCENT } from '@mana/domain';
import { api, apiErrorMessage, type ApiResponse } from '../../api/client';
import { NetworkError } from '../../api/network';

export type Catalog = InferResponseType<(typeof api)['business']['catalog']['$get'], 200>;
export type CatalogService = Catalog['services'][number];
export type CatalogClass = Catalog['classes'][number];

export function failure(e: unknown): string {
  return e instanceof NetworkError ? 'This needs a connection. Check your internet and try again.' : 'Something went wrong.';
}

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
