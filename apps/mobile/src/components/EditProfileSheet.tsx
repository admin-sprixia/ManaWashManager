import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { isValidPhone, LOGIN_CODE_LENGTH, normalizePhone } from '@mana/domain';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Avatar } from './Avatar';
import {
  IconAlert,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconLock,
  IconPerson,
  IconPhone,
  IconShield,
  IconStore,
} from './Icons';
import { PinPad } from './PinPad';
import { showToast } from './Toast';
import { colors, gradients, radius, spacing, typography } from '../theme';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { setLoginHints, type SessionUser } from '../api/session';
import { useShop } from '../offline/ShopProvider';

function formatPhone(digits: string): string {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

function toSessionUser(u: {
  id: string;
  name: string;
  phone: string;
  role: string;
  hasPin: boolean;
  shopId: string;
}): SessionUser {
  return { ...u, role: u.role === 'owner' ? 'owner' : 'staff' };
}

type Step = 'edit' | 'code' | 'confirm';

const CODE_ERRORS = new Set(['invalid_code', 'code_expired']);

export function EditProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user, isOwner, updateUser, signIn } = useAuth();
  const { info: shop } = useShop();
  const [step, setStep] = useState<Step>('edit');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [pinErrorKey, setPinErrorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<'name' | 'phone' | null>(null);

  useEffect(() => {
    if (visible && user) {
      setStep('edit');
      setName(user.name);
      setPhone(user.phone);
      setPin('');
      setCode('');
      setResendIn(0);
      setError(null);
      setBusy(false);
    }
    // Only reset when the sheet opens, not when the profile updates mid-flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  if (!user) return null;

  const trimmedName = name.trim().replace(/\s+/g, ' ');
  const digits = normalizePhone(phone);
  const nameChanged = trimmedName !== user.name;
  const phoneChanged = digits !== user.phone;
  const nameOk = trimmedName.length > 0;
  const phoneOk = isValidPhone(digits);
  const canSave = (nameChanged || phoneChanged) && nameOk && phoneOk && !busy;

  const networkMessage = (e: unknown, fallback: string) =>
    e instanceof NetworkError ? 'You’re offline. Profile changes need a connection.' : fallback;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      if (nameChanged) {
        const res = await api.auth.me.$patch({ json: { name: trimmedName } });
        if (!res.ok) {
          setError(await apiErrorMessage(res, 'Couldn’t save your name.'));
          return;
        }
        await updateUser(toSessionUser(await res.json()));
      }
      if (phoneChanged) {
        if (await sendCode()) setStep('code');
        return;
      }
      showToast('Profile updated');
      onClose();
    } catch (e) {
      setError(networkMessage(e, 'Couldn’t save your profile.'));
    } finally {
      setBusy(false);
    }
  };

  // A WhatsApp code to the new number proves it's theirs (a typo would lock them out).
  const sendCode = async (): Promise<boolean> => {
    setError(null);
    try {
      const res = await api.auth.me.phone.code.$post({ json: { phone: digits } });
      const body = (await res.json().catch(() => null)) as
        | { message?: string; error?: string; retryAfter?: number; resendAfter?: number }
        | null;
      if (!res.ok) {
        setError(
          body?.message ??
            (body?.error === 'too_soon' ? `Wait ${body.retryAfter ?? 30}s before asking for another code.` : 'Couldn’t send the code.'),
        );
        if (body?.retryAfter) setResendIn(body.retryAfter);
        return false;
      }
      setCode('');
      setResendIn(body?.resendAfter ?? 30);
      return true;
    } catch (e) {
      setError(networkMessage(e, 'Couldn’t send the code.'));
      return false;
    }
  };

  const resend = async () => {
    if (busy || resendIn > 0) return;
    setBusy(true);
    if (await sendCode()) showToast(`New code sent to +91 ${formatPhone(digits)}`);
    setBusy(false);
  };

  // The number is the sign-in identity, so moving it also needs the current PIN.
  const confirmPhone = async (value: string) => {
    if (value.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.auth.me.phone.$post({ json: { phone: digits, pin: value, code } });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
        setError(body?.message ?? 'Couldn’t change your number.');
        setPin('');
        if (body?.error && CODE_ERRORS.has(body.error)) {
          setCode('');
          setStep('code');
        } else {
          setPinErrorKey((k) => k + 1);
        }
        return;
      }
      const body = await res.json();
      await signIn(body.token, toSessionUser(body.user));
      await setLoginHints(body.user.phone, 'pin');
      showToast(`Number updated — sign in with +91 ${formatPhone(body.user.phone)} from now on`);
      onClose();
    } catch (e) {
      setError(networkMessage(e, 'Couldn’t change your number.'));
    } finally {
      setBusy(false);
    }
  };

  const onPinChange = (value: string) => {
    setPin(value);
    if (error) setError(null);
    if (value.length === 6) void confirmPhone(value);
  };

  if (step === 'code') {
    const codeReady = code.length === LOGIN_CODE_LENGTH;
    return (
      <BottomSheet
        visible={visible}
        onClose={onClose}
        dismissable={!busy}
        title="Check WhatsApp on the new number"
        subtitle={`We sent a ${LOGIN_CODE_LENGTH}-digit code to +91 ${formatPhone(digits)}.`}
        footer={
          <Button
            label="Continue"
            size="lg"
            disabled={!codeReady || busy}
            onPress={() => {
              setPin('');
              setError(null);
              setStep('confirm');
            }}
          />
        }
      >
        <View style={[styles.iconField, styles.fieldFocus]}>
          <IconLock size={17} color={colors.water} />
          <TextInput
            style={[styles.iconInput, styles.codeDigits]}
            value={code}
            onChangeText={(t) => {
              setCode(t.replace(/\D/g, '').slice(0, LOGIN_CODE_LENGTH));
              if (error) setError(null);
            }}
            placeholder={'•'.repeat(LOGIN_CODE_LENGTH)}
            placeholderTextColor={colors.slate}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={LOGIN_CODE_LENGTH}
            autoFocus
            editable={!busy}
          />
        </View>
        {error ? (
          <View style={styles.errorRow}>
            <IconAlert size={14} color={colors.danger} />
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
        <Pressable
          onPress={() => void resend()}
          disabled={busy || resendIn > 0}
          hitSlop={8}
          style={({ pressed }) => [styles.backLink, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={[styles.link, resendIn > 0 && styles.linkMuted]}>
            {resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setStep('edit');
            setError(null);
          }}
          disabled={busy}
          hitSlop={8}
          style={({ pressed }) => [styles.backLink, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <IconChevronLeft size={15} color={colors.water} />
          <Text style={styles.link}>Use a different number</Text>
        </Pressable>
      </BottomSheet>
    );
  }

  if (step === 'confirm') {
    return (
      <BottomSheet
        visible={visible}
        onClose={onClose}
        dismissable={!busy}
        title="Confirm with your PIN"
        subtitle="Your number is how you sign in, so we check it’s really you."
        footer={
          <Button
            label="Update number"
            size="lg"
            loading={busy}
            disabled={pin.length < 4}
            onPress={() => void confirmPhone(pin)}
          />
        }
      >
        <View style={styles.moveBand}>
          <View style={styles.moveSide}>
            <Text style={styles.moveLabel}>From</Text>
            <Text style={[styles.moveNumber, styles.moveOld]}>+91 {formatPhone(user.phone)}</Text>
          </View>
          <View style={styles.moveArrow}>
            <IconChevronRight size={16} color={colors.white} />
          </View>
          <View style={[styles.moveSide, styles.moveSideRight]}>
            <Text style={styles.moveLabel}>To</Text>
            <Text style={[styles.moveNumber, styles.moveNew]}>+91 {formatPhone(digits)}</Text>
          </View>
        </View>

        <View style={styles.pinHead}>
          <View style={styles.pinIcon}>
            <IconLock size={16} color={colors.waterDeep} />
          </View>
          <Text style={styles.pinHeadText}>Enter your current PIN</Text>
        </View>
        <PinPad value={pin} onChange={onPinChange} errorKey={pinErrorKey} disabled={busy} />
        {error ? (
          <View style={[styles.errorRow, styles.center]}>
            <IconAlert size={14} color={colors.danger} />
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
        <Pressable
          onPress={() => {
            setStep('edit');
            setError(null);
          }}
          disabled={busy}
          hitSlop={8}
          style={({ pressed }) => [styles.backLink, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <IconChevronLeft size={15} color={colors.water} />
          <Text style={styles.link}>Use a different number</Text>
        </Pressable>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title="Edit profile"
      subtitle="Your name shows on every job and report you’re part of."
      footer={
        <Button
          label={
            phoneChanged
              ? 'Save & verify new number'
              : nameChanged
                ? 'Save changes'
                : 'No changes yet'
          }
          size="lg"
          loading={busy}
          disabled={!canSave}
          onPress={() => void save()}
        />
      }
    >
      <LinearGradient
        colors={gradients.hero as unknown as string[]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View pointerEvents="none" style={styles.orb} />
        <View style={styles.cardAvatar}>
          <Avatar name={trimmedName || user.name} id={user.id} size={60} />
        </View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardName} numberOfLines={1}>
            {trimmedName || 'Your name'}
          </Text>
          <Text style={styles.cardPhone}>+91 {formatPhone(digits) || '····· ·····'}</Text>
          <View style={styles.cardTags}>
            <View style={styles.cardTag}>
              {isOwner ? (
                <IconShield size={11} color={colors.white} />
              ) : (
                <IconPerson size={11} color={colors.white} />
              )}
              <Text style={styles.cardTagText}>{isOwner ? 'Owner' : 'Staff'}</Text>
            </View>
            {shop ? (
              <View style={styles.cardTag}>
                <IconStore size={11} color={colors.white} />
                <Text style={styles.cardTagText} numberOfLines={1}>
                  {shop.name}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </LinearGradient>

      <View style={styles.field}>
        <View style={styles.labelRow}>
          <Text style={styles.fieldLabel}>Full name</Text>
          {nameChanged && nameOk ? <Text style={styles.editedTag}>Edited</Text> : null}
        </View>
        <View
          style={[
            styles.iconField,
            focus === 'name' && styles.fieldFocus,
            !nameOk && styles.inputError,
          ]}
        >
          <IconPerson size={18} color={focus === 'name' ? colors.water : colors.slate} />
          <TextInput
            style={styles.iconInput}
            value={name}
            onChangeText={(t) => {
              setName(t);
              if (error) setError(null);
            }}
            onFocus={() => setFocus('name')}
            onBlur={() => setFocus(null)}
            placeholder="e.g. Ravi Kumar"
            placeholderTextColor={colors.slate}
            autoCapitalize="words"
            maxLength={60}
            editable={!busy}
            returnKeyType="done"
          />
          {nameOk ? <IconCheck size={16} color={colors.teal} /> : null}
        </View>
        {!nameOk ? <Text style={styles.error}>Name can’t be empty.</Text> : null}
      </View>

      <View style={styles.field}>
        <View style={styles.labelRow}>
          <Text style={styles.fieldLabel}>Mobile number</Text>
          {phoneChanged && phoneOk ? (
            <Text style={[styles.editedTag, styles.editedAmber]}>Needs code + PIN</Text>
          ) : null}
        </View>
        <View
          style={[
            styles.iconField,
            focus === 'phone' && styles.fieldFocus,
            phone.length > 0 && !phoneOk && styles.inputError,
          ]}
        >
          <IconPhone size={17} color={focus === 'phone' ? colors.water : colors.slate} />
          <Text style={styles.cc}>+91</Text>
          <View style={styles.phoneDivider} />
          <TextInput
            style={[styles.iconInput, styles.phoneDigits]}
            value={formatPhone(digits)}
            onChangeText={(t) => {
              setPhone(normalizePhone(t).slice(0, 10));
              if (error) setError(null);
            }}
            onFocus={() => setFocus('phone')}
            onBlur={() => setFocus(null)}
            placeholder="98765 43210"
            placeholderTextColor={colors.slate}
            keyboardType="phone-pad"
            maxLength={11}
            editable={!busy}
          />
          {phoneOk ? <IconCheck size={16} color={colors.teal} /> : null}
        </View>
        {phoneChanged && phoneOk ? (
          <View style={styles.notice}>
            <IconLock size={14} color={colors.amberDeep} />
            <Text style={styles.noticeText}>
              We’ll send a WhatsApp code to the new number, then you confirm with your PIN. You
              sign in with{' '}
              <Text style={styles.noticeStrong}>+91 {formatPhone(digits)}</Text> from then on.
            </Text>
          </View>
        ) : (
          <Text style={styles.helper}>
            {phone.length > 0 && !phoneOk
              ? `${Math.max(0, 10 - digits.length)} more digit${10 - digits.length === 1 ? '' : 's'}`
              : 'Used with your PIN to sign in.'}
          </Text>
        )}
      </View>

      <View style={styles.roleRow}>
        <View style={styles.roleIcon}>
          {isOwner ? (
            <IconShield size={16} color={colors.waterDeep} />
          ) : (
            <IconLock size={15} color={colors.slateDeep} />
          )}
        </View>
        <View style={styles.roleCopy}>
          <Text style={styles.roleTitle}>{isOwner ? 'Owner' : 'Staff'}</Text>
          <Text style={styles.roleText}>
            {isOwner
              ? 'Change roles from More → Team. Rename the shop from More → Shop.'
              : 'Only the owner can change roles or the shop name.'}
          </Text>
        </View>
      </View>

      {error ? (
        <View style={styles.errorRow}>
          <IconAlert size={14} color={colors.danger} />
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  orb: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: 'rgba(255,255,255,0.12)',
    top: -70,
    right: -40,
  },
  cardAvatar: { borderRadius: 33, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' },
  cardCopy: { flex: 1, gap: 2 },
  cardName: { ...typography.heading, fontSize: 20, color: colors.white },
  cardPhone: {
    ...typography.bodyStrong,
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 0.5,
  },
  cardTags: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  cardTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    height: 22,
    maxWidth: 150,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  cardTagText: {
    ...typography.caption,
    fontSize: 11.5,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: 0.2,
    flexShrink: 1,
  },

  field: { gap: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { ...typography.caption, color: colors.slateDeep },
  editedTag: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '800',
    color: colors.waterDeep,
    backgroundColor: colors.waterPale,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9,
    overflow: 'hidden',
    letterSpacing: 0.2,
  },
  editedAmber: { color: colors.amberDeep, backgroundColor: '#FEF3C7' },
  iconField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 54,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  fieldFocus: { borderColor: colors.water, backgroundColor: colors.white },
  inputError: { borderColor: '#FCA5A5' },
  iconInput: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: colors.waterInk,
    paddingVertical: 0,
  },
  phoneDigits: { letterSpacing: 0.8 },
  cc: { ...typography.bodyStrong, color: colors.slateDeep },
  phoneDivider: { width: 1, height: 22, backgroundColor: colors.border },
  helper: {
    ...typography.caption,
    fontSize: 12,
    color: colors.slate,
    letterSpacing: 0,
    lineHeight: 17,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#FFFBEB',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
  },
  noticeText: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.amberDeep,
    letterSpacing: 0,
    lineHeight: 17,
    flex: 1,
  },
  noticeStrong: { fontWeight: '800' },

  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingVertical: spacing.sm + 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  roleIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleCopy: { flex: 1, gap: 1 },
  roleTitle: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  roleText: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0 },

  moveBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  moveSide: { flex: 1, gap: 2 },
  moveSideRight: { alignItems: 'flex-end' },
  moveLabel: {
    ...typography.caption,
    fontSize: 11,
    color: colors.slate,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  moveNumber: { ...typography.bodyStrong, fontSize: 15, letterSpacing: 0.3 },
  moveOld: { color: colors.slate, textDecorationLine: 'line-through' },
  moveNew: { color: colors.tealDeep, fontWeight: '800' },
  moveArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  pinIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinHeadText: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  error: {
    ...typography.label,
    color: colors.danger,
    textTransform: 'none',
    lineHeight: 19,
    flexShrink: 1,
  },
  center: { justifyContent: 'center' },
  backLink: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 2 },
  link: { ...typography.label, color: colors.water, fontSize: 14 },
  linkMuted: { color: colors.slate },
  codeDigits: { letterSpacing: 6, fontSize: 20 },
});
