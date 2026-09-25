import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { isValidPhone, normalizePhone } from '@mana/domain';
import { GradientHero } from '../components/GradientHero';
import { Button } from '../components/Button';
import { PinPad } from '../components/PinPad';
import { IconAlert, IconLock, IconPhone } from '../components/Icons';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { api } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { getLoginHints, setLoginHints, type LoginMethod, type SessionUser } from '../api/session';

type Step = 'phone' | 'code' | 'pin';

const RESEND_SECONDS = 30;

function formatPhone(digits: string): string {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

function lockMessage(lockedUntil?: string): string {
  if (!lockedUntil) return 'Too many wrong PINs. Try again later or use an SMS code.';
  const mins = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60_000));
  return `Too many wrong PINs. Try again in ${mins} min, or sign in with an SMS code.`;
}

export function LoginScreen() {
  const { signIn, sessionNotice } = useAuth();
  const [method, setMethod] = useState<LoginMethod>('otp');
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [pinErrorKey, setPinErrorKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [hintsLoaded, setHintsLoaded] = useState(false);
  const codeInput = useRef<TextInput>(null);

  // Shared shop phone: jump straight to the PIN pad for whoever signed in last.
  useEffect(() => {
    void getLoginHints().then((hints) => {
      if (hints.phone) {
        setPhone(hints.phone);
        setMethod(hints.method);
        if (hints.method === 'pin') setStep('pin');
      }
      setHintsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const digits = normalizePhone(phone);
  const phoneOk = isValidPhone(digits);

  const describeError = (e: unknown) =>
    e instanceof NetworkError
      ? 'No connection. Check mobile data or Wi-Fi and try again.'
      : e instanceof Error
        ? e.message
        : 'Something went wrong.';

  const accountError = (err?: string) =>
    err === 'no_account'
      ? `No team account for ${formatPhone(digits)}. Ask the owner to add you.`
      : err === 'account_disabled'
        ? 'This account has been turned off. Ask the owner to re-enable it.'
        : null;

  const complete = async (token: string, user: SessionUser, via: LoginMethod) => {
    await setLoginHints(digits, via);
    await signIn(token, user);
  };

  const switchMethod = (next: LoginMethod) => {
    if (next === method) return;
    setMethod(next);
    setError(null);
    setCode('');
    setPin('');
    setStep('phone');
  };

  const continueWithPhone = async () => {
    setError(null);
    if (method === 'pin') {
      setStep('pin');
      return;
    }
    setLoading(true);
    try {
      const res = await api.auth.otp.send.$post({ json: { phone: digits } });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(accountError(body?.error) ?? 'Couldn’t send the code. Try again.');
      }
      setCode('');
      setResendIn(RESEND_SECONDS);
      setStep('code');
      setTimeout(() => codeInput.current?.focus(), 250);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (value = code) => {
    if (value.length !== 6 || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await api.auth.otp.verify.$post({ json: { phone: digits, code: value } });
      const body = (await res.json().catch(() => null)) as
        | { token?: string; user?: SessionUser; error?: string }
        | null;
      if (!res.ok || !body?.token || !body.user) {
        setCode('');
        throw new Error(
          accountError(body?.error) ??
            (body?.error === 'invalid_otp' ? 'That code isn’t right. Check the SMS and try again.' : 'Couldn’t sign in.'),
        );
      }
      await complete(body.token, body.user, 'otp');
    } catch (e) {
      setError(describeError(e));
      setLoading(false);
    }
  };

  const verifyPin = async (value = pin) => {
    if (value.length < 4 || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await api.auth.pin.login.$post({ json: { phone: digits, pin: value } });
      const body = (await res.json().catch(() => null)) as
        | { token?: string; user?: SessionUser; error?: string; attemptsLeft?: number; lockedUntil?: string }
        | null;
      if (!res.ok || !body?.token || !body.user) {
        setPin('');
        setPinErrorKey((k) => k + 1);
        const known = accountError(body?.error);
        throw new Error(
          known ??
            (body?.error === 'pin_locked'
              ? lockMessage(body.lockedUntil)
              : body?.error === 'pin_not_set'
                ? 'No PIN set for this number yet. Sign in with an SMS code, then set a PIN from More → Account.'
                : body?.error === 'invalid_pin'
                  ? `Wrong PIN. ${body.attemptsLeft ?? 0} ${body.attemptsLeft === 1 ? 'try' : 'tries'} left.`
                  : 'Couldn’t sign in.'),
        );
      }
      await complete(body.token, body.user, 'pin');
    } catch (e) {
      setError(describeError(e));
      setLoading(false);
    }
  };

  const onPinChange = (value: string) => {
    setPin(value);
    if (error) setError(null);
    if (value.length === 6) void verifyPin(value);
  };

  const onCodeChange = (value: string) => {
    const clean = value.replace(/\D/g, '').slice(0, 6);
    setCode(clean);
    if (error) setError(null);
    if (clean.length === 6) void verifyCode(clean);
  };

  const changeNumber = () => {
    setStep('phone');
    setError(null);
    setPin('');
    setCode('');
  };

  if (!hintsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.water} />
      </View>
    );
  }

  const heroCompact = step === 'pin';

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" bounces={false}>
        <GradientHero height={heroCompact ? 170 : 250}>
          <View style={styles.heroContent}>
            <View style={styles.logoMark}>
              <Text style={styles.logoMarkText}>M</Text>
            </View>
            <Text style={styles.wordmark}>MANA</Text>
            <Text style={styles.tagline}>Wash Manager</Text>
          </View>
        </GradientHero>

        <View style={[styles.panel, shadow('md')]}>
          {sessionNotice ? (
            <View style={styles.notice}>
              <IconAlert size={16} color={colors.amberDeep} />
              <Text style={styles.noticeText}>{sessionNotice}</Text>
            </View>
          ) : null}

          {step === 'phone' ? (
            <>
              <Text style={styles.title}>Sign in</Text>
              <Text style={styles.subtitle}>Owner and staff use the same app — your role decides what you see.</Text>

              <View style={styles.segment} accessibilityRole="tablist">
                {(
                  [
                    { key: 'otp', label: 'SMS code', Icon: IconPhone },
                    { key: 'pin', label: 'PIN', Icon: IconLock },
                  ] as const
                ).map(({ key, label, Icon }) => {
                  const on = method === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => switchMethod(key)}
                      style={[styles.segmentBtn, on && styles.segmentBtnOn]}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                    >
                      <Icon size={16} color={on ? colors.waterDeep : colors.slateDeep} />
                      <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Mobile number</Text>
              <View style={[styles.phoneField, error ? styles.fieldError : null]}>
                <Text style={styles.countryCode}>+91</Text>
                <View style={styles.phoneDivider} />
                <TextInput
                  style={styles.phoneInput}
                  keyboardType="phone-pad"
                  placeholder="98765 43210"
                  placeholderTextColor={colors.slate}
                  value={formatPhone(digits)}
                  onChangeText={(t) => {
                    setPhone(normalizePhone(t).slice(0, 10));
                    if (error) setError(null);
                  }}
                  maxLength={11}
                  autoFocus={!phone}
                  returnKeyType="go"
                  onSubmitEditing={() => phoneOk && void continueWithPhone()}
                  accessibilityLabel="Mobile number"
                />
              </View>
              <Text style={styles.helper}>
                {method === 'otp' ? 'We’ll text you a 6-digit code.' : 'Next, enter the PIN you set in the app.'}
              </Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Button
                  label={method === 'otp' ? 'Send code' : 'Continue'}
                  size="lg"
                  onPress={() => void continueWithPhone()}
                  loading={loading}
                  disabled={!phoneOk}
                />
              </View>
            </>
          ) : step === 'code' ? (
            <>
              <Text style={styles.title}>Enter the code</Text>
              <Text style={styles.subtitle}>Sent by SMS to +91 {formatPhone(digits)}</Text>

              <Pressable style={styles.codeRow} onPress={() => codeInput.current?.focus()}>
                {Array.from({ length: 6 }).map((_, i) => {
                  const ch = code[i];
                  const active = i === code.length && !loading;
                  return (
                    <View key={i} style={[styles.codeBox, active && styles.codeBoxActive, error ? styles.fieldError : null]}>
                      <Text style={styles.codeDigit}>{ch ?? ''}</Text>
                    </View>
                  );
                })}
                <TextInput
                  ref={codeInput}
                  value={code}
                  onChangeText={onCodeChange}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  style={styles.hiddenInput}
                  caretHidden
                  accessibilityLabel="Verification code"
                />
              </Pressable>

              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Button label="Verify & sign in" size="lg" onPress={() => void verifyCode()} loading={loading} disabled={code.length !== 6} />
              </View>
              <View style={styles.linkRow}>
                <Pressable onPress={changeNumber} hitSlop={8}>
                  <Text style={styles.link}>Change number</Text>
                </Pressable>
                <Pressable onPress={() => void continueWithPhone()} disabled={resendIn > 0 || loading} hitSlop={8}>
                  <Text style={[styles.link, resendIn > 0 && styles.linkDisabled]}>
                    {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.title, styles.center]}>Enter your PIN</Text>
              <Text style={[styles.subtitle, styles.center]}>+91 {formatPhone(digits)}</Text>
              <View style={styles.pinWrap}>
                <PinPad value={pin} onChange={onPinChange} errorKey={pinErrorKey} disabled={loading} />
              </View>
              <View style={styles.pinStatus}>
                {loading ? (
                  <ActivityIndicator color={colors.water} />
                ) : error ? (
                  <Text style={[styles.error, styles.center]}>{error}</Text>
                ) : (
                  <Text style={[styles.helper, styles.center]}>4–6 digits · signs in automatically at 6</Text>
                )}
              </View>
              {pin.length >= 4 && pin.length < 6 && !loading ? (
                <Button label="Sign in" size="lg" onPress={() => void verifyPin()} />
              ) : null}
              <View style={styles.linkRow}>
                <Pressable onPress={changeNumber} hitSlop={8}>
                  <Text style={styles.link}>Not you? Change number</Text>
                </Pressable>
                <Pressable onPress={() => switchMethod('otp')} hitSlop={8}>
                  <Text style={styles.link}>Use SMS code</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.surface },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  scroll: { flexGrow: 1 },
  heroContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: spacing.xl },
  logoMark: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  logoMarkText: { ...typography.title, color: colors.white },
  wordmark: { ...typography.display, color: colors.white, letterSpacing: 6, fontSize: 30 },
  tagline: { ...typography.body, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
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
    marginBottom: spacing.sm,
  },
  noticeText: { ...typography.label, color: colors.amberDeep, flex: 1, textTransform: 'none' },
  title: { ...typography.title, color: colors.waterInk },
  subtitle: { ...typography.body, color: colors.slateDeep, fontSize: 15, marginBottom: spacing.sm },
  center: { textAlign: 'center' },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.waterPale,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
    marginBottom: spacing.sm,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.sm,
  },
  segmentBtnOn: { backgroundColor: colors.white, ...shadow('sm') },
  segmentText: { ...typography.bodyStrong, color: colors.slateDeep, fontSize: 15 },
  segmentTextOn: { color: colors.waterDeep },
  fieldLabel: { ...typography.caption, color: colors.slateDeep, marginTop: spacing.sm },
  phoneField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  fieldError: { borderColor: '#FCA5A5' },
  countryCode: { ...typography.heading, color: colors.slateDeep, fontSize: 20 },
  phoneDivider: { width: 1, height: 26, backgroundColor: colors.border, marginHorizontal: spacing.sm + 4 },
  phoneInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    color: colors.waterInk,
    letterSpacing: 1,
    paddingVertical: spacing.md,
  },
  helper: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  error: { ...typography.label, color: colors.danger, textTransform: 'none', lineHeight: 19 },
  actions: { marginTop: spacing.md },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  codeBox: {
    width: 48,
    height: 58,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBoxActive: { borderColor: colors.water, backgroundColor: colors.white },
  codeDigit: { ...typography.title, color: colors.waterInk },
  hiddenInput: { position: 'absolute', opacity: 0, width: '100%', height: '100%' },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  link: { ...typography.label, color: colors.water, fontSize: 14 },
  linkDisabled: { color: colors.slate },
  pinWrap: { marginTop: spacing.md },
  pinStatus: { minHeight: 40, justifyContent: 'center', marginTop: spacing.sm },
});
