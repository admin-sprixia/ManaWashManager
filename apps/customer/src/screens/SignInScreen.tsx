import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  isValidPhone,
  LOGIN_CODE_LENGTH,
  LOGIN_CODE_RESEND_SECONDS,
  LOGIN_CODE_TTL_MINUTES,
  normalizePhone,
} from '@mana/domain';
import {
  Button,
  CodeEntry,
  IconShield,
  Notice,
  PhoneField,
  colors,
  formatPhone,
  spacing,
  typography,
} from '@mana/ui';
import { api, send } from '../api/client';
import { ApiError, errorMessage } from '../api/errors';
import { getLastPhone } from '../api/session';
import { useAuth } from '../auth/AuthProvider';
import { HeroSheet } from '../components/HeroSheet';
import { useCountdown } from '../hooks/useCountdown';

type Step = 'phone' | 'code';

/** Number → WhatsApp code. Customers land in the app; anyone else can ask for service. */
export function SignInScreen({ notice }: { notice: string | null }) {
  const { signedIn, startRequesting } = useAuth();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [resendIn, startResend] = useCountdown();
  const checkingRef = useRef(false);

  useEffect(() => {
    void getLastPhone().then((p) => setPhone((current) => current || p));
  }, []);

  const sendCode = useCallback(async () => {
    if (!isValidPhone(phone)) {
      setError('Enter your 10-digit mobile number.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const sent = await send(api.auth.code.$post({ json: { phone } }));
      startResend(sent.resendAfter);
      setCode('');
      setStep('code');
    } catch (err) {
      // A code sent a moment ago still works: go to the code step and wait out the timer.
      if (err instanceof ApiError && err.code === 'too_soon') {
        startResend(LOGIN_CODE_RESEND_SECONDS);
        setStep('code');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setSending(false);
    }
  }, [phone, startResend]);

  const verify = useCallback(
    async (entered: string) => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      setChecking(true);
      setError(null);
      try {
        const result = await send(api.auth.verify.$post({ json: { phone, code: entered } }));
        if (result.status === 'signed_in') await signedIn(result.token, result.account);
        else await startRequesting({ phone, ticket: result.ticket });
      } catch (err) {
        setError(errorMessage(err));
        setCode('');
      } finally {
        checkingRef.current = false;
        setChecking(false);
      }
    },
    [phone, signedIn, startRequesting],
  );

  if (step === 'code') {
    return (
      <HeroSheet
        hero={{
          title: 'Check WhatsApp',
          subtitle: 'We sent you a code to confirm it’s your number.',
          onBack: () => setStep('phone'),
          phoneChip: { label: `+91 ${formatPhone(phone)}`, onPress: () => setStep('phone') },
        }}
      >
        <CodeEntry
          phone={phone}
          codeLength={LOGIN_CODE_LENGTH}
          validMinutes={LOGIN_CODE_TTL_MINUTES}
          value={code}
          onChange={(v) => {
            setCode(v);
            if (error) setError(null);
          }}
          onComplete={(v) => void verify(v)}
          loading={checking}
          sending={sending}
          error={error}
          resendIn={resendIn}
          onResend={() => void sendCode()}
        />
      </HeroSheet>
    );
  }

  return (
    <HeroSheet
      hero={{
        title: 'Car wash, the easy way',
        subtitle: 'See your washes and photos, collect free washes, or ask us to come to you.',
        tall: true,
      }}
    >
      {notice ? <Notice tone="warning">{notice}</Notice> : null}
      <PhoneField
        digits={phone}
        onChangeDigits={(d) => {
          setPhone(d);
          if (error) setError(null);
        }}
        normalize={normalizePhone}
        error={error}
        hint="We’ll send a code on WhatsApp."
        autoFocus={!phone}
        onSubmit={() => void sendCode()}
      />
      <Button label="Continue" size="lg" onPress={() => void sendCode()} loading={sending} />
      <View style={styles.trust}>
        <IconShield size={14} color={colors.slate} />
        <Text style={styles.trustText}>Only you can see your cars, washes and photos.</Text>
      </View>
    </HeroSheet>
  );
}

const styles = StyleSheet.create({
  trust: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.sm },
  trustText: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
});
