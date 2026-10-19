import React, { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { PAYMENT_METHOD_LABEL } from '@mana/domain';
import { IconCheck, IconGift, IconPlay, IconRupee, IconWhatsApp, MakeLogo, colors, radius, spacing, statusColors, typography } from '@mana/ui';
import type { BoardJob } from '../../offline/types';
import { formatRupees } from '../../utils/format';
import {
  customerLine,
  firstName,
  formatTime,
  isToday,
  isWalkIn,
  servicesLine,
  spacedPlate,
  STATUS_LABEL,
  vehicleModelLine,
  washerNames,
} from '../../utils/jobs';

/** The one next step, as a short label. */
function actionLabel(job: BoardJob): string | null {
  if (job.status === 'waiting') return 'Start';
  if (job.status === 'washing') return 'Ready';
  if (job.status === 'ready') return `Collect ${formatRupees(job.total)}`;
  return null;
}

/** Gifts the car is still owed first, else today's welcome gift. */
function giftNote(job: BoardJob): { text: string; owed: boolean } | null {
  if (job.status === 'void') return null;
  const owed = job.giftsOwedForCar?.length ?? 0;
  if (owed > 0) return { owed: true, text: owed === 1 ? 'Gift owed' : `${owed} gifts owed` };
  if ((job.gifts ?? []).some((g) => g.status === 'given')) return { owed: false, text: 'Gift given' };
  return null;
}

interface JobRowProps {
  job: BoardJob;
  busy: boolean;
  first: boolean;
  onOpen: (job: BoardJob) => void;
  onAction: (job: BoardJob) => void;
  onThankYou: (job: BoardJob) => void;
}

/**
 * One job on the board: a plain full-width row. The company and model (or the plate) and the
 * total, the plate, the services, who and when, and the single next step.
 */
export const JobRow = memo(function JobRow({ job, busy, first, onOpen, onAction, onThankYou }: JobRowProps) {
  const isVoid = job.status === 'void';
  const action = actionLabel(job);
  const gift = giftNote(job);
  const walkIn = isWalkIn(job.vehicle);
  const make = job.vehicle.make?.trim() || null;
  const model = vehicleModelLine(job.vehicle);
  const plateText = walkIn ? 'Walk-in' : spacedPlate(job.vehicle.registrationNumber);
  const title = model ?? plateText;
  const doorstep = job.deliveryMode === 'doorstep';
  const inProgress = job.status === 'waiting' || job.status === 'washing';
  const when = isToday(job.createdAt) ? formatTime(job.createdAt) : 'Earlier';
  const washers = washerNames(job);
  const by =
    job.status === 'paid' && job.paidBy
      ? firstName(job.paidBy.name)
      : (job.status === 'washing' || job.status === 'ready') && washers
        ? washers
        : null;
  const services = servicesLine(job);
  const paidVia = job.status === 'paid' && job.paymentMethod ? PAYMENT_METHOD_LABEL[job.paymentMethod] : null;

  return (
    <Pressable
      onPress={() => onOpen(job)}
      android_ripple={{ color: colors.surface }}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${make ?? ''}, ${walkIn ? 'walk-in' : job.vehicle.registrationNumber}, ${services}, ${customerLine(job)}, ${STATUS_LABEL[job.status]}, ${formatRupees(job.total)}${gift ? `, ${gift.text}` : ''}. Open details`}
    >
      <View style={[styles.body, !first && styles.bodyDivider]}>
        <View style={styles.line}>
          {model || walkIn ? (
            <Text style={[styles.title, isVoid && styles.voided]} numberOfLines={1}>
              {title}
            </Text>
          ) : (
            <View style={styles.flex}>
              <View style={[styles.plate, styles.plateLarge]}>
                <Text style={[styles.plateText, styles.plateTextLarge]} numberOfLines={1}>
                  {plateText}
                </Text>
              </View>
            </View>
          )}
          <Text style={[styles.price, isVoid && styles.voided]}>{formatRupees(job.total)}</Text>
        </View>

        {model || doorstep ? (
          <View style={styles.vehicleLine}>
            {model && make ? <MakeLogo make={make} height={16} /> : null}
            {model && !walkIn ? (
              <View style={styles.plate}>
                <Text style={styles.plateText} numberOfLines={1}>
                  {plateText}
                </Text>
              </View>
            ) : null}
            {doorstep ? <Text style={styles.doorstep}>Doorstep</Text> : null}
          </View>
        ) : null}

        <Text style={[styles.services, isVoid && styles.voided]} numberOfLines={1}>
          {services}
        </Text>

        <View style={styles.line}>
          <Text style={styles.meta} numberOfLines={1}>
            {inProgress || isVoid ? (
              <Text style={{ color: statusColors[job.status].fg, fontWeight: '700' }}>
                {'● '}
                {STATUS_LABEL[job.status]}
                {'   '}
              </Text>
            ) : null}
            <Text style={styles.customer}>{customerLine(job)}</Text>
            {`  ·  ${when}`}
            {by ? `  ·  ${by}` : ''}
            {paidVia ? <Text style={styles.paid}>{`  ·  ${paidVia}`}</Text> : null}
          </Text>
          {gift ? (
            <View style={styles.gift}>
              <IconGift size={12} color={gift.owed ? colors.amberDeep : colors.tealDeep} />
              <Text style={gift.owed ? styles.giftOwed : styles.giftGiven} numberOfLines={1}>
                {gift.text}
              </Text>
            </View>
          ) : null}
          <View style={styles.flexFill} />

          {action ? (
            <Pressable
              onPress={() => onAction(job)}
              disabled={busy}
              hitSlop={10}
              style={({ pressed }) => [
                styles.action,
                job.status === 'ready' ? styles.actionCollect : styles.actionNext,
                (pressed || busy) && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={job.status === 'washing' ? 'Mark ready' : job.status === 'waiting' ? 'Start wash' : action}
            >
              {busy ? (
                <ActivityIndicator size="small" color={job.status === 'ready' ? colors.white : colors.indigo} />
              ) : (
                <>
                  {job.status === 'waiting' ? (
                    <IconPlay size={11} color={colors.indigo} />
                  ) : job.status === 'washing' ? (
                    <IconCheck size={13} color={colors.indigo} />
                  ) : (
                    <IconRupee size={13} color={colors.white} />
                  )}
                  <Text style={[styles.actionText, job.status === 'ready' && styles.actionTextCollect]}>{action}</Text>
                </>
              )}
            </Pressable>
          ) : job.status === 'paid' ? (
            <Pressable
              onPress={() => onThankYou(job)}
              hitSlop={10}
              style={({ pressed }) => [styles.action, styles.actionThanks, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Send thank-you on WhatsApp"
            >
              <IconWhatsApp size={16} />
              <Text style={styles.thanksText}>Thank you</Text>
            </Pressable>
          ) : null}
        </View>

        {job.syncState ? (
          <Text style={job.syncState === 'failed' ? styles.syncFailed : styles.syncPending}>
            {job.syncState === 'failed' ? 'Not synced · open More to review' : 'Saved on this phone · will sync'}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { paddingLeft: spacing.md, backgroundColor: colors.white },
  rowFirst: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowPressed: { backgroundColor: colors.surface },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 5,
    paddingVertical: spacing.md,
    paddingRight: spacing.md,
  },
  bodyDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.heading, color: colors.waterInk, fontSize: 16, letterSpacing: -0.2, flex: 1 },
  price: { ...typography.heading, color: colors.waterInk, fontSize: 16, letterSpacing: -0.2 },
  voided: { color: colors.slate, textDecorationLine: 'line-through' },

  vehicleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, alignItems: 'flex-start' },
  plateLarge: {},
  plateTextLarge: { ...typography.heading, fontSize: 16, color: colors.waterInk, letterSpacing: 1 },
  plate: {},
  plateText: { fontSize: 12.5, fontWeight: '700', color: colors.slateDeep, letterSpacing: 1 },
  doorstep: { ...typography.caption, color: colors.tealDeep, fontSize: 12.5, fontWeight: '700', letterSpacing: 0 },

  services: { ...typography.body, color: colors.slateDeep, fontSize: 14 },
  meta: { ...typography.caption, color: colors.slate, fontSize: 12.5, letterSpacing: 0, flexShrink: 1 },
  flexFill: { flex: 1 },
  gift: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 0 },
  customer: { color: colors.slateDeep, fontWeight: '600' },
  paid: { color: colors.tealDeep, fontWeight: '700' },
  giftOwed: { ...typography.caption, fontSize: 12.5, letterSpacing: 0, color: colors.amberDeep, fontWeight: '700' },
  giftGiven: { ...typography.caption, fontSize: 12.5, letterSpacing: 0, color: colors.tealDeep, fontWeight: '700' },

  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 34,
    minWidth: 84,
    paddingHorizontal: spacing.md - 2,
    borderRadius: radius.pill,
  },
  actionNext: { backgroundColor: colors.indigoPale },
  actionCollect: { backgroundColor: colors.indigo },
  actionThanks: { backgroundColor: '#EAF8F0', borderWidth: StyleSheet.hairlineWidth, borderColor: '#BBE7CC' },
  actionText: { ...typography.label, color: colors.indigo, fontSize: 13 },
  actionTextCollect: { color: colors.white },
  thanksText: { ...typography.label, color: '#0F7A3D', fontSize: 13 },
  pressed: { opacity: 0.7 },

  syncPending: { ...typography.caption, color: colors.amberDeep, fontSize: 12, fontWeight: '700', letterSpacing: 0 },
  syncFailed: { ...typography.caption, color: colors.danger, fontSize: 12, fontWeight: '700', letterSpacing: 0 },
});
