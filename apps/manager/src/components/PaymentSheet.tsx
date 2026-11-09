import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MAX_ROUND_OFF, MIN_REASON_LENGTH, PAYMENT_METHOD_LABEL, type PaymentMethod } from '@mana/domain';
import {
  colors,
  radius,
  spacing,
  typography,
  BottomSheet,
  Button,
  IconCash,
  IconRupee,
  IconUpi,
  IconWallet,
} from '@mana/ui';
import { formatRupees } from '../utils/format';
import { ManaPayCard } from './ManaPayCard';

/** How a bill is paid: one method, or split (cash part plus the rest by UPI), and any cash kept. */
export interface PaymentChoice {
  method: PaymentMethod;
  /** Split bill: its cash part, in paise (the rest by `method`). */
  cashAmount?: number | null;
  /** Cash actually handed over when more than the cash due (no change given), in paise. */
  cashReceived?: number | null;
}

type Tile = PaymentMethod | 'split';

const TILES: { key: Tile; label: string; hint: string; Icon: typeof IconCash; accent: string; tint: string }[] = [
  { key: 'cash', label: PAYMENT_METHOD_LABEL.cash, hint: 'Notes & coins', Icon: IconCash, accent: colors.teal, tint: '#CCFBF1' },
  { key: 'upi', label: PAYMENT_METHOD_LABEL.upi, hint: 'GPay, PhonePe, Paytm', Icon: IconUpi, accent: colors.waterDeep, tint: colors.waterPale },
  { key: 'split', label: 'UPI + Cash', hint: 'Part each way', Icon: IconRupee, accent: colors.indigo, tint: colors.indigoPale },
  { key: 'other', label: PAYMENT_METHOD_LABEL.other, hint: 'Card, credit, etc.', Icon: IconWallet, accent: colors.slateDeep, tint: '#F1F5F9' },
];

interface PaymentSheetProps {
  visible: boolean;
  amount: number;
  subtitle: string;
  onClose: () => void;
  onConfirm: (choice: PaymentChoice, reason?: string) => Promise<string | null>;
  /** Correction mode: how it's on record now, and a reason is required. */
  current?: PaymentChoice | null;
}

/** Whole rupees typed in a box → paise (null when empty or not a number). */
function paiseOf(text: string): number | null {
  const n = Number(text.replace(/[^\d]/g, ''));
  return text.trim() && Number.isFinite(n) ? n * 100 : null;
}

/**
 * "How did they pay?" Cash, UPI, UPI + Cash (split) or other, then one confirm. For cash, the
 * cash actually handed over can be entered when the customer gave more and wanted no change: the
 * extra is kept as a round-off and expected in the drawer. Also used for corrections.
 */
export function PaymentSheet({ visible, amount, subtitle, onClose, onConfirm, current }: PaymentSheetProps) {
  const correcting = current !== undefined;
  const [tile, setTile] = useState<Tile>('cash');
  const [upiText, setUpiText] = useState('');
  const [receivedText, setReceivedText] = useState('');
  const [showReceived, setShowReceived] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const wasSplit = current && current.method !== 'cash' && (current.cashAmount ?? 0) > 0;
    setTile(correcting ? (current?.method === 'cash' ? 'upi' : 'cash') : 'cash');
    setUpiText(wasSplit ? String((amount - (current?.cashAmount ?? 0)) / 100) : '');
    setReceivedText('');
    setShowReceived(false);
    setReason('');
    setError(null);
    setBusy(false);
    // Filled in once, when the sheet opens: the screen behind redraws (every minute, on sync),
    // and that must never wipe what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const upiPart = tile === 'split' ? paiseOf(upiText) : null;
  const cashDue = tile === 'cash' ? amount : tile === 'split' ? amount - (upiPart ?? 0) : 0;
  const splitOk = tile !== 'split' || (upiPart != null && upiPart > 0 && upiPart < amount);
  const received = showReceived ? paiseOf(receivedText) : null;
  const extra = received != null ? received - cashDue : 0;
  const receivedOk = received == null || (received >= cashDue && extra <= MAX_ROUND_OFF);
  const reasonOk = !correcting || reason.trim().length >= MIN_REASON_LENGTH;

  const choice: PaymentChoice =
    tile === 'split'
      ? { method: 'upi', cashAmount: cashDue, cashReceived: received != null && extra > 0 ? received : null }
      : { method: tile, cashAmount: null, cashReceived: tile === 'cash' && received != null && extra > 0 ? received : null };
  const unchanged =
    correcting &&
    current != null &&
    current.method === choice.method &&
    (current.cashAmount ?? null) === (choice.cashAmount ?? null) &&
    (current.cashReceived ?? null) === (choice.cashReceived ?? null);

  const label = tile === 'split' && upiPart != null && splitOk
    ? `${formatRupees(upiPart)} UPI + ${formatRupees(cashDue)} cash`
    : TILES.find((t) => t.key === tile)!.label;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const message = await onConfirm(choice, correcting ? reason.trim() : undefined);
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={correcting ? 'Correct payment' : 'Collect payment'}
      subtitle={subtitle}
      footer={
        <Button
          label={correcting ? `Change to ${label}` : `Collect ${formatRupees(amount)} · ${label}`}
          size="lg"
          loading={busy}
          disabled={!splitOk || !receivedOk || !reasonOk || unchanged}
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
        {TILES.map(({ key, label: tileLabel, hint, Icon, accent, tint }) => {
          const on = tile === key;
          return (
            <Pressable
              key={key}
              onPress={() => {
                setTile(key);
                setError(null);
                if (key !== 'cash' && key !== 'split') setShowReceived(false);
              }}
              style={({ pressed }) => [styles.tile, on && { borderColor: accent, backgroundColor: tint }, pressed && styles.pressed]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={tileLabel}
            >
              <View style={[styles.tileIcon, { backgroundColor: on ? colors.white : tint }]}>
                <Icon size={22} color={accent} />
              </View>
              <Text style={[styles.tileLabel, on && { color: accent }]} numberOfLines={1}>
                {tileLabel}
              </Text>
              <Text style={styles.tileHint} numberOfLines={2}>
                {hint}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tile === 'split' ? (
        <View style={styles.block}>
          <Text style={styles.fieldLabel}>Paid by UPI (₹)</Text>
          <TextInput
            style={styles.input}
            value={upiText}
            onChangeText={(t) => setUpiText(t.replace(/[^\d]/g, ''))}
            placeholder="e.g. 500"
            placeholderTextColor={colors.slate}
            keyboardType="number-pad"
            maxLength={7}
          />
          <Text style={[styles.helper, !splitOk && upiText ? styles.helperError : null]}>
            {!upiText
              ? 'Enter the UPI part; the rest is cash.'
              : !splitOk
                ? `Must be less than ${formatRupees(amount)}.`
                : `Cash to take: ${formatRupees(cashDue)}`}
          </Text>
        </View>
      ) : null}

      {(tile === 'cash' || (tile === 'split' && splitOk)) && cashDue > 0 ? (
        showReceived ? (
          <View style={styles.block}>
            <Text style={styles.fieldLabel}>Cash received (₹), no change given</Text>
            <TextInput
              style={styles.input}
              value={receivedText}
              onChangeText={(t) => setReceivedText(t.replace(/[^\d]/g, ''))}
              placeholder={String(cashDue / 100)}
              placeholderTextColor={colors.slate}
              keyboardType="number-pad"
              maxLength={7}
            />
            <Text style={[styles.helper, !receivedOk ? styles.helperError : null]}>
              {received == null
                ? `Cash due is ${formatRupees(cashDue)}.`
                : received < cashDue
                  ? `Less than the ${formatRupees(cashDue)} due.`
                  : extra > MAX_ROUND_OFF
                    ? `More than ${formatRupees(MAX_ROUND_OFF)} over: give the change back.`
                    : extra > 0
                      ? `${formatRupees(extra)} extra kept as round-off, expected in the cash box.`
                      : 'Exactly the cash due.'}
            </Text>
          </View>
        ) : (
          <Pressable onPress={() => setShowReceived(true)} hitSlop={6} accessibilityRole="button">
            <Text style={styles.link}>Customer gave more cash and wants no change?</Text>
          </Pressable>
        )
      ) : null}

      {!correcting && (tile === 'upi' || (tile === 'split' && splitOk && upiPart)) && amount > 0 ? (
        <>
          <ManaPayCard amount={tile === 'split' ? (upiPart ?? 0) : amount} />
          <Text style={styles.qrHint}>Tap Collect once the sound box announces the payment.</Text>
        </>
      ) : null}

      {correcting ? (
        <View style={styles.block}>
          <Text style={styles.fieldLabel}>Reason (saved in the history)</Text>
          <TextInput
            style={styles.input}
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
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexBasis: '22%',
    flexGrow: 1,
    minWidth: 120,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    gap: 6,
    backgroundColor: colors.white,
    minHeight: 124,
  },
  pressed: { opacity: 0.85 },
  tileIcon: { width: 42, height: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 17 },
  tileHint: { ...typography.caption, color: colors.slate, letterSpacing: 0, fontSize: 11 },
  block: { gap: 6 },
  fieldLabel: { ...typography.caption, color: colors.slateDeep },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    fontSize: 18,
    color: colors.waterInk,
    backgroundColor: colors.surface,
  },
  helper: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0 },
  helperError: { color: colors.danger },
  link: { ...typography.label, color: colors.indigo, textTransform: 'none' },
  qrHint: { ...typography.caption, color: colors.slateDeep, textAlign: 'center', letterSpacing: 0, lineHeight: 17 },
  error: { ...typography.label, color: colors.danger, textTransform: 'none' },
});
