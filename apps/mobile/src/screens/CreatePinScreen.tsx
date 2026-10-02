import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { checkPin, pinProblemMessage } from '@mana/domain';
import { GradientHero } from '../components/GradientHero';
import { Button } from '../components/Button';
import { PinPad } from '../components/PinPad';
import { IconLock } from '../components/Icons';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';

/**
 * Shown to anyone signed in without a PIN — the owner right after using the recovery code.
 * PINs are the only way back in, so nothing else in the app opens until one is set.
 */
export function CreatePinScreen() {
  const { user, signIn, signOut } = useAuth();
  const [step, setStep] = useState<'choose' | 'confirm'>('choose');
  const [first, setFirst] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const fail = (message: string) => {
    setError(message);
    setErrorKey((k) => k + 1);
  };

  const next = async (pin = value) => {
    if (pin.length < 4 || busy) return;
    if (step === 'choose') {
      const problem = checkPin(pin);
      if (problem) {
        setValue('');
        return fail(pinProblemMessage(problem));
      }
      setFirst(pin);
      setValue('');
      setError(null);
      setStep('confirm');
      return;
    }
    if (pin !== first) {
      setValue('');
      setFirst('');
      setStep('choose');
      return fail('PINs didn’t match. Start again.');
    }
    setBusy(true);
    try {
      const res = await api.auth.pin.$put({ json: { pin } });
      if (!res.ok) {
        setBusy(false);
        setValue('');
        return fail(await apiErrorMessage(res, 'Couldn’t save the PIN.'));
      }
      const session = await res.json();
      if ('token' in session) {
        await signIn(session.token, { ...session.user, role: session.user.role === 'owner' ? 'owner' : 'staff' });
      }
    } catch (e) {
      setBusy(false);
      setValue('');
      fail(e instanceof NetworkError ? 'No connection. Try again when you’re online.' : 'Couldn’t save the PIN.');
    }
  };

  const onChange = (pin: string) => {
    setValue(pin);
    if (error) setError(null);
    if (pin.length === 6) void next(pin);
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} bounces={false} keyboardShouldPersistTaps="handled">
      <GradientHero height={170}>
        <View style={styles.heroContent}>
          <View style={styles.badge}>
            <IconLock size={22} color={colors.white} />
          </View>
          <Text style={styles.heroTitle}>Create your PIN</Text>
        </View>
      </GradientHero>
      <View style={[styles.panel, shadow('md')]}>
        <Text style={[styles.title, styles.center]}>
          {step === 'choose' ? `Hi ${user?.name.split(' ')[0] ?? ''}, choose a PIN` : 'Enter it once more'}
        </Text>
        <Text style={[styles.subtitle, styles.center]}>
          {step === 'choose'
            ? 'You’ll use it every time you sign in. 4–6 digits.'
            : 'Just to be sure you remember it.'}
        </Text>
        <View style={styles.pinWrap}>
          <PinPad value={value} onChange={onChange} errorKey={errorKey} disabled={busy} />
        </View>
        <View style={styles.status}>
          {busy ? (
            <ActivityIndicator color={colors.water} />
          ) : (
            <Text style={[styles.hint, error ? styles.error : null]}>
              {error ?? 'Avoid easy ones like 1234 or 0000.'}
            </Text>
          )}
        </View>
        {value.length >= 4 && value.length < 6 && !busy ? (
          <Button label={step === 'choose' ? 'Next' : 'Save PIN'} size="lg" onPress={() => void next()} />
        ) : null}
        <Pressable onPress={() => void signOut()} hitSlop={8} style={styles.signOut}>
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, backgroundColor: colors.surface },
  heroContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingBottom: spacing.lg },
  badge: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { ...typography.heading, color: colors.white },
  panel: {
    flex: 1,
    marginTop: -spacing.xl,
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  title: { ...typography.title, color: colors.waterInk },
  subtitle: { ...typography.body, color: colors.slateDeep, fontSize: 15 },
  center: { textAlign: 'center' },
  pinWrap: { marginTop: spacing.md },
  status: { minHeight: 40, justifyContent: 'center' },
  hint: { ...typography.caption, color: colors.slate, textAlign: 'center', letterSpacing: 0 },
  error: { color: colors.danger, fontWeight: '600' },
  signOut: { alignSelf: 'center', marginTop: spacing.md },
  link: { ...typography.label, color: colors.water, fontSize: 14 },
});
