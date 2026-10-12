import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { InferResponseType } from 'hono/client';
import { IconBuilding, IconChevronRight, Pill, colors, radius, spacing, typography, type PillTone } from '@mana/ui';
import type { api } from '../api/client';
import { PHASE_STAFF_LABEL, PHASE_STAFF_TONE } from '../screens/places/shared';
import { formatRupees } from '../utils/format';

export type CustomerCommunity = NonNullable<
  InferResponseType<(typeof api)['customers'][':id']['$get'], 200>
>['communities'][number];

const MEMBER_STATUS: Record<string, { label: string; tone: PillTone } | undefined> = {
  pending: { label: 'TO CONFIRM', tone: 'amber' },
  left: { label: 'LEFT', tone: 'slate' },
  removed: { label: 'REMOVED', tone: 'slate' },
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const METHOD: Record<string, string> = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', cash: 'Cash' };

/** Where the customer lives, what they're on there, and what they've paid — on their profile. */
export function CustomerCommunities({
  communities,
  onOpenPlace,
}: {
  communities: CustomerCommunity[];
  onOpenPlace: (placeId: string) => void;
}) {
  return (
    <View style={styles.list}>
      {communities.map((m) => {
        const status = MEMBER_STATUS[m.status];
        const receipts = m.orders.flatMap((o) => o.receipts.map((r) => ({ ...r, title: o.title })));
        return (
          <View key={m.memberId} style={styles.card}>
            <Pressable
              onPress={() => onOpenPlace(m.place.id)}
              style={({ pressed }) => [styles.head, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Open ${m.place.name}`}
            >
              <View style={styles.icon}>
                <IconBuilding size={18} color={colors.waterDeep} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.place} numberOfLines={1}>
                  {m.place.name}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[m.unit ? `Flat ${m.unit}` : null, `since ${shortDate(m.since)}`].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {status ? <Pill label={status.label} tone={status.tone} /> : null}
              <IconChevronRight size={16} color={colors.slate} />
            </Pressable>

            {m.orders.length === 0 ? (
              <Text style={styles.empty}>No plan or wash booked yet.</Text>
            ) : (
              m.orders.map((o) => (
                <View key={o.id} style={styles.order}>
                  <View style={styles.orderTop}>
                    <Text style={styles.orderTitle} numberOfLines={1}>
                      {o.title}
                    </Text>
                    <Pill label={PHASE_STAFF_LABEL[o.phase].toUpperCase()} tone={PHASE_STAFF_TONE[o.phase]} />
                  </View>
                  <Text style={styles.meta} numberOfLines={1}>
                    {[o.vehicle.registrationNumber ?? o.vehicle.typeName, `${o.washesUsed} of ${o.washesTotal} washes used`].join(' · ')}
                  </Text>
                  <Text style={[styles.money, o.paid < o.total && o.status !== 'cancelled' && styles.moneyDue]}>
                    {o.paid >= o.total
                      ? `Paid ${formatRupees(o.total)}`
                      : `Paid ${formatRupees(o.paid)} of ${formatRupees(o.total)}`}
                    {o.due ? ` · next part ${formatRupees(o.due.amount)}` : ''}
                  </Text>
                </View>
              ))
            )}

            {receipts.length > 0 ? (
              <View style={styles.payments}>
                <Text style={styles.paymentsLabel}>PAYMENTS</Text>
                {receipts.map((r) => (
                  <View key={r.id} style={styles.payment}>
                    <View style={styles.flex}>
                      <Text style={styles.paymentTitle} numberOfLines={1}>
                        {r.title}
                      </Text>
                      <Text style={styles.paymentMeta} numberOfLines={1}>
                        {[r.paidAt ? shortDate(r.paidAt) : null, r.method ? (METHOD[r.method] ?? r.method) : null, r.receiptNo]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                    <View style={styles.paymentRight}>
                      <Text style={styles.paymentAmount}>{formatRupees(r.amount)}</Text>
                      {r.refunded > 0 ? <Text style={styles.refunded}>{formatRupees(r.refunded)} refunded</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: spacing.md, gap: spacing.sm },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  place: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  meta: { ...typography.caption, color: colors.slateDeep },
  empty: { ...typography.caption, color: colors.slateDeep, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  order: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: 3,
  },
  orderTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  orderTitle: { ...typography.bodyStrong, color: colors.waterInk, flex: 1 },
  money: { ...typography.caption, color: colors.tealDeep, fontWeight: '700' },
  moneyDue: { color: colors.amberDeep },
  payments: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: 8,
  },
  paymentsLabel: { ...typography.caption, color: colors.slateDeep, fontWeight: '700', letterSpacing: 0.8, fontSize: 10 },
  payment: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  paymentTitle: { ...typography.body, color: colors.waterInk, fontSize: 13 },
  paymentMeta: { ...typography.caption, color: colors.slateDeep, fontSize: 11 },
  paymentRight: { alignItems: 'flex-end' },
  paymentAmount: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 14 },
  refunded: { ...typography.caption, color: colors.amberDeep, fontSize: 11 },
  pressed: { opacity: 0.85 },
});
