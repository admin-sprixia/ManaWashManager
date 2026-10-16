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
import {
  isValidPhone,
  LOGIN_CODE_LENGTH,
  LOGIN_CODE_TTL_MINUTES,
  normalizePhone,
} from '@mana/domain';
import {
  AuthHero,
  Button,
  IconAlert,
  IconLock,
  IconShield,
  IconUsers,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { PinPad } from '../components/PinPad';
import { api } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import {
  getLastShop,
  getLoginHints,
  setLoginHints,
  type SessionUser,
} from '../api/session';

type Step = 'phone' | 'pin' | 'forgot' | 'code';
/** `device`: a new phone proves the number, then the PIN. `reset`: a forgotten PIN is cleared. */
type CodePurpose = 'device' | 'reset';

type SignInBody = {
  token?: string;
  user?: SessionUser;
  error?: string;
  message?: string;
  attemptsLeft?: number;
  lockedUntil?: string;
  retryAfter?: number;
  resendAfter?: number;
  next?: 'pin';
  resetBy?: { by: string; at: string } | null;
};

function formatPhone(digits: string): string {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

function lockMessage(lockedUntil?: string): string {
  if (!lockedUntil) return 'Too many wrong tries. Try again later, or tap “Forgot PIN?”.';
  const mins = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60_000));
  const wait = mins < 90 ? `${mins} min` : `${Math.ceil(mins / 60)} hours`;
  return `Too many wrong tries. Try again in ${wait}, or tap “Forgot PIN?”.`;
}

function resetNotice(resetBy: { by: string; at: string }): string {
  const when = new Date(resetBy.at).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `Your PIN was reset by ${resetBy.by} on ${when}. If you didn’t ask for this, tell your owner or Mana Wash HQ.`;
}

/**
 * Day to day everyone signs in with phone + PIN on a phone their number trusts. A new phone is
 * confirmed once with a code sent on WhatsApp; a forgotten PIN is cleared the same way. A reset by
 * the owner or HQ never signs anyone in — the person still proves their number with a code. A
 * number on no team is told to ask their owner or manager, who add people from Team.
 */
export function LoginScreen() {
  const { signIn, sessionNotice, setSignInNotice } = useAuth();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [pinErrorKey, setPinErrorKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hintsLoaded, setHintsLoaded] = useState(false);
  const [codeBack, setCodeBack] = useState<Step>('phone');
  const [purpose, setPurpose] = useState<CodePurpose>('reset');
  const [info, setInfo] = useState<string | null>(null);
  const [phoneFocused, setPhoneFocused] = useState(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // On a shared shop phone, jump straight to the PIN pad for whoever signed in last.
  useEffect(() => {
    void getLoginHints().then((hints) => {
      if (hints.phone) {
        setPhone(hints.phone);
        setStep('pin');
      }
      setHintsLoaded(true);
    });
  }, []);

  const digits = normalizePhone(phone);
  const phoneOk = isValidPhone(digits);
  const hintChecked = useRef(false);

  const describeError = (e: unknown) =>
    e instanceof NetworkError
      ? 'No connection. Check mobile data or Wi-Fi and try again.'
      : e instanceof Error
        ? e.message
        : 'Something went wrong.';

  const accountError = (err?: string, message?: string) =>
    err === 'no_account'
      ? (message ?? 'This number isn’t on a Mana Wash team yet. Ask your branch owner or manager to add you from Team.')
      : err === 'account_disabled'
        ? 'This account has been turned off. Ask the owner to re-enable it.'
        : err === 'branch_closed'
          ? (message ?? 'Mana Wash HQ has closed your branch.')
          : null;

  const complete = async (token: string, user: SessionUser) => {
    await setLoginHints(digits, 'pin');
    await signIn(token, user);
  };

  const goTo = (next: Step) => {
    setStep(next);
    setError(null);
    setInfo(null);
    setPin('');
    setCode('');
  };

  const requestCode = async (why: CodePurpose = purpose) => {
    if (sending) return;
    if (step !== 'code') setCodeBack(step === 'forgot' ? 'forgot' : 'phone');
    setPurpose(why);
    setError(null);
    setSending(true);
    try {
      const res = await api.auth.code.request.$post({ json: { phone: digits, purpose: why } });
      const body = (await res.json().catch(() => null)) as SignInBody | null;
      // A code went out moments ago — it's still good, so just show the entry screen.
      if (body?.error === 'too_soon') {
        setResendIn(body.retryAfter ?? 30);
        goTo('code');
        return;
      }
      if (!res.ok)
        throw new Error(accountError(body?.error, body?.message) ?? body?.message ?? 'Couldn’t send the code.');
      setResendIn(body?.resendAfter ?? 30);
      goTo('code');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSending(false);
    }
  };

  const continueWithPhone = async () => {
    if (!phoneOk || loading || sending) return;
    setError(null);
    setLoading(true);
    try {
      const res = await api.auth.start.$post({ json: { phone: digits } });
      const body = (await res.json().catch(() => null)) as
        (Omit<SignInBody, 'next'> & { next?: 'pin' | 'code' | 'verify_device' }) | null;
      if (body?.next === 'code' || body?.next === 'verify_device') {
        setLoading(false);
        await requestCode(body.next === 'code' ? 'reset' : 'device');
        return;
      }
      if (!res.ok || body?.next !== 'pin') {
        throw new Error(accountError(body?.error, body?.message) ?? body?.message ?? 'Couldn’t continue.');
      }
      goTo('pin');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (value = code) => {
    if (value.length !== LOGIN_CODE_LENGTH || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await api.auth.code.verify.$post({
        json: { phone: digits, code: value, shopId: await getLastShop(digits), purpose },
      });
      const body = (await res.json().catch(() => null)) as SignInBody | null;
      // A new phone is now trusted; the person's own PIN does the rest.
      if (res.ok && body?.next === 'pin') {
        goTo('pin');
        setInfo('Phone confirmed. Now enter your PIN.');
        setLoading(false);
        return;
      }
      if (!res.ok || !body?.token || !body.user) {
        setCode('');
        throw new Error(
          accountError(body?.error, body?.message) ??
            (body?.attemptsLeft != null
              ? `${body.message ?? 'That code isn’t right.'} ${body.attemptsLeft} ${body.attemptsLeft === 1 ? 'try' : 'tries'} left.`
              : (body?.message ?? 'Couldn’t sign in.')),
        );
      }
      // The server cleared the old PIN; the app asks for a new one straight after this.
      setSignInNotice(body.resetBy ? resetNotice(body.resetBy) : null);
      await complete(body.token, body.user);
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
      const res = await api.auth.pin.login.$post({
        json: { phone: digits, pin: value, shopId: await getLastShop(digits) },
      });
      const body = (await res.json().catch(() => null)) as
        (SignInBody & { useCode?: boolean }) | null;
      if (body?.error === 'pin_not_set' && body.useCode) {
        // The PIN was reset since: the person proves it's them on WhatsApp, then picks a new one.
        setLoading(false);
        setPin('');
        await requestCode('reset');
        return;
      }
      if (body?.error === 'device_not_trusted') {
        setLoading(false);
        setPin('');
        await requestCode('device');
        return;
      }
      if (!res.ok || !body?.token || !body.user) {
        setPin('');
        setPinErrorKey((k) => k + 1);
        throw new Error(
          accountError(body?.error, body?.message) ??
            (body?.error === 'pin_locked'
              ? lockMessage(body.lockedUntil)
              : body?.error === 'invalid_pin'
                  ? `Wrong PIN. ${body.attemptsLeft ?? 0} ${body.attemptsLeft === 1 ? 'try' : 'tries'} left.`
                  : 'Couldn’t sign in.'),
        );
      }
      await complete(body.token, body.user);
    } catch (e) {
      setError(describeError(e));
      setLoading(false);
    }
  };

  const onPinChange = (value: string) => {
    setPin(value);
    if (error) setError(null);
    if (info) setInfo(null);
    if (value.length === 6) void verifyPin(value);
  };

  // The remembered number may have lost its PIN since (a reset), this phone may no longer be
  // trusted, or the number may have been taken off every team: ask the server once, quietly, and
  // move on to the WhatsApp code, or back to the number with the reason. Offline, stay on the pad.
  useEffect(() => {
    if (!hintsLoaded || hintChecked.current || step !== 'pin' || !phoneOk) return;
    hintChecked.current = true;
    void api.auth.start
      .$post({ json: { phone: digits } })
      .then((res) => res.json() as Promise<{ next?: string; error?: string; message?: string }>)
      .then(({ next, error: err, message }) => {
        if (next === 'code') void requestCode('reset');
        else if (next === 'verify_device') void requestCode('device');
        else if (err === 'no_account') {
          goTo('phone');
          setError(accountError(err, message));
        }
      })
      .catch(() => undefined);
    // Runs once for the remembered number; requestCode/goTo are recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintsLoaded, step, phoneOk, digits]);

  if (!hintsLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.water} />
      </View>
    );
  }

  const phoneLabel = `+91 ${formatPhone(digits)}`;
  const changeNumber = { label: phoneLabel, onPress: () => goTo('phone') };
  const hero: Omit<React.ComponentProps<typeof AuthHero>, 'product'> =
    step === 'phone'
      ? {
          title: 'Sign in',
          subtitle: 'Use the mobile number your branch added you with.',
          tall: true,
        }
      : step === 'pin'
              ? { title: 'Welcome back', subtitle: 'Enter your PIN to continue.', phoneChip: changeNumber }
              : step === 'forgot'
                ? {
                    title: 'Forgot your PIN?',
                    subtitle: 'No problem — here’s how to get back in.',
                    onBack: () => goTo('pin'),
                  }
                : {
                    title: purpose === 'device' ? 'Confirm this phone' : 'Check WhatsApp',
                    subtitle:
                      purpose === 'device'
                        ? `First time on this phone. We sent a ${LOGIN_CODE_LENGTH}-digit code to ${phoneLabel} on WhatsApp.`
                        : `We sent a ${LOGIN_CODE_LENGTH}-digit code to ${phoneLabel}. It works for ${LOGIN_CODE_TTL_MINUTES} minutes.`,
                    onBack: () => goTo(codeBack),
                  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <AuthHero product="Wash Partner" {...hero} />

        <View style={styles.panel}>
          {sessionNotice ? (
            <View style={styles.notice}>
              <IconAlert size={16} color={colors.amberDeep} />
              <Text style={styles.noticeText}>{sessionNotice}</Text>
            </View>
          ) : null}

          {step === 'phone' ? (
            <>
              <Text style={styles.fieldLabel}>Mobile number</Text>
              <View
                style={[
                  styles.phoneField,
                  phoneFocused && styles.fieldFocused,
                  error ? styles.fieldError : null,
                ]}
              >
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
                  onFocus={() => setPhoneFocused(true)}
                  onBlur={() => setPhoneFocused(false)}
                  maxLength={11}
                  autoFocus={!phone}
                  returnKeyType="go"
                  onSubmitEditing={() => void continueWithPhone()}
                  accessibilityLabel="Mobile number"
                />
              </View>
              {error ? (
                <Text style={styles.error}>{error}</Text>
              ) : (
                <Text style={styles.helper}>
                  Next, your PIN — or a WhatsApp code the first time.
                </Text>
              )}
              <View style={styles.actions}>
                <Button
                  label="Continue"
                  size="lg"
                  onPress={() => void continueWithPhone()}
                  disabled={!phoneOk}
                  loading={loading || sending}
                />
              </View>
              <View style={styles.trust}>
                <IconShield size={14} color={colors.slate} />
                <Text style={styles.trustText}>Your shop’s data stays private to your team.</Text>
              </View>
            </>
          ) : step === 'pin' ? (
            <>
              <View style={styles.pinWrap}>
                <PinPad
                  value={pin}
                  onChange={onPinChange}
                  errorKey={pinErrorKey}
                  disabled={loading}
                />
              </View>
              <View style={styles.pinStatus}>
                {loading ? (
                  <ActivityIndicator color={colors.water} />
                ) : error ? (
                  <Text style={[styles.error, styles.center]}>{error}</Text>
                ) : info ? (
                  <Text style={[styles.info, styles.center]}>{info}</Text>
                ) : (
                  <Text style={[styles.helper, styles.center]}>
                    Owners and managers: 6 digits · staff: 4–6
                  </Text>
                )}
              </View>
              {pin.length >= 4 && pin.length < 6 && !loading ? (
                <Button label="Sign in" size="lg" onPress={() => void verifyPin()} />
              ) : null}
              <Pressable
                onPress={() => goTo('forgot')}
                hitSlop={8}
                style={styles.centerLink}
                accessibilityRole="button"
              >
                <Text style={styles.link}>Forgot PIN?</Text>
              </Pressable>
            </>
          ) : step === 'forgot' ? (
            <>
              <View style={styles.helpRow}>
                <View style={styles.helpIcon}>
                  <IconLock size={20} color={colors.waterDeep} />
                </View>
                <View style={styles.helpCopy}>
                  <Text style={styles.helpTitle}>Get a code on WhatsApp</Text>
                  <Text style={styles.helpBody}>
                    We’ll send a {LOGIN_CODE_LENGTH}-digit code to {phoneLabel}. Enter it, then
                    choose a new PIN.
                  </Text>
                </View>
              </View>
              <View style={[styles.helpRow, styles.helpRowLast]}>
                <View style={[styles.helpIcon, styles.helpIconTeal]}>
                  <IconUsers size={20} color={colors.tealDeep} />
                </View>
                <View style={styles.helpCopy}>
                  <Text style={styles.helpTitle}>Lost your phone?</Text>
                  <Text style={styles.helpBody}>
                    Ask your owner (or Mana Wash HQ, if you’re an owner) to reset your PIN. That
                    signs you out everywhere; you then get back in with a WhatsApp code.
                  </Text>
                </View>
              </View>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Button
                  label="Send code on WhatsApp"
                  size="lg"
                  onPress={() => void requestCode('reset')}
                  loading={sending}
                />
              </View>
            </>
          ) : step === 'code' ? (
            <>
              <Text style={styles.fieldLabel}>WhatsApp code</Text>
              <TextInput
                style={[styles.otpInput, error ? styles.fieldError : null]}
                value={code}
                onChangeText={(t) => {
                  const next = t.replace(/\D/g, '').slice(0, LOGIN_CODE_LENGTH);
                  setCode(next);
                  if (error) setError(null);
                  if (next.length === LOGIN_CODE_LENGTH) void verifyCode(next);
                }}
                placeholder={'•'.repeat(LOGIN_CODE_LENGTH)}
                placeholderTextColor={colors.waterLight}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={LOGIN_CODE_LENGTH}
                autoFocus
                editable={!loading}
                accessibilityLabel="WhatsApp code"
              />
              <View style={styles.pinStatus}>
                {loading ? (
                  <ActivityIndicator color={colors.water} />
                ) : error ? (
                  <Text style={styles.error}>{error}</Text>
                ) : (
                  <Text style={styles.helper}>
                    {purpose === 'device'
                      ? 'You only do this once per phone. Your PIN comes next.'
                      : `Goes on automatically once all ${LOGIN_CODE_LENGTH} digits are in.`}
                  </Text>
                )}
              </View>
              <Button
                label={resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
                variant="secondary"
                onPress={() => void requestCode()}
                loading={sending}
                disabled={resendIn > 0 || loading}
              />
            </>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.white },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  scroll: { flexGrow: 1 },
  panel: {
    flex: 1,
    marginTop: -radius.xl,
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg + 4,
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
  center: { textAlign: 'center' },
  fieldLabel: {
    ...typography.caption,
    color: colors.slateDeep,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  phoneField: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 62,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  fieldFocused: { borderColor: colors.water, backgroundColor: colors.white },
  fieldError: { borderColor: '#FCA5A5' },
  countryCode: { ...typography.heading, color: colors.waterInk, fontSize: 20 },
  phoneDivider: {
    width: 1,
    height: 26,
    backgroundColor: colors.border,
    marginHorizontal: spacing.sm + 4,
  },
  phoneInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    color: colors.waterInk,
    letterSpacing: 1,
    paddingVertical: 0,
  },
  helper: { ...typography.caption, color: colors.slate, letterSpacing: 0, lineHeight: 17 },
  error: { ...typography.label, color: colors.danger, textTransform: 'none', lineHeight: 19 },
  info: { ...typography.label, color: colors.tealDeep, textTransform: 'none', lineHeight: 19 },
  actions: { marginTop: spacing.md },
  trust: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.lg,
  },
  trustText: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  link: { ...typography.label, color: colors.water, fontSize: 14 },
  centerLink: { alignSelf: 'center', paddingVertical: spacing.sm, marginTop: spacing.sm },
  pinWrap: { marginTop: spacing.xs },
  pinStatus: { minHeight: 40, justifyContent: 'center', marginTop: spacing.xs },
  helpRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  helpRowLast: { borderBottomWidth: 0 },
  helpIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpIconTeal: { backgroundColor: '#CCFBF1' },
  helpCopy: { flex: 1, gap: 4 },
  helpTitle: { ...typography.bodyStrong, color: colors.waterInk },
  helpBody: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20 },
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
  },
});
