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
  SHOP_TRIAL_DAYS,
} from '@mana/domain';
import { GradientHero } from '../components/GradientHero';
import { Button } from '../components/Button';
import { PinPad } from '../components/PinPad';
import {
  IconAlert,
  IconChevronRight,
  IconEdit,
  IconLock,
  IconStore,
  IconUserPlus,
} from '../components/Icons';
import { SignUpFlow } from '../components/auth/SignUpFlow';
import { JoinShopFlow } from '../components/auth/JoinShopFlow';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { api } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import {
  getJoinRequest,
  getLastShop,
  getLoginHints,
  setLoginHints,
  type SessionUser,
} from '../api/session';

type Step = 'phone' | 'pin' | 'forgot' | 'code' | 'recovery' | 'choose' | 'signup' | 'join';

type SignInBody = {
  token?: string;
  user?: SessionUser;
  error?: string;
  message?: string;
  attemptsLeft?: number;
  lockedUntil?: string;
  retryAfter?: number;
  resendAfter?: number;
};

function formatPhone(digits: string): string {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

function lockMessage(lockedUntil?: string): string {
  if (!lockedUntil)
    return 'Too many wrong tries. Try again later, or ask the owner to reset your PIN.';
  const mins = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 60_000));
  return `Too many wrong tries. Try again in ${mins} min, or ask the owner to reset your PIN.`;
}

/**
 * Day to day everyone signs in with phone + PIN. The owner gets in on a new phone (or after
 * forgetting their PIN) with a code sent on WhatsApp, and the one-time recovery code is the
 * emergency fallback. A number with no account chooses between starting a new shop and asking
 * to join one with its shop ID.
 */
export function LoginScreen() {
  const { signIn, sessionNotice } = useAuth();
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
  const [resumeToken, setResumeToken] = useState<string | undefined>();

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // A request to join a shop still waiting on the owner reopens its waiting screen. Otherwise, on a
  // shared shop phone, jump straight to the PIN pad for whoever signed in last.
  useEffect(() => {
    void Promise.all([getJoinRequest(), getLoginHints()]).then(([request, hints]) => {
      if (request) {
        setPhone(request.phone);
        setResumeToken(request.requestToken);
        setStep('join');
      } else if (hints.phone) {
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

  const accountError = (err?: string) =>
    err === 'no_account'
      ? `No team account for ${formatPhone(digits)}. Ask the owner to add you.`
      : err === 'account_disabled'
        ? 'This account has been turned off. Ask the owner to re-enable it.'
        : null;

  const complete = async (token: string, user: SessionUser) => {
    await setLoginHints(digits, 'pin');
    await signIn(token, user);
  };

  const goTo = (next: Step) => {
    setStep(next);
    setError(null);
    setPin('');
    setCode('');
  };

  const requestCode = async () => {
    if (sending) return;
    setError(null);
    setSending(true);
    try {
      const res = await api.auth.code.request.$post({ json: { phone: digits } });
      const body = (await res.json().catch(() => null)) as SignInBody | null;
      // A code went out moments ago — it's still good, so just show the entry screen.
      if (body?.error === 'too_soon') {
        setResendIn(body.retryAfter ?? 30);
        goTo('code');
        return;
      }
      if (!res.ok)
        throw new Error(accountError(body?.error) ?? body?.message ?? 'Couldn’t send the code.');
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
        (SignInBody & { next?: 'pin' | 'code' | 'new' }) | null;
      if (body?.next === 'new') {
        goTo('choose');
        return;
      }
      if (body?.next === 'code') {
        setLoading(false);
        await requestCode();
        return;
      }
      if (!res.ok || body?.next !== 'pin') {
        throw new Error(accountError(body?.error) ?? body?.message ?? 'Couldn’t continue.');
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
        json: { phone: digits, code: value, shopId: await getLastShop(digits) },
      });
      const body = (await res.json().catch(() => null)) as SignInBody | null;
      if (!res.ok || !body?.token || !body.user) {
        setCode('');
        throw new Error(
          accountError(body?.error) ??
            (body?.attemptsLeft != null
              ? `${body.message ?? 'That code isn’t right.'} ${body.attemptsLeft} ${body.attemptsLeft === 1 ? 'try' : 'tries'} left.`
              : (body?.message ?? 'Couldn’t sign in.')),
        );
      }
      // The server cleared the old PIN; the app asks for a new one straight after this.
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
        // First time on this number (or after a reset): the owner proves it's them on WhatsApp.
        setLoading(false);
        setPin('');
        await requestCode();
        return;
      }
      if (!res.ok || !body?.token || !body.user) {
        setPin('');
        setPinErrorKey((k) => k + 1);
        throw new Error(
          accountError(body?.error) ??
            (body?.error === 'pin_locked'
              ? lockMessage(body.lockedUntil)
              : body?.error === 'pin_not_set'
                ? 'No PIN for this number yet. Ask the owner to set one in More → Team.'
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

  const recover = async () => {
    if (!code.trim() || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await api.auth.recover.$post({
        json: { phone: digits, code: code.trim(), shopId: await getLastShop(digits) },
      });
      const body = (await res.json().catch(() => null)) as SignInBody | null;
      if (!res.ok || !body?.token || !body.user) {
        throw new Error(
          accountError(body?.error) ??
            (body?.error === 'pin_locked'
              ? lockMessage(body.lockedUntil)
              : body?.attemptsLeft != null
                ? `${body.message ?? 'That code isn’t right.'} ${body.attemptsLeft} ${body.attemptsLeft === 1 ? 'try' : 'tries'} left.`
                : (body?.message ?? 'Couldn’t sign in.')),
        );
      }
      // The server cleared the old PIN; the app asks for a new one straight after this.
      await complete(body.token, body.user);
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

  // The remembered number may have lost its PIN since (reset, or a new phone): ask the server once,
  // quietly, and move on to the WhatsApp code or the "New here?" choice. Offline, stay on the pad.
  useEffect(() => {
    if (!hintsLoaded || hintChecked.current || step !== 'pin' || !phoneOk) return;
    hintChecked.current = true;
    void api.auth.start
      .$post({ json: { phone: digits } })
      .then((res) => res.json() as Promise<{ next?: string }>)
      .then(({ next }) => {
        if (next === 'code') void requestCode();
        else if (next === 'new') goTo('choose');
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
        <GradientHero height={step === 'pin' || step === 'signup' || step === 'join' ? 170 : 250}>
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
              <Text style={styles.subtitle}>
                Owner and staff use the same app — your role decides what you see.
              </Text>

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
            </>
          ) : step === 'choose' ? (
            <>
              <Pressable
                style={styles.numberChip}
                onPress={() => goTo('phone')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Change number"
              >
                <Text style={styles.numberChipText}>+91 {formatPhone(digits)}</Text>
                <IconEdit size={14} color={colors.water} />
              </Pressable>
              <Text style={styles.title}>Welcome! Who are you?</Text>
              <Text style={styles.subtitle}>This number is new here. Pick one to get started.</Text>
              <Pressable
                style={({ pressed }) => [styles.choice, pressed && styles.choicePressed]}
                onPress={() => goTo('signup')}
                accessibilityRole="button"
              >
                <View style={styles.choiceIcon}>
                  <IconStore size={26} color={colors.waterDeep} />
                </View>
                <View style={styles.choiceCopy}>
                  <Text style={[styles.choiceTag, styles.choiceTagOwner]}>OWNER</Text>
                  <Text style={styles.choiceTitle}>I own a car wash</Text>
                  <Text style={styles.choiceBody}>
                    Set up your shop in a minute. Free for {SHOP_TRIAL_DAYS} days.
                  </Text>
                </View>
                <View style={styles.choiceGo}>
                  <IconChevronRight size={18} color={colors.waterDeep} />
                </View>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.choice, pressed && styles.choicePressedTeal]}
                onPress={() => {
                  setResumeToken(undefined);
                  goTo('join');
                }}
                accessibilityRole="button"
              >
                <View style={[styles.choiceIcon, styles.choiceIconTeal]}>
                  <IconUserPlus size={26} color={colors.tealDeep} />
                </View>
                <View style={styles.choiceCopy}>
                  <Text style={[styles.choiceTag, styles.choiceTagStaff]}>STAFF</Text>
                  <Text style={styles.choiceTitle}>I work at a car wash</Text>
                  <Text style={styles.choiceBody}>
                    Join your shop with the 6-digit shop ID from your owner.
                  </Text>
                </View>
                <View style={[styles.choiceGo, styles.choiceGoTeal]}>
                  <IconChevronRight size={18} color={colors.tealDeep} />
                </View>
              </Pressable>
              <Text style={styles.choiceHint}>
                Not sure? The owner starts the shop first, then shares the shop ID with the team.
              </Text>
            </>
          ) : step === 'signup' ? (
            <SignUpFlow phone={digits} onBack={() => goTo('choose')} />
          ) : step === 'join' ? (
            <JoinShopFlow
              phone={digits}
              resumeToken={resumeToken}
              onBack={() => {
                setResumeToken(undefined);
                goTo('choose');
              }}
            />
          ) : step === 'pin' ? (
            <>
              <Text style={[styles.title, styles.center]}>Enter your PIN</Text>
              <Text style={[styles.subtitle, styles.center]}>+91 {formatPhone(digits)}</Text>
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
                ) : (
                  <Text style={[styles.helper, styles.center]}>
                    4–6 digits · signs in automatically at 6
                  </Text>
                )}
              </View>
              {pin.length >= 4 && pin.length < 6 && !loading ? (
                <Button label="Sign in" size="lg" onPress={() => void verifyPin()} />
              ) : null}
              <View style={styles.linkRow}>
                <Pressable onPress={() => goTo('phone')} hitSlop={8}>
                  <Text style={styles.link}>Not you? Change number</Text>
                </Pressable>
                <Pressable onPress={() => goTo('forgot')} hitSlop={8}>
                  <Text style={styles.link}>Forgot PIN?</Text>
                </Pressable>
              </View>
            </>
          ) : step === 'forgot' ? (
            <>
              <Text style={styles.title}>Forgot your PIN?</Text>
              <View style={styles.helpCard}>
                <Text style={styles.helpTitle}>Staff</Text>
                <Text style={styles.helpBody}>
                  Ask the owner to reset it in More → Team. You can sign in with the new PIN right
                  away.
                </Text>
              </View>
              <View style={styles.helpCard}>
                <View style={styles.helpHead}>
                  <IconLock size={16} color={colors.waterDeep} />
                  <Text style={styles.helpTitle}>Owner</Text>
                </View>
                <Text style={styles.helpBody}>
                  We’ll send a {LOGIN_CODE_LENGTH}-digit code on WhatsApp to +91{' '}
                  {formatPhone(digits)}. Enter it, then choose a new PIN.
                </Text>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Button
                  label="Send code on WhatsApp"
                  size="lg"
                  onPress={() => void requestCode()}
                  loading={sending}
                />
                <Pressable onPress={() => goTo('recovery')} hitSlop={8} style={styles.inlineLink}>
                  <Text style={styles.link}>No WhatsApp? Use the recovery code</Text>
                </Pressable>
              </View>
              <View style={styles.linkRow}>
                <Pressable onPress={() => goTo('pin')} hitSlop={8}>
                  <Text style={styles.link}>Back to PIN</Text>
                </Pressable>
              </View>
            </>
          ) : step === 'code' ? (
            <>
              <Text style={styles.title}>Enter the WhatsApp code</Text>
              <Text style={styles.subtitle}>
                Sent to +91 {formatPhone(digits)}. It works for {LOGIN_CODE_TTL_MINUTES} minutes.
              </Text>
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
                placeholderTextColor={colors.border}
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
                    Signs in automatically once all {LOGIN_CODE_LENGTH} digits are in.
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
              <View style={styles.linkRow}>
                <Pressable onPress={() => goTo('pin')} hitSlop={8}>
                  <Text style={styles.link}>Back to PIN</Text>
                </Pressable>
                <Pressable onPress={() => goTo('recovery')} hitSlop={8}>
                  <Text style={styles.link}>Use recovery code</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>Recovery code</Text>
              <View style={styles.helpCard}>
                <View style={styles.helpHead}>
                  <IconLock size={16} color={colors.waterDeep} />
                  <Text style={styles.helpTitle}>Owner emergency sign-in</Text>
                </View>
                <Text style={styles.helpBody}>
                  Enter the recovery code kept on the server for +91 {formatPhone(digits)}. It works
                  once; you’ll choose a new PIN straight after.
                </Text>
                <TextInput
                  style={[styles.codeInput, error ? styles.fieldError : null]}
                  value={code}
                  onChangeText={(t) => {
                    setCode(t);
                    if (error) setError(null);
                  }}
                  placeholder="Recovery code"
                  placeholderTextColor={colors.slate}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  returnKeyType="go"
                  onSubmitEditing={() => void recover()}
                  accessibilityLabel="Recovery code"
                />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Button
                  label="Sign in with recovery code"
                  size="lg"
                  onPress={() => void recover()}
                  loading={loading}
                  disabled={!code.trim()}
                />
              </View>
              <View style={styles.linkRow}>
                <Pressable onPress={() => goTo('forgot')} hitSlop={8}>
                  <Text style={styles.link}>Back</Text>
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
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  scroll: { flexGrow: 1 },
  heroContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: spacing.xl,
  },
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
    paddingVertical: spacing.md,
  },
  helper: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  error: { ...typography.label, color: colors.danger, textTransform: 'none', lineHeight: 19 },
  actions: { marginTop: spacing.md },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  link: { ...typography.label, color: colors.water, fontSize: 14 },
  pinWrap: { marginTop: spacing.md },
  pinStatus: { minHeight: 40, justifyContent: 'center', marginTop: spacing.sm },
  helpCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  helpHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inlineLink: { alignSelf: 'center', paddingVertical: spacing.xs },
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
  numberChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.waterPale,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 6,
    marginBottom: spacing.sm,
  },
  numberChipText: { ...typography.bodyStrong, color: colors.waterDeep, fontSize: 14 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 4,
    marginTop: spacing.sm + 4,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  choicePressed: { borderColor: colors.water, backgroundColor: colors.waterPale },
  choicePressedTeal: { borderColor: colors.teal, backgroundColor: '#F0FDFA' },
  choiceIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceIconTeal: { backgroundColor: '#CCFBF1' },
  choiceCopy: { flex: 1, gap: 3 },
  choiceTag: { ...typography.caption, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  choiceTagOwner: { color: colors.water },
  choiceTagStaff: { color: colors.teal },
  choiceTitle: { ...typography.heading, color: colors.waterInk, fontSize: 18 },
  choiceBody: { ...typography.body, color: colors.slateDeep, fontSize: 13, lineHeight: 18 },
  choiceGo: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceGoTeal: { backgroundColor: '#CCFBF1' },
  choiceHint: {
    ...typography.caption,
    color: colors.slate,
    letterSpacing: 0,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  helpTitle: { ...typography.bodyStrong, color: colors.waterInk },
  helpBody: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20 },
  codeInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    fontSize: 17,
    fontWeight: '600',
    color: colors.waterInk,
    letterSpacing: 1,
  },
});
