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
import Svg, { Circle, G, Path } from 'react-native-svg';
import {
  ScreenContainer,
  ScreenHeader,
  BottomSheet,
  BRAND_MARK,
  IconAlert,
  IconBan,
  IconCalendar,
  IconCar,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconDownload,
  IconBuilding,
  IconGift,
  IconHome,
  IconReceipt,
  IconStar,
  IconStore,
  IconTag,
  IconUserPlus,
  IconUsers,
  brandGradients,
  colors,
  radius,
  shadow,
  spacing,
  typography,
} from '@mana/ui';
import { api } from '../api/client';
import { useAuth } from '../api/auth';
import { formatRupees } from '../utils/format';
import { shareReportPdf } from '../utils/shareReportPdf';
import type { ReportExportPayload } from '../utils/reportPdf';
import { useShop } from '../offline/ShopProvider';
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
  /** Paid for community plans in the period, less refunds. */
  planIncome?: number;
  planPayments?: number;
  /** Washes at customers' homes (part of carsWashed) and what they brought in (part of revenue). */
  doorstepWashes?: number;
  doorstepRevenue?: number;
  /** Plan cars washed at communities; their money is plan income. */
  communityWashes?: number;
  /** Wash plans sold at the counter (not washes) and what they brought in (part of revenue). */
  shopPlansSold?: number;
  shopPlanRevenue?: number;
  net: number;
  label?: string;
  from?: string;
  to?: string;
}

interface RewardsReport {
  freeWashes: number;
  freeValue: number;
  giftsGiven: number;
  gifts: { stockItemId: string; name: string; unit: string; count: number; quantity: number; label: string }[];
  giftsOwedNow: number;
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

const STARS = [
  [24, 26, 1.2, 0.5],
  [88, 12, 0.9, 0.4],
  [150, 40, 1.1, 0.3],
  [214, 18, 1.2, 0.45],
  [40, 86, 0.8, 0.3],
  [190, 96, 1, 0.3],
] as const;

/** Today's IST calendar date (matches API report windows), not the phone's local TZ. */
function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
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

export function ReportsScreen({ navigation }: ReportsScreenProps) {
  const { user } = useAuth();
  const { rewardsOn, info } = useShop();
  const shopName = info?.name?.trim() || 'Your shop';
  const [rewardsReport, setRewardsReport] = useState<RewardsReport | null>(null);
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
      const rewardsCall = api.rewards.report
        .$get({ query })
        .then(async (r) => (r.ok ? ((await r.json()) as RewardsReport) : null))
        .catch(() => null);
      const [res, rewardsBody] = await Promise.all([api.jobs.stats.$get({ query }), rewardsCall]);
      setRewardsReport(rewardsBody);
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
    setRange(key);
    setPeriodOpen(false);
    setError(null);
    if (key !== 'custom') setAppliedCustom(null);
  };

  const openExpenses = () => navigation.navigate('Expenses');

  const onExport = async () => {
    if (exporting) return;
    if (range === 'custom' && !appliedCustom) {
      setError('Apply a custom date range before exporting.');
      return;
    }
    setExporting(true);
    setError(null);
    try {
      const res = await api.jobs.stats.export.$get({ query });
      if (res.status === 403) throw new Error('Only the owner can export reports.');
      if (!res.ok) throw new Error(`Could not export (${res.status}).`);
      const payload = (await res.json()) as ReportExportPayload;
      await shareReportPdf(payload, {
        name: payload.shop?.name ?? info?.name ?? shopName,
        city: payload.shop?.city ?? info?.city,
        code: payload.shop?.code ?? info?.code,
        generatedBy: user
          ? { name: user.name, phone: user.phone, role: user.role }
          : null,
        rewards:
          payload.rewards ??
          (rewardsReport
            ? {
                freeWashes: rewardsReport.freeWashes,
                freeValue: rewardsReport.freeValue,
                giftsGiven: rewardsReport.giftsGiven,
                giftsOwedNow: rewardsReport.giftsOwedNow,
                gifts: rewardsReport.gifts.map((g) => ({
                  name: g.name,
                  label: g.label,
                  unit: g.unit,
                  quantity: g.quantity,
                })),
              }
            : null),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not export PDF.';
      if (!/cancel|dismiss/i.test(message)) setError(message);
    } finally {
      setExporting(false);
    }
  };

  const planSales = stats?.shopPlanRevenue ?? 0;
  const washRevenue = stats ? stats.revenue - planSales : 0;
  const avgTicket = stats && stats.carsWashed > 0 ? Math.round(washRevenue / stats.carsWashed / 100) * 100 : 0;

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
  const g = brandGradients.hero;
  const profitTone = stats && stats.net < 0;

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
                <ActivityIndicator color={colors.indigo} size="small" />
              ) : (
                <>
                  <IconDownload size={15} color={colors.indigo} />
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
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.indigo}
            colors={[colors.indigo]}
          />
        }
      >
        <Pressable
          onPress={() => setPeriodOpen(true)}
          style={({ pressed }) => [styles.period, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Period: ${selectedPeriod.label}`}
        >
          <View style={styles.periodIcon}>
            <IconCalendar size={18} color={colors.indigo} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.periodLabel}>{selectedPeriod.label}</Text>
            <Text style={styles.periodHint} numberOfLines={1}>
              {periodSubtitle}
            </Text>
          </View>
          <View style={styles.periodChevron}>
            <IconChevronDown size={16} color={colors.indigo} />
          </View>
        </Pressable>

        {range === 'custom' ? (
          <View style={styles.bandPad}>
            <Text style={styles.sectionTitle}>Custom dates</Text>
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
          <View style={styles.emptyBand}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.indigoPale }]}>
              <IconBan size={22} color={colors.indigo} />
            </View>
            <Text style={styles.emptyTitle}>Owner only</Text>
            <Text style={styles.emptyText}>Reports are only visible to the shop owner.</Text>
          </View>
        ) : stats ? (
          <>
            <LinearGradient
              colors={g.colors as unknown as string[]}
              locations={g.locations as unknown as number[]}
              start={g.start}
              end={g.end}
              style={[styles.hero, shadow('md')]}
            >
              <Svg
                style={StyleSheet.absoluteFill}
                width="100%"
                height="100%"
                viewBox="0 0 340 220"
                preserveAspectRatio="xMidYMid slice"
              >
                {STARS.map(([x, y, r, o]) => (
                  <Circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#FFFFFF" fillOpacity={o} />
                ))}
              </Svg>
              <Svg style={styles.heroMark} width={150} height={150} viewBox="0 0 256 256">
                <G>
                  <Path d={BRAND_MARK.drop} fill="#FFFFFF" fillOpacity={0.07} />
                  <Path d={BRAND_MARK.arms} fill="#FFFFFF" fillOpacity={0.1} />
                  <Path d={BRAND_MARK.centre} fill="#FFFFFF" fillOpacity={0.15} />
                </G>
              </Svg>

              <View style={styles.heroTop}>
                <View style={styles.flex}>
                  <Text style={styles.heroEyebrow}>Business report</Text>
                  <Text style={styles.heroShop} numberOfLines={1}>
                    {shopName}
                  </Text>
                </View>
                {loading ? <ActivityIndicator color={colors.white} size="small" /> : null}
              </View>

              <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
                {formatRupees(stats.revenue)}
              </Text>
              <Text style={styles.heroMeta}>
                Revenue · {stats.carsWashed} wash{stats.carsWashed === 1 ? '' : 'es'}
                {stats.carsWashed > 0 ? ` · ${formatRupees(avgTicket)} avg` : ''}
              </Text>
              {planSales ? (
                <Text style={styles.heroMeta}>
                  Includes {formatRupees(planSales)} from {stats.shopPlansSold ?? 0}{' '}
                  {stats.shopPlansSold === 1 ? 'plan' : 'plans'} sold at the shop
                </Text>
              ) : null}
              {stats.planIncome ? (
                <Text style={styles.heroMeta}>+ {formatRupees(stats.planIncome)} from community plans</Text>
              ) : null}

              <View style={styles.heroChips}>
                <Pressable
                  onPress={openExpenses}
                  style={({ pressed }) => [styles.heroChip, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Open expenses"
                >
                  <Text style={styles.heroChipLabel}>Expenses</Text>
                  <Text style={styles.heroChipValue} numberOfLines={1} adjustsFontSizeToFit>
                    {formatRupees(stats.expenses)}
                  </Text>
                </Pressable>
                <View style={styles.heroChip}>
                  <Text style={styles.heroChipLabel}>Net profit</Text>
                  <Text
                    style={[styles.heroChipValue, profitTone && styles.heroChipNeg]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {formatRupees(stats.net)}
                  </Text>
                </View>
                <View style={styles.heroChip}>
                  <Text style={styles.heroChipLabel}>Period</Text>
                  <Text style={styles.heroChipValue} numberOfLines={1}>
                    {selectedPeriod.label}
                  </Text>
                </View>
              </View>
            </LinearGradient>

            <Text style={styles.sectionTitle}>At a glance</Text>
            <View style={styles.grid}>
              <StatTile
                index={0}
                icon={<IconCar size={18} color={colors.indigo} />}
                tint={colors.indigoPale}
                value={String(stats.carsWashed + (stats.communityWashes ?? 0))}
                label="Vehicles washed"
                hint={(stats.communityWashes ?? 0) > 0 ? `${stats.communityWashes} at communities` : undefined}
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
                icon={<IconUsers size={18} color={colors.indigo} />}
                tint={colors.indigoPale}
                value={String(stats.repeatCustomers)}
                label="Repeat customers"
                hint={totalCustomers > 0 ? `${pct(stats.repeatCustomers, totalCustomers)}% came back` : 'Came back'}
              />
            </View>

            {(stats.doorstepWashes ?? 0) > 0 || (stats.communityWashes ?? 0) > 0 || planSales > 0 ? (
              <>
                <Text style={styles.sectionTitle}>{planSales > 0 ? 'Where we washed and sold' : 'Where we washed'}</Text>
                <View style={styles.band}>
                  <DetailRow
                    icon={<IconStore size={16} color={colors.indigo} />}
                    tint={colors.indigoPale}
                    label={`At the shop · ${stats.carsWashed - (stats.doorstepWashes ?? 0)}`}
                    value={formatRupees(washRevenue - (stats.doorstepRevenue ?? 0))}
                  />
                  {planSales > 0 ? (
                    <DetailRow
                      icon={<IconStore size={16} color={colors.tealDeep} />}
                      tint="#CCFBF1"
                      label={`Plans sold at the shop · ${stats.shopPlansSold ?? 0}`}
                      value={formatRupees(planSales)}
                    />
                  ) : null}
                  <DetailRow
                    icon={<IconHome size={16} color={colors.amberDeep} />}
                    tint="#FEF3C7"
                    label={`At customers’ homes · ${stats.doorstepWashes ?? 0}`}
                    value={formatRupees(stats.doorstepRevenue ?? 0)}
                  />
                  <DetailRow
                    icon={<IconBuilding size={16} color={colors.tealDeep} />}
                    tint="#CCFBF1"
                    label={`At communities · ${stats.communityWashes ?? 0}`}
                    value={stats.planIncome ? 'Paid by plans' : '—'}
                    last
                  />
                </View>
              </>
            ) : null}

            <Text style={styles.sectionTitle}>How money came in</Text>
            <View style={styles.band}>
              <View style={styles.bandInner}>
                <View style={styles.cardHeadRow}>
                  <Text style={styles.cardTitle}>Payments</Text>
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
            </View>

            <Text style={styles.sectionTitle}>Profit</Text>
            <View style={styles.band}>
              <View style={styles.bandInner}>
                <LineRow
                  label="Revenue"
                  hint={planSales ? 'Washes and shop plans paid in this period' : 'Washes paid in this period'}
                  value={formatRupees(stats.revenue)}
                />
                {stats.planIncome ? (
                  <LineRow
                    label="Community plans"
                    hint={`${stats.planPayments ?? 0} ${stats.planPayments === 1 ? 'payment' : 'payments'} for plans, less refunds`}
                    value={`+ ${formatRupees(stats.planIncome)}`}
                  />
                ) : null}
                <LineRow
                  label="Expenses"
                  hint="Tap to see every entry"
                  value={`− ${formatRupees(stats.expenses)}`}
                  valueStyle={styles.minus}
                  onPress={openExpenses}
                  last
                />
                <View style={[styles.netRow, profitTone && styles.netRowNegative]}>
                  <View style={styles.flex}>
                    <Text style={styles.netLabel}>Net</Text>
                    <Text style={styles.netHint}>
                      {stats.planIncome ? 'Revenue and plans, minus expenses' : 'Revenue minus expenses'}
                    </Text>
                  </View>
                  <Text style={[styles.netValue, profitTone && styles.minus]}>{formatRupees(stats.net)}</Text>
                </View>
              </View>
            </View>

            <Text style={styles.sectionTitle}>More details</Text>
            <View style={styles.band}>
              <DetailRow
                icon={<IconReceipt size={16} color={colors.indigo} />}
                tint={colors.indigoPale}
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

            {rewardsReport &&
            (rewardsOn ||
              rewardsReport.freeWashes > 0 ||
              rewardsReport.giftsGiven > 0 ||
              rewardsReport.giftsOwedNow > 0) ? (
              <>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Rewards</Text>
                  <Pressable onPress={() => navigation.navigate('Rewards')} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.cardLink}>Set up ›</Text>
                  </Pressable>
                </View>
                <View style={styles.band}>
                  <DetailRow
                    icon={<IconStar size={16} color={colors.amberDeep} />}
                    tint="#FEF3C7"
                    label="Free washes used"
                    value={String(rewardsReport.freeWashes)}
                  />
                  <DetailRow
                    icon={<IconTag size={16} color={colors.amberDeep} />}
                    tint="#FEF3C7"
                    label="Value given free"
                    value={rewardsReport.freeValue > 0 ? formatRupees(rewardsReport.freeValue) : '—'}
                  />
                  <DetailRow
                    icon={<IconGift size={16} color={colors.tealDeep} />}
                    tint="#CCFBF1"
                    label="Welcome gifts handed over"
                    value={String(rewardsReport.giftsGiven)}
                  />
                  <DetailRow
                    icon={<IconGift size={16} color="#C2410C" />}
                    tint="#FFEDD5"
                    label="Gifts owed right now"
                    value={String(rewardsReport.giftsOwedNow)}
                    last
                  />
                  {rewardsReport.gifts.length > 0 ? (
                    <Text style={styles.cardFoot}>
                      Handed over:{' '}
                      {rewardsReport.gifts
                        .map((g) => (g.unit === 'pcs' ? `${g.name} × ${g.quantity}` : `${g.name} ${g.label}`))
                        .join(' · ')}
                    </Text>
                  ) : null}
                  <Text style={styles.cardFoot}>
                    Free washes are already inside “Discounts given”. Staff still earn their commission on them.
                  </Text>
                </View>
              </>
            ) : null}

            <Text style={styles.sectionTitle}>Share</Text>
            <View style={styles.band}>
              <View style={styles.exportHead}>
                <View style={styles.exportIcon}>
                  <IconDownload size={20} color={colors.white} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>PDF report</Text>
                  <Text style={styles.exportHint}>
                    Cover, GST, expenses, day-by-day, peak hours, staff, stock and the full job ledger for{' '}
                    {shopName}.
                  </Text>
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
          <ActivityIndicator color={colors.indigo} size="large" style={styles.loader} />
        ) : (
          <View style={styles.emptyBand}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.indigoPale }]}>
              <IconCalendar size={22} color={colors.indigo} />
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
                  <Text style={[styles.sheetRowLabel, on && styles.sheetRowLabelOn]}>{p.label}</Text>
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
    <View style={[styles.detailRow, !last && styles.lineDivider]}>
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
  scroll: { paddingBottom: spacing.xxl, gap: spacing.md },
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
    backgroundColor: colors.indigoPale,
  },
  exportPillText: { ...typography.label, fontSize: 13, color: colors.indigo, fontWeight: '700' },

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
    borderRadius: 20,
    backgroundColor: colors.indigoPale,
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

  bandPad: { paddingHorizontal: spacing.md, gap: spacing.sm },
  band: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  bandInner: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.md },

  sectionTitle: {
    ...typography.heading,
    fontSize: 16,
    color: colors.ink,
    letterSpacing: -0.2,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing.md,
  },

  overline: { ...typography.caption, fontSize: 11, color: colors.slate, fontWeight: '800', letterSpacing: 1 },
  cardHeadRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  cardTitle: { ...typography.heading, fontSize: 17, color: colors.waterInk, letterSpacing: -0.2 },
  cardMeta: { ...typography.label, fontSize: 14, color: colors.slateDeep },
  cardLink: { ...typography.label, fontSize: 14, color: colors.indigo, fontWeight: '700' },
  cardFoot: {
    ...typography.caption,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.slateDeep,
    letterSpacing: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },

  customFields: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  customField: { flex: 1, gap: 6 },
  customLabel: { ...typography.caption, fontSize: 12, color: colors.slateDeep, fontWeight: '700', letterSpacing: 0 },
  customInput: {
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.white,
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
    backgroundColor: colors.indigo,
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
    marginHorizontal: spacing.md,
    borderRadius: radius.xl,
    padding: spacing.md + 2,
    gap: 4,
    overflow: 'hidden',
  },
  heroMark: { position: 'absolute', right: -22, top: -14 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  heroEyebrow: { ...typography.label, fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  heroShop: {
    ...typography.bodyStrong,
    fontSize: 15,
    color: colors.white,
    fontWeight: '800',
    marginTop: 2,
  },
  heroValue: {
    ...typography.display,
    fontSize: 40,
    color: colors.white,
    letterSpacing: -1,
    marginTop: 4,
  },
  heroMeta: { ...typography.label, fontSize: 13.5, color: 'rgba(255,255,255,0.9)', lineHeight: 18 },
  heroChips: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  heroChip: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    gap: 2,
  },
  heroChipLabel: {
    ...typography.caption,
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.72)',
    letterSpacing: 0.2,
  },
  heroChipValue: { ...typography.bodyStrong, fontSize: 14.5, color: colors.white, fontWeight: '800' },
  heroChipNeg: { color: '#FECACA' },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tile: { width: '50%', padding: spacing.md, gap: 2, borderColor: colors.border },
  tileRight: { borderLeftWidth: StyleSheet.hairlineWidth },
  tileBottom: { borderTopWidth: StyleSheet.hairlineWidth },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
  payAmount: {
    ...typography.bodyStrong,
    fontSize: 15,
    color: colors.waterInk,
    fontWeight: '700',
    minWidth: 72,
    textAlign: 'right',
  },
  emptyInline: { ...typography.body, fontSize: 14, color: colors.slateDeep },

  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.sm + 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 6,
  },
  lineDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  lineLabel: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  lineHint: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0, marginTop: 1 },
  lineValue: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk, fontWeight: '700' },
  minus: { color: colors.danger },
  netRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm + 4,
    borderTopWidth: 1.5,
    borderTopColor: colors.indigo,
  },
  netRowNegative: { borderTopColor: colors.danger },
  netLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk, fontWeight: '700' },
  netHint: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  netValue: { ...typography.heading, fontSize: 22, color: colors.teal },
  detailIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },

  exportHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  exportIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.indigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportHint: {
    ...typography.caption,
    fontSize: 13,
    lineHeight: 18,
    color: colors.slateDeep,
    letterSpacing: 0,
    marginTop: 2,
  },
  exportFull: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    height: 50,
    borderRadius: radius.pill,
    backgroundColor: colors.indigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exportFullLabel: { ...typography.bodyStrong, fontSize: 15, color: colors.white, fontWeight: '700' },

  emptyBand: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
  sheetRowOn: { backgroundColor: colors.indigoPale },
  sheetRowLabel: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk },
  sheetRowLabelOn: { color: colors.indigo, fontWeight: '700' },
  sheetRowHint: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slateDeep,
    letterSpacing: 0,
    marginTop: 1,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
});
