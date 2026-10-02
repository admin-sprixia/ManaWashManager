import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SHOP_TRIAL_DAYS } from '@mana/domain';
import { Button } from '../Button';
import { colors, radius, spacing, typography } from '../../theme';
import { api } from '../../api/client';
import { useAuth } from '../../api/auth';
import { setLoginHints, type SessionUser } from '../../api/session';
import { ChoosePin } from './ChoosePin';
import { CodeEntry } from './CodeEntry';
import { describeError, useSignupCode } from './useSignupCode';

type Step = 'code' | 'pin' | 'details';

const STEP_NUMBER: Record<Step, number> = { code: 1, pin: 2, details: 3 };

interface CreateShopBody {
  token?: string;
  user?: SessionUser;
  error?: string;
  message?: string;
}

/**
 * A new owner starting a shop: WhatsApp code → choose a PIN (twice) → their name, shop name and
 * city. Nothing is saved until the last step, so closing the app halfway leaves nothing behind.
 */
export function SignUpFlow({ phone, onBack }: { phone: string; onBack: () => void }) {
  const { signIn } = useAuth();
  const otp = useSignupCode(phone, 'signup');
  const [step, setStep] = useState<Step>('code');
  const [ticket, setTicket] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [shopName, setShopName] = useState('');
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void otp.request();
    // Send once when the flow opens; "Send a new code" handles the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async (value: string) => {
    const next = await otp.verify(value);
    if (next) {
      setTicket(next);
      setStep('pin');
    }
  };

  const canCreate = name.trim().length > 0 && shopName.trim().length >= 2 && !saving;

  const create = async () => {
    if (!ticket || !canCreate) return;
    setError(null);
    setSaving(true);
    try {
      const res = await api.signup.shop.$post({
        json: {
          ticket,
          pin,
          name: name.trim(),
          shopName: shopName.trim(),
          city: city.trim() || undefined,
        },
      });
      const body = (await res.json().catch(() => null)) as CreateShopBody | null;
      if (res.ok && body?.token && body.user) {
        await setLoginHints(phone, 'pin');
        await signIn(body.token, body.user);
        return;
      }
      if (body?.error === 'ticket_expired') {
        setTicket(null);
        otp.setCode('');
        setStep('code');
        void otp.request();
        otp.setError(body.message ?? 'That took too long — we sent a new code.');
        return;
      }
      if (body?.error === 'weak_pin') {
        setStep('pin');
        return;
      }
      setError(body?.message ?? 'Couldn’t create the shop.');
    } catch (e) {
      setError(describeError(e, 'Couldn’t create the shop.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Text style={styles.stepLabel}>New shop · step {STEP_NUMBER[step]} of 3</Text>

      {step === 'code' ? (
        <>
          <CodeEntry
            phone={phone}
            value={otp.code}
            onChange={(v) => {
              otp.setCode(v);
              if (otp.error) otp.setError(null);
            }}
            onComplete={(v) => void verify(v)}
            loading={otp.checking}
            sending={otp.sending}
            error={otp.error}
            resendIn={otp.resendIn}
            onResend={() => void otp.request()}
          />
          <View style={styles.linkRow}>
            <Pressable onPress={onBack} hitSlop={8}>
              <Text style={styles.link}>Back</Text>
            </Pressable>
          </View>
        </>
      ) : step === 'pin' ? (
        <>
          <ChoosePin
            onDone={(chosen) => {
              setPin(chosen);
              setStep('details');
              return Promise.resolve(null);
            }}
          />
          <View style={styles.linkRow}>
            <Pressable onPress={onBack} hitSlop={8}>
              <Text style={styles.link}>Start again</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.title}>About your shop</Text>
          <Text style={styles.subtitle}>This is what your team and customers will see.</Text>

          <Text style={styles.fieldLabel}>Your name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Arun Kumar"
            placeholderTextColor={colors.slate}
            autoCapitalize="words"
            autoFocus
            maxLength={60}
            returnKeyType="next"
          />
          <Text style={styles.fieldLabel}>Shop name</Text>
          <TextInput
            style={styles.input}
            value={shopName}
            onChangeText={setShopName}
            placeholder="e.g. Bubble Car Wash"
            placeholderTextColor={colors.slate}
            autoCapitalize="words"
            maxLength={60}
            returnKeyType="next"
          />
          <Text style={styles.fieldLabel}>City (optional)</Text>
          <TextInput
            style={styles.input}
            value={city}
            onChangeText={setCity}
            placeholder="e.g. Hyderabad"
            placeholderTextColor={colors.slate}
            autoCapitalize="words"
            maxLength={40}
            returnKeyType="done"
            onSubmitEditing={() => void create()}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Button
              label="Create my shop"
              size="lg"
              onPress={() => void create()}
              loading={saving}
              disabled={!canCreate}
            />
          </View>
          <Text style={styles.footnote}>
            Free for {SHOP_TRIAL_DAYS} days. You can add your team straight after.
          </Text>
          <View style={styles.linkRow}>
            <Pressable onPress={() => setStep('pin')} hitSlop={8} disabled={saving}>
              <Text style={styles.link}>Change PIN</Text>
            </Pressable>
          </View>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  stepLabel: { ...typography.caption, color: colors.water, letterSpacing: 0.5 },
  title: { ...typography.title, color: colors.waterInk },
  subtitle: { ...typography.body, color: colors.slateDeep, fontSize: 15, marginBottom: spacing.xs },
  fieldLabel: { ...typography.caption, color: colors.slateDeep, marginTop: spacing.sm },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    fontSize: 17,
    fontWeight: '600',
    color: colors.waterInk,
  },
  error: {
    ...typography.label,
    color: colors.danger,
    textTransform: 'none',
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  actions: { marginTop: spacing.md },
  footnote: { ...typography.caption, color: colors.slate, letterSpacing: 0, textAlign: 'center' },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  link: { ...typography.label, color: colors.water, fontSize: 14 },
});
