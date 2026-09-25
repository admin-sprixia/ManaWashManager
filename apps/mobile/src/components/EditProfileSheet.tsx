import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { isValidPhone, normalizePhone } from '@mana/domain';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Avatar } from './Avatar';
import { IconLock } from './Icons';
import { showToast } from './Toast';
import { colors, radius, spacing, typography } from '../theme';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useAuth } from '../api/auth';
import { getLoginHints, setLoginHints, type SessionUser } from '../api/session';

const RESEND_SECONDS = 30;

function formatPhone(digits: string): string {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

function toSessionUser(u: { id: string; name: string; phone: string; role: string; hasPin: boolean }): SessionUser {
  return { ...u, role: u.role === 'owner' ? 'owner' : 'staff' };
}

type Step = 'edit' | 'verify';

export function EditProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user, isOwner, updateUser, signIn } = useAuth();
  const [step, setStep] = useState<Step>('edit');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const codeInput = useRef<TextInput>(null);

  useEffect(() => {
    if (visible && user) {
      setStep('edit');
      setName(user.name);
      setPhone(user.phone);
      setCode('');
      setError(null);
      setBusy(false);
      setResendIn(0);
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

  const sendCode = async (): Promise<boolean> => {
    const res = await api.auth.me.phone.send.$post({ json: { phone: digits } });
    if (!res.ok) {
      setError(await apiErrorMessage(res, 'Couldn’t send a code to that number.'));
      return false;
    }
    setResendIn(RESEND_SECONDS);
    return true;
  };

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
        if (await sendCode()) {
          setCode('');
          setStep('verify');
        }
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

  const verify = async (value: string) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.auth.me.phone.verify.$post({ json: { phone: digits, code: value } });
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t verify that code.'));
        setCode('');
        return;
      }
      const body = await res.json();
      const hints = await getLoginHints();
      await signIn(body.token, toSessionUser(body.user));
      await setLoginHints(body.user.phone, hints.method);
      showToast(`Number updated — sign in with +91 ${formatPhone(body.user.phone)} from now on`);
      onClose();
    } catch (e) {
      setError(networkMessage(e, 'Couldn’t verify that code.'));
    } finally {
      setBusy(false);
    }
  };

  const onCodeChange = (text: string) => {
    const next = text.replace(/\D/g, '').slice(0, 6);
    setCode(next);
    if (error) setError(null);
    if (next.length === 6) void verify(next);
  };

  const resend = async () => {
    if (resendIn > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await sendCode()) showToast('New code sent');
    } catch (e) {
      setError(networkMessage(e, 'Couldn’t send a new code.'));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'verify') {
    return (
      <BottomSheet
        visible={visible}
        onClose={onClose}
        dismissable={!busy}
        title="Confirm your new number"
        subtitle={`Enter the 6-digit code sent by SMS to +91 ${formatPhone(digits)}.`}
        footer={
          <Button
            label="Verify & update number"
            size="lg"
            loading={busy}
            disabled={code.length !== 6}
            onPress={() => void verify(code)}
          />
        }
      >
        <Pressable style={styles.codeRow} onPress={() => codeInput.current?.focus()}>
          {Array.from({ length: 6 }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.codeBox,
                i === code.length && !busy ? styles.codeBoxActive : null,
                error ? styles.inputError : null,
              ]}
            >
              <Text style={styles.codeDigit}>{code[i] ?? ''}</Text>
            </View>
          ))}
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
        <View style={styles.linkRow}>
          <Pressable
            onPress={() => {
              setStep('edit');
              setError(null);
            }}
            disabled={busy}
            hitSlop={8}
          >
            <Text style={styles.link}>Change number</Text>
          </Pressable>
          <Pressable onPress={() => void resend()} disabled={resendIn > 0 || busy} hitSlop={8}>
            <Text style={[styles.link, resendIn > 0 && styles.linkDisabled]}>
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </Text>
          </Pressable>
        </View>
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
          label={phoneChanged ? 'Save & verify number' : 'Save changes'}
          size="lg"
          loading={busy}
          disabled={!canSave}
          onPress={() => void save()}
        />
      }
    >
      <View style={styles.preview}>
        <Avatar name={trimmedName || user.name} id={user.id} size={64} />
        <View style={styles.previewCopy}>
          <Text style={styles.previewName} numberOfLines={1}>
            {trimmedName || 'Your name'}
          </Text>
          <Text style={styles.previewMeta}>{isOwner ? 'Owner' : 'Staff'}</Text>
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Name</Text>
        <TextInput
          style={[styles.input, !nameOk ? styles.inputError : null]}
          value={name}
          onChangeText={(t) => {
            setName(t);
            if (error) setError(null);
          }}
          placeholder="e.g. Ravi Kumar"
          placeholderTextColor={colors.slate}
          autoCapitalize="words"
          maxLength={60}
          editable={!busy}
          returnKeyType="done"
        />
        {!nameOk ? <Text style={styles.error}>Name can’t be empty.</Text> : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Mobile number</Text>
        <View style={[styles.phoneField, phone.length > 0 && !phoneOk ? styles.inputError : null]}>
          <Text style={styles.cc}>+91</Text>
          <View style={styles.phoneDivider} />
          <TextInput
            style={styles.phoneInput}
            value={formatPhone(digits)}
            onChangeText={(t) => {
              setPhone(normalizePhone(t).slice(0, 10));
              if (error) setError(null);
            }}
            placeholder="98765 43210"
            placeholderTextColor={colors.slate}
            keyboardType="phone-pad"
            maxLength={11}
            editable={!busy}
          />
        </View>
        <Text style={styles.helper}>
          {phoneChanged
            ? 'We’ll text a code to the new number. You’ll sign in with it from then on.'
            : 'Used to sign in with an SMS code or your PIN.'}
        </Text>
      </View>

      <View style={styles.roleRow}>
        <View style={styles.roleIcon}>
          <IconLock size={15} color={colors.slateDeep} />
        </View>
        <Text style={styles.roleText}>
          Role: <Text style={styles.roleStrong}>{isOwner ? 'Owner' : 'Staff'}</Text>
          {isOwner ? ' · Change roles from Team.' : ' · Only the owner can change roles.'}
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  previewCopy: { flex: 1, gap: 2 },
  previewName: { ...typography.heading, color: colors.waterInk },
  previewMeta: {
    ...typography.caption,
    color: colors.slateDeep,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  field: { gap: 6 },
  fieldLabel: { ...typography.caption, color: colors.slateDeep },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    fontSize: 17,
    fontWeight: '600',
    color: colors.waterInk,
    backgroundColor: colors.surface,
  },
  inputError: { borderColor: '#FCA5A5' },
  phoneField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  cc: { ...typography.bodyStrong, color: colors.slateDeep },
  phoneDivider: { width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: spacing.sm + 2 },
  phoneInput: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: colors.waterInk,
    paddingVertical: spacing.sm + 4,
    letterSpacing: 0.5,
  },
  helper: { ...typography.caption, color: colors.slate, letterSpacing: 0, lineHeight: 17 },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
  },
  roleIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleText: { ...typography.body, color: colors.slateDeep, fontSize: 13, flex: 1 },
  roleStrong: { fontWeight: '700', color: colors.waterInk },
  error: { ...typography.label, color: colors.danger, textTransform: 'none', lineHeight: 19 },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  codeBox: {
    width: 46,
    height: 56,
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
  linkRow: { flexDirection: 'row', justifyContent: 'space-between' },
  link: { ...typography.label, color: colors.water, fontSize: 14 },
  linkDisabled: { color: colors.slate },
});
