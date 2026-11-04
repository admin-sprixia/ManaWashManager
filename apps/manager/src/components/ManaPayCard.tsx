import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, { Path, Rect } from 'react-native-svg';
import { BrandMark, brandGradients, colors, radius, spacing, typography } from '@mana/ui';
import { MANA_PAY_QR } from '../config/app';
import { formatRupees } from '../utils/format';
import { qrPath } from './UpiQr';

const GOLD = '#E8BF78';
const GOLD_LIGHT = '#F8E2B0';
const STEPS = ['Scan', 'Enter amount', 'Pay'];

/**
 * MANA Pay, as on the counter card: the shop's UPI QR on a night-indigo card, with the amount to
 * enter in large type and the name the customer should see before paying.
 */
export function ManaPayCard({ amount, size = 210 }: { amount: number; size?: number }) {
  const { path, count } = useMemo(() => qrPath(MANA_PAY_QR), []);
  const quiet = 2;
  const g = brandGradients.promo;

  return (
    <LinearGradient colors={[...g.colors]} locations={g.locations ? [...g.locations] : undefined} start={g.start} end={g.end} style={styles.card}>
      <View style={styles.head}>
        <BrandMark size={26} />
        <Text style={styles.title}>
          MANA <Text style={styles.titlePay}>Pay</Text>
        </Text>
      </View>
      <Text style={styles.kicker}>SCAN TO PAY · KOVUR</Text>

      <View style={styles.qrFrame}>
        <View style={styles.qrTile}>
          <Svg width={size} height={size} viewBox={`${-quiet} ${-quiet} ${count + quiet * 2} ${count + quiet * 2}`}>
            <Rect x={-quiet} y={-quiet} width={count + quiet * 2} height={count + quiet * 2} fill="#FFFFFF" />
            <Path d={path} fill="#0C1442" />
          </Svg>
        </View>
      </View>

      <Text style={styles.enter}>Enter</Text>
      <Text style={styles.amount}>{formatRupees(amount)}</Text>
      <Text style={styles.payee}>SRI MANA WASH</Text>
      <Text style={styles.check}>The customer checks this name on their screen before paying</Text>

      <View style={styles.steps}>
        {STEPS.map((s, i) => (
          <View key={s} style={styles.step}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{s}</Text>
          </View>
        ))}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderRadius: radius.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(232,191,120,0.55)',
    gap: 4,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.title, color: colors.white, fontSize: 26, letterSpacing: 1.2 },
  titlePay: { color: GOLD, fontStyle: 'italic' },
  kicker: { ...typography.caption, color: '#9BAEF5', fontWeight: '700', letterSpacing: 1.6, fontSize: 11 },
  qrFrame: { marginTop: spacing.sm, padding: 4, borderRadius: radius.lg + 4, borderWidth: 1.5, borderColor: GOLD },
  qrTile: { padding: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.white },
  enter: { ...typography.caption, color: GOLD_LIGHT, fontWeight: '700', letterSpacing: 1.2, marginTop: spacing.sm, textTransform: 'uppercase' },
  amount: { ...typography.display, color: colors.white, fontSize: 40, lineHeight: 46 },
  payee: { ...typography.bodyStrong, color: colors.white, letterSpacing: 2, fontSize: 15 },
  check: { ...typography.caption, color: GOLD_LIGHT, letterSpacing: 0, textAlign: 'center' },
  steps: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  step: { alignItems: 'center', gap: 4 },
  stepNum: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: GOLD, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { ...typography.caption, color: GOLD_LIGHT, fontWeight: '800' },
  stepText: { ...typography.caption, color: '#E6EAFF', fontWeight: '600', letterSpacing: 0 },
});
