import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import qrcode from 'qrcode-generator';
import { colors, radius, spacing, typography } from '@mana/ui';
import { formatRupees } from '../utils/format';

/** The UPI link any payment app understands; the amount is filled in so the customer only confirms. */
export function upiLink(upiId: string, payee: string, amount: number, note: string): string {
  const params = [
    `pa=${encodeURIComponent(upiId)}`,
    `pn=${encodeURIComponent(payee)}`,
    `am=${(amount / 100).toFixed(2)}`,
    'cu=INR',
    `tn=${encodeURIComponent(note.slice(0, 50))}`,
  ];
  return `upi://pay?${params.join('&')}`;
}

/** A QR code the customer scans with GPay, PhonePe or Paytm to pay this exact amount. */
export function UpiQr({ upiId, payee, amount, note, size = 196 }: { upiId: string; payee: string; amount: number; note: string; size?: number }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(upiLink(upiId, payee, amount, note));
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
    return { path: d, count: n };
  }, [upiId, payee, amount, note]);
  const quiet = 2;

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${count + quiet * 2} ${count + quiet * 2}`}>
          <Rect x={-quiet} y={-quiet} width={count + quiet * 2} height={count + quiet * 2} fill="#FFFFFF" />
          <Path d={path} fill="#0B1F33" />
        </Svg>
      </View>
      <Text style={styles.amount}>Scan to pay {formatRupees(amount)}</Text>
      <Text style={styles.id} numberOfLines={1}>
        {upiId}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4 },
  card: {
    padding: spacing.sm + 2,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.indigoMist,
  },
  amount: { ...typography.bodyStrong, color: colors.indigo, fontWeight: '800', marginTop: 4 },
  id: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0.2 },
});
