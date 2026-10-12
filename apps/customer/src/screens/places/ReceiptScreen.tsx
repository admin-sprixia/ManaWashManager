import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { formatInr } from '@mana/domain';
import { Button, IconShare, colors, formatDateTime, radius, shadow, spacing } from '@mana/ui';
import { api, send } from '../../api/client';
import type { Receipt } from '../../api/types';
import { MessageCard } from '../../components/MessageCard';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useRemote } from '../../hooks/useRemote';
import { usePageStyle } from '../../layout/Layout';
import type { MainStackParams } from '../../navigation/types';
import { shareText } from '../../utils/contact';

type Props = NativeStackScreenProps<MainStackParams, 'Receipt'>;

const METHOD_LABEL: Record<string, string> = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', test: 'Test payment' };

const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 ? 1 : 0)}%`;

function itemLine(r: Receipt): string {
  return r.item.part ? `${r.item.title} (part ${r.item.part.seq} of ${r.item.part.of})` : r.item.title;
}

/** Plain text of the receipt, for WhatsApp or email. */
function receiptText(r: Receipt): string {
  return [
    `${r.seller.legalName} · Receipt ${r.receiptNo}`,
    formatDateTime(r.paidAt),
    r.seller.gstin ? `GSTIN ${r.seller.gstin}` : null,
    '',
    `${itemLine(r)} · ${r.item.vehicle}`,
    r.item.place,
    '',
    r.gst.rateBp > 0 ? `Taxable ${formatInr(r.gst.taxable)}` : null,
    r.gst.rateBp > 0 ? `CGST ${pct(r.gst.rateBp / 2)} ${formatInr(r.gst.cgst)} · SGST ${pct(r.gst.rateBp / 2)} ${formatInr(r.gst.sgst)}` : null,
    `Paid ${formatInr(r.amount)}${r.method ? ` by ${METHOD_LABEL[r.method] ?? r.method}` : ''}`,
    r.refunded > 0 ? `Refunded ${formatInr(r.refunded)}` : null,
  ]
    .filter((l): l is string => l != null)
    .join('\n');
}

/** A GST receipt for one payment, laid out like the paper one, with a share button. */
export function ReceiptScreen({ navigation, route }: Props) {
  const pageStyle = usePageStyle();
  const remote = useRemote(() => send(api.receipts[':id'].$get({ param: { id: route.params.paymentId } })));
  const r = remote.data?.receipt ?? null;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScreenHeader title="Receipt" onBack={() => navigation.goBack()} />
      {!r ? (
        remote.loading ? (
          <ActivityIndicator style={styles.loading} color={colors.water} size="large" />
        ) : (
          <MessageCard
            title="Couldn’t open the receipt"
            body={remote.error ?? 'Check your connection and try again.'}
            action={{ label: 'Try again', onPress: () => void remote.reload() }}
          />
        )
      ) : (
        <ScrollView contentContainerStyle={[styles.content, pageStyle]}>
          <View style={styles.paper}>
            <Text style={styles.seller}>{r.seller.legalName}</Text>
            <Text style={styles.muted}>
              {[r.seller.branch, r.seller.address ?? r.seller.city].filter(Boolean).join(' · ')}
            </Text>
            {r.seller.gstin ? <Text style={styles.muted}>GSTIN {r.seller.gstin}</Text> : null}

            <View style={styles.rule} />
            <Row label="Receipt" value={r.receiptNo} strong />
            <Row label="Date" value={formatDateTime(r.paidAt)} />
            <Row label="Billed to" value={[r.customer.name, r.customer.phone].filter(Boolean).join(' · ')} />

            <View style={styles.rule} />
            <Text style={styles.item}>{itemLine(r)}</Text>
            <Text style={styles.muted}>
              {r.item.vehicle} · {r.item.place}
            </Text>

            <View style={styles.rule} />
            {r.gst.rateBp > 0 ? (
              <>
                <Row label="Taxable value" value={formatInr(r.gst.taxable)} />
                <Row label={`CGST ${pct(r.gst.rateBp / 2)}`} value={formatInr(r.gst.cgst)} />
                <Row label={`SGST ${pct(r.gst.rateBp / 2)}`} value={formatInr(r.gst.sgst)} />
              </>
            ) : null}
            <Row label="Total paid" value={formatInr(r.amount)} strong />
            {r.method ? <Row label="Paid by" value={METHOD_LABEL[r.method] ?? r.method} /> : null}
            {r.refunds.map((f, i) => (
              <Row
                key={i}
                label={f.status === 'processed' ? 'Refunded' : 'Refund on the way'}
                value={`− ${formatInr(f.amount)}`}
              />
            ))}
            {r.seller.phone ? <Text style={styles.footnote}>Questions? Call {r.seller.phone}.</Text> : null}
          </View>
          <View style={styles.actions}>
            <Button
              label="Share receipt"
              variant="secondary"
              icon={<IconShare size={18} color={colors.indigo} />}
              onPress={() => void shareText(receiptText(r))}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.value, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: spacing.xl },
  loading: { marginTop: spacing.xl },
  paper: {
    margin: 16,
    padding: spacing.md + 4,
    gap: 6,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E9EDFC',
    ...shadow('md'),
  },
  seller: { fontSize: 18, fontWeight: '800', color: colors.ink },
  muted: { fontSize: 13, color: colors.slateDeep },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  item: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  label: { fontSize: 14, color: colors.slateDeep },
  value: { flexShrink: 1, fontSize: 14, color: colors.ink, textAlign: 'right' },
  strong: { fontWeight: '800', color: colors.ink, fontSize: 15 },
  footnote: { marginTop: 10, fontSize: 12.5, color: colors.slate },
  actions: { paddingHorizontal: 16 },
});
