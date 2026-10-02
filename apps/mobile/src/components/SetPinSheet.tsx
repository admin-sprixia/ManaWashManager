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
  /** Ask for the current PIN first (changing your own PIN). */
  askCurrent?: boolean;
  /**
   * Resolve with an error message to stay open, or null on success. Return
   * `{ currentPinError }` when the server rejected the current PIN, to go back to that step.
   */
  onSubmit: (pin: string, currentPin?: string) => Promise<string | null | { currentPinError: string }>;
}

type Step = 'current' | 'choose' | 'confirm';

/**
 * (Current →) choose → confirm a 4–6 digit PIN. Weak PINs (1234, 0000) are caught before any
 * request.
 */
export function SetPinSheet({ visible, title, subtitle, onClose, askCurrent, onSubmit }: SetPinSheetProps) {
  const firstStep: Step = askCurrent ? 'current' : 'choose';
  const [step, setStep] = useState<Step>(firstStep);
  const [current, setCurrent] = useState('');
  const [first, setFirst] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStep(firstStep);
    setCurrent('');
    setFirst('');
    setValue('');
    setError(null);
    setBusy(false);
  }, [visible, firstStep]);

  const fail = (message: string) => {
    setError(message);
    setErrorKey((k) => k + 1);
  };

  const next = async () => {
    if (step === 'current') {
      setCurrent(value);
      setValue('');
      setError(null);
      setStep('choose');
      return;
    }
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
    const result = await onSubmit(value, askCurrent ? current : undefined);
    setBusy(false);
    if (result && typeof result === 'object') {
      setValue('');
      setFirst('');
      setCurrent('');
      setStep('current');
      fail(result.currentPinError);
    } else if (result) {
      fail(result);
    }
  };

  const heading =
    step === 'current'
      ? 'Enter your current PIN'
      : step === 'choose'
        ? `Choose a ${askCurrent ? 'new ' : ''}4–6 digit PIN`
        : 'Enter the same PIN again';

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={title}
      subtitle={subtitle}
      footer={
        <Button
          label={step === 'confirm' ? 'Save PIN' : 'Next'}
          size="lg"
          loading={busy}
          disabled={value.length < 4}
          onPress={() => void next()}
        />
      }
    >
      <Text style={styles.step}>{heading}</Text>
      <PinPad value={value} onChange={setValue} errorKey={errorKey} disabled={busy} />
      <Text style={[styles.hint, error ? styles.error : null]}>
        {error ??
          (step === 'current'
            ? 'The PIN you sign in with today.'
            : 'Avoid easy ones like 1234 or 0000.')}
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
