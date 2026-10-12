import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MIN_REASON_LENGTH, PAYMENT_METHOD_LABEL, type PaymentMethod } from '@mana/domain';
import {
  colors,
  radius,
  spacing,
  typography,
  BottomSheet,
  Button,
  IconCash,
  IconUpi,
  IconWallet,
} from '@mana/ui';
import { formatRupees } from '../utils/format';
import { useShop } from '../offline/ShopProvider';
import { UpiQr } from './UpiQr';

const METHODS: { key: PaymentMethod; hint: string; Icon: typeof IconCash; accent: string; tint: string }[] = [
  { key: 'cash', hint: 'Notes & coins', Icon: IconCash, accent: colors.teal, tint: '#CCFBF1' },
  { key: 'upi', hint: 'GPay, PhonePe, Paytm', Icon: IconUpi, accent: colors.waterDeep, tint: colors.waterPale },
  { key: 'other', hint: 'Card, credit, etc.', Icon: IconWallet, accent: colors.slateDeep, tint: '#F1F5F9' },
];

interface PaymentSheetProps {
  visible: boolean;
  amount: number;
  subtitle: string;
  onClose: () => void;
  onConfirm: (method: PaymentMethod, reason?: string) => Promise<string | null>;
  /** Owner correction mode: the method already on record, and a reason is required. */
  currentMethod?: PaymentMethod | null;
}

/** "How did they pay?" — three big tiles, then one confirm. Also used for owner corrections. */
export function PaymentSheet({ visible, amount, subtitle, onClose, onConfirm, currentMethod }: PaymentSheetProps) {
  const correcting = currentMethod !== undefined;
  const { upiId, info } = useShop();
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setMethod(correcting ? (METHODS.find((m) => m.key !== currentMethod)?.key ?? 'cash') : 'cash');
    setReason('');
    setError(null);
    setBusy(false);
  }, [visible, correcting, currentMethod]);

  const reasonOk = !correcting || reason.trim().length >= MIN_REASON_LENGTH;
  const unchanged = correcting && method === currentMethod;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const message = await onConfirm(method, correcting ? reason.trim() : undefined);
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={correcting ? 'Correct payment method' : 'Collect payment'}
      subtitle={subtitle}
      footer={
        <Button
          label={
            correcting
              ? `Change to ${PAYMENT_METHOD_LABEL[method]}`
              : `Collect ${formatRupees(amount)} · ${PAYMENT_METHOD_LABEL[method]}`
          }
          size="lg"
          loading={busy}
          disabled={!reasonOk || unchanged}
          onPress={() => void confirm()}
        />
      }
    >
      {!correcting ? (
        <View style={styles.amountBand}>
          <Text style={styles.amountLabel}>Amount due</Text>
          <Text style={styles.amount}>{formatRupees(amount)}</Text>
        </View>
      ) : null}

      <View style={styles.tiles}>
        {METHODS.map(({ key, hint, Icon, accent, tint }) => {
          const on = method === key;
          const isCurrent = correcting && key === currentMethod;
          return (
            <Pressable
              key={key}
              onPress={() => setMethod(key)}
              style={({ pressed }) => [
                styles.tile,
                on && { borderColor: accent, backgroundColor: tint },
                pressed && styles.pressed,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={PAYMENT_METHOD_LABEL[key]}
            >
              <View style={[styles.tileIcon, { backgroundColor: on ? colors.white : tint }]}>
                <Icon size={24} color={accent} />
              </View>
              <Text style={[styles.tileLabel, on && { color: accent }]}>{PAYMENT_METHOD_LABEL[key]}</Text>
              <Text style={styles.tileHint} numberOfLines={2}>
                {isCurrent ? 'On record now' : hint}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {!correcting && method === 'upi' && amount > 0 ? (
        upiId ? (
          <UpiQr upiId={upiId} payee={info?.name ?? 'Car wash'} amount={amount} note={subtitle} />
        ) : (
          <Text style={styles.qrHint}>
            Add your shop’s UPI ID in More → UPI QR code to show a QR the customer can scan here.
          </Text>
        )
      ) : null}

      {correcting ? (
        <View style={styles.reasonBlock}>
          <Text style={styles.reasonLabel}>Reason (saved in the audit log)</Text>
          <TextInput
            style={styles.reasonInput}
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Customer paid by UPI, entered as cash"
            placeholderTextColor={colors.slate}
            maxLength={200}
          />
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  amountBand: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 2,
  },
  amountLabel: { ...typography.caption, color: colors.slateDeep, textTransform: 'uppercase', letterSpacing: 0.8 },
  amount: { ...typography.display, color: colors.waterInk, fontSize: 38 },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    gap: 6,
    backgroundColor: colors.white,
    minHeight: 124,
  },
  pressed: { opacity: 0.85 },
  tileIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 17 },
  tileHint: { ...typography.caption, color: colors.slate, letterSpacing: 0, fontSize: 11 },
  reasonBlock: { gap: 6 },
  qrHint: { ...typography.caption, color: colors.slateDeep, textAlign: 'center', letterSpacing: 0, lineHeight: 17 },
  reasonLabel: { ...typography.caption, color: colors.slateDeep },
  reasonInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    fontSize: 16,
    color: colors.waterInk,
    backgroundColor: colors.surface,
  },
  error: { ...typography.label, color: colors.danger, textTransform: 'none' },
});
