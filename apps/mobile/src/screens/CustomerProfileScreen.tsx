import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  LayoutAnimation,
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
import { vehicleImageFor } from '../components/VehicleTypeIcon';
import { PlateBadge } from '../components/newWash/Highlight';
import {
  IconChevronDown,
  IconChevronLeft,
  IconClock,
  IconDroplet,
  IconPerson,
  IconPhone,
  IconPlus,
  IconSparkle,
  IconWhatsApp,
} from '../components/Icons';
import { colors, gradients, radius, shadow, spacing, typography } from '../theme';
import { api } from '../api/client';
import { buildWhatsAppLink, formatRelativeDate, formatRupees } from '../utils/format';
import { buildThankYouMessage } from '../utils/messages';
import type { RootStackParamList } from '../navigation/RootNavigator';
import type { JobStatus } from '@mana/domain';

type CustomerProfileScreenProps = NativeStackScreenProps<RootStackParamList, 'CustomerProfile'>;

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
  vehicle: { registrationNumber: string; vehicleType?: { name: string } | null };
  jobServices: { quantity?: number; service: { name: string } }[];
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

const HISTORY_PREVIEW = 5;
const OPEN_STATUSES: JobStatus[] = ['waiting', 'washing', 'ready'];

const SOURCE_LABEL: Record<string, string> = {
  google: 'Found on Google',
  friend: 'Referred by a friend',
  board: 'Saw our board',
  instagram: 'Found on Instagram',
  other: 'Other source',
};

function isWalkIn(reg: string): boolean {
  return reg.startsWith('WALK-IN');
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

function paymentLabel(method: string | null | undefined): string | null {
  if (!method) return null;
  if (method === 'cash') return 'Cash';
  if (method === 'upi') return 'UPI';
  return 'Other';
}

/** Relative date for mid-sentence use: "today", "3 days ago", or "on 15 Sept 2026". */
function whenLower(input: string): string {
  const rel = formatRelativeDate(input);
  if (rel === 'Today' || rel === 'Yesterday') return rel.toLowerCase();
  return rel.endsWith('ago') ? rel : `on ${rel}`;
}

function monthKey(input: string): string {
  return new Date(input).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function timeOf(input: string): string {
  return new Date(input).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

/** The service this customer picks most often, once there's enough history to call it a habit. */
function favouriteService(history: HistoryJob[]): string | null {
  const counts = new Map<string, number>();
  let jobs = 0;
  for (const job of history) {
    if (job.status === 'void') continue;
    jobs++;
    for (const js of job.jobServices)
      counts.set(js.service.name, (counts.get(js.service.name) ?? 0) + 1);
  }
  if (jobs < 2) return null;
  let best: string | null = null;
  let bestCount = 1;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

export function CustomerProfileScreen({ route, navigation }: CustomerProfileScreenProps) {
  const { customerId } = route.params;
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<LoadState>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.customers[':id'].$get({ param: { id: customerId } });
      if (!res.ok) throw new Error(`Could not load this customer (${res.status}).`);
      setData((await res.json()) as ProfileData | null);
    } catch (e) {
      setData(null);
      setError(
        e instanceof Error
          ? e.message
          : 'Could not reach the API. Is it running on localhost:8787?',
      );
    }
  }, [customerId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const insights = useMemo(() => {
    if (!data) return null;
    const { history } = data;
    const paid = history.filter((j) => j.status === 'paid');
    const open = history.filter((j) => OPEN_STATUSES.includes(j.status));
    const perVehicle = new Map<string, { visits: number; last: string }>();
    for (const job of history) {
      if (job.status === 'void') continue;
      const reg = job.vehicle.registrationNumber;
      const prev = perVehicle.get(reg);
      perVehicle.set(reg, { visits: (prev?.visits ?? 0) + 1, last: prev?.last ?? job.createdAt });
    }
    return {
      avgTicket: paid.length > 0 ? Math.round(data.lifetimeSpend / paid.length / 100) * 100 : null,
      openCount: open.length,
      openTotal: open.reduce((sum, j) => sum + j.total, 0),
      favourite: favouriteService(history),
      perVehicle,
    };
  }, [data]);

  const openWhatsApp = (phone: string, message: string) => {
    setActionError(null);
    Linking.openURL(buildWhatsAppLink(phone, message)).catch(() => {
      setActionError('Could not open WhatsApp — make sure it’s installed.');
    });
  };

  const callPhone = (phone: string) => {
    setActionError(null);
    const digits = phone.replace(/\D/g, '');
    Linking.openURL(`tel:+${digits.length === 10 ? `91${digits}` : digits}`).catch(() => {
      setActionError('Could not start a call on this device.');
    });
  };

  if (data === undefined || !data || !insights) {
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
  const firstName = customer.name?.trim().split(/\s+/)[0] ?? null;
  const displayName = customer.name?.trim() || formatPhoneIntl(customer.phone);
  const initials = customerInitials(customer.name);
  const phoneDisplay = formatPhoneIntl(customer.phone);
  const washableVehicles = vehicles.filter((v) => !isWalkIn(v.registrationNumber));
  const primaryReg =
    history.find((j) => !isWalkIn(j.vehicle.registrationNumber))?.vehicle.registrationNumber ??
    washableVehicles[0]?.registrationNumber;
  const loyalty =
    data.visitCount >= 10
      ? 'Loyal regular'
      : data.visitCount > 1
        ? 'Repeat customer'
        : 'New customer';
  const since = new Date(customer.createdAt).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  });

  const visibleHistory = showAllHistory ? history : history.slice(0, HISTORY_PREVIEW);
  const groups: { month: string; jobs: HistoryJob[] }[] = [];
  for (const job of visibleHistory) {
    const month = monthKey(job.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.jobs.push(job);
    else groups.push({ month, jobs: [job] });
  }

  const startWash = (registration?: string) =>
    navigation.navigate('NewWash', registration ? { registration } : undefined);

  const thankYouMessage = (job: HistoryJob) =>
    buildThankYouMessage({
      jobId: job.id,
      customerName: customer.name,
      registrationNumber: job.vehicle.registrationNumber,
      vehicleType: job.vehicle.vehicleType?.name,
      services: job.jobServices.map((js) => ({ name: js.service.name, quantity: js.quantity })),
      total: job.total,
      discount: job.discount,
      paymentMethod: job.paymentMethod,
      visitedAt: job.createdAt,
    });

  const greetingMessage = `Hi${firstName ? ` ${firstName}` : ''}, this is MANA Car Wash. How can we help you today?`;

  const toggleHistory = () => {
    LayoutAnimation.configureNext({
      duration: 220,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
    });
    setShowAllHistory((v) => !v);
  };

  return (
    <ScreenContainer noPadding edges={['bottom']}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
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
            <View style={styles.avatarRing}>
              <View style={styles.avatar}>
                {initials ? (
                  <Text style={styles.avatarText}>{initials}</Text>
                ) : (
                  <IconPerson size={34} color={colors.waterDeep} />
                )}
              </View>
            </View>

            <Text style={styles.heroName} numberOfLines={2}>
              {displayName}
            </Text>
            <Text style={styles.heroPhone}>{phoneDisplay}</Text>

            <View style={styles.badgeRow}>
              <View style={[styles.badge, data.visitCount > 1 && styles.badgeRepeat]}>
                {data.visitCount > 1 ? <IconSparkle size={12} color={colors.tealDeep} /> : null}
                <Text style={[styles.badgeText, data.visitCount > 1 && styles.badgeTextRepeat]}>
                  {loyalty}
                </Text>
              </View>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>Since {since}</Text>
              </View>
            </View>
          </View>

          <View style={styles.quickRow}>
            <QuickAction label="Call" onPress={() => callPhone(customer.phone)}>
              <IconPhone size={20} color={colors.white} />
            </QuickAction>
            <QuickAction
              label="WhatsApp"
              onPress={() => openWhatsApp(customer.phone, greetingMessage)}
            >
              <IconWhatsApp size={20} variant="mono" color={colors.white} />
            </QuickAction>
            <QuickAction label="New wash" primary onPress={() => startWash(primaryReg)}>
              <IconDroplet size={20} color={colors.waterDeep} />
            </QuickAction>
          </View>
        </LinearGradient>

        <View style={styles.statsCard}>
          <View style={styles.statsRow}>
            <Stat
              value={String(data.visitCount)}
              label={data.visitCount === 1 ? 'Visit' : 'Visits'}
            />
            <View style={styles.statDivider} />
            <Stat value={formatRupees(data.lifetimeSpend)} label="Spent" tone="teal" />
            <View style={styles.statDivider} />
            <Stat
              value={insights.avgTicket != null ? formatRupees(insights.avgTicket) : '—'}
              label="Avg. ticket"
            />
          </View>
          <View style={styles.statsFooter}>
            <InsightLine
              icon={<IconClock size={14} color={colors.waterDeep} />}
              text={data.lastVisit ? `Last here ${whenLower(data.lastVisit)}` : 'No visits yet'}
            />
            {insights.favourite ? (
              <InsightLine
                icon={<IconSparkle size={14} color={colors.waterDeep} />}
                text={`Usually gets ${insights.favourite}`}
              />
            ) : null}
            {customer.source ? (
              <InsightLine
                icon={<IconPerson size={14} color={colors.waterDeep} />}
                text={SOURCE_LABEL[customer.source] ?? customer.source}
              />
            ) : null}
          </View>
          {insights.openCount > 0 ? (
            <View style={styles.pendingStrip}>
              <View style={styles.pendingDot} />
              <Text style={styles.pendingText}>
                {formatRupees(insights.openTotal)} to collect · {insights.openCount} open{' '}
                {insights.openCount === 1 ? 'wash' : 'washes'}
              </Text>
            </View>
          ) : null}
        </View>
        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

        <SectionHeader title="Vehicles" count={vehicles.length} />
        {vehicles.length === 0 ? (
          <EmptyState
            title="No vehicles yet"
            body="Vehicles appear here when this customer gets a wash."
          />
        ) : (
          <View style={styles.edgeList}>
            {vehicles.map((v, index) => {
              const makeModel = [v.make, v.model].filter(Boolean).join(' ');
              const stats = insights.perVehicle.get(v.registrationNumber);
              const walkIn = isWalkIn(v.registrationNumber);
              return (
                <View
                  key={v.id}
                  style={[styles.vehicleRow, index < vehicles.length - 1 && styles.rowBorder]}
                >
                  <Image source={vehicleImageFor(v.vehicleType.name)} style={styles.vehicleThumb} />
                  <View style={styles.vehicleCopy}>
                    {walkIn ? (
                      <Text style={styles.walkIn}>Walk-in</Text>
                    ) : (
                      <PlateBadge plate={v.registrationNumber} size="sm" />
                    )}
                    <Text style={styles.vehicleMeta} numberOfLines={1}>
                      {v.vehicleType.name}
                      {makeModel ? ` · ${makeModel}` : ''}
                    </Text>
                    <Text style={styles.vehicleVisits} numberOfLines={1}>
                      {stats
                        ? `${stats.visits} ${stats.visits === 1 ? 'wash' : 'washes'} · last ${whenLower(stats.last)}`
                        : 'No washes yet'}
                    </Text>
                  </View>
                  {walkIn ? null : (
                    <Pressable
                      onPress={() => startWash(v.registrationNumber)}
                      style={({ pressed }) => [styles.washPill, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`New wash for ${v.registrationNumber}`}
                      hitSlop={6}
                    >
                      <IconPlus size={14} color={colors.waterDeep} />
                      <Text style={styles.washPillText}>Wash</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}

        <SectionHeader title="History" count={history.length} />
        {history.length === 0 ? (
          <EmptyState
            title="No visits yet"
            body="Every wash for this customer will show up here."
          />
        ) : (
          <View>
            {groups.map((group) => (
              <View key={group.month}>
                <Text style={styles.monthLabel}>{group.month}</Text>
                <View style={styles.edgeList}>
                  {group.jobs.map((job, index) => {
                    const date = new Date(job.createdAt);
                    const isVoid = job.status === 'void';
                    const pay = paymentLabel(job.paymentMethod);
                    return (
                      <View
                        key={job.id}
                        style={[
                          styles.historyRow,
                          index < group.jobs.length - 1 && styles.rowBorder,
                        ]}
                      >
                        <View style={[styles.dateBlock, isVoid && styles.dateBlockVoid]}>
                          <Text style={[styles.dateDay, isVoid && styles.textVoid]}>
                            {date.getDate()}
                          </Text>
                          <Text style={styles.dateWeekday}>
                            {date.toLocaleDateString('en-IN', { weekday: 'short' })}
                          </Text>
                        </View>
                        <View style={styles.historyCopy}>
                          <Text
                            style={[styles.historyService, isVoid && styles.historyServiceVoid]}
                            numberOfLines={2}
                          >
                            {job.jobServices
                              .map((js) =>
                                js.quantity && js.quantity > 1
                                  ? `${js.service.name} ×${js.quantity}`
                                  : js.service.name,
                              )
                              .join(' · ')}
                          </Text>
                          <View style={styles.historyMetaRow}>
                            {isWalkIn(job.vehicle.registrationNumber) ? (
                              <Text style={styles.historyMeta}>Walk-in</Text>
                            ) : (
                              <PlateBadge plate={job.vehicle.registrationNumber} size="sm" />
                            )}
                            <Text style={styles.historyMeta}>
                              {timeOf(job.createdAt)}
                              {pay ? ` · ${pay}` : ''}
                            </Text>
                          </View>
                          {job.discount && job.discount > 0 ? (
                            <Text style={styles.discountNote}>
                              {formatRupees(job.discount)} off
                              {job.discountReason ? ` · ${job.discountReason}` : ''}
                            </Text>
                          ) : null}
                          {job.status === 'paid' ? (
                            <Pressable
                              onPress={() => openWhatsApp(customer.phone, thankYouMessage(job))}
                              style={({ pressed }) => [styles.thankYou, pressed && styles.pressed]}
                              hitSlop={6}
                            >
                              <IconWhatsApp size={14} />
                              <Text style={styles.thankYouLabel}>Send thank-you</Text>
                            </Pressable>
                          ) : null}
                        </View>
                        <View style={styles.historyRight}>
                          <Text style={[styles.historyPrice, isVoid && styles.historyPriceVoid]}>
                            {formatRupees(job.total)}
                          </Text>
                          <StatusBadge status={job.status} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}
            {history.length > HISTORY_PREVIEW ? (
              <Pressable
                onPress={toggleHistory}
                style={({ pressed }) => [styles.showAll, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.showAllText}>
                  {showAllHistory ? 'Show less' : `Show all ${history.length} visits`}
                </Text>
                <View style={showAllHistory ? styles.chevronUp : undefined}>
                  <IconChevronDown size={16} color={colors.water} />
                </View>
              </Pressable>
            ) : null}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function QuickAction({
  label,
  primary,
  onPress,
  children,
}: {
  label: string;
  primary?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickAction,
        primary && styles.quickActionPrimary,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
      <Text style={[styles.quickLabel, primary && styles.quickLabelPrimary]}>{label}</Text>
    </Pressable>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'teal' }) {
  return (
    <View style={styles.stat}>
      <Text
        style={[styles.statValue, tone === 'teal' && styles.statValueTeal]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function InsightLine({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.insightLine}>
      <View style={styles.insightIcon}>{icon}</View>
      <Text style={styles.insightText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {count > 0 ? (
        <View style={styles.sectionCount}>
          <Text style={styles.sectionCountText}>{count}</Text>
        </View>
      ) : null}
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
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingBottom: spacing.xxl },
  loadingRoot: { flex: 1, paddingHorizontal: spacing.md },
  hero: {
    paddingBottom: spacing.xl + spacing.md,
    overflow: 'hidden',
  },
  orbLarge: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255,255,255,0.14)',
    top: -60,
    right: -50,
  },
  orbSmall: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(94,234,212,0.2)',
    bottom: 40,
    left: -40,
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
    marginTop: -spacing.sm,
    gap: 4,
  },
  avatarRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    padding: 3,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.45)',
    ...shadow('md'),
  },
  avatar: {
    flex: 1,
    borderRadius: 41,
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
    fontSize: 27,
    letterSpacing: -0.5,
    textAlign: 'center',
    textShadowColor: 'rgba(8,47,73,0.25)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroPhone: {
    ...typography.body,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    letterSpacing: 0.3,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8,47,73,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  badgeRepeat: {
    backgroundColor: 'rgba(204,251,241,0.95)',
    borderColor: colors.tealLight,
  },
  badgeText: { ...typography.caption, color: colors.white, fontSize: 11, letterSpacing: 0.3 },
  badgeTextRepeat: { color: colors.tealDeep, fontWeight: '700' },
  quickRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
  quickAction: {
    flex: 1,
    height: 66,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  quickActionPrimary: {
    backgroundColor: colors.white,
    borderColor: colors.white,
    ...shadow('sm'),
  },
  quickLabel: { ...typography.label, color: colors.white, fontSize: 12 },
  quickLabelPrimary: { color: colors.waterDeep },
  statsCard: {
    marginHorizontal: spacing.md,
    marginTop: -spacing.lg,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadow('md'),
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: spacing.xs },
  statValue: { ...typography.heading, color: colors.waterInk, fontSize: 21, letterSpacing: -0.4 },
  statValueTeal: { color: colors.teal },
  statLabel: { ...typography.caption, color: colors.slateDeep, fontSize: 11, letterSpacing: 0.4 },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
  },
  statsFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    gap: 8,
  },
  insightLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  insightIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightText: { ...typography.body, color: colors.waterInk, fontSize: 14, flex: 1 },
  pendingStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.amberLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  pendingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.amber },
  pendingText: { ...typography.label, color: colors.amberDeep, fontSize: 13 },
  actionError: {
    ...typography.caption,
    color: colors.danger,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionTitle: { ...typography.heading, color: colors.waterInk, fontSize: 18 },
  sectionCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCountText: { ...typography.caption, color: colors.waterDeep, fontWeight: '700' },
  edgeList: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  vehicleThumb: { width: 64, height: 48, borderRadius: 10, backgroundColor: colors.waterPale },
  vehicleCopy: { flex: 1, gap: 4, alignItems: 'flex-start' },
  walkIn: { ...typography.bodyStrong, color: colors.waterInk },
  vehicleMeta: { ...typography.body, color: colors.waterInk, fontSize: 14 },
  vehicleVisits: { ...typography.caption, color: colors.slateDeep },
  washPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
  },
  washPillText: { ...typography.label, color: colors.waterDeep },
  monthLabel: {
    ...typography.label,
    color: colors.slateDeep,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 11,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 6,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  dateBlock: {
    width: 46,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
  },
  dateBlockVoid: { backgroundColor: '#F1F5F9' },
  dateDay: { ...typography.heading, color: colors.waterDeep, fontSize: 18, lineHeight: 22 },
  dateWeekday: {
    ...typography.caption,
    color: colors.slateDeep,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  textVoid: { color: colors.slate },
  historyCopy: { flex: 1, gap: 6 },
  historyService: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 15,
    lineHeight: 20,
  },
  historyServiceVoid: { color: colors.slate, textDecorationLine: 'line-through' },
  historyMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  historyMeta: { ...typography.caption, color: colors.slateDeep },
  discountNote: { ...typography.caption, color: colors.amberDeep },
  thankYou: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  thankYouLabel: { ...typography.label, color: colors.teal, fontSize: 12 },
  historyRight: { alignItems: 'flex-end', gap: 8 },
  historyPrice: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 16 },
  historyPriceVoid: { color: colors.slate, textDecorationLine: 'line-through' },
  showAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  showAllText: { ...typography.label, color: colors.water, fontSize: 14 },
  chevronUp: { transform: [{ rotate: '180deg' }] },
  empty: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: { ...typography.bodyStrong, color: colors.waterInk },
  emptyBody: { ...typography.body, color: colors.slateDeep, textAlign: 'center', fontSize: 14 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  errorTitle: { ...typography.heading, color: colors.waterInk },
  errorBody: { ...typography.body, color: colors.slateDeep, textAlign: 'center' },
  retryBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.water,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryBtnText: { ...typography.label, color: colors.white },
  pressed: { opacity: 0.85 },
});
