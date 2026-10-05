import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EXPENSE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL, type ExpenseCategory, type PaymentMethod } from '@mana/domain';
import {
  ScreenContainer,
  ScreenHeader,
  Avatar,
  Button,
  IconAlert,
  IconBan,
  IconChevronRight,
  IconEdit,
  IconReceipt,
  IconShield,
  IconStar,
  IconSync,
  IconUsers,
  colors,
  gradients,
  radius,
  shadow,
  spacing,
  typography,
} from '@mana/ui';
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
  servicesSold: number;
  commission: number;
  attendance: { present: number; half: number; absent: number; daysWorked: number };
}

interface AuditItem {
  id: string;
  kind: 'job_void' | 'payment_change' | 'expense_void';
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
  return v && v in PAYMENT_METHOD_LABEL ? PAYMENT_METHOD_LABEL[v as PaymentMethod] : v ?? '—';
}

const KIND_META = {
  job_void: { label: 'Job voided', short: 'Voids', Icon: IconBan, fg: colors.danger, bg: '#FEE2E2' },
  payment_change: { label: 'Payment corrected', short: 'Payment fixes', Icon: IconEdit, fg: colors.amberDeep, bg: '#FEF3C7' },
  expense_void: { label: 'Expense voided', short: 'Expense voids', Icon: IconReceipt, fg: '#9D174D', bg: '#FCE7F3' },
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
      if (!staffRes.ok) throw new Error(await apiErrorMessage(staffRes, 'Couldn’t load the staff report.'));
      if (!auditRes.ok) throw new Error(await apiErrorMessage(auditRes, 'Couldn’t load the audit log.'));
      const staff = await staffRes.json();
      const log = await auditRes.json();
      setRows('rows' in staff ? (staff.rows as StaffRow[]) : []);
      setAudit('items' in log ? (log.items as AuditItem[]) : []);
    } catch (e) {
      setError(e instanceof NetworkError ? 'Reports need a connection. Pull down to retry.' : (e as Error).message);
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
  const kindCounts = audit.reduce(
    (c, a) => ({ ...c, [a.kind]: c[a.kind] + 1 }),
    { job_void: 0, payment_change: 0, expense_void: 0 } as Record<AuditItem['kind'], number>,
  );

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Staff report" onBack={() => navigation.goBack()} />
      </View>

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
                  <Text style={[styles.segmentBadgeText, on && styles.segmentBadgeTextOn]}>{t.count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
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
            <LinearGradient
              colors={gradients.hero as unknown as string[]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={styles.hero}
            >
              <View pointerEvents="none" style={styles.orbLarge} />
              <View pointerEvents="none" style={styles.orbSmall} />
              <Text style={styles.heroEyebrow}>Collected by the team</Text>
              <Text style={styles.heroValue}>{formatRupees(totals.collected)}</Text>
              {best ? (
                <View style={styles.leader}>
                  <IconStar size={13} color={colors.amberLight} />
                  <Text style={styles.leaderText} numberOfLines={1}>
                    {best.name} leads with {formatRupees(best.collected)}
                  </Text>
                </View>
              ) : (
                <Text style={styles.heroMeta}>
                  {rows.length} {rows.length === 1 ? 'person' : 'people'} on the team
                </Text>
              )}
              <View style={styles.heroSplit}>
                <View style={styles.heroCell}>
                  <Text style={styles.heroCellValue}>{formatRupees(totals.commission)}</Text>
                  <Text style={styles.heroCellLabel}>Commission</Text>
                </View>
                <View style={[styles.heroCell, styles.heroCellDivider]}>
                  <Text style={styles.heroCellValue}>{totals.started}</Text>
                  <Text style={styles.heroCellLabel}>Washes started</Text>
                </View>
                <Pressable
                  onPress={() => setTab('audit')}
                  style={({ pressed }) => [styles.heroCell, styles.heroCellDivider, pressed && styles.pressedFade]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.heroCellValue, totals.flags > 0 && styles.heroFlag]}>{totals.flags}</Text>
                  <Text style={styles.heroCellLabel}>Voids & fixes ›</Text>
                </Pressable>
              </View>
            </LinearGradient>

            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>By person</Text>
              <Text style={styles.sectionMeta}>Sorted by money collected</Text>
            </View>

            {rows.length === 0 ? (
              <View style={styles.stateBox}>
                <View style={[styles.stateIcon, { backgroundColor: colors.waterPale }]}>
                  <IconUsers size={26} color={colors.waterDeep} />
                </View>
                <Text style={styles.stateTitle}>No activity yet</Text>
                <Text style={styles.stateBody}>Numbers show up here once the team starts washes in this period.</Text>
              </View>
            ) : (
              <View style={styles.list}>
                {rows.map((r, i) => {
                  const total = r.cash + r.upi + r.other;
                  const flags = r.voids + r.corrections;
                  const share = totals.collected > 0 ? Math.round((r.collected / totals.collected) * 100) : 0;
                  const ranked = r.collected > 0 && i < 3 && rows.length > 1;
                  return (
                    <View key={r.userId} style={[styles.person, i < rows.length - 1 && styles.divider]}>
                      <View style={styles.personTop}>
                        <View>
                          <Avatar name={r.name} id={r.userId} size={46} muted={!r.active} />
                          {ranked ? (
                            <View style={[styles.rank, { backgroundColor: RANK_COLORS[i] }]}>
                              <Text style={styles.rankText}>{i + 1}</Text>
                            </View>
                          ) : null}
                        </View>
                        <View style={styles.personCopy}>
                          <Text style={styles.personName} numberOfLines={1}>
                            {r.name}
                          </Text>
                          <View style={styles.tags}>
                            <View style={[styles.tag, r.role === 'owner' && styles.tagOwner]}>
                              <Text style={[styles.tagText, r.role === 'owner' && styles.tagTextOwner]}>
                                {r.role === 'owner' ? 'Owner' : 'Staff'}
                              </Text>
                            </View>
                            {!r.active ? (
                              <View style={[styles.tag, styles.tagOff]}>
                                <Text style={[styles.tagText, styles.tagTextOff]}>Turned off</Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                        <View style={styles.personRight}>
                          <Text style={styles.personAmount}>{formatRupees(r.collected)}</Text>
                          <Text style={styles.personShare}>
                            {totals.collected > 0 ? `${share}% of team` : 'collected'}
                          </Text>
                        </View>
                      </View>

                      {total > 0 ? (
                        <View style={styles.payBlock}>
                          <View style={styles.bar}>
                            {r.cash > 0 ? <View style={{ flex: r.cash, backgroundColor: colors.teal }} /> : null}
                            {r.upi > 0 ? <View style={{ flex: r.upi, backgroundColor: colors.water }} /> : null}
                            {r.other > 0 ? <View style={{ flex: r.other, backgroundColor: colors.slate }} /> : null}
                          </View>
                          <View style={styles.legend}>
                            <View style={styles.legendItem}>
                              <View style={[styles.legendDot, { backgroundColor: colors.teal }]} />
                              <Text style={styles.legendText}>Cash {formatRupees(r.cash)}</Text>
                            </View>
                            <View style={styles.legendItem}>
                              <View style={[styles.legendDot, { backgroundColor: colors.water }]} />
                              <Text style={styles.legendText}>UPI {formatRupees(r.upi)}</Text>
                            </View>
                            {r.other > 0 ? (
                              <View style={styles.legendItem}>
                                <View style={[styles.legendDot, { backgroundColor: colors.slate }]} />
                                <Text style={styles.legendText}>Other {formatRupees(r.other)}</Text>
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
                          label={r.attendance.absent > 0 ? `Days · ${r.attendance.absent} off` : 'Days worked'}
                        />
                      </View>

                      {flags > 0 ? (
                        <Pressable
                          onPress={() => setTab('audit')}
                          hitSlop={6}
                          style={({ pressed }) => [styles.flagLine, pressed && styles.pressedFade]}
                        >
                          <IconAlert size={14} color={colors.amberDeep} />
                          <Text style={styles.flagText}>
                            {r.voids > 0 ? `${r.voids} void${r.voids === 1 ? '' : 's'}` : ''}
                            {r.voids > 0 && r.corrections > 0 ? ' · ' : ''}
                            {r.corrections > 0 ? `${r.corrections} payment fix${r.corrections === 1 ? '' : 'es'}` : ''}
                          </Text>
                          <Text style={styles.flagLink}>See why ›</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.howTo}>
              <Text style={styles.howToTitle}>How these are counted</Text>
              <Text style={styles.howToText}>
                • Started — washes each person created.{'\n'}• Collected — money they marked paid, for washes started in
                this period.{'\n'}• Commission — only on services that have one (like rust coating), for whoever got the
                customer to take it, once paid. Split equally when several people helped.{'\n'}• Days worked — a half day
                counts as 0.5.
              </Text>
            </View>
          </>
        ) : audit.length === 0 ? (
          <View style={styles.stateBox}>
            <View style={[styles.stateIcon, styles.cleanIcon]}>
              <IconShield size={30} color={colors.teal} />
            </View>
            <Text style={styles.stateTitle}>Clean books</Text>
            <Text style={styles.stateBody}>No voids or payment corrections in this period.</Text>
          </View>
        ) : (
          <>
            <View style={styles.kindSummary}>
              {(Object.keys(KIND_META) as AuditItem['kind'][]).map((k, i) => {
                const meta = KIND_META[k];
                return (
                  <View key={k} style={[styles.kindCell, i > 0 && styles.kindCellDivider]}>
                    <View style={[styles.kindIcon, { backgroundColor: meta.bg }]}>
                      <meta.Icon size={15} color={meta.fg} />
                    </View>
                    <Text style={[styles.kindValue, kindCounts[k] > 0 && { color: meta.fg }]}>{kindCounts[k]}</Text>
                    <Text style={styles.kindLabel}>{meta.short}</Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Every void and correction</Text>
              <Text style={styles.sectionMeta}>Newest first</Text>
            </View>
            <View style={styles.list}>
              {audit.map((a, i) => {
                const meta = KIND_META[a.kind];
                const title =
                  a.kind === 'expense_void'
                    ? EXPENSE_CATEGORY_LABEL[a.title as ExpenseCategory] ?? a.title
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
                        <Text style={styles.auditSub}>  ·  {a.subtitle}</Text>
                      </Text>
                      {a.kind === 'payment_change' ? (
                        <View style={styles.changeRow}>
                          <Text style={styles.changeFrom}>{methodLabel(a.fromValue)}</Text>
                          <Text style={styles.changeArrow}>→</Text>
                          <Text style={styles.changeTo}>{methodLabel(a.toValue)}</Text>
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
                    style={({ pressed }) => [i < audit.length - 1 && styles.divider, pressed && styles.pressed]}
                  >
                    {row}
                  </Pressable>
                ) : (
                  <View key={a.id} style={i < audit.length - 1 && styles.divider}>
                    {row}
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xxl, paddingTop: spacing.md, gap: spacing.md },
  pressed: { backgroundColor: colors.surface },
  pressedFade: { opacity: 0.7 },
  loader: { marginTop: spacing.xxl },
  segment: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
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
  segmentBadgeText: { ...typography.caption, fontSize: 11, fontWeight: '800', color: colors.amberDeep, letterSpacing: 0 },
  segmentBadgeTextOn: { color: colors.white },
  hero: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md + 4, overflow: 'hidden' },
  orbLarge: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(255,255,255,0.12)',
    top: -80,
    right: -60,
  },
  orbSmall: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(94,234,212,0.18)',
    bottom: -40,
    left: -30,
  },
  heroEyebrow: { ...typography.label, fontSize: 14, color: 'rgba(255,255,255,0.88)' },
  heroValue: { ...typography.display, fontSize: 42, color: colors.white, letterSpacing: -1, marginTop: 2 },
  heroMeta: { ...typography.label, fontSize: 13.5, color: 'rgba(255,255,255,0.9)' },
  leader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leaderText: { ...typography.label, fontSize: 13.5, color: colors.white, flexShrink: 1 },
  heroSplit: {
    flexDirection: 'row',
    marginTop: spacing.md + 4,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.45)',
  },
  heroCell: { flex: 1, gap: 2 },
  heroCellDivider: {
    paddingLeft: spacing.md,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(255,255,255,0.45)',
  },
  heroCellValue: { ...typography.heading, fontSize: 19, color: colors.white },
  heroCellLabel: { ...typography.caption, fontSize: 11.5, color: 'rgba(255,255,255,0.85)', fontWeight: '700', letterSpacing: 0 },
  heroFlag: { color: colors.amberLight },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginBottom: -spacing.sm,
  },
  sectionTitle: { ...typography.heading, fontSize: 18, color: colors.waterInk, letterSpacing: -0.2 },
  sectionMeta: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0 },
  list: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  person: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.md },
  personTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
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
  personCopy: { flex: 1, gap: 4 },
  personName: { ...typography.bodyStrong, fontSize: 17, color: colors.waterInk, fontWeight: '700' },
  tags: { flexDirection: 'row', gap: 6 },
  tag: { paddingHorizontal: 8, height: 20, borderRadius: radius.pill, backgroundColor: colors.surface, justifyContent: 'center' },
  tagOwner: { backgroundColor: colors.waterPale },
  tagOff: { backgroundColor: '#F1F5F9' },
  tagText: { ...typography.caption, fontSize: 11, fontWeight: '700', color: colors.slateDeep, letterSpacing: 0.2 },
  tagTextOwner: { color: colors.waterDeep },
  tagTextOff: { color: colors.slate },
  personRight: { alignItems: 'flex-end', gap: 2 },
  personAmount: { ...typography.heading, fontSize: 20, color: colors.waterInk },
  personShare: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  payBlock: { gap: spacing.sm },
  bar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.surface, gap: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, fontWeight: '600' },
  metrics: { flexDirection: 'row', alignItems: 'center' },
  metric: { flex: 1, alignItems: 'center', gap: 2 },
  metricDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: colors.border },
  metricValue: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk, fontWeight: '800' },
  metricLabel: { ...typography.caption, fontSize: 11, color: colors.slate, letterSpacing: 0 },
  flagLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flagText: { ...typography.caption, fontSize: 12.5, color: colors.amberDeep, fontWeight: '700', letterSpacing: 0, flex: 1 },
  flagLink: { ...typography.caption, fontSize: 12.5, color: colors.amberDeep, fontWeight: '700', letterSpacing: 0 },
  howTo: { paddingHorizontal: spacing.md, gap: 6 },
  howToTitle: { ...typography.caption, fontSize: 12, color: colors.slateDeep, fontWeight: '800', letterSpacing: 0.4 },
  howToText: { ...typography.caption, fontSize: 12.5, color: colors.slate, letterSpacing: 0, lineHeight: 19 },
  stateBox: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, gap: spacing.sm },
  stateIcon: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  cleanIcon: { backgroundColor: '#CCFBF1' },
  stateTitle: { ...typography.heading, fontSize: 19, color: colors.waterInk },
  stateBody: { ...typography.body, fontSize: 14.5, color: colors.slateDeep, textAlign: 'center', lineHeight: 21 },
  kindSummary: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
  },
  kindCell: { flex: 1, alignItems: 'center', gap: 4 },
  kindCellDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  kindIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  kindValue: { ...typography.heading, fontSize: 22, color: colors.slate },
  kindLabel: { ...typography.caption, fontSize: 11.5, color: colors.slateDeep, letterSpacing: 0 },
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
  auditKind: { ...typography.caption, fontWeight: '800', textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.6 },
  auditAmount: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 16, fontWeight: '700' },
  auditTitle: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  auditSub: { fontWeight: '400', color: colors.slateDeep },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  changeFrom: { ...typography.label, fontSize: 13, color: colors.slate, textDecorationLine: 'line-through' },
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
