import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  BottomSheet,
  Button,
  FieldLabel,
  IconCheck,
  IconChevronDown,
  IconSearch,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** A second line under the label ("Manager", "Monday"). */
  hint?: string;
  /** Options with the same group are listed under one heading ("Morning"). */
  group?: string;
  /** A picture before the label (a company's logo); also shown in the field once picked. */
  leading?: React.ReactNode;
}

interface BaseProps<T extends string> {
  label?: string;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  /** Sheet heading; defaults to the field label. */
  sheetTitle?: string;
  sheetSubtitle?: string;
  /** Shown in a tinted tile at the start of the field. */
  icon?: React.ReactNode;
  hint?: string;
  error?: string | null;
  /** Adds a search box to the list (worth it past ~8 options). */
  searchable?: boolean;
  /** Tint for the selected state; defaults to the brand indigo. */
  accent?: string;
  /** Background of the icon tile. */
  accentPale?: string;
  disabled?: boolean;
}

function Trigger({
  label,
  text,
  placeholder,
  icon,
  hint,
  error,
  count,
  accent,
  accentPale,
  disabled,
  onPress,
}: {
  label?: string;
  text: string | null;
  placeholder: string;
  icon?: React.ReactNode;
  hint?: string;
  error?: string | null;
  count?: number;
  accent: string;
  accentPale: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.group}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [styles.trigger, error ? styles.triggerError : null, pressed && styles.pressed, disabled && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? 'Choose'}: ${text ?? placeholder}`}
      >
        {icon ? <View style={[styles.icon, { backgroundColor: accentPale }]}>{icon}</View> : null}
        <Text style={[styles.value, !text && styles.placeholder]} numberOfLines={2}>
          {text ?? placeholder}
        </Text>
        {count != null && count > 0 ? (
          <View style={[styles.count, { backgroundColor: accent }]}>
            <Text style={styles.countText}>{count}</Text>
          </View>
        ) : null}
        <View style={[styles.chevron, { backgroundColor: accentPale }]}>
          <IconChevronDown size={15} color={accent} />
        </View>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Groups options under their headings, keeping the given order, and applies the search. */
function useGrouped<T extends string>(options: readonly SelectOption<T>[], query: string) {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q)) : options;
    const groups: { title: string | null; items: SelectOption<T>[] }[] = [];
    for (const o of list) {
      const title = o.group ?? null;
      const last = groups[groups.length - 1];
      if (last && last.title === title) last.items.push(o);
      else groups.push({ title, items: [o] });
    }
    return groups;
  }, [options, query]);
}

function SearchBox({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  return (
    <View style={styles.search}>
      <IconSearch size={17} color={colors.slate} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChange}
        placeholder="Search"
        placeholderTextColor={colors.slate}
        autoCorrect={false}
        disableFullscreenUI
      />
    </View>
  );
}

function OptionList<T extends string>({
  groups,
  isOn,
  onPress,
  multiple,
  accent,
  isLocked,
  round,
}: {
  groups: { title: string | null; items: SelectOption<T>[] }[];
  isOn: (v: T) => boolean;
  onPress: (v: T) => void;
  multiple: boolean;
  accent: string;
  isLocked?: (v: T) => boolean;
  /** Round markers even when several can be picked. */
  round?: boolean;
}) {
  if (!groups.length) return <Text style={styles.empty}>Nothing matches.</Text>;
  return (
    <View style={styles.list}>
      {groups.map((g, gi) => (
        <View key={g.title ?? `g${gi}`}>
          {g.title ? <Text style={styles.groupTitle}>{g.title}</Text> : null}
          {g.items.map((o, i) => {
            const on = isOn(o.value);
            const locked = isLocked?.(o.value) ?? false;
            return (
              <Pressable
                key={o.value}
                onPress={() => onPress(o.value)}
                disabled={locked}
                style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, on && { backgroundColor: `${accent}12` }, pressed && styles.pressed, locked && styles.disabled]}
                accessibilityRole={multiple ? 'checkbox' : 'radio'}
                accessibilityState={multiple ? { checked: on } : { selected: on }}
              >
                {o.leading ?? null}
                <View style={styles.rowCopy}>
                  <Text style={[styles.rowLabel, on && { color: accent }]}>{o.label}</Text>
                  {o.hint ? <Text style={styles.rowHint}>{o.hint}</Text> : null}
                </View>
                {multiple && !round ? (
                  <View style={[styles.box, on && { backgroundColor: accent, borderColor: accent }]}>{on ? <IconCheck size={12} color={colors.white} /> : null}</View>
                ) : (
                  <View style={[styles.radio, on && { borderColor: accent }]}>{on ? <View style={[styles.radioDot, { backgroundColor: accent }]} /> : null}</View>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** Past this many options the list draws only the rows on screen (companies, models). */
const LONG_LIST = 30;

type FlatItem<T extends string> = { kind: 'title'; key: string; title: string } | { kind: 'option'; key: string; option: SelectOption<T> };

/** One tight list, drawn a screenful at a time: long lists open at once. */
function LongOptionList<T extends string>({
  groups,
  value,
  accent,
  onPress,
}: {
  groups: { title: string | null; items: SelectOption<T>[] }[];
  value: T | null;
  accent: string;
  onPress: (v: T) => void;
}) {
  const items = useMemo(() => {
    const out: FlatItem<T>[] = [];
    groups.forEach((g, gi) => {
      if (g.title) out.push({ kind: 'title', key: `t${gi}`, title: g.title });
      for (const o of g.items) out.push({ kind: 'option', key: o.value, option: o });
    });
    return out;
  }, [groups]);
  if (!items.length) return <Text style={styles.empty}>Nothing matches.</Text>;
  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.key}
      style={styles.longList}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={14}
      maxToRenderPerBatch={16}
      windowSize={7}
      removeClippedSubviews
      renderItem={({ item }) => {
        if (item.kind === 'title') return <Text style={styles.groupTitle}>{item.title}</Text>;
        const o = item.option;
        const on = o.value === value;
        return (
          <Pressable
            onPress={() => onPress(o.value)}
            style={({ pressed }) => [styles.compactRow, on && { backgroundColor: `${accent}12` }, pressed && styles.pressed]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            {o.leading ?? null}
            <View style={styles.rowCopy}>
              <Text style={[styles.compactLabel, on && { color: accent }]} numberOfLines={1}>
                {o.label}
              </Text>
              {o.hint ? (
                <Text style={styles.rowHint} numberOfLines={1}>
                  {o.hint}
                </Text>
              ) : null}
            </View>
            {on ? <IconCheck size={16} color={accent} /> : null}
          </Pressable>
        );
      }}
    />
  );
}

/** A dropdown: looks like a field, opens a list in a bottom sheet, closes on pick. */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose',
  sheetTitle,
  sheetSubtitle,
  icon,
  hint,
  error,
  searchable,
  accent = colors.indigo,
  accentPale = colors.indigoPale,
  disabled,
}: BaseProps<T> & { value: T | null; onChange: (v: T) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const groups = useGrouped(options, query);
  const selected = options.find((o) => o.value === value) ?? null;
  const long = options.length > LONG_LIST;
  const pick = (v: T) => {
    onChange(v);
    setOpen(false);
  };

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  return (
    <>
      <Trigger
        label={label}
        text={selected?.label ?? null}
        placeholder={placeholder}
        icon={selected?.leading ?? icon}
        hint={hint}
        error={error}
        accent={accent}
        accentPale={accentPale}
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={sheetTitle ?? label ?? 'Choose'}
        subtitle={sheetSubtitle}
        scroll={!long}
      >
        {searchable ? <SearchBox value={query} onChange={setQuery} /> : null}
        {long ? (
          <LongOptionList groups={groups} value={value} accent={accent} onPress={pick} />
        ) : (
          <OptionList groups={groups} multiple={false} accent={accent} isOn={(v) => v === value} onPress={pick} />
        )}
      </BottomSheet>
    </>
  );
}

/** A dropdown that picks several: ticks in a sheet, quick presets, confirmed with Done. */
export function MultiSelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose',
  sheetTitle,
  sheetSubtitle,
  icon,
  hint,
  error,
  searchable,
  accent = colors.indigo,
  accentPale = colors.indigoPale,
  disabled,
  min = 0,
  max,
  presets,
  summarize,
  round,
}: BaseProps<T> & {
  value: readonly T[];
  onChange: (v: T[]) => void;
  min?: number;
  max?: number;
  /** Round radio-style markers instead of tick boxes. */
  round?: boolean;
  /** One-tap picks above the list ("Weekdays", "Everyone"). */
  presets?: readonly { label: string; values: readonly T[] }[];
  /** How the field reads when closed; defaults to the labels joined. */
  summarize?: (picked: SelectOption<T>[]) => string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<T[]>([...value]);
  const [query, setQuery] = useState('');
  const groups = useGrouped(options, query);

  useEffect(() => {
    if (!open) return;
    setDraft([...value]);
    setQuery('');
    // Only when the sheet opens: edits stay in the draft until Done.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const picked = options.filter((o) => value.includes(o.value));
  const text = picked.length ? (summarize ? summarize(picked) : picked.map((o) => o.label).join(', ')) : null;
  const full = max != null && draft.length >= max;
  const same = (a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((v) => b.includes(v));

  const toggle = (v: T) =>
    setDraft((d) => {
      if (d.includes(v)) return d.length <= min ? d : d.filter((x) => x !== v);
      if (max != null && d.length >= max) return d;
      return [...d, v];
    });

  return (
    <>
      <Trigger
        label={label}
        text={text}
        placeholder={placeholder}
        icon={icon}
        hint={hint}
        error={error}
        count={picked.length > 1 ? picked.length : undefined}
        accent={accent}
        accentPale={accentPale}
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={sheetTitle ?? label ?? 'Choose'}
        subtitle={sheetSubtitle ?? (max != null ? `Pick up to ${max}` : min > 0 ? `Pick at least ${min}` : undefined)}
        footer={
          <Button
            label={draft.length ? `Done · ${draft.length} picked` : 'Done'}
            disabled={draft.length < min}
            onPress={() => {
              onChange(options.filter((o) => draft.includes(o.value)).map((o) => o.value));
              setOpen(false);
            }}
          />
        }
      >
        {presets?.length ? (
          <View style={styles.presets}>
            {presets.map((p) => {
              const on = same(draft, p.values);
              return (
                <Pressable
                  key={p.label}
                  onPress={() => setDraft([...p.values])}
                  style={({ pressed }) => [styles.preset, on && { backgroundColor: accent, borderColor: accent }, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.presetText, on && styles.presetTextOn]}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {searchable ? <SearchBox value={query} onChange={setQuery} /> : null}
        <OptionList
          groups={groups}
          multiple
          round={round}
          accent={accent}
          isOn={(v) => draft.includes(v)}
          isLocked={(v) => full && !draft.includes(v)}
          onPress={toggle}
        />
        {full ? <Text style={styles.hint}>That’s the most you can pick.</Text> : null}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  group: { gap: 6 },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    minHeight: 56,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  triggerError: { borderColor: colors.danger },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
  icon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  value: { ...typography.bodyStrong, fontSize: 15.5, fontWeight: '800', color: colors.waterInk, flex: 1 },
  placeholder: { color: colors.slate, fontWeight: '600' },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  countText: { color: colors.white, fontSize: 11.5, fontWeight: '800' },
  chevron: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  hint: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0, lineHeight: 17 },
  error: { ...typography.caption, fontSize: 12.5, color: colors.danger, fontWeight: '700', letterSpacing: 0 },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, paddingVertical: 10, ...typography.body, fontSize: 15, color: colors.waterInk },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  preset: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  presetText: { ...typography.label, fontSize: 13, fontWeight: '700', color: colors.slateDeep },
  presetTextOn: { color: colors.white },
  list: {
    marginHorizontal: -spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  groupTitle: {
    ...typography.label,
    fontSize: 11.5,
    fontWeight: '800',
    color: colors.slate,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 6,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 6,
    backgroundColor: colors.white,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  longList: {
    flexGrow: 0,
    flexShrink: 1,
    marginHorizontal: -spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    minHeight: 50,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  compactLabel: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  rowCopy: { flex: 1, gap: 1 },
  rowLabel: { ...typography.bodyStrong, fontSize: 15.5, color: colors.waterInk },
  rowHint: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  empty: { ...typography.body, color: colors.slate, textAlign: 'center', paddingVertical: spacing.lg },
});
