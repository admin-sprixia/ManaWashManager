import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  PLACE_KIND_LABELS,
  PREFERRED_TIME_LABELS,
  vehicleSummary,
  type PlaceKind,
  type PreferredTime,
} from '@mana/domain';
import {
  IconCalendar,
  IconCar,
  IconClock,
  IconMapPin,
  colors,
  formatDateTime,
  radius,
  shadow,
  spacing,
  typography,
  type PillTone,
} from '@mana/ui';
import { Pill } from './CardList';
import type { ServiceRequest } from '../api/types';

const STATUS: Record<ServiceRequest['status'], { label: string; tone: PillTone }> = {
  pending: { label: 'WAITING FOR A CALL', tone: 'water' },
  out_of_area: { label: 'NOT IN YOUR AREA YET', tone: 'amber' },
  approved: { label: 'APPROVED', tone: 'teal' },
  rejected: { label: 'DECLINED', tone: 'danger' },
  cancelled: { label: 'CANCELLED', tone: 'slate' },
};

function Line({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.line}>
      {icon}
      <Text style={styles.lineText}>{text}</Text>
    </View>
  );
}

/** One service request: its status and what was asked for. */
export function RequestCard({ request }: { request: ServiceRequest }) {
  const status = STATUS[request.status];
  const place = [request.homeText, request.placeName, request.address].filter(Boolean).join(', ');
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Pill label={status.label} tone={status.tone} />
        <Text style={styles.date}>{formatDateTime(request.createdAt)}</Text>
      </View>
      {request.branch ? (
        <Text style={styles.branch}>
          {request.branch.name}
          {request.branch.city ? ` · ${request.branch.city}` : ''}
        </Text>
      ) : null}
      <Line icon={<IconMapPin size={16} color={colors.slateDeep} />} text={place} />
      <Line
        icon={<IconCar size={16} color={colors.slateDeep} />}
        text={`${vehicleSummary(request.cars, request.bikes)} · ${PLACE_KIND_LABELS[request.placeKind as PlaceKind] ?? 'Other'}`}
      />
      {request.preferredTime ? (
        <Line
          icon={<IconClock size={16} color={colors.slateDeep} />}
          text={PREFERRED_TIME_LABELS[request.preferredTime as PreferredTime] ?? ''}
        />
      ) : null}
      {request.handledAt && request.status !== 'cancelled' ? (
        <Line icon={<IconCalendar size={16} color={colors.slateDeep} />} text={`Answered ${formatDateTime(request.handledAt)}`} />
      ) : null}
      {request.reason ? <Text style={styles.reason}>“{request.reason}”</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E9EDFC',
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadow('md'),
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  date: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  branch: { ...typography.bodyStrong, color: colors.waterInk },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  lineText: { ...typography.body, color: colors.slateDeep, fontSize: 14, lineHeight: 20, flex: 1 },
  reason: { ...typography.body, color: colors.waterInk, fontSize: 14, fontStyle: 'italic' },
});
