import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenContainer } from '../components/ScreenContainer';
import { StatusBadge } from '../components/StatusBadge';
import {
  IconCalendar,
  IconCar,
  IconChevronLeft,
  IconPerson,
  IconPhone,
  IconRupee,
  IconVisits,
  IconWhatsApp,
} from '../components/Icons';
import { colors, gradients, radius, shadow, spacing, typography } from '../theme';
import { api } from '../api/client';
import { buildWhatsAppLink, formatDateTime, formatRelativeDate, formatRupees } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';
import type { JobStatus } from '@mana/domain';

type CustomerProfileScreenProps = NativeStackScreenProps<RootStackParamList, 'CustomerProfile'>;
type ProfileTab = 'details' | 'vehicles' | 'history';

interface VehicleItem {
  id: string;
  registrationNumber: string;
  vehicleType: { name: string };
  make?: string | null;
  model?: string | null;
}

interface HistoryJob {
  id: string;
  status: JobStatus;
  total: number;
  discount?: number;
  discountReason?: string | null;
  paymentMethod?: string | null;
  createdAt: string;
  vehicle: { registrationNumber: string };
  jobServices: { service: { name: string } }[];
}

interface ProfileData {
  customer: {
    id: string;
    name: string | null;
    phone: string;
    source?: string | null;
    marketingConsent?: boolean;
    createdAt: string;
  };
  vehicles: VehicleItem[];
  history: HistoryJob[];
  visitCount: number;
  lifetimeSpend: number;
  lastVisit: string | null;
}

type LoadState = ProfileData | null | undefined;

const TABS: { key: ProfileTab; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'vehicles', label: 'Vehicles' },
  { key: 'history', label: 'History' },
];

const SOURCE_LABEL: Record<string, string> = {
  google: 'Google',
  friend: 'Friend / referral',
  board: 'Board / walk-by',
  instagram: 'Instagram',
  other: 'Other',
};

function vehicleLabel(reg: string): string {
  return reg.startsWith('WALK-IN') ? 'Walk-in' : reg;
}

function formatPhoneIntl(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (local.length === 10) return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  return phone;
}

function customerInitials(name: string | null): string | null {
  const parts = (name?.trim() ?? '').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

function formatJoinedDate(input: string): string {
  return new Date(input).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function paymentLabel(method: string | null | undefined): string | null {
  if (!method) return null;
  if (method === 'cash') return 'Cash';
  if (method === 'upi') return 'UPI';
  return 'Other';
}

export function CustomerProfileScreen({ route, navigation }: CustomerProfileScreenProps) {
  const { customerId } = route.params;
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<LoadState>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const [tab, setTab] = useState<ProfileTab>('details');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.customers[':id'].$get({ param: { id: customerId } });
      if (!res.ok) throw new Error(`Could not load this customer (${res.status}).`);
      setData((await res.json()) as ProfileData | null);
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

  const callPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    Linking.openURL(`tel:+${digits.length === 10 ? `91${digits}` : digits}`).catch(() => {
      setWhatsappError('Could not start a call on this device.');
    });
  };

  if (data === undefined || !data) {
    return (
      <ScreenContainer noPadding edges={['top', 'bottom']}>
        <View style={[styles.loadingRoot, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={styles.backOnLight}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <IconChevronLeft size={22} color={colors.waterDeep} />
          </Pressable>
          <View style={styles.centerFill}>
            {data === undefined ? (
              <ActivityIndicator color={colors.water} size="large" />
            ) : (
              <>
                <Text style={styles.errorTitle}>Couldn’t load this customer</Text>
                <Text style={styles.errorBody}>{error ?? 'This customer could not be found.'}</Text>
                <Pressable onPress={() => void load()} style={styles.retryBtn}>
                  <Text style={styles.retryBtnText}>Retry</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </ScreenContainer>
    );
  }

  const { customer, vehicles, history } = data;
  const hasName = Boolean(customer.name?.trim());
  const displayName = customer.name?.trim() || formatPhoneIntl(customer.phone);
  const initials = customerInitials(customer.name);
  const phoneDisplay = formatPhoneIntl(customer.phone);
  const isRepeat = data.visitCount > 1;
  const paidCount = history.filter((j) => j.status === 'paid').length;
  const avgTicket =
    paidCount > 0 ? Math.round(data.lifetimeSpend / paidCount) : 0;

  const thankYouMessage = (regNumber?: string) =>
    `Hi${customer.name?.trim() ? ` ${customer.name.trim()}` : ''}, thank you for choosing MANA Car Wash!` +
    `${regNumber ? ` Your ${vehicleLabel(regNumber)} is all done —` : ''} we hope it looks great. See you next time 🚗`;

  const greetingMessage = `Hi${customer.name?.trim() ? ` ${customer.name.trim()}` : ''}, this is MANA Car Wash. How can we help you today?`;

  return (
    <ScreenContainer noPadding edges={['bottom']}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[]}
      >
        {/* Atmospheric hero — same water language as Job Board */}
        <LinearGradient
          colors={gradients.hero as unknown as string[]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[styles.hero, { paddingTop: insets.top + spacing.sm }]}
        >
          <View pointerEvents="none" style={styles.orbLarge} />
          <View pointerEvents="none" style={styles.orbSmall} />

          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.backOnHero, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <IconChevronLeft size={22} color={colors.white} />
          </Pressable>

          <View style={styles.heroIdentity}>
            <LinearGradient
              colors={['rgba(255,255,255,0.95)', 'rgba(224,242,254,0.95)'] as unknown as string[]}
              style={styles.avatarRing}
            >
              <View style={styles.avatar}>
                {initials ? (
                  <Text style={styles.avatarText}>{initials}</Text>
                ) : (
                  <IconPerson size={34} color={colors.waterDeep} />
                )}
              </View>
            </LinearGradient>

            <Text style={styles.heroName} numberOfLines={2}>
              {displayName}
            </Text>
            <Text style={styles.heroPhone}>{phoneDisplay}</Text>

            <View style={styles.badgeRow}>
              <View style={[styles.badge, isRepeat ? styles.badgeRepeat : styles.badgeNew]}>
                <Text style={[styles.badgeText, isRepeat ? styles.badgeTextRepeat : styles.badgeTextNew]}>
                  {isRepeat ? 'Repeat customer' : 'New customer'}
                </Text>
              </View>
              {customer.source ? (
                <View style={styles.badgeMuted}>
                  <Text style={styles.badgeMutedText}>
                    {SOURCE_LABEL[customer.source] ?? customer.source}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </LinearGradient>

        {/* Overlapping action sheet */}
        <View style={styles.sheet}>
          <View style={styles.paddedBlock}>
            <View style={styles.actionRow}>
              <Pressable
                onPress={() => openWhatsApp(customer.phone, greetingMessage)}
                style={({ pressed }) => [styles.actionWhatsApp, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="WhatsApp"
              >
                <IconWhatsApp size={18} color="#FFFFFF" />
                <Text style={styles.actionWhatsAppLabel}>WhatsApp</Text>
              </Pressable>

              <Pressable
                onPress={() => callPhone(customer.phone)}
                style={({ pressed }) => [styles.actionCallShell, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Call"
              >
                <LinearGradient
                  colors={gradients.primaryButton as unknown as string[]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.actionCall}
                >
                  <IconPhone size={17} color={colors.white} />
                  <Text style={styles.actionCallLabel}>Call</Text>
                </LinearGradient>
              </Pressable>
            </View>
            {whatsappError ? <Text style={styles.whatsappError}>{whatsappError}</Text> : null}

            <View style={styles.metricRow}>
              <View style={[styles.metricTile, styles.metricVisits]}>
                <View style={styles.metricIconBubble}>
                  <IconVisits size={14} color={colors.waterDeep} />
                </View>
                <Text style={styles.metricValue}>{data.visitCount}</Text>
                <Text style={styles.metricLabel}>Visits</Text>
              </View>
              <View style={[styles.metricTile, styles.metricSpend]}>
                <View style={[styles.metricIconBubble, styles.metricIconTeal]}>
                  <IconRupee size={14} color={colors.tealDeep} />
                </View>
                <Text style={[styles.metricValue, styles.metricValueTeal]} numberOfLines={1} adjustsFontSizeToFit>
                  {formatRupees(data.lifetimeSpend)}
                </Text>
                <Text style={styles.metricLabel}>Lifetime</Text>
              </View>
              <View style={[styles.metricTile, styles.metricLast]}>
                <View style={[styles.metricIconBubble, styles.metricIconAmber]}>
                  <IconCalendar size={14} color={colors.amberDeep} />
                </View>
                <Text style={[styles.metricValue, styles.metricValueAmber]} numberOfLines={1} adjustsFontSizeToFit>
                  {data.lastVisit ? formatRelativeDate(data.lastVisit) : '—'}
                </Text>
                <Text style={styles.metricLabel}>Last visit</Text>
              </View>
            </View>

            <View style={styles.segment}>
              {TABS.map((item) => {
                const active = tab === item.key;
                const count =
                  item.key === 'vehicles'
                    ? vehicles.length
                    : item.key === 'history'
                      ? history.length
                      : null;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setTab(item.key)}
                    style={[styles.segmentItem, active && styles.segmentItemActive]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                  >
                    {active ? (
                      <LinearGradient
                        colors={gradients.chipSelected as unknown as string[]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.segmentActiveFill}
                      >
                        <Text style={styles.segmentLabelActive}>
                          {item.label}
                          {count != null && count > 0 ? ` · ${count}` : ''}
                        </Text>
                      </LinearGradient>
                    ) : (
                      <Text style={styles.segmentLabel}>
                        {item.label}
                        {count != null && count > 0 ? ` · ${count}` : ''}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>

          {tab === 'details' && (
            <View style={styles.panel}>
              <Text style={styles.sectionEyebrow}>Customer info</Text>
              <View style={styles.edgeList}>
                <InfoRow
                  label="Name"
                  value={hasName ? customer.name!.trim() : 'Not set'}
                  muted={!hasName}
                />
                <InfoRow label="Phone" value={phoneDisplay} />
                <InfoRow
                  label="Customer since"
                  value={formatJoinedDate(customer.createdAt)}
                  last={!customer.source && paidCount === 0}
                />
                {customer.source ? (
                  <InfoRow
                    label="Heard about us"
                    value={SOURCE_LABEL[customer.source] ?? customer.source}
                    last={paidCount === 0}
                  />
                ) : null}
                {paidCount > 0 ? (
                  <InfoRow label="Avg. ticket" value={formatRupees(avgTicket)} last />
                ) : null}
              </View>
            </View>
          )}

          {tab === 'vehicles' && (
            <View style={styles.panel}>
              {vehicles.length === 0 ? (
                <View style={styles.paddedBlock}>
                  <EmptyState title="No vehicles yet" body="Vehicles appear here when this customer gets a wash." />
                </View>
              ) : (
                <View style={styles.edgeList}>
                  {vehicles.map((v, index) => {
                    const makeModel = [v.make, v.model].filter(Boolean).join(' ');
                    return (
                      <View
                        key={v.id}
                        style={[
                          styles.listRow,
                          index < vehicles.length - 1 && styles.listRowBorder,
                        ]}
                      >
                        <View style={styles.listRowIcon}>
                          <IconCar size={18} color={colors.waterDeep} />
                        </View>
                        <View style={styles.listRowCopy}>
                          <Text style={styles.listRowTitle}>
                            {vehicleLabel(v.registrationNumber)}
                          </Text>
                          <Text style={styles.listRowMeta}>
                            {v.vehicleType.name}
                            {makeModel ? ` · ${makeModel}` : ''}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {tab === 'history' && (
            <View style={styles.panel}>
              {history.length === 0 ? (
                <View style={styles.paddedBlock}>
                  <EmptyState title="No visits yet" body="Every wash for this customer will show up here." />
                </View>
              ) : (
                <View style={styles.edgeList}>
                  {history.map((job, index) => (
                    <View
                      key={job.id}
                      style={[
                        styles.historyRow,
                        index < history.length - 1 && styles.listRowBorder,
                      ]}
                    >
                      <View style={styles.historyTop}>
                        <Text style={styles.historyDate}>{formatDateTime(job.createdAt)}</Text>
                        <StatusBadge status={job.status} />
                      </View>
                      <View style={styles.historyMain}>
                        <Text style={styles.historyService} numberOfLines={2}>
                          {job.jobServices.map((js) => js.service.name).join(' · ')}
                        </Text>
                        <Text style={styles.historyPrice}>{formatRupees(job.total)}</Text>
                      </View>
                      <Text style={styles.historyVehicle}>
                        {vehicleLabel(job.vehicle.registrationNumber)}
                        {paymentLabel(job.paymentMethod)
                          ? ` · ${paymentLabel(job.paymentMethod)}`
                          : ''}
                      </Text>
                      {job.discount && job.discount > 0 ? (
                        <Text style={styles.discountNote}>
                          Discount {formatRupees(job.discount)}
                          {job.discountReason ? ` · ${job.discountReason}` : ''}
                        </Text>
                      ) : null}
                      {job.status === 'paid' ? (
                        <Pressable
                          onPress={() =>
                            openWhatsApp(
                              customer.phone,
                              thankYouMessage(job.vehicle.registrationNumber),
                            )
                          }
                          style={({ pressed }) => [styles.thankYouBtn, pressed && styles.pressed]}
                        >
                          <IconWhatsApp size={14} color="#25D366" />
                          <Text style={styles.thankYouLabel}>Send thank-you</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function InfoRow({
  label,
  value,
  muted,
  last,
}: {
  label: string;
  value: string;
  muted?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, !last && styles.listRowBorder]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, muted && styles.infoValueMuted]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scroll: {
    paddingBottom: spacing.xxl,
  },
  loadingRoot: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  hero: {
    paddingBottom: spacing.xl + 8,
    overflow: 'hidden',
  },
  orbLarge: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.14)',
    top: -50,
    right: -40,
  },
  orbSmall: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(94,234,212,0.2)',
    bottom: 20,
    left: -30,
  },
  backOnHero: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginLeft: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backOnLight: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIdentity: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: 6,
  },
  avatarRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    padding: 4,
    marginBottom: 6,
    ...shadow('md'),
  },
  avatar: {
    flex: 1,
    borderRadius: 42,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    ...typography.title,
    color: colors.waterDeep,
    fontSize: 30,
    letterSpacing: 0.5,
  },
  heroName: {
    ...typography.title,
    color: colors.white,
    fontSize: 26,
    letterSpacing: -0.4,
    textAlign: 'center',
    textShadowColor: 'rgba(8,47,73,0.25)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroPhone: {
    ...typography.body,
    color: 'rgba(255,255,255,0.88)',
    fontSize: 15,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badgeNew: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderColor: 'rgba(255,255,255,0.45)',
  },
  badgeRepeat: {
    backgroundColor: 'rgba(204,251,241,0.95)',
    borderColor: colors.tealLight,
  },
  badgeMuted: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8,47,73,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  badgeText: {
    ...typography.caption,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  badgeTextNew: { color: colors.white },
  badgeTextRepeat: { color: colors.tealDeep },
  badgeMutedText: { ...typography.caption, color: 'rgba(255,255,255,0.9)', fontSize: 11 },
  sheet: {
    marginTop: -spacing.lg,
    gap: spacing.md,
  },
  paddedBlock: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionWhatsApp: {
    flex: 1,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: '#25D366',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...shadow('sm'),
  },
  actionWhatsAppLabel: {
    ...typography.bodyStrong,
    color: colors.white,
    fontSize: 15,
  },
  actionCallShell: {
    flex: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    ...shadow('sm'),
  },
  actionCall: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionCallLabel: {
    ...typography.bodyStrong,
    color: colors.white,
    fontSize: 15,
  },
  whatsappError: {
    ...typography.caption,
    color: colors.danger,
    textAlign: 'center',
    marginTop: -spacing.xs,
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metricTile: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
  },
  metricVisits: {
    backgroundColor: colors.waterPale,
    borderColor: '#BAE6FD',
  },
  metricSpend: {
    backgroundColor: '#CCFBF1',
    borderColor: '#99F6E4',
  },
  metricLast: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  metricIconBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  metricIconTeal: {},
  metricIconAmber: {},
  metricValue: {
    ...typography.heading,
    color: colors.waterInk,
    fontSize: 17,
    letterSpacing: -0.3,
  },
  metricValueTeal: { color: colors.tealDeep },
  metricValueAmber: { color: colors.amberDeep },
  metricLabel: {
    ...typography.caption,
    color: colors.slateDeep,
    fontSize: 11,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 2,
    ...shadow('sm'),
  },
  segmentItem: {
    flex: 1,
    borderRadius: radius.sm + 2,
    overflow: 'hidden',
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: {},
  segmentActiveFill: {
    width: '100%',
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm + 2,
    paddingHorizontal: 4,
  },
  segmentLabel: {
    ...typography.label,
    color: colors.slateDeep,
    fontSize: 13,
    textTransform: 'none',
    letterSpacing: 0,
    paddingVertical: 10,
  },
  segmentLabelActive: {
    ...typography.label,
    color: colors.white,
    fontSize: 13,
    textTransform: 'none',
    letterSpacing: 0,
  },
  panel: {
    gap: 0,
  },
  sectionEyebrow: {
    ...typography.label,
    color: colors.slateDeep,
    letterSpacing: 0.6,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  edgeList: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 64,
    backgroundColor: colors.white,
  },
  listRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listRowCopy: {
    flex: 1,
    gap: 2,
  },
  listRowTitle: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 16,
  },
  listRowMeta: {
    ...typography.caption,
    color: colors.slateDeep,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 52,
    backgroundColor: colors.white,
  },
  infoLabel: {
    ...typography.body,
    color: colors.slateDeep,
    fontSize: 15,
  },
  infoValue: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 15,
    textAlign: 'right',
    flexShrink: 1,
  },
  infoValueMuted: {
    color: colors.slate,
    fontWeight: '500',
  },
  historyRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 6,
    backgroundColor: colors.white,
  },
  historyTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyDate: {
    ...typography.caption,
    color: colors.slateDeep,
  },
  historyMain: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  historyService: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 16,
    flex: 1,
  },
  historyVehicle: {
    ...typography.caption,
    color: colors.slate,
  },
  historyPrice: {
    ...typography.bodyStrong,
    color: colors.waterDeep,
    fontSize: 16,
  },
  discountNote: {
    ...typography.caption,
    color: colors.amberDeep,
  },
  thankYouBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  thankYouLabel: {
    ...typography.label,
    color: colors.tealDeep,
    fontSize: 12,
    textTransform: 'none',
  },
  empty: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    ...typography.bodyStrong,
    color: colors.waterInk,
  },
  emptyBody: {
    ...typography.body,
    color: colors.slateDeep,
    textAlign: 'center',
    fontSize: 14,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
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
  pressed: {
    opacity: 0.85,
  },
});
