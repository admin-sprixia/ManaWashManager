import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { checkPin, pinProblemMessage, SENIOR_PIN_DIGITS } from '@mana/domain';
import { BottomSheet, Button, IconAlert, IconCheck, IconLock, colors, spacing } from '@mana/ui';
import { PinPad } from './PinPad';
import { SheetHead, SheetNotice } from './SheetBits';

interface SetPinSheetProps {
  visible: boolean;
  title: string;
  /** Whose PIN this is — shown under the title. */
  subtitle: string;
  onClose: () => void;
  /** Ask for the current PIN first (changing your own PIN). */
  askCurrent?: boolean;
  /** Owners, managers and HQ: the new PIN must be 6 digits. */
  senior?: boolean;
  /**
   * Resolve with an error message to stay open, or null on success. Return
   * `{ currentPinError }` when the server rejected the current PIN, to go back to that step.
   */
  onSubmit: (pin: string, currentPin?: string) => Promise<string | null | { currentPinError: string }>;
}

type Step = 'current' | 'choose' | 'confirm';

/**
 * (Current →) choose → confirm a PIN: 4–6 digits, or 6 for `senior`. Weak PINs (1234, 0000)
 * are caught before any request.
 */
export function SetPinSheet({ visible, title, subtitle, onClose, askCurrent, senior = false, onSubmit }: SetPinSheetProps) {
  const firstStep: Step = askCurrent ? 'current' : 'choose';
  const minDigits = senior ? SENIOR_PIN_DIGITS : 4;
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
      const problem = checkPin(value, senior);
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
        ? `Choose a ${askCurrent ? 'new ' : ''}${senior ? '6' : '4–6'} digit PIN`
        : 'Enter the same PIN again';

  const caption =
    step === 'current' ? 'The PIN you sign in with today.' : 'Avoid easy ones like 1234 or 0000.';

  const steps: Step[] = askCurrent ? ['current', 'choose', 'confirm'] : ['choose', 'confirm'];
  const stepIndex = steps.indexOf(step);

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
          disabled={value.length < (step === 'current' ? 4 : minDigits)}
          onPress={() => void next()}
        />
      }
    >
      <SheetHead
        icon={
          step === 'confirm' ? (
            <IconCheck size={21} color={colors.teal} />
          ) : (
            <IconLock size={21} color={colors.indigo} />
          )
        }
        title={heading}
        caption={caption}
        right={
          <View style={styles.dots} accessibilityLabel={`Step ${stepIndex + 1} of ${steps.length}`}>
            {steps.map((s, i) => (
              <View key={s} style={[styles.dot, i <= stepIndex && styles.dotOn]} />
            ))}
          </View>
        }
      />
      <PinPad value={value} onChange={setValue} errorKey={errorKey} disabled={busy} />
      {error ? (
        <SheetNotice tone="danger" icon={<IconAlert size={14} color={colors.danger} />}>
          {error}
        </SheetNotice>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.indigoMist },
  dotOn: { backgroundColor: colors.indigo, width: spacing.md },
});
