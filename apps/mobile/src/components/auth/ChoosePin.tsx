import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { checkPin, pinProblemMessage } from '@mana/domain';
import { Button } from '../Button';
import { PinPad } from '../PinPad';
import { colors, spacing, typography } from '../../theme';

interface ChoosePinProps {
  /** Saves the PIN once it's been entered twice. Returns an error message, or null on success. */
  onDone: (pin: string) => Promise<string | null>;
  greeting?: string;
}

/** Pick a PIN, then type it again. Easy ones (1234, 0000) are refused before the second go. */
export function ChoosePin({ onDone, greeting }: ChoosePinProps) {
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
      setValue('');
      if (problem) return fail(pinProblemMessage(problem));
      setFirst(pin);
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
    const problem = await onDone(pin);
    if (problem) {
      setBusy(false);
      setValue('');
      setFirst('');
      setStep('choose');
      fail(problem);
    }
  };

  const onChange = (pin: string) => {
    setValue(pin);
    if (error) setError(null);
    if (pin.length === 6) void next(pin);
  };

  return (
    <>
      <Text style={[styles.title, styles.center]}>
        {step === 'choose' ? (greeting ?? 'Choose a PIN') : 'Enter it once more'}
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
        <Button
          label={step === 'choose' ? 'Next' : 'Save PIN'}
          size="lg"
          onPress={() => void next()}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.waterInk },
  subtitle: { ...typography.body, color: colors.slateDeep, fontSize: 15 },
  center: { textAlign: 'center' },
  pinWrap: { marginTop: spacing.md },
  status: { minHeight: 40, justifyContent: 'center' },
  hint: { ...typography.caption, color: colors.slate, textAlign: 'center', letterSpacing: 0 },
  error: { color: colors.danger, fontWeight: '600' },
});
