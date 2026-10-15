import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing, typography, BottomSheet, Button } from '@mana/ui';
import { MAX_SERVICE_PRICE_PAISE } from '@mana/domain';
import { formatRupees, parseRupees } from '../utils/format';

interface PriceSheetProps {
  visible: boolean;
  title: string;
  price: number | null;
  commission: number | null;
  onClose: () => void;
  /** Amounts in paise; commission null clears it. Resolves with an error message or null. */
  onSave: (price: number, commission: number | null) => Promise<string | null>;
  /** Stops offering this service for this vehicle. Shown only when given. */
  onRemove?: () => Promise<string | null>;
  /**
   * A business price list price: the branch may charge its own price within `range`, or none
   * at all when `range` is null (the business switched branch prices off).
   */
  business?: { listPrice: number; range: { min: number; max: number } | null; overridden: boolean };
  /** Goes back to the business price. Shown only when given. */
  onReset?: () => Promise<string | null>;
}

const TOO_LARGE = `That price looks too large (over ${formatRupees(MAX_SERVICE_PRICE_PAISE)}). Check for extra zeros.`;

function toRupeesText(paise: number | null): string {
  return paise == null ? '' : String(paise / 100);
}

/** Price for one service on one vehicle size, and the staff commission for getting a customer to take it. */
export function PriceSheet({
  visible,
  title,
  price,
  commission,
  onClose,
  onSave,
  onRemove,
  business,
  onReset,
}: PriceSheetProps) {
  const [priceText, setPriceText] = useState('');
  const [commissionText, setCommissionText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPriceText(toRupeesText(price));
    setCommissionText(toRupeesText(commission));
    setError(null);
    setBusy(false);
  }, [visible, price, commission]);

  const priceLocked = business != null && business.range == null;
  const p = priceLocked ? price : parseRupees(priceText);
  const c = parseRupees(commissionText);
  const inRange = !business?.range || (p != null && p >= business.range.min && p <= business.range.max);
  const priceOk = p != null && !Number.isNaN(p) && inRange;
  const commissionOk = c == null || (!Number.isNaN(c) && priceOk && c <= p);

  const save = async () => {
    if (!priceOk || !commissionOk) return;
    if (p > MAX_SERVICE_PRICE_PAISE) {
      setError(TOO_LARGE);
      return;
    }
    setBusy(true);
    setError(null);
    const message = await onSave(p, c);
    setBusy(false);
    if (message) setError(message);
  };

  const runAction = async (action: (() => Promise<string | null>) | undefined) => {
    if (!action) return;
    setBusy(true);
    setError(null);
    const message = await action();
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={title}
      footer={
        <View style={styles.footer}>
          <Button label="Save" size="lg" loading={busy} disabled={!priceOk || !commissionOk} onPress={() => void save()} />
          {onReset && business?.overridden ? (
            <Button
              label={`Use the business price (${formatRupees(business.listPrice)})`}
              variant="ghost"
              disabled={busy}
              onPress={() => void runAction(onReset)}
            />
          ) : null}
          {onRemove ? (
            <Button label="Not offered for this vehicle" variant="ghost" disabled={busy} onPress={() => void runAction(onRemove)} />
          ) : null}
        </View>
      }
    >
      <View style={styles.field}>
        <Text style={styles.label}>Customer price</Text>
        <View style={[styles.inputRow, priceLocked && styles.inputLocked, !inRange && styles.inputError]}>
          <Text style={styles.rupee}>₹</Text>
          <TextInput
            style={styles.input}
            value={priceText}
            onChangeText={setPriceText}
            keyboardType="numeric"
            placeholder="400"
            placeholderTextColor={colors.slate}
            autoFocus={!priceLocked}
            editable={!priceLocked}
            maxLength={7}
          />
        </View>
        {business ? (
          <Text style={[styles.helper, !inRange && styles.helperError]}>
            {business.range
              ? `Business price ${formatRupees(business.listPrice)}. This branch can charge ${formatRupees(business.range.min)} to ${formatRupees(business.range.max)}.`
              : `The business sets this price (${formatRupees(business.listPrice)}). Ask a business admin to change it.`}
          </Text>
        ) : null}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Staff commission (optional)</Text>
        <View style={[styles.inputRow, !commissionOk && styles.inputError]}>
          <Text style={styles.rupee}>₹</Text>
          <TextInput
            style={styles.input}
            value={commissionText}
            onChangeText={setCommissionText}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={colors.slate}
            maxLength={7}
          />
        </View>
        <Text style={[styles.helper, !commissionOk && styles.helperError]}>
          {!commissionOk
            ? 'Commission can’t be more than the price.'
            : 'Only for services worth rewarding, like rust coating. Paid to whoever got the customer to take it, once the job is paid. Leave empty for no commission. Changes apply to new washes only.'}
        </Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.xs },
  field: { gap: 6 },
  label: { ...typography.caption, color: colors.slateDeep },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  inputError: { borderColor: '#FCA5A5' },
  inputLocked: { opacity: 0.6 },
  rupee: { ...typography.heading, color: colors.slateDeep, marginRight: spacing.xs },
  input: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: colors.waterInk,
    paddingVertical: spacing.sm + 4,
  },
  helper: { ...typography.caption, color: colors.slate, letterSpacing: 0, lineHeight: 17 },
  helperError: { color: colors.danger },
  error: { ...typography.label, color: colors.danger, textTransform: 'none' },
});
