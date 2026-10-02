import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import { MAX_SERVICE_PRICE_PAISE } from '@mana/domain';
import { formatRupees, parseRupees } from '../utils/format';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Pill } from './EdgeList';
import { showUpgrade } from './UpgradeSheet';
import { useProPill } from '../offline/PlanProvider';

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
  /** Free plan: commission is shown as a Pro feature instead of an input, and left unchanged. */
  commissionLocked?: boolean;
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
  commissionLocked,
}: PriceSheetProps) {
  const [priceText, setPriceText] = useState('');
  const [commissionText, setCommissionText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const proPill = useProPill();

  useEffect(() => {
    if (!visible) return;
    setPriceText(toRupeesText(price));
    setCommissionText(toRupeesText(commission));
    setError(null);
    setBusy(false);
  }, [visible, price, commission]);

  const p = parseRupees(priceText);
  const c = commissionLocked ? commission : parseRupees(commissionText);
  const priceOk = p != null && !Number.isNaN(p);
  const commissionOk = commissionLocked || c == null || (!Number.isNaN(c) && priceOk && c <= p);

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

  const remove = async () => {
    if (!onRemove) return;
    setBusy(true);
    setError(null);
    const message = await onRemove();
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
          {onRemove ? (
            <Button label="Not offered for this vehicle" variant="ghost" disabled={busy} onPress={() => void remove()} />
          ) : null}
        </View>
      }
    >
      <View style={styles.field}>
        <Text style={styles.label}>Customer price</Text>
        <View style={styles.inputRow}>
          <Text style={styles.rupee}>₹</Text>
          <TextInput
            style={styles.input}
            value={priceText}
            onChangeText={setPriceText}
            keyboardType="numeric"
            placeholder="400"
            placeholderTextColor={colors.slate}
            autoFocus
            maxLength={7}
          />
        </View>
      </View>
      {commissionLocked ? (
        <Pressable
          style={styles.locked}
          onPress={() => {
            onClose();
            showUpgrade({ kind: 'feature', feature: 'commission' });
          }}
          accessibilityRole="button"
        >
          <View style={styles.flex}>
            <Text style={styles.lockedTitle}>Staff commission</Text>
            <Text style={styles.helper}>Reward staff for selling services like rust coating.</Text>
          </View>
          <Pill label="PRO" tone="slate" />
        </Pressable>
      ) : (
      <View style={styles.field}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>Staff commission (optional)</Text>
          {proPill}
        </View>
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
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.xs },
  field: { gap: 6 },
  label: { ...typography.caption, color: colors.slateDeep },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  flex: { flex: 1, gap: 2 },
  locked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  lockedTitle: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
});
