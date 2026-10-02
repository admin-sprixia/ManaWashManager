import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { LOGIN_CODE_LENGTH, LOGIN_CODE_TTL_MINUTES } from '@mana/domain';
import { Button } from '../Button';
import { colors, radius, spacing, typography } from '../../theme';

interface CodeEntryProps {
  phone: string;
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

function formatPhone(digits: string): string {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

/** The WhatsApp code step: one big box that checks itself once the last digit is typed. */
export function CodeEntry({
  phone,
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
        Sent to +91 {formatPhone(phone)}. It works for {LOGIN_CODE_TTL_MINUTES} minutes.
      </Text>
      <TextInput
        style={[styles.otpInput, error ? styles.fieldError : null]}
        value={value}
        onChangeText={(t) => {
          const next = t.replace(/\D/g, '').slice(0, LOGIN_CODE_LENGTH);
          onChange(next);
          if (next.length === LOGIN_CODE_LENGTH) onComplete(next);
        }}
        placeholder={'•'.repeat(LOGIN_CODE_LENGTH)}
        placeholderTextColor={colors.border}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={LOGIN_CODE_LENGTH}
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
            Checks automatically once all {LOGIN_CODE_LENGTH} digits are in.
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
