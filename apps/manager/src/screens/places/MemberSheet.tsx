import React, { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { MEMBER_CHECK_LABEL, formatInr, unitTitle } from '@mana/domain';
import { BottomSheet, Button, Notice, Pill, colors, formatPhone, showAlert, showToast, spacing, typography } from '@mana/ui';
import { api, type ApiResponse } from '../../api/client';
import { openWhatsApp } from '../../utils/whatsapp';
import { PHASE_STAFF_LABEL, PHASE_STAFF_TONE, failure, type PlaceMember } from './shared';

const NEEDS_LINK = new Set(['awaiting_payment', 'payment_due', 'paused_unpaid']);

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

  return (
    <BottomSheet
      visible={m != null}
      onClose={onClose}
      dismissable={busy == null}
      title={m ? unitTitle(noun, m.unit) : ''}
      subtitle={m ? [m.customer.name, `+91 ${formatPhone(m.customer.phone)}`].filter(Boolean).join(' · ') : undefined}
      footer={
        m ? (
          <View style={styles.footer}>
            {m.status === 'pending' ? (
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
            <Button label="Call" variant="secondary" onPress={() => void Linking.openURL(`tel:+91${m.customer.phone}`).catch(() => undefined)} />
          </View>
        ) : undefined
      }
    >
      {m ? (
        <View style={styles.body}>
          {m.checks.length ? (
            <Notice tone="warning" title="Please check">
              {m.checks.map((c) => MEMBER_CHECK_LABEL[c]).join(' · ')}
            </Notice>
          ) : null}
          {m.parkingNote ? <Text style={styles.note}>Parked: {m.parkingNote}</Text> : null}
          {m.vehicles.map((v) => {
            const order = v.orders[0];
            return (
              <View key={v.id} style={styles.vehicle}>
                <View style={styles.vehicleHead}>
                  <View style={styles.flex}>
                    <Text style={styles.plate}>{v.vehicle?.registrationNumber ?? v.typeName}</Text>
                    <Text style={styles.meta}>{order ? `${order.title} · ${formatInr(order.total)}` : 'No plan'}</Text>
                    {order && order.kind === 'plan' ? (
                      <Text style={styles.meta}>
                        {order.washesUsed} of {order.washesTotal} washes · {formatInr(order.paid)} paid
                      </Text>
                    ) : null}
                  </View>
                  {order ? <Pill label={PHASE_STAFF_LABEL[order.phase].toUpperCase()} tone={PHASE_STAFF_TONE[order.phase]} /> : null}
                </View>
                {order && m.status === 'active' && NEEDS_LINK.has(order.phase) ? (
                  <Button
                    label="Send payment link on WhatsApp"
                    variant="secondary"
                    loading={busy === `link:${order.id}`}
                    onPress={() => void sendLink(order.id)}
                  />
                ) : null}
              </View>
            );
          })}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.removeGap} />
          <Button label="Remove from community" variant="danger" loading={busy === 'remove'} onPress={remove} />
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  removeGap: { height: spacing.sm },
  footer: { gap: spacing.sm },
  flex: { flex: 1, gap: 2 },
  note: { ...typography.body, fontSize: 14, color: colors.slateDeep },
  vehicle: { gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  vehicleHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  plate: { fontSize: 16, fontWeight: '800', letterSpacing: 0.6, color: colors.waterInk },
  meta: { fontSize: 13.5, color: colors.slateDeep },
  error: { ...typography.label, color: colors.danger },
});
