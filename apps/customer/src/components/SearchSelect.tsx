import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  BottomSheet,
  Button,
  FieldLabel,
  FieldMessage,
  IconCheck,
  IconChevronDown,
  IconEdit,
  IconSearch,
  colors,
} from '@mana/ui';

interface SearchSelectProps {
  label: string;
  required?: boolean;
  placeholder: string;
  /** What the list is of, for the sheet's title and search box: "make", "model". */
  noun: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  /** Drawn beside each option and the picked value, e.g. the make's logo. */
  renderIcon?: (option: string) => React.ReactNode;
  /** Shown instead of opening the sheet, e.g. "Pick the make first". */
  disabledHint?: string;
  maxLength: number;
  error?: string;
}

/** A field that opens a searchable list, ending in "Other" for anything that isn't listed. */
export function SearchSelect({
  label,
  required,
  placeholder,
  noun,
  options,
  value,
  onChange,
  renderIcon,
  disabledHint,
  maxLength,
  error,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [other, setOther] = useState(false);
  const [typed, setTyped] = useState('');
  const disabled = Boolean(disabledHint);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return options;
    const starts = options.filter((o) => o.toLowerCase().startsWith(q));
    const contains = options.filter(
      (o) => !o.toLowerCase().startsWith(q) && o.toLowerCase().includes(q),
    );
    return [...starts, ...contains];
  }, [options, q]);
  const exact = options.some((o) => o.toLowerCase() === q);
  const isListed = (v: string) => options.some((o) => o.toLowerCase() === v.toLowerCase());

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  const show = () => {
    setQuery('');
    const custom = Boolean(value) && !isListed(value);
    setTyped(custom ? value : '');
    setOther(options.length === 0 || custom);
    setOpen(true);
  };
  const startOther = () => {
    setTyped(query.trim());
    setOther(true);
  };
  const useTyped = () => {
    if (typed.trim()) pick(typed.trim());
  };

  return (
    <View style={styles.group}>
      <FieldLabel required={required}>{label}</FieldLabel>
      <Pressable
        onPress={show}
        disabled={disabled}
        style={({ pressed }) => [
          styles.box,
          Boolean(error) && styles.boxError,
          disabled && styles.boxDisabled,
          pressed && styles.boxPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}: ${value}` : label}
        accessibilityHint={disabledHint}
      >
        {value && renderIcon ? renderIcon(value) : null}
        <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <IconChevronDown size={18} color={disabled ? colors.slate : colors.indigoMid} />
      </Pressable>
      <FieldMessage error={error} hint={disabledHint} />

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={other ? `Type the ${noun}` : `Pick the ${noun}`}
        footer={
          other ? (
            <View style={styles.footer}>
              <Button label={`Use this ${noun}`} onPress={useTyped} disabled={!typed.trim()} />
              {options.length > 0 ? (
                <Button
                  label="Back to the list"
                  variant="secondary"
                  onPress={() => setOther(false)}
                />
              ) : null}
            </View>
          ) : value ? (
            <Button label={`Clear the ${noun}`} variant="secondary" onPress={() => pick('')} />
          ) : undefined
        }
      >
        {other ? (
          <View style={styles.otherBody}>
            <Text style={styles.otherHint}>
              {options.length === 0
                ? `We don’t have a list for this one. Type the ${noun} as it’s written on the vehicle.`
                : `Not in our list? Type the ${noun} as it’s written on the vehicle.`}
            </Text>
            <View style={styles.search}>
              <IconEdit size={18} color={colors.slate} />
              <TextInput
                style={styles.searchInput}
                value={typed}
                onChangeText={setTyped}
                placeholder={`The ${noun}`}
                placeholderTextColor={colors.slate}
                autoCapitalize="words"
                autoCorrect={false}
                autoFocus
                maxLength={maxLength}
                returnKeyType="done"
                onSubmitEditing={useTyped}
                disableFullscreenUI
                accessibilityLabel={`Type the ${noun}`}
              />
            </View>
          </View>
        ) : (
          <>
            <View style={styles.search}>
              <IconSearch size={18} color={colors.slate} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder={`Search the ${noun}`}
                placeholderTextColor={colors.slate}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={maxLength}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (matches.length === 1) pick(matches[0]!);
                  else if (q && !exact) pick(query.trim());
                }}
                disableFullscreenUI
                accessibilityLabel={`Search the ${noun}`}
              />
            </View>
            <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {q && !exact ? (
                <Row label={`Use “${query.trim()}”`} strong onPress={() => pick(query.trim())} />
              ) : null}
              {matches.map((o) => (
                <Row
                  key={o}
                  label={o}
                  icon={renderIcon?.(o)}
                  selected={o === value}
                  onPress={() => pick(o)}
                />
              ))}
              <Row
                label="Other"
                detail={`${noun[0]!.toUpperCase()}${noun.slice(1)} not in the list`}
                icon={
                  <View style={styles.otherIcon}>
                    <IconEdit size={16} color={colors.indigoMid} />
                  </View>
                }
                selected={Boolean(value) && !isListed(value)}
                onPress={startOther}
              />
            </ScrollView>
          </>
        )}
      </BottomSheet>
    </View>
  );
}

function Row({
  label,
  detail,
  icon,
  selected,
  strong,
  onPress,
}: {
  label: string;
  detail?: string;
  icon?: React.ReactNode;
  selected?: boolean;
  strong?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.indigoPale }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      {icon}
      <View style={styles.rowTextWrap}>
        <Text style={[styles.rowText, (selected || strong) && styles.rowTextOn]} numberOfLines={1}>
          {label}
        </Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      {selected ? <IconCheck size={16} color={colors.indigoMid} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { gap: 7 },
  box: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: '#DDE3FA',
    borderRadius: 14,
    backgroundColor: '#F7F8FF',
    paddingHorizontal: 14,
  },
  boxError: { borderColor: colors.danger },
  boxDisabled: { opacity: 0.6 },
  boxPressed: { borderColor: colors.indigo, backgroundColor: colors.white },
  value: { flex: 1, fontSize: 16.5, color: colors.ink },
  placeholder: { color: colors.slate },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 50,
    borderWidth: 1.5,
    borderColor: '#DDE3FA',
    borderRadius: 14,
    backgroundColor: '#F7F8FF',
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.ink, paddingVertical: 0 },
  // A fixed height keeps the sheet above the keyboard while typing.
  list: { maxHeight: 320 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surface },
  rowTextWrap: { flex: 1 },
  rowText: { fontSize: 16, color: colors.ink },
  rowTextOn: { color: colors.indigoMid, fontWeight: '800' },
  rowDetail: { marginTop: 1, fontSize: 13, color: colors.slate },
  otherIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.indigoPale,
  },
  otherBody: { gap: 12 },
  otherHint: { fontSize: 14.5, lineHeight: 21, color: colors.slateDeep },
  footer: { gap: 10 },
});
