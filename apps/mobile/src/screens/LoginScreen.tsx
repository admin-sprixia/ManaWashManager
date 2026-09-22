import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { colors, spacing, typography } from '../theme';
import { api } from '../api/client';
import { setSessionToken, setSessionUser } from '../api/session';

interface LoginScreenProps {
  onLoggedIn: () => void;
}

type Step = 'phone' | 'code';

export function LoginScreen({ onLoggedIn }: LoginScreenProps) {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendOtp = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await api.auth.otp.send.$post({ json: { phone } });
      if (!res.ok) throw new Error('Could not send code. Check the number and try again.');
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await api.auth.otp.verify.$post({ json: { phone, code } });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        const message =
          body?.error === 'no_account'
            ? `No account found for ${phone}. Check the number, or ask the owner to add you.`
            : body?.error === 'invalid_otp'
              ? 'Incorrect code — check the code and try again.'
              : `Something went wrong (${res.status}).`;
        throw new Error(message);
      }
      const body = await res.json();
      await setSessionToken(body.token);
      await setSessionUser(body.user);
      onLoggedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text style={styles.title}>MANA</Text>
        <Text style={styles.subtitle}>Wash Manager</Text>
      </View>

      {step === 'phone' ? (
        <View style={styles.form}>
          <Text style={styles.label}>Phone number</Text>
          <TextInput
            style={styles.input}
            keyboardType="phone-pad"
            placeholder="98765 43210"
            placeholderTextColor={colors.waterLight}
            value={phone}
            onChangeText={setPhone}
            autoFocus
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Button label="Send code" onPress={sendOtp} loading={loading} disabled={phone.length < 10} />
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.label}>Enter the 6-digit code sent to {phone}</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            placeholder="000000"
            placeholderTextColor={colors.waterLight}
            value={code}
            onChangeText={setCode}
            maxLength={6}
            autoFocus
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Button label="Verify & sign in" onPress={verifyOtp} loading={loading} disabled={code.length !== 6} />
          <Button label="Use a different number" variant="secondary" onPress={() => setStep('phone')} />
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    marginTop: spacing.xl * 2,
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.title,
    fontSize: 40,
    color: colors.water,
    letterSpacing: 2,
  },
  subtitle: {
    ...typography.body,
    color: colors.waterInk,
  },
  form: {
    gap: spacing.md,
  },
  label: {
    ...typography.label,
    color: colors.waterInk,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 18,
    color: colors.waterInk,
    backgroundColor: colors.offWhite,
  },
  error: {
    color: colors.danger,
    ...typography.label,
  },
});
