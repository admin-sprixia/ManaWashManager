import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  EXPENSE_CATEGORY_LABEL,
  PAYMENT_METHOD_LABEL,
  USER_ROLE_LABEL,
  toUserRole,
  type ExpenseCategory,
  type PaymentMethod,
} from '@mana/domain';
import {
  ScreenContainer,
  ScreenHeader,
  Avatar,
  Button,
  IconAlert,
  IconBan,
  IconCash,
  IconChevronRight,
  IconDrawer,
  IconEdit,
  IconReceipt,
  IconShield,
  IconStar,
  IconSync,
  IconUsers,
  colors,
  radius,
  shadow,
  spacing,
  typography,
} from '@mana/ui';
import { Band, BandRow, ScreenHero, SectionTitle } from '../components/ScreenChrome';
import { PeriodSelect, type PeriodKey } from '../components/PeriodSelect';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { formatDateTime, formatRupees } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'StaffReport'>;
type Tab = 'performance' | 'audit';

interface StaffRow {
  userId: string;
  name: string;
  role: string;
  active: boolean;
  washesStarted: number;
  jobsCollected: number;
  collected: number;
  cash: number;
  upi: number;
  other: number;
  voids: number;
  corrections: number;
  washesDone: number;
  /** Wash plans they sold at the counter: in Paid and money collected, not in Started. */
  plansSold?: number;
  communityWashes: number;
  servicesSold: number;
  commission: number;
  /** Doorstep cash they hold right now, from any day. */
  doorstepHeld?: number;
  /** Doorstep cash they handed in short in this period. */
  doorstepShort?: number;
  attendance: { present: number; half: number; absent: number; daysWorked: number };
}

interface AuditItem {
  id: string;
  kind: 'job_void' | 'payment_change' | 'expense_void' | 'expense_edit' | 'handover_undo' | 'drawer_reopen';
  at: string;
  by: { id: string; name: string };
  reason: string | null;
  amount: number;
  title: string;
  subtitle: string;
  fromValue: string | null;
  toValue: string | null;
  jobId: string | null;
}

function methodLabel(v: string | null): string {
  return v && v in PAYMENT_METHOD_LABEL ? PAYMENT_METHOD_LABEL[v as PaymentMethod] : (v ?? '—');
}

const KIND_META = {
  job_void: {
    label: 'Job voided',
    short: 'Voids',
    Icon: IconBan,
    fg: colors.danger,
    bg: '#FEE2E2',
  },
  payment_change: {
    label: 'Payment corrected',
    short: 'Payment fixes',
    Icon: IconEdit,
    fg: colors.amberDeep,
    bg: '#FEF3C7',
  },
  expense_void: {
    label: 'Expense deleted',
    short: 'Expense deletes',
    Icon: IconReceipt,
    fg: '#9D174D',
    bg: '#FCE7F3',
  },
  expense_edit: {
    label: 'Expense edited',
    short: 'Expense edits',
    Icon: IconEdit,
    fg: '#0369A1',
    bg: '#E0F2FE',
  },
  handover_undo: {
    label: 'Handover undone',
    short: 'Handovers undone',
    Icon: IconCash,
    fg: '#B45309',
    bg: '#FEF3C7',
  },
  drawer_reopen: {
    label: 'Cash day reopened',
    short: 'Reopens',
    Icon: IconDrawer,
    fg: '#5B21B6',
    bg: '#EDE9FE',
  },
} as const;

const RANK_COLORS = ['#F59E0B', '#94A3B8', '#C2410C'];

function Metric({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, tone ? { color: tone } : null]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function StaffReportScreen({ navigation }: Props) {
  const [tab, setTab] = useState<Tab>('performance');
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [staffRes, auditRes] = await Promise.all([
        api.reports.staff.$get({ query: { range: period } }),
        api.reports.audit.$get({ query: { range: period } }),
      ]);
      if (!staffRes.ok)
        throw new Error(await apiErrorMessage(staffRes, 'Couldn’t load the staff report.'));
      if (!auditRes.ok)
        throw new Error(await apiErrorMessage(auditRes, 'Couldn’t load the audit log.'));
      const staff = await staffRes.json();
      const log = await auditRes.json();
      setRows('rows' in staff ? (staff.rows as StaffRow[]) : []);
      setAudit('items' in log ? (log.items as AuditItem[]) : []);
    } catch (e) {
      setError(
        e instanceof NetworkError
          ? 'Reports need a connection. Pull down to retry.'
          : (e as Error).message,
      );
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const totals = rows.reduce(
    (t, r) => ({
      collected: t.collected + r.collected,
      commission: t.commission + r.commission,
      started: t.started + r.washesStarted,
      flags: t.flags + r.voids + r.corrections,
    }),
    { collected: 0, commission: 0, started: 0, flags: 0 },
  );
  const best = rows.length > 1 && rows[0]!.collected > 0 ? rows[0]! : null;
  const kindCounts = audit.reduce((c, a) => ({ ...c, [a.kind]: c[a.kind] + 1 }), {
    job_void: 0,
    payment_change: 0,
    expense_void: 0,
    expense_edit: 0,
    handover_undo: 0,
    drawer_reopen: 0,
  } as Record<AuditItem['kind'], number>);

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Staff report" onBack={() => navigation.goBack()} />
      </View>

      <View style={styles.segmentBand}>
        <View style={styles.segment} accessibilityRole="tablist">
          {(
            [
              { key: 'performance', label: 'Performance', count: 0 },
              { key: 'audit', label: 'Corrections', count: audit.length },
            ] as const
          ).map((t) => {
            const on = tab === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={[styles.segmentBtn, on && styles.segmentBtnOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{t.label}</Text>
                {t.count > 0 ? (
                  <View style={[styles.segmentBadge, on && styles.segmentBadgeOn]}>
                    <Text style={[styles.segmentBadgeText, on && styles.segmentBadgeTextOn]}>
                      {t.count}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.water}
            colors={[colors.water]}
          />
        }
      >
        <PeriodSelect value={period} onChange={setPeriod} />

        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.water} />
        ) : error ? (
          <View style={styles.stateBox}>
            <View style={[styles.stateIcon, { backgroundColor: colors.waterPale }]}>
              <IconSync size={26} color={colors.waterDeep} />
            </View>
            <Text style={styles.stateBody}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : tab === 'performance' ? (
          <>
            {/* Team summary */}
            <ScreenHero
              eyebrow="Collected by the team"
              title={formatRupees(totals.collected)}
              meta={
                best
                  ? `${best.name} leads with ${formatRupees(best.collected)}`
                  : `${rows.length} ${rows.length === 1 ? 'person' : 'people'} on the team`
              }
              chips={[
                { label: 'Commission', value: formatRupees(totals.commission) },
                { label: 'Washes started', value: totals.started },
                { label: 'Voids & fixes', value: totals.flags },
              ]}
              right={
                totals.flags > 0 ? (
                  <Pressable
                    onPress={() => setTab('audit')}
                    hitSlop={8}
                    style={({ pressed }) => [styles.heroLink, pressed && styles.pressedFade]}
                    accessibilityRole="button"
                    accessibilityLabel="See voids and fixes"
                  >
                    <Text style={styles.heroLinkText}>See fixes ›</Text>
                  </Pressable>
                ) : undefined
              }
            />

            <SectionTitle meta="Sorted by money collected">By person</SectionTitle>

            {rows.length === 0 ? (
              <View style={styles.stateBox}>
                <View style={[styles.stateIcon, { backgroundColor: colors.waterPale }]}>
                  <IconUsers size={26} color={colors.waterDeep} />
                </View>
                <Text style={styles.stateTitle}>No activity yet</Text>
                <Text style={styles.stateBody}>
                  Numbers show up here once the team starts washes in this period.
                </Text>
              </View>
            ) : (
              <Band>
                {rows.map((r, i) => {
                  const total = r.cash + r.upi + r.other;
                  const flags = r.voids + r.corrections;
                  const share =
                    totals.collected > 0 ? Math.round((r.collected / totals.collected) * 100) : 0;
                  const ranked = r.collected > 0 && i < 3 && rows.length > 1;
                  return (
                    <View key={r.userId} style={i < rows.length - 1 && styles.divider}>
                      <BandRow
                        last
                        icon={
                          <View>
                            <Avatar name={r.name} id={r.userId} size={42} muted={!r.active} />
                            {ranked ? (
                              <View style={[styles.rank, { backgroundColor: RANK_COLORS[i] }]}>
                                <Text style={styles.rankText}>{i + 1}</Text>
                              </View>
                            ) : null}
                          </View>
                        }
                        iconBg="transparent"
                        title={r.name}
                        subtitle={`${USER_ROLE_LABEL[toUserRole(r.role)]}${r.active ? '' : ' · Turned off'}`}
                        muted={!r.active}
                        right={
                          <View style={styles.personRight}>
                            <Text style={styles.personAmount}>{formatRupees(r.collected)}</Text>
                            <Text style={styles.personShare}>
                              {totals.collected > 0 ? `${share}% of team` : 'collected'}
                            </Text>
                          </View>
                        }
                      />
                      <View style={styles.person}>
                        {total > 0 ? (
                          <View style={styles.payBlock}>
                            <View style={styles.bar}>
                              {r.cash > 0 ? (
                                <View style={{ flex: r.cash, backgroundColor: colors.teal }} />
                              ) : null}
                              {r.upi > 0 ? (
                                <View style={{ flex: r.upi, backgroundColor: colors.water }} />
                              ) : null}
                              {r.other > 0 ? (
                                <View style={{ flex: r.other, backgroundColor: colors.slate }} />
                              ) : null}
                            </View>
                            <View style={styles.legend}>
                              <View style={styles.legendItem}>
                                <View
                                  style={[styles.legendDot, { backgroundColor: colors.teal }]}
                                />
                                <Text style={styles.legendText}>Cash {formatRupees(r.cash)}</Text>
                              </View>
                              <View style={styles.legendItem}>
                                <View
                                  style={[styles.legendDot, { backgroundColor: colors.water }]}
                                />
                                <Text style={styles.legendText}>UPI {formatRupees(r.upi)}</Text>
                              </View>
                              {r.other > 0 ? (
                                <View style={styles.legendItem}>
                                  <View
                                    style={[styles.legendDot, { backgroundColor: colors.slate }]}
                                  />
                                  <Text style={styles.legendText}>
                                    Other {formatRupees(r.other)}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                          </View>
                        ) : null}

                        <View style={styles.metrics}>
                          <Metric value={String(r.washesStarted)} label="Started" />
                          <View style={styles.metricDivider} />
                          <Metric value={String(r.jobsCollected)} label="Paid" />
                          <View style={styles.metricDivider} />
                          <Metric
                            value={formatRupees(r.commission)}
                            label={`Commission${r.servicesSold ? ` · ${r.servicesSold}` : ''}`}
                            tone={r.commission > 0 ? colors.tealDeep : undefined}
                          />
                          <View style={styles.metricDivider} />
                          <Metric
                            value={String(r.attendance.daysWorked)}
                            label={
                              r.attendance.absent > 0
                                ? `Days · ${r.attendance.absent} off`
                                : 'Days worked'
                            }
                          />
                        </View>

                        {r.communityWashes > 0 ? (
                          <Text style={styles.communityLine}>
                            {r.communityWashes} {r.communityWashes === 1 ? 'car' : 'cars'} washed at
                            communities
                          </Text>
                        ) : null}
                        {(r.plansSold ?? 0) > 0 ? (
                          <Text style={styles.communityLine}>
                            {r.plansSold} wash {r.plansSold === 1 ? 'plan' : 'plans'} sold at the shop
                          </Text>
                        ) : null}

                        {(r.doorstepHeld ?? 0) > 0 || (r.doorstepShort ?? 0) > 0 ? (
                          <Pressable
                            onPress={() => navigation.navigate('Cash')}
                            hitSlop={6}
                            style={({ pressed }) => [styles.flagLine, pressed && styles.pressedFade]}
                          >
                            <IconCash size={14} color={colors.amberDeep} />
                            <Text style={styles.flagText}>
                              {(r.doorstepHeld ?? 0) > 0 ? `Holds ${formatRupees(r.doorstepHeld ?? 0)} doorstep cash` : ''}
                              {(r.doorstepHeld ?? 0) > 0 && (r.doorstepShort ?? 0) > 0 ? ' · ' : ''}
                              {(r.doorstepShort ?? 0) > 0 ? `${formatRupees(r.doorstepShort ?? 0)} short at handovers` : ''}
                            </Text>
                            <Text style={styles.flagLink}>Cash drawer ›</Text>
                          </Pressable>
                        ) : null}

                        {flags > 0 ? (
                          <Pressable
                            onPress={() => setTab('audit')}
                            hitSlop={6}
                            style={({ pressed }) => [
                              styles.flagLine,
                              pressed && styles.pressedFade,
                            ]}
                          >
                            <IconAlert size={14} color={colors.amberDeep} />
                            <Text style={styles.flagText}>
                              {r.voids > 0 ? `${r.voids} void${r.voids === 1 ? '' : 's'}` : ''}
                              {r.voids > 0 && r.corrections > 0 ? ' · ' : ''}
                              {r.corrections > 0
                                ? `${r.corrections} payment fix${r.corrections === 1 ? '' : 'es'}`
                                : ''}
                            </Text>
                            <Text style={styles.flagLink}>See why ›</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </Band>
            )}

            <View style={styles.howTo}>
              <Text style={styles.howToTitle}>How these are counted</Text>
              <Text style={styles.howToText}>
                • Started — washes each person created in this period.{'\n'}• Collected — money they
                marked paid in this period (same days as Reports and the cash drawer).{'\n'}• Commission — only on services that have
                one (like rust coating), for whoever got the customer to take it, once paid. Split
                equally when several people helped.{'\n'}• Days worked — a half day counts as 0.5.
                {'\n'}• Communities — plan cars each person marked washed on a community wash day.
                {'\n'}• Plans sold — wash plans sold at the counter: in Paid and Collected, not in Started.
                {'\n'}• Doorstep cash — what they hold now, and any amount handed in short.
              </Text>
            </View>
          </>
        ) : audit.length === 0 ? (
          <>
            <ScreenHero
              eyebrow="Voids & corrections"
              title="Clean books"
              meta="No voids or corrections in this period."
            />
            <View style={styles.stateBox}>
              <View style={[styles.stateIcon, styles.cleanIcon]}>
                <IconShield size={30} color={colors.teal} />
              </View>
              <Text style={styles.stateTitle}>Clean books</Text>
              <Text style={styles.stateBody}>No voids or payment corrections in this period.</Text>
            </View>
          </>
        ) : (
          <>
            <ScreenHero
              tone="alert"
              eyebrow="Voids & corrections"
              title={`${audit.length} ${audit.length === 1 ? 'change' : 'changes'} to review`}
              meta="Every void, payment fix, expense change, undone handover and reopened cash day, with who did it and why."
              chips={(Object.keys(KIND_META) as AuditItem['kind'][]).map((k) => ({
                label: KIND_META[k].short,
                value: kindCounts[k],
              }))}
            />

            <SectionTitle meta="Newest first">Every void and correction</SectionTitle>
            <Band>
              {audit.map((a, i) => {
                const meta = KIND_META[a.kind];
                const title =
                  a.kind === 'expense_void' || a.kind === 'expense_edit'
                    ? (EXPENSE_CATEGORY_LABEL[a.title as ExpenseCategory] ?? a.title)
                    : a.title;
                const row = (
                  <View style={styles.auditRow}>
                    <View style={[styles.auditIcon, { backgroundColor: meta.bg }]}>
                      <meta.Icon size={17} color={meta.fg} />
                    </View>
                    <View style={styles.auditBody}>
                      <View style={styles.auditTop}>
                        <Text style={[styles.auditKind, { color: meta.fg }]}>{meta.label}</Text>
                        <Text style={styles.auditAmount}>{formatRupees(a.amount)}</Text>
                      </View>
                      <Text style={styles.auditTitle} numberOfLines={1}>
                        {title}
                        <Text style={styles.auditSub}> · {a.subtitle}</Text>
                      </Text>
                      {a.kind === 'payment_change' ? (
                        <View style={styles.changeRow}>
                          <Text style={styles.changeFrom}>{methodLabel(a.fromValue)}</Text>
                          <Text style={styles.changeArrow}>→</Text>
                          <Text style={styles.changeTo}>{methodLabel(a.toValue)}</Text>
                        </View>
                      ) : a.kind === 'expense_edit' ? (
                        <View style={styles.editLines}>
                          <Text style={styles.editFrom} numberOfLines={2}>
                            {a.fromValue}
                          </Text>
                          <Text style={styles.changeTo} numberOfLines={2}>
                            → {a.toValue}
                          </Text>
                        </View>
                      ) : null}
                      {a.reason ? <Text style={styles.auditReason}>“{a.reason}”</Text> : null}
                      <View style={styles.auditByRow}>
                        <Avatar name={a.by.name} id={a.by.id} size={18} />
                        <Text style={styles.auditBy}>
                          {a.by.name} · {formatDateTime(a.at)}
                        </Text>
                      </View>
                    </View>
                    {a.jobId ? <IconChevronRight size={16} color={colors.slate} /> : null}
                  </View>
                );
                return a.jobId ? (
                  <Pressable
                    key={a.id}
                    onPress={() => navigation.navigate('JobDetail', { jobId: a.jobId! })}
                    android_ripple={{ color: colors.waterPale }}
                    style={({ pressed }) => [
                      i < audit.length - 1 && styles.divider,
                      pressed && styles.pressed,
                    ]}
                  >
                    {row}
                  </Pressable>
                ) : (
                  <View key={a.id} style={i < audit.length - 1 && styles.divider}>
                    {row}
                  </View>
                );
              })}
            </Band>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl, paddingTop: spacing.xs, gap: spacing.sm + 2 },
  pressed: { backgroundColor: colors.surface },
  pressedFade: { opacity: 0.7 },
  loader: { marginTop: spacing.xxl },
  segmentBand: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  segment: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: radius.pill,
  },
  segmentBtnOn: { backgroundColor: colors.waterInk, ...shadow('sm') },
  segmentText: { ...typography.bodyStrong, fontSize: 14, color: colors.slateDeep },
  segmentTextOn: { color: colors.white, fontWeight: '700' },
  segmentBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBadgeOn: { backgroundColor: colors.amber },
  segmentBadgeText: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '800',
    color: colors.amberDeep,
    letterSpacing: 0,
  },
  segmentBadgeTextOn: { color: colors.white },
  heroLink: {
    paddingHorizontal: 10,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
  },
  heroLinkText: {
    ...typography.caption,
    fontSize: 12,
    fontWeight: '800',
    color: colors.white,
    letterSpacing: 0,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  person: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.white,
  },
  rank: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { fontSize: 10, fontWeight: '800', color: colors.white },
  personRight: { alignItems: 'flex-end', gap: 2 },
  personAmount: { ...typography.heading, fontSize: 20, color: colors.waterInk },
  personShare: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  payBlock: { gap: spacing.sm },
  bar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    gap: 2,
  },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slateDeep,
    letterSpacing: 0,
    fontWeight: '600',
  },
  metrics: { flexDirection: 'row', alignItems: 'center' },
  metric: { flex: 1, alignItems: 'center', gap: 2 },
  metricDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
  },
  metricValue: {
    ...typography.bodyStrong,
    fontSize: 16,
    color: colors.waterInk,
    fontWeight: '800',
  },
  metricLabel: { ...typography.caption, fontSize: 11, color: colors.slate, letterSpacing: 0 },
  flagLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  communityLine: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.tealDeep,
    fontWeight: '700',
    letterSpacing: 0,
  },
  flagText: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.amberDeep,
    fontWeight: '700',
    letterSpacing: 0,
    flex: 1,
  },
  flagLink: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.amberDeep,
    fontWeight: '700',
    letterSpacing: 0,
  },
  howTo: { paddingHorizontal: spacing.md, gap: 6 },
  howToTitle: {
    ...typography.caption,
    fontSize: 12,
    color: colors.slateDeep,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  howToText: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slate,
    letterSpacing: 0,
    lineHeight: 19,
  },
  stateBox: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  stateIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  cleanIcon: { backgroundColor: '#CCFBF1' },
  stateTitle: { ...typography.heading, fontSize: 19, color: colors.waterInk },
  stateBody: {
    ...typography.body,
    fontSize: 14.5,
    color: colors.slateDeep,
    textAlign: 'center',
    lineHeight: 21,
  },
  auditRow: {
    flexDirection: 'row',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  auditIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  auditBody: { flex: 1, gap: 5 },
  auditTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  auditKind: {
    ...typography.caption,
    fontWeight: '800',
    textTransform: 'uppercase',
    fontSize: 11,
    letterSpacing: 0.6,
  },
  auditAmount: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 16,
    fontWeight: '700',
  },
  auditTitle: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  auditSub: { fontWeight: '400', color: colors.slateDeep },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editLines: { gap: 2 },
  editFrom: { ...typography.label, fontSize: 13, color: colors.slate },
  changeFrom: {
    ...typography.label,
    fontSize: 13,
    color: colors.slate,
    textDecorationLine: 'line-through',
  },
  changeArrow: { ...typography.label, fontSize: 13, color: colors.slate },
  changeTo: { ...typography.label, fontSize: 13, color: colors.amberDeep, fontWeight: '800' },
  auditReason: {
    ...typography.body,
    color: colors.slateDeep,
    fontStyle: 'italic',
    fontSize: 14,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: spacing.sm,
  },
  auditByRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  auditBy: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
});
