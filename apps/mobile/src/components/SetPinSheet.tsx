import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { checkPin, pinProblemMessage } from '@mana/domain';
import { colors, spacing, typography } from '../theme';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { PinPad } from './PinPad';

interface SetPinSheetProps {
  visible: boolean;
  title: string;
  /** Whose PIN this is — shown under the title. */
  subtitle: string;
  onClose: () => void;
  /** Resolve with an error message to stay open, or null on success. */
  onSubmit: (pin: string) => Promise<string | null>;
}

/** Choose → confirm a 4–6 digit PIN. Weak PINs (1234, 0000) are caught before any request. */
export function SetPinSheet({ visible, title, subtitle, onClose, onSubmit }: SetPinSheetProps) {
  const [step, setStep] = useState<'choose' | 'confirm'>('choose');
  const [first, setFirst] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStep('choose');
    setFirst('');
    setValue('');
    setError(null);
    setBusy(false);
  }, [visible]);

  const fail = (message: string) => {
    setError(message);
    setErrorKey((k) => k + 1);
  };

  const next = async () => {
    if (step === 'choose') {
      const problem = checkPin(value);
      if (problem) return fail(pinProblemMessage(problem));
      setFirst(value);
      setValue('');
      setError(null);
      setStep('confirm');
      return;
    }
    if (value !== first) {
      setValue('');
      setFirst('');
      setStep('choose');
      return fail('PINs didn’t match. Start again.');
    }
    setBusy(true);
    const message = await onSubmit(value);
    setBusy(false);
    if (message) fail(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={title}
      subtitle={subtitle}
      footer={
        <Button
          label={step === 'choose' ? 'Next' : 'Save PIN'}
          size="lg"
          loading={busy}
          disabled={value.length < 4}
          onPress={() => void next()}
        />
      }
    >
      <Text style={styles.step}>
        {step === 'choose' ? 'Choose a 4–6 digit PIN' : 'Enter the same PIN again'}
      </Text>
      <PinPad value={value} onChange={setValue} errorKey={errorKey} disabled={busy} />
      <Text style={[styles.hint, error ? styles.error : null]}>
        {error ?? 'Avoid easy ones like 1234 or 0000.'}
      </Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  step: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  hint: { ...typography.caption, color: colors.slate, textAlign: 'center', letterSpacing: 0 },
  error: { color: colors.danger, fontWeight: '600' },
});
