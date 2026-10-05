import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatPhone } from '../format';
import { colors, radius, spacing, typography } from '../theme';
import { Button } from './Button';

interface CodeEntryProps {
  phone: string;
  /** Digits in a code (LOGIN_CODE_LENGTH in @mana/domain). */
  codeLength: number;
  /** How long a code works (LOGIN_CODE_TTL_MINUTES in @mana/domain). */
  validMinutes: number;
  value: string;
  onChange: (code: string) => void;
  /** Called once all digits are in. */
  onComplete: (code: string) => void;
  loading: boolean;
  sending: boolean;
  error: string | null;
  resendIn: number;
  onResend: () => void;
}

/** The WhatsApp code step: one big box that checks itself once the last digit is typed. */
export function CodeEntry({
  phone,
  codeLength,
  validMinutes,
  value,
  onChange,
  onComplete,
  loading,
  sending,
  error,
  resendIn,
  onResend,
}: CodeEntryProps) {
  return (
    <>
      <Text style={styles.title}>Enter the WhatsApp code</Text>
      <Text style={styles.subtitle}>
        Sent to +91 {formatPhone(phone)}. It works for {validMinutes} minutes.
      </Text>
      <TextInput
        style={[styles.otpInput, error ? styles.fieldError : null]}
        value={value}
        onChangeText={(t) => {
          const next = t.replace(/\D/g, '').slice(0, codeLength);
          onChange(next);
          if (next.length === codeLength) onComplete(next);
        }}
        placeholder={'•'.repeat(codeLength)}
        placeholderTextColor={colors.border}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={codeLength}
        autoFocus
        editable={!loading}
        accessibilityLabel="WhatsApp code"
      />
      <View style={styles.status}>
        {loading ? (
          <ActivityIndicator color={colors.water} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <Text style={styles.helper}>
            Checks automatically once all {codeLength} digits are in.
          </Text>
        )}
      </View>
      <Button
        label={resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
        variant="secondary"
        onPress={onResend}
        loading={sending}
        disabled={resendIn > 0 || loading}
      />
    </>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.waterInk },
  subtitle: { ...typography.body, color: colors.slateDeep, fontSize: 15, marginBottom: spacing.sm },
  otpInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    fontSize: 30,
    fontWeight: '700',
    color: colors.waterInk,
    letterSpacing: 12,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  fieldError: { borderColor: '#FCA5A5' },
  status: { minHeight: 40, justifyContent: 'center', marginTop: spacing.sm },
  helper: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  error: { ...typography.label, color: colors.danger, textTransform: 'none', lineHeight: 19 },
});
