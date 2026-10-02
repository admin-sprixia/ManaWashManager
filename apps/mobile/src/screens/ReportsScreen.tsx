import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import LinearGradient from 'react-native-linear-gradient';
import { ScreenContainer } from '../components/ScreenContainer';
import { ScreenHeader } from '../components/ScreenHeader';
import { BottomSheet } from '../components/BottomSheet';
import {
  IconAlert,
  IconBan,
  IconCalendar,
  IconCar,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconDownload,
  IconReceipt,
  IconTag,
  IconUserPlus,
  IconUsers,
} from '../components/Icons';
import { colors, gradients, radius, spacing, typography } from '../theme';
import { api } from '../api/client';
import { formatRupees } from '../utils/format';
import { shareReportPdf } from '../utils/shareReportPdf';
import type { ReportExportPayload } from '../utils/reportPdf';
import { usePlan, useProPill } from '../offline/PlanProvider';
import { handlePlanError, showUpgrade } from '../components/UpgradeSheet';
import type { RootStackParamList } from '../navigation/RootNavigator';

type ReportsScreenProps = NativeStackScreenProps<RootStackParamList, 'Reports'>;

type Range = 'today' | 'week' | 'month' | 'year' | 'custom';

interface Stats {
  carsWashed: number;
  revenue: number;
  cash: number;
  upi: number;
  other: number;
  voided: number;
  newCustomers: number;
  repeatCustomers: number;
  pendingNow: number;
  discounts: number;
  expenses: number;
  net: number;
  label?: string;
  from?: string;
  to?: string;
}

const PERIODS: { key: Range; label: string; hint: string }[] = [
  { key: 'today', label: 'Today', hint: 'This IST calendar day' },
  { key: 'week', label: 'Last 7 days', hint: 'Rolling week including today' },
  { key: 'month', label: 'This month', hint: 'From the 1st until now' },
  { key: 'year', label: 'This year', hint: 'From Jan 1 until now' },
  { key: 'custom', label: 'Custom dates', hint: 'Pick any From → To range' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const PAY_COLORS = { cash: colors.teal, upi: colors.water, other: colors.slate } as const;

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

/** "2026-10-02" → "2 Oct 2026". */
function prettyDate(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''} ${iso.slice(0, 4)}`;
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** Free plan reports cover today and the last 7 days; longer periods are Pro. */
const PRO_PERIODS: ReadonlySet<Range> = new Set<Range>(['month', 'year', 'custom']);

export function ReportsScreen({ navigation }: ReportsScreenProps) {
  const { isPro } = usePlan();
  const proPill = useProPill();
  const [range, setRange] = useState<Range>('today');
  const [periodOpen, setPeriodOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(todayIso());
  const [customTo, setCustomTo] = useState(todayIso());
  const [appliedCustom, setAppliedCustom] = useState<{ from: string; to: string } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const selectedPeriod = PERIODS.find((p) => p.key === range) ?? PERIODS[0]!;

  const query = useMemo(() => {
    if (range === 'custom') {
      const from = appliedCustom?.from ?? customFrom;
      const to = appliedCustom?.to ?? customTo;
      return { range: 'custom' as const, from, to };
    }
    return { range };
  }, [range, appliedCustom, customFrom, customTo]);

  const load = useCallback(async () => {
    if (query.range === 'custom' && (!isIsoDate(query.from) || !isIsoDate(query.to))) {
      setError('Enter dates as YYYY-MM-DD.');
      setStats(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await api.jobs.stats.$get({ query });
      if (await handlePlanError(res)) {
        setRange('today');
        setAppliedCustom(null);
        return;
      }
      if (res.status === 403) {
        setForbidden(true);
        setStats(null);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (body?.error === 'from_after_to') throw new Error('“From” must be on or before “To”.');
        if (body?.error === 'range_too_long') throw new Error('Custom range can’t be longer than 1 year.');
        throw new Error(`Could not load reports (${res.status}).`);
      }
      setStats((await res.json()) as Stats);
    } catch (e) {
      setStats(null);
      setError(e instanceof Error ? e.message : 'Could not reach the API. Is it running on localhost:8787?');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useFocusEffect(
    useCallback(() => {
      if (range === 'custom' && !appliedCustom) {
        setLoading(false);
        setStats(null);
        return;
      }
      void load();
    }, [range, appliedCustom, load]),
  );

  const refresh = async () => {
    if (range === 'custom' && !appliedCustom) return;
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const applyCustom = () => {
    if (!isIsoDate(customFrom) || !isIsoDate(customTo)) {
      setError('Enter dates as YYYY-MM-DD.');
      return;
    }
    if (customFrom > customTo) {
      setError('“From” must be on or before “To”.');
      return;
    }
    setError(null);
    setAppliedCustom({ from: customFrom.trim(), to: customTo.trim() });
  };

  const selectPeriod = (key: Range) => {
    if (!isPro && PRO_PERIODS.has(key)) {
      setPeriodOpen(false);
      showUpgrade({ kind: 'feature', feature: 'fullReports' });
      return;
    }
    setRange(key);
    setPeriodOpen(false);
    setError(null);
    if (key !== 'custom') setAppliedCustom(null);
  };

  const openExpenses = () =>
    isPro ? navigation.navigate('Expenses') : showUpgrade({ kind: 'feature', feature: 'expenses' });

  const onExport = async () => {
    if (exporting) return;
    if (!isPro) {
      showUpgrade({ kind: 'feature', feature: 'pdfExport' });
      return;
    }
    if (range === 'custom' && !appliedCustom) {
      setError('Apply a custom date range before exporting.');
      return;
    }
    setExporting(true);
    setError(null);
    try {
      const res = await api.jobs.stats.export.$get({ query });
      if (await handlePlanError(res)) return;
      if (res.status === 403) throw new Error('Only the owner can export reports.');
      if (!res.ok) throw new Error(`Could not export (${res.status}).`);
      const payload = (await res.json()) as ReportExportPayload;
      await shareReportPdf(payload);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not export PDF.';
      if (!/cancel|dismiss/i.test(message)) setError(message);
    } finally {
      setExporting(false);
    }
  };

  const avgTicket =
    stats && stats.carsWashed > 0 ? Math.round(stats.revenue / stats.carsWashed / 100) * 100 : 0;

  const periodSubtitle =
    range === 'custom' && appliedCustom
      ? `${prettyDate(appliedCustom.from)} → ${prettyDate(appliedCustom.to)}`
      : stats?.from && stats.to && stats.from !== stats.to
        ? `${prettyDate(stats.from)} → ${prettyDate(stats.to)}`
        : stats?.from
          ? prettyDate(stats.from)
          : selectedPeriod.hint;

  const exportDisabled = exporting || forbidden || !stats;
  const totalCustomers = stats ? stats.newCustomers + stats.repeatCustomers : 0;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader
          title="Reports"
          onBack={() => navigation.goBack()}
          right={
            <Pressable
              onPress={() => void onExport()}
              disabled={exportDisabled}
              style={({ pressed }) => [styles.exportPill, exportDisabled && styles.disabled, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Export PDF"
            >
              {exporting ? (
                <ActivityIndicator color={colors.waterDeep} size="small" />
              ) : (
                <>
                  <IconDownload size={15} color={colors.waterDeep} />
                  <Text style={styles.exportPillText}>PDF</Text>
                </>
              )}
            </Pressable>
          }
        />
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.water} colors={[colors.water]} />
        }
      >
        {/* Period dropdown */}
        <Pressable
          onPress={() => setPeriodOpen(true)}
          style={({ pressed }) => [styles.period, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Period: ${selectedPeriod.label}`}
        >
          <View style={styles.periodIcon}>
            <IconCalendar size={18} color={colors.waterDeep} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.periodLabel}>{selectedPeriod.label}</Text>
            <Text style={styles.periodHint} numberOfLines={1}>
              {periodSubtitle}
            </Text>
          </View>
          <View style={styles.periodChevron}>
            <IconChevronDown size={16} color={colors.waterDeep} />
          </View>
        </Pressable>

        {range === 'custom' ? (
          <View style={[styles.card]}>
            <Text style={styles.overline}>CUSTOM DATES</Text>
            <View style={styles.customFields}>
              <View style={styles.customField}>
                <Text style={styles.customLabel}>From</Text>
                <TextInput
                  style={styles.customInput}
                  value={customFrom}
                  onChangeText={setCustomFrom}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.slate}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={10}
                />
              </View>
              <Text style={styles.customArrow}>→</Text>
              <View style={styles.customField}>
                <Text style={styles.customLabel}>To</Text>
                <TextInput
                  style={styles.customInput}
                  value={customTo}
                  onChangeText={setCustomTo}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.slate}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={10}
                />
              </View>
            </View>
            <Pressable
              onPress={applyCustom}
              style={({ pressed }) => [styles.applyBtn, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.applyBtnText}>Show report</Text>
            </Pressable>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBanner}>
            <IconAlert size={18} color={colors.danger} />
            <Text style={styles.errorBannerText}>{error}</Text>
            <Pressable onPress={() => void load()} hitSlop={8} style={styles.retryPill}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {forbidden ? (
          <View style={[styles.card, styles.emptyCard]}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.waterPale }]}>
              <IconBan size={22} color={colors.waterDeep} />
            </View>
            <Text style={styles.emptyTitle}>Owner only</Text>
            <Text style={styles.emptyText}>Reports are only visible to the shop owner.</Text>
          </View>
        ) : stats ? (
          <>
            {/* Revenue hero */}
            <LinearGradient
              colors={gradients.hero as unknown as string[]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={[styles.hero]}
            >
              <View pointerEvents="none" style={styles.orbLarge} />
              <View pointerEvents="none" style={styles.orbSmall} />
              <View style={styles.heroTop}>
                <Text style={styles.heroEyebrow}>Revenue</Text>
                {loading ? <ActivityIndicator color={colors.white} size="small" /> : null}
              </View>
              <Text style={styles.heroValue}>{formatRupees(stats.revenue)}</Text>
              <Text style={styles.heroMeta}>
                {stats.carsWashed} wash{stats.carsWashed === 1 ? '' : 'es'}
                {stats.carsWashed > 0 ? `  ·  ${formatRupees(avgTicket)} per vehicle` : ''}
              </Text>
              <View style={styles.heroSplit}>
                <Pressable
                  onPress={openExpenses}
                  style={({ pressed }) => [styles.heroTile, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Open expenses"
                >
                  <Text style={styles.heroTileLabel}>Expenses ›</Text>
                  <Text style={styles.heroTileValue}>{formatRupees(stats.expenses)}</Text>
                </Pressable>
                <View style={[styles.heroTile, styles.heroTileStrong]}>
                  <Text style={[styles.heroTileLabel, styles.heroTileLabelStrong]}>Net profit</Text>
                  <Text style={[styles.heroTileValue, styles.heroTileValueStrong, stats.net < 0 && styles.negative]}>
                    {formatRupees(stats.net)}
                  </Text>
                </View>
              </View>
            </LinearGradient>

            {/* Quick numbers */}
            <View style={styles.grid}>
              <StatTile
                index={0}
                icon={<IconCar size={18} color={colors.waterDeep} />}
                tint={colors.waterPale}
                value={String(stats.carsWashed)}
                label="Vehicles washed"
              />
              <StatTile
                index={1}
                icon={<IconClock size={18} color={colors.amberDeep} />}
                tint="#FEF3C7"
                value={String(stats.pendingNow)}
                label="At the bay now"
                hint="Not paid yet"
              />
              <StatTile
                index={2}
                icon={<IconUserPlus size={18} color={colors.tealDeep} />}
                tint="#CCFBF1"
                value={String(stats.newCustomers)}
                label="New customers"
                hint="First visit"
              />
              <StatTile
                index={3}
                icon={<IconUsers size={18} color="#6D28D9" />}
                tint="#EDE9FE"
                value={String(stats.repeatCustomers)}
                label="Repeat customers"
                hint={totalCustomers > 0 ? `${pct(stats.repeatCustomers, totalCustomers)}% came back` : 'Came back'}
              />
            </View>

            {/* How money came in */}
            <View style={[styles.card]}>
              <View style={styles.cardHeadRow}>
                <Text style={styles.cardTitle}>How money came in</Text>
                <Text style={styles.cardMeta}>{formatRupees(stats.revenue)}</Text>
              </View>
              {stats.revenue === 0 ? (
                <Text style={styles.emptyInline}>No payments collected in this period.</Text>
              ) : (
                <>
                  <View style={styles.stackBar}>
                    {(['cash', 'upi', 'other'] as const).map((k) =>
                      stats[k] > 0 ? (
                        <View key={k} style={{ flex: stats[k], backgroundColor: PAY_COLORS[k] }} />
                      ) : null,
                    )}
                  </View>
                  <PayRow label="Cash" amount={stats.cash} total={stats.revenue} color={PAY_COLORS.cash} />
                  <PayRow label="UPI" amount={stats.upi} total={stats.revenue} color={PAY_COLORS.upi} />
                  {stats.other > 0 ? (
                    <PayRow label="Other" amount={stats.other} total={stats.revenue} color={PAY_COLORS.other} />
                  ) : null}
                </>
              )}
            </View>

            {/* Profit breakdown */}
            <View style={[styles.card]}>
              <Text style={styles.cardTitle}>Profit</Text>
              <View>
                <LineRow label="Revenue" hint="Collected from paid washes" value={formatRupees(stats.revenue)} />
                <LineRow
                  label="Expenses"
                  hint="Tap to see every entry"
                  value={`− ${formatRupees(stats.expenses)}`}
                  valueStyle={styles.minus}
                  onPress={openExpenses}
                  last
                />
              </View>
              <View style={[styles.netRow, stats.net < 0 && styles.netRowNegative]}>
                <View style={styles.flex}>
                  <Text style={styles.netLabel}>Net</Text>
                  <Text style={styles.netHint}>Revenue minus expenses</Text>
                </View>
                <Text style={[styles.netValue, stats.net < 0 && styles.minus]}>{formatRupees(stats.net)}</Text>
              </View>
            </View>

            {/* Other details */}
            <View style={[styles.card]}>
              <Text style={styles.cardTitle}>More details</Text>
              <View>
                <DetailRow
                  icon={<IconReceipt size={16} color={colors.waterDeep} />}
                  tint={colors.waterPale}
                  label="Average per vehicle"
                  value={stats.carsWashed > 0 ? formatRupees(avgTicket) : '—'}
                />
                <DetailRow
                  icon={<IconTag size={16} color={colors.amberDeep} />}
                  tint="#FEF3C7"
                  label="Discounts given"
                  value={stats.discounts > 0 ? formatRupees(stats.discounts) : '—'}
                />
                <DetailRow
                  icon={<IconBan size={16} color={colors.slateDeep} />}
                  tint="#F1F5F9"
                  label="Cancelled jobs"
                  value={String(stats.voided)}
                  last
                />
              </View>
            </View>

            {/* Export */}
            <View style={[styles.card]}>
              <View style={styles.exportHead}>
                <View style={[styles.emptyIcon, styles.exportIcon]}>
                  <IconDownload size={20} color={colors.white} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>Share a PDF report</Text>
                  <Text style={styles.exportHint}>Summary, payment split and every job in this period.</Text>
                </View>
              </View>
              <Pressable
                onPress={() => void onExport()}
                disabled={exporting}
                style={({ pressed }) => [styles.exportFull, pressed && styles.pressed]}
              >
                {exporting ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.exportFullLabel}>Export PDF</Text>
                )}
              </Pressable>
            </View>
          </>
        ) : loading ? (
          <ActivityIndicator color={colors.water} size="large" style={styles.loader} />
        ) : (
          <View style={[styles.card, styles.emptyCard]}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.waterPale }]}>
              <IconCalendar size={22} color={colors.waterDeep} />
            </View>
            <Text style={styles.emptyTitle}>{range === 'custom' ? 'Pick your dates' : 'No data yet'}</Text>
            <Text style={styles.emptyText}>
              {range === 'custom'
                ? 'Enter From and To above, then tap Show report.'
                : 'Numbers appear here once washes are paid.'}
            </Text>
          </View>
        )}
      </ScrollView>

      <BottomSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} title="Choose period">
        <View style={styles.sheetList}>
          {PERIODS.map((p, i) => {
            const on = range === p.key;
            return (
              <Pressable
                key={p.key}
                onPress={() => selectPeriod(p.key)}
                style={({ pressed }) => [
                  styles.sheetRow,
                  i > 0 && styles.sheetDivider,
                  on && styles.sheetRowOn,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <View style={styles.flex}>
                  <View style={styles.sheetLabelRow}>
                    <Text style={[styles.sheetRowLabel, on && styles.sheetRowLabelOn]}>{p.label}</Text>
                    {PRO_PERIODS.has(p.key) ? proPill : null}
                  </View>
                  <Text style={styles.sheetRowHint}>{p.hint}</Text>
                </View>
                <View style={[styles.radio, on && styles.radioOn]}>
                  {on ? <IconCheck size={12} color={colors.white} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>
    </ScreenContainer>
  );
}

function StatTile({
  icon,
  tint,
  value,
  label,
  hint,
  index,
}: {
  icon: React.ReactNode;
  tint: string;
  value: string;
  label: string;
  hint?: string;
  /** Position in the 2-column grid, for the hairline dividers. */
  index: number;
}) {
  return (
    <View style={[styles.tile, index % 2 === 1 && styles.tileRight, index >= 2 && styles.tileBottom]}>
      <View style={[styles.tileIcon, { backgroundColor: tint }]}>{icon}</View>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
    </View>
  );
}

function PayRow({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  return (
    <View style={styles.payRow}>
      <View style={[styles.payDot, { backgroundColor: color }]} />
      <Text style={styles.payLabel}>{label}</Text>
      <Text style={styles.payPct}>{pct(amount, total)}%</Text>
      <Text style={styles.payAmount}>{formatRupees(amount)}</Text>
    </View>
  );
}

function LineRow({
  label,
  hint,
  value,
  valueStyle,
  onPress,
  last,
}: {
  label: string;
  hint?: string;
  value: string;
  valueStyle?: object;
  onPress?: () => void;
  last?: boolean;
}) {
  const body = (
    <>
      <View style={styles.flex}>
        <Text style={styles.lineLabel}>{label}</Text>
        {hint ? <Text style={styles.lineHint}>{hint}</Text> : null}
      </View>
      <Text style={[styles.lineValue, valueStyle]}>{value}</Text>
      {onPress ? <IconChevronRight size={16} color={colors.slate} /> : null}
    </>
  );
  return onPress ? (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.lineRow, !last && styles.lineDivider, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      {body}
    </Pressable>
  ) : (
    <View style={[styles.lineRow, !last && styles.lineDivider]}>{body}</View>
  );
}

function DetailRow({
  icon,
  tint,
  label,
  value,
  last,
}: {
  icon: React.ReactNode;
  tint: string;
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.lineRow, !last && styles.lineDivider]}>
      <View style={[styles.detailIcon, { backgroundColor: tint }]}>{icon}</View>
      <Text style={[styles.lineLabel, styles.flex]}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  headerPad: { paddingHorizontal: spacing.md },
  scroll: { paddingTop: spacing.xs, paddingBottom: spacing.xxl, gap: spacing.md },
  loader: { marginTop: spacing.xxl },
  exportPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    minWidth: 64,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
  },
  exportPillText: { ...typography.label, fontSize: 13, color: colors.waterDeep, fontWeight: '700' },
  period: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  periodIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk, fontWeight: '700' },
  periodHint: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, marginTop: 1 },
  periodChevron: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  overline: { ...typography.caption, fontSize: 11, color: colors.slate, fontWeight: '800', letterSpacing: 1 },
  cardHeadRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  cardTitle: { ...typography.heading, fontSize: 18, color: colors.waterInk, letterSpacing: -0.2 },
  cardMeta: { ...typography.label, fontSize: 14, color: colors.slateDeep },
  customFields: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  customField: { flex: 1, gap: 6 },
  customLabel: { ...typography.caption, fontSize: 12, color: colors.slateDeep, fontWeight: '700', letterSpacing: 0 },
  customInput: {
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm + 4,
    fontSize: 15,
    fontWeight: '600',
    color: colors.waterInk,
  },
  customArrow: { ...typography.bodyStrong, color: colors.slate, paddingBottom: 12 },
  applyBtn: {
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.waterInk,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyBtnText: { ...typography.bodyStrong, fontSize: 15, color: colors.white, fontWeight: '700' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    backgroundColor: '#FEF2F2',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#FECACA',
  },
  errorBannerText: { ...typography.label, fontSize: 13, color: colors.danger, flex: 1 },
  retryPill: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    justifyContent: 'center',
  },
  retryText: { ...typography.caption, fontSize: 12.5, color: colors.white, fontWeight: '700', letterSpacing: 0 },
  hero: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md + 4,
    overflow: 'hidden',
  },
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
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroEyebrow: { ...typography.label, fontSize: 14, color: 'rgba(255,255,255,0.88)' },
  heroValue: { ...typography.display, fontSize: 44, color: colors.white, letterSpacing: -1, marginTop: 2 },
  heroMeta: { ...typography.label, fontSize: 13.5, color: 'rgba(255,255,255,0.9)' },
  heroSplit: {
    flexDirection: 'row',
    marginTop: spacing.md + 4,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.45)',
  },
  heroTile: { flex: 1, gap: 2 },
  heroTileStrong: {
    paddingLeft: spacing.md,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(255,255,255,0.45)',
  },
  heroTileLabel: { ...typography.caption, fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: '700', letterSpacing: 0 },
  heroTileLabelStrong: {},
  heroTileValue: { ...typography.heading, fontSize: 21, color: colors.white },
  heroTileValueStrong: { fontSize: 21 },
  negative: { color: '#FECACA' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tile: {
    width: '50%',
    padding: spacing.md,
    gap: 2,
    borderColor: colors.border,
  },
  tileRight: { borderLeftWidth: StyleSheet.hairlineWidth },
  tileBottom: { borderTopWidth: StyleSheet.hairlineWidth },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  tileValue: { ...typography.title, fontSize: 28, color: colors.waterInk, letterSpacing: -0.5 },
  tileLabel: { ...typography.bodyStrong, fontSize: 14, color: colors.waterInk },
  tileHint: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  stackBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    gap: 2,
  },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  payDot: { width: 10, height: 10, borderRadius: 5 },
  payLabel: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk, flex: 1 },
  payPct: {
    ...typography.caption,
    fontSize: 12,
    color: colors.slateDeep,
    fontWeight: '700',
    letterSpacing: 0,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  payAmount: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk, fontWeight: '700', minWidth: 72, textAlign: 'right' },
  emptyInline: { ...typography.body, fontSize: 14, color: colors.slateDeep },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingVertical: spacing.sm + 4 },
  lineDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  lineLabel: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  lineHint: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0, marginTop: 1 },
  lineValue: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk, fontWeight: '700' },
  minus: { color: colors.danger },
  netRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: -spacing.md,
    paddingTop: spacing.sm + 4,
    borderTopWidth: 1.5,
    borderTopColor: colors.waterInk,
  },
  netRowNegative: { borderTopColor: colors.danger },
  netLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk, fontWeight: '700' },
  netHint: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  netValue: { ...typography.heading, fontSize: 22, color: colors.teal },
  detailIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  exportHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  exportIcon: { backgroundColor: colors.waterDeep, marginBottom: 0 },
  exportHint: { ...typography.caption, fontSize: 13, lineHeight: 18, color: colors.slateDeep, letterSpacing: 0, marginTop: 2 },
  exportFull: {
    height: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.waterDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportFullLabel: { ...typography.bodyStrong, fontSize: 15, color: colors.white, fontWeight: '700' },
  emptyCard: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: { ...typography.heading, fontSize: 18, color: colors.waterInk },
  emptyText: { ...typography.body, fontSize: 14, color: colors.slateDeep, textAlign: 'center' },
  sheetList: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
  },
  sheetDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sheetRowOn: { backgroundColor: colors.waterPale },
  sheetLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sheetRowLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk },
  sheetRowLabelOn: { color: colors.waterDeep, fontWeight: '700' },
  sheetRowHint: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, marginTop: 1 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.water, borderColor: colors.water },
});
