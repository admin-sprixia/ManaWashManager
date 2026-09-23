import React, { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { ScreenHeader } from '../components/ScreenHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/StatusBadge';
import { colors, radius, spacing, typography } from '../theme';
import { api } from '../api/client';
import { buildWhatsAppLink, formatDateTime, formatRelativeDate, formatRupees } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';
import type { JobStatus } from '@mana/domain';

type CustomerProfileScreenProps = NativeStackScreenProps<RootStackParamList, 'CustomerProfile'>;

interface VehicleItem {
  id: string;
  registrationNumber: string;
  vehicleType: { name: string };
}

interface HistoryJob {
  id: string;
  status: JobStatus;
  total: number;
  createdAt: string;
  vehicle: { registrationNumber: string };
  jobServices: { service: { name: string } }[];
}

interface ProfileData {
  customer: { id: string; name: string | null; phone: string; createdAt: string };
  vehicles: VehicleItem[];
  history: HistoryJob[];
  visitCount: number;
  lifetimeSpend: number;
  lastVisit: string | null;
}

/** `undefined` = still loading, `null` = not found or the request failed (see `error`). */
type LoadState = ProfileData | null | undefined;

export function CustomerProfileScreen({ route, navigation }: CustomerProfileScreenProps) {
  const { customerId } = route.params;
  const [data, setData] = useState<LoadState>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.customers[':id'].$get({ param: { id: customerId } });
      if (!res.ok) throw new Error(`Could not load this customer (${res.status}).`);
      const json = await res.json();
      setData(json as ProfileData | null);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Could not reach the API. Is it running on localhost:8787?');
    }
  }, [customerId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openWhatsApp = (phone: string, message: string) => {
    setWhatsappError(null);
    Linking.openURL(buildWhatsAppLink(phone, message)).catch(() => {
      setWhatsappError('Could not open WhatsApp — make sure it’s installed.');
    });
  };

  if (data === undefined) {
    return (
      <ScreenContainer>
        <ScreenHeader title="Customer" onBack={() => navigation.goBack()} />
        <View style={styles.centerFill}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </ScreenContainer>
    );
  }

  if (!data) {
    return (
      <ScreenContainer>
        <ScreenHeader title="Customer" onBack={() => navigation.goBack()} />
        <View style={styles.centerFill}>
          <Text style={styles.errorTitle}>Couldn’t load this customer</Text>
          <Text style={styles.errorBody}>{error ?? 'This customer could not be found.'}</Text>
          <Pressable onPress={() => void load()} style={styles.retryBtn} accessibilityRole="button">
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  const { customer, vehicles, history } = data;
  const displayName = customer.name?.trim() || customer.phone;
  const thankYouMessage = (regNumber?: string) =>
    `Hi${customer.name?.trim() ? ` ${customer.name.trim()}` : ''}, thank you for choosing MANA Car Wash!` +
    `${regNumber ? ` Your ${regNumber} is all done —` : ''} we hope it looks great. See you next time 🚗`;

  return (
    <ScreenContainer>
      <ScreenHeader title="Customer" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card elevation="sm" style={styles.identityCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.identityCopy}>
            <Text style={styles.name} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.phone}>{customer.phone}</Text>
          </View>
        </Card>

        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{data.visitCount}</Text>
            <Text style={styles.statLabel}>{data.visitCount === 1 ? 'Visit' : 'Visits'}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {formatRupees(data.lifetimeSpend)}
            </Text>
            <Text style={styles.statLabel}>Lifetime spend</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {data.lastVisit ? formatRelativeDate(data.lastVisit) : '—'}
            </Text>
            <Text style={styles.statLabel}>Last visit</Text>
          </View>
        </View>

        <Button label="Message on WhatsApp" variant="secondary" onPress={() => openWhatsApp(customer.phone, thankYouMessage())} />
        {whatsappError ? <Text style={styles.whatsappError}>{whatsappError}</Text> : null}

        {vehicles.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Vehicles</Text>
            <View style={styles.vehicleRow}>
              {vehicles.map((v) => (
                <View key={v.id} style={styles.vehicleChip}>
                  <Text style={styles.vehicleChipReg} numberOfLines={1}>
                    {v.registrationNumber.startsWith('WALK-IN') ? 'Walk-in' : v.registrationNumber}
                  </Text>
                  <Text style={styles.vehicleChipType}>{v.vehicleType.name}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionLabel}>History</Text>
        {history.length === 0 ? (
          <Text style={styles.emptyText}>No jobs yet for this customer.</Text>
        ) : (
          history.map((job) => (
            <Card key={job.id} elevation="sm" style={styles.jobCard}>
              <View style={styles.jobHeader}>
                <Text style={styles.jobDate}>{formatDateTime(job.createdAt)}</Text>
                <StatusBadge status={job.status} />
              </View>
              <Text style={styles.jobServices} numberOfLines={2}>
                {job.jobServices.map((js) => js.service.name).join(', ')}
              </Text>
              <View style={styles.jobFooter}>
                <Text style={styles.jobVehicle} numberOfLines={1}>
                  {job.vehicle.registrationNumber.startsWith('WALK-IN') ? 'Walk-in' : job.vehicle.registrationNumber}
                </Text>
                <Text style={styles.jobTotal}>{formatRupees(job.total)}</Text>
              </View>
              {job.status === 'paid' ? (
                <Pressable
                  onPress={() => openWhatsApp(customer.phone, thankYouMessage(job.vehicle.registrationNumber))}
                  style={styles.whatsappRow}
                  accessibilityRole="button"
                >
                  <Text style={styles.whatsappRowText}>Send thank-you on WhatsApp</Text>
                </Pressable>
              ) : null}
            </Card>
          ))
        )}
        <View style={styles.bottomPad} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  loadingText: {
    ...typography.body,
    color: colors.slateDeep,
  },
  errorTitle: {
    ...typography.heading,
    color: colors.waterInk,
  },
  errorBody: {
    ...typography.body,
    color: colors.slateDeep,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.water,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryBtnText: {
    ...typography.label,
    color: colors.white,
  },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    ...typography.title,
    color: colors.waterDeep,
    fontSize: 22,
  },
  identityCopy: {
    flex: 1,
    gap: 2,
  },
  name: {
    ...typography.heading,
    color: colors.waterInk,
  },
  phone: {
    ...typography.body,
    color: colors.slateDeep,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    ...typography.heading,
    color: colors.waterDeep,
    fontSize: 17,
  },
  statLabel: {
    ...typography.caption,
    color: colors.slateDeep,
    textAlign: 'center',
  },
  whatsappError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: -spacing.xs,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.slateDeep,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  vehicleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  vehicleChip: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
    minWidth: 120,
  },
  vehicleChipReg: {
    ...typography.bodyStrong,
    color: colors.waterInk,
  },
  vehicleChipType: {
    ...typography.caption,
    color: colors.slateDeep,
  },
  emptyText: {
    ...typography.body,
    color: colors.slateDeep,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  jobCard: {
    gap: spacing.xs,
  },
  jobHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  jobDate: {
    ...typography.caption,
    color: colors.slateDeep,
  },
  jobServices: {
    ...typography.body,
    color: colors.waterInk,
  },
  jobFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  jobVehicle: {
    ...typography.caption,
    color: colors.slateDeep,
    flex: 1,
    marginRight: spacing.sm,
  },
  jobTotal: {
    ...typography.bodyStrong,
    color: colors.waterDeep,
  },
  whatsappRow: {
    marginTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  whatsappRowText: {
    ...typography.label,
    color: colors.teal,
    textTransform: 'none',
  },
  bottomPad: {
    height: spacing.lg,
  },
});
