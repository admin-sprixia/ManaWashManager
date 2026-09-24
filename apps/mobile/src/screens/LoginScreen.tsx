import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { GradientHero } from '../components/GradientHero';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { colors, radius, spacing, typography } from '../theme';
import { api } from '../api/client';
import { setSessionToken, setSessionUser } from '../api/session';

interface LoginScreenProps {
  onLoggedIn: () => void | Promise<void>;
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
      await onLoggedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer noPadding edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <GradientHero height={300}>
            <View style={styles.heroContent}>
              <View style={styles.logoMark}>
                <Text style={styles.logoMarkText}>M</Text>
              </View>
              <Text style={styles.wordmark}>MANA</Text>
              <Text style={styles.tagline}>Wash Manager</Text>
            </View>
          </GradientHero>

          <View style={styles.cardWrap}>
            <Card elevation="lg" style={styles.formCard}>
              {step === 'phone' ? (
                <View style={styles.form}>
                  <Text style={styles.welcome}>Welcome back</Text>
                  <Text style={styles.subtitle}>Sign in with your phone number</Text>

                  <Text style={styles.label}>PHONE NUMBER</Text>
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
                  <View style={styles.spacer} />
                  <Button label="Send code" size="lg" onPress={sendOtp} loading={loading} disabled={phone.length < 10} />
                </View>
              ) : (
                <View style={styles.form}>
                  <Text style={styles.welcome}>Verify it's you</Text>
                  <Text style={styles.subtitle}>Enter the 6-digit code sent to {phone}</Text>

                  <Text style={styles.label}>VERIFICATION CODE</Text>
                  <TextInput
                    style={[styles.input, styles.codeInput]}
                    keyboardType="number-pad"
                    placeholder="000000"
                    placeholderTextColor={colors.waterLight}
                    value={code}
                    onChangeText={setCode}
                    maxLength={6}
                    autoFocus
                  />
                  {error && <Text style={styles.error}>{error}</Text>}
                  <View style={styles.spacer} />
                  <Button
                    label="Verify & sign in"
                    size="lg"
                    onPress={verifyOtp}
                    loading={loading}
                    disabled={code.length !== 6}
                  />
                  <View style={styles.smallSpacer} />
                  <Button label="Use a different number" variant="ghost" onPress={() => setStep('phone')} />
                </View>
              )}
            </Card>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
  },
  heroContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoMarkText: {
    ...typography.title,
    color: colors.white,
  },
  wordmark: {
    ...typography.display,
    color: colors.white,
    letterSpacing: 6,
  },
  tagline: {
    ...typography.body,
    color: 'rgba(255,255,255,0.85)',
    marginTop: spacing.xs,
  },
  cardWrap: {
    paddingHorizontal: spacing.md,
    marginTop: -56,
    flex: 1,
  },
  formCard: {
    padding: spacing.lg,
  },
  form: {
    gap: spacing.sm,
  },
  welcome: {
    ...typography.title,
    color: colors.waterInk,
  },
  subtitle: {
    ...typography.body,
    color: colors.slateDeep,
    marginBottom: spacing.sm,
  },
  label: {
    ...typography.label,
    color: colors.waterDeep,
    marginTop: spacing.sm,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 20,
    fontWeight: '600',
    color: colors.waterInk,
    backgroundColor: colors.surface,
  },
  codeInput: {
    letterSpacing: 8,
    textAlign: 'center',
  },
  spacer: {
    height: spacing.sm,
  },
  smallSpacer: {
    height: spacing.xs,
  },
  error: {
    color: colors.danger,
    ...typography.label,
    textTransform: 'none',
  },
});
