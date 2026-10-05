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
  SEAT_LOCKED_MESSAGE,
  SHOP_TRIAL_DAYS,
} from '@mana/domain';
import {
  AuthHero,
  Button,
  IconAlert,
  IconChevronRight,
  IconLock,
  IconShield,
  IconStore,
  IconUserPlus,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { PinPad } from '../components/PinPad';
import { SignUpFlow } from '../components/auth/SignUpFlow';
import { JoinShopFlow } from '../components/auth/JoinShopFlow';
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
 * emergency fallback. A number with no account asks to join a shop with its shop ID (or, while
 * sign-up is open, may start a new shop instead).
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
  const [codeBack, setCodeBack] = useState<Step>('phone');
  const [signupOpen, setSignupOpen] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);

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
        : err === 'plan_seat_locked'
          ? SEAT_LOCKED_MESSAGE
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

  // A number with no account: choose "start a shop" or "join one" while sign-up is open; once it's
  // closed (MANA's own branches only) the only way in is asking to join with the shop ID.
  const goToNew = (open: boolean) => {
    setSignupOpen(open);
    if (open) {
      goTo('choose');
    } else {
      setResumeToken(undefined);
      goTo('join');
    }
  };

  const requestCode = async () => {
    if (sending) return;
    if (step !== 'code') setCodeBack(step === 'forgot' ? 'forgot' : 'phone');
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
        (SignInBody & { next?: 'pin' | 'code' | 'new'; signupOpen?: boolean }) | null;
      if (body?.next === 'new') {
        goToNew(body.signupOpen === true);
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
      .then((res) => res.json() as Promise<{ next?: string; signupOpen?: boolean }>)
      .then(({ next, signupOpen: open }) => {
        if (next === 'code') void requestCode();
        else if (next === 'new') goToNew(open === true);
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
          subtitle: 'Owner and staff use the same app — your role decides what you see.',
          tall: true,
        }
      : step === 'choose'
        ? {
            title: 'Welcome to MANA',
            subtitle: 'This number is new here. How will you use the app?',
            phoneChip: changeNumber,
            onBack: () => goTo('phone'),
          }
        : step === 'signup'
          ? {
              title: 'Start your shop',
              subtitle: `Free for ${SHOP_TRIAL_DAYS} days · ready in about a minute.`,
            }
          : step === 'join'
            ? {
                title: 'Join your shop',
                subtitle: 'Your owner approves you, then you’re in.',
                phoneChip: signupOpen || resumeToken ? undefined : changeNumber,
              }
            : step === 'pin'
              ? { title: 'Welcome back', subtitle: 'Enter your PIN to continue.', phoneChip: changeNumber }
              : step === 'forgot'
                ? {
                    title: 'Forgot your PIN?',
                    subtitle: 'No problem — here’s how to get back in.',
                    onBack: () => goTo('pin'),
                  }
                : step === 'code'
                  ? {
                      title: 'Check WhatsApp',
                      subtitle: `We sent a ${LOGIN_CODE_LENGTH}-digit code to ${phoneLabel}. It works for ${LOGIN_CODE_TTL_MINUTES} minutes.`,
                      onBack: () => goTo(codeBack),
                    }
                  : {
                      title: 'Recovery code',
                      subtitle: `Owner emergency sign-in for ${phoneLabel}.`,
                      onBack: () => goTo('forgot'),
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
        <AuthHero product="Wash Manager" {...hero} />

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
          ) : step === 'choose' ? (
            <>
              <Text style={styles.sectionLabel}>I am the…</Text>
              <View style={styles.choiceList}>
                <Pressable
                  style={({ pressed }) => [styles.choice, pressed && styles.choicePressed]}
                  onPress={() => goTo('signup')}
                  accessibilityRole="button"
                  accessibilityLabel={`Owner. I own a car wash. Set up your shop, free for ${SHOP_TRIAL_DAYS} days.`}
                >
                  <View style={styles.choiceIcon}>
                    <IconStore size={24} color={colors.waterDeep} />
                  </View>
                  <View style={styles.choiceCopy}>
                    <View style={styles.choiceHead}>
                      <Text style={styles.choiceTitle}>Owner</Text>
                      <View style={styles.choiceTag}>
                        <Text style={styles.choiceTagText}>{SHOP_TRIAL_DAYS} DAYS FREE</Text>
                      </View>
                    </View>
                    <Text style={styles.choiceBody}>
                      I own a car wash. Set up my shop in a minute.
                    </Text>
                  </View>
                  <IconChevronRight size={20} color={colors.slate} />
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.choice, pressed && styles.choicePressedTeal]}
                  onPress={() => {
                    setResumeToken(undefined);
                    goTo('join');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Staff. I work at a car wash. Join with the shop ID from your owner."
                >
                  <View style={[styles.choiceIcon, styles.choiceIconTeal]}>
                    <IconUserPlus size={24} color={colors.tealDeep} />
                  </View>
                  <View style={styles.choiceCopy}>
                    <Text style={styles.choiceTitle}>Staff</Text>
                    <Text style={styles.choiceBody}>
                      I work at a car wash. Join with the 6-digit shop ID from my owner.
                    </Text>
                  </View>
                  <IconChevronRight size={20} color={colors.slate} />
                </Pressable>
              </View>
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
                goTo(signupOpen ? 'choose' : 'phone');
              }}
            />
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
                ) : (
                  <Text style={[styles.helper, styles.center]}>
                    4–6 digits · signs in automatically at 6
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
                <View style={[styles.helpIcon, styles.helpIconTeal]}>
                  <IconUserPlus size={20} color={colors.tealDeep} />
                </View>
                <View style={styles.helpCopy}>
                  <Text style={styles.helpTitle}>I’m staff</Text>
                  <Text style={styles.helpBody}>
                    Ask the owner to reset it in More → Team. You can sign in with the new PIN
                    right away.
                  </Text>
                </View>
              </View>
              <View style={[styles.helpRow, styles.helpRowLast]}>
                <View style={styles.helpIcon}>
                  <IconLock size={20} color={colors.waterDeep} />
                </View>
                <View style={styles.helpCopy}>
                  <Text style={styles.helpTitle}>I’m the owner</Text>
                  <Text style={styles.helpBody}>
                    We’ll send a {LOGIN_CODE_LENGTH}-digit code on WhatsApp to {phoneLabel}. Enter
                    it, then choose a new PIN.
                  </Text>
                </View>
              </View>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Button
                  label="Send code on WhatsApp"
                  size="lg"
                  onPress={() => void requestCode()}
                  loading={sending}
                />
              </View>
              <Pressable onPress={() => goTo('recovery')} hitSlop={8} style={styles.centerLink}>
                <Text style={styles.link}>No WhatsApp? Use the recovery code</Text>
              </Pressable>
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
              <Pressable onPress={() => goTo('recovery')} hitSlop={8} style={styles.centerLink}>
                <Text style={styles.link}>Use the recovery code instead</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.body}>
                Enter the recovery code kept on the server. It works once; you’ll choose a new PIN
                straight after.
              </Text>
              <Text style={styles.fieldLabel}>Recovery code</Text>
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
                autoFocus
                returnKeyType="go"
                onSubmitEditing={() => void recover()}
                accessibilityLabel="Recovery code"
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Button
                  label="Sign in with recovery code"
                  size="lg"
                  onPress={() => void recover()}
                  loading={loading}
                  disabled={!code.trim()}
                />
              </View>
            </>
          )}
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
  body: { ...typography.body, color: colors.slateDeep, fontSize: 15, lineHeight: 22 },
  center: { textAlign: 'center' },
  fieldLabel: {
    ...typography.caption,
    color: colors.slateDeep,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  sectionLabel: {
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
  choiceList: {
    marginHorizontal: -spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  choicePressed: { backgroundColor: colors.waterPale },
  choicePressedTeal: { backgroundColor: '#F0FDFA' },
  choiceIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceIconTeal: { backgroundColor: '#CCFBF1' },
  choiceCopy: { flex: 1, gap: 3 },
  choiceHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  choiceTitle: { ...typography.heading, color: colors.waterInk, fontSize: 18 },
  choiceTag: {
    backgroundColor: colors.waterPale,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  choiceTagText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: colors.waterDeep },
  choiceBody: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20 },
  choiceHint: {
    ...typography.caption,
    color: colors.slate,
    letterSpacing: 0,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
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
  codeInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
    fontSize: 17,
    fontWeight: '600',
    color: colors.waterInk,
    letterSpacing: 1,
  },
});
