import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { checkPin, isSeniorRole, pinProblemMessage, SENIOR_PIN_DIGITS } from '@mana/domain';
import {
  GradientHero,
  Button,
  IconAlert,
  IconLock,
  colors,
  radius,
  shadow,
  spacing,
  typography,
} from '@mana/ui';
import { PinPad } from '../components/PinPad';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';

/**
 * Shown to anyone signed in without a PIN (right after a reset), and to an owner or manager
 * still on a PIN shorter than 6 digits. PINs are the only way back in, so nothing else in the
 * app opens until one is set.
 */
export function CreatePinScreen() {
  const { user, signIn, signOut, signInNotice, setSignInNotice } = useAuth();
  const upgrading = Boolean(user?.hasPin && user.pinUpgradeRequired);
  const senior = user ? isSeniorRole(user.role) || upgrading : false;
  const minDigits = senior ? SENIOR_PIN_DIGITS : 4;
  const [step, setStep] = useState<'current' | 'choose' | 'confirm'>(upgrading ? 'current' : 'choose');
  const [currentPin, setCurrentPin] = useState('');
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
    if (busy) return;
    if (step === 'current') {
      if (pin.length < 4) return;
      setCurrentPin(pin);
      setValue('');
      setError(null);
      setStep('choose');
      return;
    }
    if (pin.length < minDigits) return;
    if (step === 'choose') {
      const problem = checkPin(pin, senior);
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
      const res = await api.auth.pin.$put({ json: upgrading ? { pin, currentPin } : { pin } });
      if (!res.ok) {
        setBusy(false);
        setValue('');
        setFirst('');
        // A wrong current PIN means starting over from it; anything else, from choosing.
        setStep(res.status === 401 && upgrading ? 'current' : 'choose');
        return fail(await apiErrorMessage(res, 'Couldn’t save the PIN.'));
      }
      const session = await res.json();
      if ('token' in session) {
        setSignInNotice(null);
        await signIn(session.token, session.user);
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
    if (pin.length === SENIOR_PIN_DIGITS) void next(pin);
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll} bounces={false} keyboardShouldPersistTaps="handled">
      <GradientHero height={170}>
        <View style={styles.heroContent}>
          <View style={styles.badge}>
            <IconLock size={22} color={colors.white} />
          </View>
          <Text style={styles.heroTitle}>{upgrading ? 'New 6-digit PIN' : 'Create your PIN'}</Text>
        </View>
      </GradientHero>
      <View style={[styles.panel, shadow('md')]}>
        {signInNotice ? (
          <View style={styles.notice}>
            <IconAlert size={16} color={colors.amberDeep} />
            <Text style={styles.noticeText}>{signInNotice}</Text>
          </View>
        ) : null}
        <Text style={[styles.title, styles.center]}>
          {step === 'current'
            ? `Hi ${user?.name.split(' ')[0] ?? ''}, enter your current PIN`
            : step === 'choose'
              ? upgrading
                ? 'Now choose a new 6-digit PIN'
                : `Hi ${user?.name.split(' ')[0] ?? ''}, choose a PIN`
              : 'Enter it once more'}
        </Text>
        <Text style={[styles.subtitle, styles.center]}>
          {step === 'current'
            ? 'Owners and managers now use 6-digit PINs, because they can see and change more.'
            : step === 'choose'
              ? `You’ll use it every time you sign in. ${senior ? '6 digits.' : '4–6 digits.'}`
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
        {value.length >= (step === 'current' ? 4 : minDigits) && value.length < SENIOR_PIN_DIGITS && !busy ? (
          <Button label={step === 'confirm' ? 'Save PIN' : 'Next'} size="lg" onPress={() => void next()} />
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
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: colors.amberLight,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
  },
  noticeText: { ...typography.label, color: colors.amberDeep, flex: 1, textTransform: 'none' },
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
