import React, { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { formatPhone } from '../format';
import { brandGradients, colors, radius, spacing, typography } from '../theme';
import { Gradient } from './Gradient';
import { IconMinus, IconPlus } from './Icons';

/** Small uppercase caption above a field or a group of choices. */
export function FieldLabel({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

/** Error in red, else a grey hint, under a field. Keeps its height so the layout doesn't jump. */
export function FieldMessage({ error, hint }: { error?: string | null; hint?: string }) {
  if (error) return <Text style={styles.error}>{error}</Text>;
  return hint ? <Text style={styles.hint}>{hint}</Text> : null;
}

interface PhoneFieldProps {
  /** Up to 10 digits, no spaces. */
  digits: string;
  onChangeDigits: (digits: string) => void;
  /** Turns raw typed text into digits (normalizePhone in @mana/domain strips +91, 0, spaces). */
  normalize: (text: string) => string;
  label?: string;
  error?: string | null;
  hint?: string;
  autoFocus?: boolean;
  editable?: boolean;
  onSubmit?: () => void;
}

/** "+91 | 98765 43210" — the one mobile number box both apps sign in with. */
export function PhoneField({
  digits,
  onChangeDigits,
  normalize,
  label = 'Mobile number',
  error,
  hint,
  autoFocus,
  editable = true,
  onSubmit,
}: PhoneFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.group}>
      <FieldLabel>{label}</FieldLabel>
      <View style={[styles.ring, focused && styles.ringOn]}>
      <View style={[styles.phoneBox, focused && styles.focused, error ? styles.errorBorder : null]}>
        <Text style={styles.countryCode}>+91</Text>
        <View style={styles.phoneDivider} />
        <TextInput
          style={styles.phoneInput}
          keyboardType="phone-pad"
          placeholder="98765 43210"
          placeholderTextColor={colors.slate}
          value={formatPhone(digits)}
          onChangeText={(t) => onChangeDigits(normalize(t).slice(0, 10))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          maxLength={11}
          autoFocus={autoFocus}
          editable={editable}
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          disableFullscreenUI
          accessibilityLabel={label}
        />
      </View>
      </View>
      <FieldMessage error={error} hint={hint} />
    </View>
  );
}

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string | null;
  hint?: string;
  /** Marks a field the form can go without. */
  optional?: boolean;
}

/** Labelled single- or multi-line text box with focus and error states. */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, optional, multiline, onFocus, onBlur, ...input },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.group}>
      <FieldLabel>{optional ? `${label} (optional)` : label}</FieldLabel>
      <View style={[styles.ring, focused && styles.ringOn]}>
      <TextInput
        ref={ref}
        style={[
          styles.textBox,
          multiline && styles.multiline,
          focused && styles.focused,
          error ? styles.errorBorder : null,
        ]}
        placeholderTextColor={colors.slate}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        disableFullscreenUI
        accessibilityLabel={label}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...input}
      />
      </View>
      <FieldMessage error={error} hint={hint} />
    </View>
  );
});

interface ChoiceChipsProps<T extends string> {
  label?: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string | null;
}

/** One answer from a few, as wrapping pills. */
export function ChoiceChips<T extends string>({ label, options, value, onChange, error }: ChoiceChipsProps<T>) {
  return (
    <View style={styles.group}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <View style={styles.chips} accessibilityRole="radiogroup">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.chipPressed]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              {selected ? <Gradient spec={brandGradients.primary} style={StyleSheet.absoluteFill} /> : null}
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <FieldMessage error={error} />
    </View>
  );
}

interface CounterProps {
  label: string;
  icon?: React.ReactNode;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max: number;
}

/** A row with − value + for small counts (cars, bikes). */
export function Counter({ label, icon, value, onChange, min = 0, max }: CounterProps) {
  const step = (by: number) => onChange(Math.min(max, Math.max(min, value + by)));
  return (
    <View style={styles.counter}>
      {icon ? <View style={styles.counterIcon}>{icon}</View> : null}
      <Text style={styles.counterLabel}>{label}</Text>
      <Pressable
        onPress={() => step(-1)}
        disabled={value <= min}
        hitSlop={6}
        style={({ pressed }) => [styles.counterButton, value <= min && styles.counterDisabled, pressed && styles.chipPressed]}
        accessibilityRole="button"
        accessibilityLabel={`Fewer ${label.toLowerCase()}`}
      >
        <IconMinus size={18} color={colors.waterDeep} />
      </Pressable>
      <Text style={styles.counterValue} accessibilityLabel={`${value} ${label.toLowerCase()}`}>
        {value}
      </Text>
      <Pressable
        onPress={() => step(1)}
        disabled={value >= max}
        hitSlop={6}
        style={({ pressed }) => [styles.counterButton, value >= max && styles.counterDisabled, pressed && styles.chipPressed]}
        accessibilityRole="button"
        accessibilityLabel={`More ${label.toLowerCase()}`}
      >
        <IconPlus size={18} color={colors.waterDeep} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 7 },
  // A soft indigo halo around the focused field.
  ring: { borderRadius: 17 },
  ringOn: { backgroundColor: 'rgba(84,104,212,0.14)', padding: 3, margin: -3 },
  label: {
    fontSize: 12,
    color: colors.slateDeep,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  hint: { ...typography.caption, color: colors.slate, letterSpacing: 0, lineHeight: 17 },
  error: { ...typography.label, color: colors.danger, lineHeight: 19 },
  focused: { borderColor: colors.indigo, backgroundColor: colors.white },
  errorBorder: { borderColor: '#FCA5A5', backgroundColor: '#FFF8F8' },
  phoneBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 62,
    borderWidth: 1.5,
    borderColor: '#DDE3FA',
    borderRadius: 14,
    backgroundColor: '#F7F8FF',
    paddingHorizontal: spacing.md,
  },
  countryCode: { ...typography.heading, color: colors.waterInk, fontSize: 20 },
  phoneDivider: { width: 1, height: 26, backgroundColor: colors.border, marginHorizontal: spacing.sm + 4 },
  phoneInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    color: colors.waterInk,
    letterSpacing: 1,
    paddingVertical: 0,
  },
  textBox: {
    minHeight: 54,
    borderWidth: 1.5,
    borderColor: '#DDE3FA',
    borderRadius: 14,
    backgroundColor: '#F7F8FF',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 16.5,
    color: colors.ink,
  },
  multiline: { minHeight: 112, paddingTop: 14, lineHeight: 23 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: '#DDE3FA',
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  chipSelected: {
    borderColor: 'transparent',
    backgroundColor: colors.indigo,
  },
  chipPressed: { opacity: 0.7 },
  chipText: { fontSize: 14.5, fontWeight: '600', color: colors.slateDeep },
  chipTextSelected: { color: colors.white },
  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingVertical: spacing.sm,
  },
  counterIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterLabel: { ...typography.bodyStrong, color: colors.waterInk, flex: 1 },
  counterButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterDisabled: { opacity: 0.35 },
  counterValue: { ...typography.heading, color: colors.waterInk, minWidth: 28, textAlign: 'center' },
});
