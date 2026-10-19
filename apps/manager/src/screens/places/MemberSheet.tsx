import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { MEMBER_CHECK_LABEL, formatInr, unitTitle } from '@mana/domain';
import {
  BottomSheet,
  Button,
  IconAlert,
  IconBike,
  IconCar,
  IconPhone,
  IconTrash,
  IconUserPlus,
  IconWhatsApp,
  Pill,
  colors,
  formatPhone,
  radius,
  showAlert,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { api, type ApiResponse } from '../../api/client';
import { useAuth } from '../../api/auth';
import { SheetHead, SheetNotice, SheetPill } from '../../components/SheetBits';
import { openWhatsApp } from '../../utils/whatsapp';
import { TEAL, TEAL_MIST, TEAL_PALE } from './panel/parts';
import { PHASE_STAFF_LABEL, PHASE_STAFF_TONE, failure, type PlaceMember } from './shared';

const NEEDS_LINK = new Set(['awaiting_payment', 'payment_due', 'paused_unpaid']);
/** Order phases with no money paid in (or none left to refund). */
const NOT_PAID = new Set(['waitlist', 'awaiting_payment', 'ended', 'cancelled']);

/**
 * One member, for the team: their flat and vehicles with each plan's state, and what the team can
 * do — confirm, call, send a payment link on WhatsApp, or take them off the place.
 */
export function MemberSheet({
  member,
  noun,
  onClose,
  run,
  reload,
}: {
  member: PlaceMember | null;
  noun: string;
  onClose: () => void;
  /** Sends a change and reloads; resolves with an error message or null. */
  run: (call: () => Promise<ApiResponse>, done?: string) => Promise<string | null>;
  reload: () => Promise<void>;
}) {
  const { isOwner } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const m = member;

  const act = async (key: string, call: () => Promise<ApiResponse>, done: string, close = false) => {
    setBusy(key);
    setError(null);
    const message = await run(call, done);
    setBusy(null);
    if (message) setError(message);
    else if (close) onClose();
  };

  const sendLink = async (orderId: string) => {
    if (!m) return;
    setBusy(`link:${orderId}`);
    setError(null);
    try {
      const res = await api.places.orders[':id']['payment-link'].$post({ param: { id: orderId } });
      const body = (await res.json()) as { message?: string; phone?: string | null };
      if (!res.ok || !body.message) {
        setError(body.message ?? 'Couldn’t make the payment link.');
        return;
      }
      await openWhatsApp(body.phone ?? m.customer.phone, body.message);
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = () =>
    m &&
    showAlert(
      'Remove them from this community?',
      'Their plans end now. Washes paid for and not given are refunded by your refund rule.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy('remove');
              try {
                const res = await api.places.members[':id'].remove.$post({ param: { id: m.id }, json: { reason: null } });
                const body = (await res.json()) as { refunded?: number; message?: string };
                if (!res.ok) {
                  setError(body.message ?? 'Couldn’t remove them.');
                  return;
                }
                showToast(body.refunded ? `Removed · ${formatInr(body.refunded)} refunded` : 'Removed', 'success');
                onClose();
                await reload();
              } catch (e) {
                setError(failure(e));
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ],
    );

  const pending = m?.status === 'pending';
  const unpaid = m ? m.vehicles.some((v) => v.orders[0] && NEEDS_LINK.has(v.orders[0].phase)) : false;
  // Removing someone with a paid plan refunds it, so that's the owner's call.
  const paidPlan = m ? m.vehicles.some((v) => v.orders.some((o) => !NOT_PAID.has(o.phase))) : false;
  const mayRemove = isOwner || !paidPlan;
  const tone = pending ? 'amber' : unpaid ? 'danger' : 'teal';
  const headColor = pending ? colors.amberDeep : unpaid ? colors.danger : TEAL;

  return (
    <BottomSheet
      visible={m != null}
      onClose={onClose}
      dismissable={busy == null}
      title={m ? unitTitle(noun, m.unit) : ''}
      footer={
        m ? (
          <View style={styles.footer}>
            {pending ? (
              <Button
                label="Confirm member"
                size="lg"
                loading={busy === 'approve'}
                onPress={() => void act('approve', () => api.places.members[':id'].approve.$post({ param: { id: m.id } }), 'Confirmed · they can pay now', true)}
              />
            ) : m.checks.length ? (
              <Button
                label="Checked · all fine"
                size="lg"
                loading={busy === 'clear'}
                onPress={() => void act('clear', () => api.places.members[':id']['clear-checks'].$post({ param: { id: m.id } }), 'Marked as checked', true)}
              />
            ) : null}
            <View style={styles.contactRow}>
              <Pressable
                onPress={() => void Linking.openURL(`tel:+91${m.customer.phone}`).catch(() => undefined)}
                style={({ pressed }) => [styles.contact, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Call"
              >
                <IconPhone size={17} color={TEAL} />
                <Text style={styles.contactText}>Call</Text>
              </Pressable>
              <Pressable
                onPress={() => void openWhatsApp(m.customer.phone, `Hi${m.customer.name ? ` ${m.customer.name.split(' ')[0]}` : ''}, this is the Mana Wash team.`)}
                style={({ pressed }) => [styles.contact, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="WhatsApp"
              >
                <IconWhatsApp size={17} />
                <Text style={styles.contactText}>WhatsApp</Text>
              </Pressable>
            </View>
          </View>
        ) : undefined
      }
    >
      {m ? (
        <View style={styles.body}>
          <SheetHead
            tone={tone}
            icon={pending ? <IconUserPlus size={20} color={headColor} /> : <IconCar size={20} color={headColor} />}
            title={m.customer.name?.trim() || 'No name given'}
            caption={`${unitTitle(noun, m.unit)}  ·  +91 ${formatPhone(m.customer.phone)}`}
            right={<SheetPill label={pending ? 'To confirm' : unpaid ? 'Not paid' : 'Member'} tone={tone} />}
          />

          {m.checks.length ? (
            <SheetNotice tone="amber" icon={<IconAlert size={15} color={colors.amberDeep} />}>
              {`Please check: ${m.checks.map((c) => MEMBER_CHECK_LABEL[c]).join(' · ')}`}
            </SheetNotice>
          ) : null}

          {m.parkingNote ? (
            <View style={styles.parking}>
              <Text style={styles.label}>Where it’s parked</Text>
              <Text style={styles.parkingText}>{m.parkingNote}</Text>
            </View>
          ) : null}

          <Text style={styles.label}>{m.vehicles.length === 1 ? 'Vehicle' : `${m.vehicles.length} vehicles`}</Text>
          {m.vehicles.map((v) => {
            const order = v.orders[0];
            const plan = order && order.kind === 'plan';
            const pct = plan && order.washesTotal ? Math.min(1, order.washesUsed / order.washesTotal) : 0;
            return (
              <View key={v.id} style={styles.vehicle}>
                <View style={styles.vehicleHead}>
                  <View style={styles.vehicleIcon}>
                    {v.category === 'bike' ? <IconBike size={18} color={TEAL} /> : <IconCar size={18} color={TEAL} />}
                  </View>
                  <View style={styles.flex}>
                    {v.vehicle?.registrationNumber ? (
                      <View style={styles.plate}>
                        <Text style={styles.plateText}>{v.vehicle.registrationNumber}</Text>
                      </View>
                    ) : (
                      <Text style={styles.noPlate}>Plate noted on the first wash</Text>
                    )}
                    <Text style={styles.meta}>{v.typeName}</Text>
                  </View>
                  {order ? <Pill label={PHASE_STAFF_LABEL[order.phase].toUpperCase()} tone={PHASE_STAFF_TONE[order.phase]} /> : null}
                </View>

                {order ? (
                  <View style={styles.order}>
                    <View style={styles.orderLine}>
                      <Text style={styles.orderTitle} numberOfLines={1}>
                        {order.title}
                      </Text>
                      <Text style={styles.orderPrice}>{formatInr(order.total)}</Text>
                    </View>
                    {plan ? (
                      <>
                        <View style={styles.bar}>
                          <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
                        </View>
                        <Text style={styles.meta}>
                          {order.washesUsed} of {order.washesTotal} washes used  ·  {formatInr(order.paid)} paid
                        </Text>
                      </>
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.meta}>No plan yet</Text>
                )}

                {order && m.status === 'active' && NEEDS_LINK.has(order.phase) ? (
                  <Button
                    label="Send payment link on WhatsApp"
                    variant="secondary"
                    icon={<IconWhatsApp size={17} />}
                    loading={busy === `link:${order.id}`}
                    onPress={() => void sendLink(order.id)}
                  />
                ) : null}
              </View>
            );
          })}

          {error ? <SheetNotice tone="danger">{error}</SheetNotice> : null}

          {mayRemove ? (
            <Pressable
              onPress={remove}
              disabled={busy === 'remove'}
              style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Remove from community"
            >
              <IconTrash size={16} color={colors.danger} />
              <Text style={styles.removeText}>{busy === 'remove' ? 'Removing…' : 'Remove from community'}</Text>
            </Pressable>
          ) : (
            <Text style={styles.ownerOnly}>They have a paid plan. Only the owner can remove them, because it refunds the plan.</Text>
          )}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  footer: { gap: spacing.sm },
  flex: { flex: 1, gap: 3 },
  pressed: { opacity: 0.75 },
  label: { ...typography.caption, fontSize: 12.5, fontWeight: '700', color: colors.slateDeep, letterSpacing: 0.1 },
  parking: { gap: 4, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm + 4 },
  parkingText: { ...typography.body, fontSize: 14, color: colors.waterInk },
  vehicle: {
    gap: spacing.sm + 2,
    padding: spacing.sm + 4,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  vehicleHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  vehicleIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: TEAL_PALE, alignItems: 'center', justifyContent: 'center' },
  plate: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: colors.waterInk,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: colors.white,
  },
  plateText: { fontSize: 14.5, fontWeight: '800', letterSpacing: 1.2, color: colors.waterInk },
  noPlate: { ...typography.label, fontSize: 13, color: colors.slateDeep, fontStyle: 'italic' },
  meta: { fontSize: 13, color: colors.slateDeep },
  order: { gap: 6, backgroundColor: TEAL_MIST, borderRadius: radius.md, padding: spacing.sm + 2 },
  orderLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  orderTitle: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '800', color: colors.waterInk, flex: 1 },
  orderPrice: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '800', color: TEAL },
  bar: { height: 6, borderRadius: 3, backgroundColor: TEAL_PALE, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.teal },
  contactRow: { flexDirection: 'row', gap: spacing.sm },
  contact: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    backgroundColor: TEAL_MIST,
  },
  contactText: { ...typography.label, fontSize: 14.5, fontWeight: '700', color: TEAL },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: spacing.sm + 2,
    marginTop: spacing.xs,
  },
  removeText: { ...typography.label, fontSize: 14, fontWeight: '700', color: colors.danger },
  ownerOnly: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0, textAlign: 'center', paddingVertical: spacing.sm },
});
