import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenContainer } from '../components/ScreenContainer';
import { IconChevronDown, IconChevronLeft, IconDownload } from '../components/Icons';
import { colors, gradients, radius, shadow, spacing, typography } from '../theme';
import { api } from '../api/client';
import { formatRupees } from '../utils/format';
import { shareReportPdf } from '../utils/shareReportPdf';
import type { ReportExportPayload } from '../utils/reportPdf';
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

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function ReportsScreen({ navigation }: ReportsScreenProps) {
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<Range>('today');
  const [periodOpen, setPeriodOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(todayIso());
  const [customTo, setCustomTo] = useState(todayIso());
  const [appliedCustom, setAppliedCustom] = useState<{ from: string; to: string } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
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
      await shareReportPdf(payload);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not export PDF.';
      if (!/cancel|dismiss/i.test(message)) setError(message);
    } finally {
      setExporting(false);
    }
  };

  const avgTicket =
    stats && stats.carsWashed > 0 ? Math.round(stats.revenue / stats.carsWashed) : 0;

  const periodSubtitle =
    range === 'custom' && appliedCustom
      ? `${appliedCustom.from} → ${appliedCustom.to}`
      : selectedPeriod.hint;

  return (
    <ScreenContainer noPadding edges={['bottom']}>
      <LinearGradient
        colors={gradients.hero as unknown as string[]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.hero, { paddingTop: insets.top + spacing.sm }]}
      >
        <View style={styles.heroTop}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <IconChevronLeft size={22} color={colors.white} />
          </Pressable>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>OWNER</Text>
            <Text style={styles.heroTitle}>Reports</Text>
          </View>
          <Pressable
            onPress={() => void onExport()}
            disabled={exporting || forbidden || !stats}
            style={({ pressed }) => [
              styles.exportBtn,
              (exporting || forbidden || !stats) && styles.exportBtnDisabled,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Export PDF"
          >
            {exporting ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <>
                <IconDownload size={16} color={colors.white} />
                <Text style={styles.exportLabel}>PDF</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* Period dropdown — scalable: add ranges in PERIODS only */}
        <View style={styles.controlPad}>
          <Text style={styles.controlLabel}>Period</Text>
          <Pressable
            onPress={() => setPeriodOpen(true)}
            style={({ pressed }) => [styles.dropdown, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Period: ${selectedPeriod.label}`}
          >
            <View style={styles.dropdownCopy}>
              <Text style={styles.dropdownValue}>{selectedPeriod.label}</Text>
              <Text style={styles.dropdownHint} numberOfLines={1}>
                {periodSubtitle}
              </Text>
            </View>
            <IconChevronDown size={18} color={colors.white} />
          </Pressable>
        </View>

        {range === 'custom' ? (
          <View style={styles.customBox}>
            <View style={styles.customFields}>
              <View style={styles.customField}>
                <Text style={styles.customLabel}>From</Text>
                <TextInput
                  style={styles.customInput}
                  value={customFrom}
                  onChangeText={setCustomFrom}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <View style={styles.customField}>
                <Text style={styles.customLabel}>To</Text>
                <TextInput
                  style={styles.customInput}
                  value={customTo}
                  onChangeText={setCustomTo}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <Pressable onPress={applyCustom} style={styles.applyBtn} accessibilityRole="button">
                <Text style={styles.applyBtnText}>Apply</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.heroStats}>
          {loading && !stats ? (
            <ActivityIndicator color={colors.white} style={{ marginVertical: 12 }} />
          ) : stats ? (
            <>
              <Text style={styles.revenueEyebrow}>Revenue</Text>
              <Text style={styles.revenueValue}>{formatRupees(stats.revenue)}</Text>
              <Text style={styles.revenueMeta}>
                {stats.carsWashed} car{stats.carsWashed === 1 ? '' : 's'} washed
                {stats.from && stats.to ? `  ·  ${stats.from} → ${stats.to}` : ''}
              </Text>
            </>
          ) : (
            <Text style={styles.revenueMeta}>
              {range === 'custom' && !appliedCustom
                ? 'Set From / To, then tap Apply'
                : forbidden
                  ? 'Owner access only'
                  : '—'}
            </Text>
          )}
        </View>
      </LinearGradient>

      {/* Period picker sheet */}
      <Modal visible={periodOpen} transparent animationType="fade" onRequestClose={() => setPeriodOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setPeriodOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Choose period</Text>
            {PERIODS.map((p) => {
              const on = range === p.key;
              return (
                <Pressable
                  key={p.key}
                  onPress={() => selectPeriod(p.key)}
                  style={[styles.sheetRow, on && styles.sheetRowOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <View style={styles.sheetRowCopy}>
                    <Text style={[styles.sheetRowLabel, on && styles.sheetRowLabelOn]}>{p.label}</Text>
                    <Text style={styles.sheetRowHint}>{p.hint}</Text>
                  </View>
                  {on ? <Text style={styles.sheetCheck}>✓</Text> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
          <Pressable onPress={() => void load()} hitSlop={8}>
            <Text style={styles.errorRetry}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {forbidden ? (
        <View style={styles.centerFill}>
          <Text style={styles.errorTitle}>Owner only</Text>
          <Text style={styles.errorBody}>Reports are only visible to the account owner.</Text>
        </View>
      ) : stats ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionLabel}>Profit</Text>
          <View style={styles.list}>
            <StatRow label="Revenue" hint="Money collected from paid washes" value={formatRupees(stats.revenue)} />
            <Pressable
              onPress={() => navigation.navigate('Expenses')}
              android_ripple={{ color: colors.waterPale }}
              accessibilityRole="button"
              accessibilityLabel="Open expenses"
            >
              <StatRow label="Expenses" hint="Tap to see every entry" value={`- ${formatRupees(stats.expenses)}`} />
            </Pressable>
            <View style={[styles.statRow, styles.netRow]}>
              <View style={styles.statCopy}>
                <Text style={styles.netLabel}>Net</Text>
                <Text style={styles.statHint}>Revenue minus expenses</Text>
              </View>
              <Text style={[styles.netValue, stats.net < 0 && styles.netNegative]}>{formatRupees(stats.net)}</Text>
            </View>
          </View>
          {stats.discounts > 0 ? (
            <Text style={styles.discountNote}>Includes {formatRupees(stats.discounts)} given as discounts.</Text>
          ) : null}

          {/* Snapshot — clear labels, no jargon */}
          <Text style={styles.sectionLabel}>Snapshot</Text>
          <View style={styles.list}>
            <StatRow
              label="Cars at the bay now"
              hint="Waiting, washing, or ready — not paid yet"
              value={String(stats.pendingNow)}
            />
            <StatRow label="Cars washed" hint="In this period" value={String(stats.carsWashed)} />
            <StatRow label="New customers" hint="First visit in this period" value={String(stats.newCustomers)} />
            <StatRow
              label="Repeat customers"
              hint="Had washed with you before"
              value={String(stats.repeatCustomers)}
              last
            />
          </View>

          <View style={styles.list}>
            <StatRow
              label="Average per car"
              value={stats.carsWashed > 0 ? formatRupees(avgTicket) : '—'}
              last={stats.voided === 0}
            />
            {stats.voided > 0 ? (
              <StatRow label="Voided jobs" value={String(stats.voided)} last />
            ) : null}
          </View>

          <Text style={styles.sectionLabel}>How money came in</Text>
          {stats.revenue === 0 ? (
            <Text style={styles.emptyInline}>No payments collected in this period.</Text>
          ) : (
            <View style={styles.payBlock}>
              <PayLine label="Cash" amount={stats.cash} total={stats.revenue} color={colors.teal} />
              <PayLine label="UPI" amount={stats.upi} total={stats.revenue} color={colors.water} />
              {stats.other > 0 ? (
                <PayLine label="Other" amount={stats.other} total={stats.revenue} color={colors.slate} />
              ) : null}
            </View>
          )}

          <Pressable
            onPress={() => void onExport()}
            disabled={exporting}
            style={({ pressed }) => [styles.exportFull, pressed && styles.pressed]}
          >
            {exporting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <>
                <IconDownload size={18} color={colors.white} />
                <Text style={styles.exportFullLabel}>Export PDF</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.exportHint}>
            Summary, payment split, and every job in the selected period.
          </Text>
        </ScrollView>
      ) : loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.water} size="large" />
        </View>
      ) : (
        <View style={styles.centerFill}>
          <Text style={styles.errorBody}>
            {range === 'custom' ? 'Apply a date range to see numbers.' : 'No data yet.'}
          </Text>
        </View>
      )}
    </ScreenContainer>
  );
}

function StatRow({
  label,
  hint,
  value,
  last,
}: {
  label: string;
  hint?: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.statRow, !last && styles.rowDivider]}>
      <View style={styles.statCopy}>
        <Text style={styles.statLabel}>{label}</Text>
        {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
      </View>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function PayLine({
  label,
  amount,
  total,
  color,
}: {
  label: string;
  amount: number;
  total: number;
  color: string;
}) {
  const widthPct = total > 0 ? Math.max(3, (amount / total) * 100) : 0;
  return (
    <View style={styles.payLine}>
      <View style={styles.payHeader}>
        <Text style={styles.payLabel}>{label}</Text>
        <Text style={styles.payMeta}>
          {formatRupees(amount)} · {pct(amount, total)}%
        </Text>
      </View>
      <View style={styles.payTrack}>
        <View style={[styles.payFill, { width: `${widthPct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  netRow: { backgroundColor: colors.surface },
  netLabel: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 17 },
  netValue: { ...typography.heading, color: colors.teal, fontSize: 22 },
  netNegative: { color: colors.danger },
  discountNote: {
    ...typography.caption,
    color: colors.slate,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    letterSpacing: 0,
  },
  hero: {
    paddingBottom: spacing.md,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: { flex: 1, gap: 1 },
  heroEyebrow: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 1.6,
    fontSize: 10,
  },
  heroTitle: {
    ...typography.heading,
    color: colors.white,
    fontSize: 22,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(8,47,73,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  exportBtnDisabled: { opacity: 0.45 },
  exportLabel: {
    ...typography.label,
    color: colors.white,
    fontSize: 12,
  },
  controlPad: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    gap: 6,
  },
  controlLabel: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 0.4,
    fontSize: 11,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  dropdownCopy: {
    flex: 1,
    gap: 2,
  },
  dropdownValue: {
    ...typography.bodyStrong,
    color: colors.white,
    fontSize: 16,
  },
  dropdownHint: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
  },
  customBox: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  customFields: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  customField: {
    flex: 1,
    gap: 4,
  },
  customLabel: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.75)',
    fontSize: 10,
  },
  customInput: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  applyBtn: {
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  applyBtnText: {
    ...typography.label,
    color: colors.waterInk,
    fontSize: 13,
  },
  heroStats: {
    paddingHorizontal: spacing.md,
    minHeight: 72,
    justifyContent: 'center',
  },
  revenueEyebrow: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.75)',
    marginBottom: 2,
  },
  revenueValue: {
    ...typography.display,
    color: colors.white,
    fontSize: 34,
    letterSpacing: -0.8,
  },
  revenueMeta: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 4,
    fontSize: 12,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(8,47,73,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
    ...shadow('lg'),
  },
  sheetTitle: {
    ...typography.heading,
    color: colors.waterInk,
    marginBottom: spacing.sm,
    fontSize: 18,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  sheetRowOn: {
    backgroundColor: colors.waterPale,
    marginHorizontal: -spacing.md,
    paddingHorizontal: spacing.md,
  },
  sheetRowCopy: {
    flex: 1,
    gap: 2,
  },
  sheetRowLabel: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 16,
  },
  sheetRowLabelOn: {
    color: colors.waterDeep,
  },
  sheetRowHint: {
    ...typography.caption,
    color: colors.slateDeep,
  },
  sheetCheck: {
    ...typography.heading,
    color: colors.water,
    fontSize: 18,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#FECACA',
    gap: spacing.sm,
  },
  errorBannerText: {
    ...typography.caption,
    color: colors.danger,
    flex: 1,
  },
  errorRetry: {
    ...typography.label,
    color: colors.danger,
  },
  body: {
    paddingBottom: spacing.xl,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.slateDeep,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    fontSize: 11,
  },
  list: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    gap: spacing.md,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  statCopy: {
    flex: 1,
    gap: 2,
  },
  statLabel: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 15,
  },
  statHint: {
    ...typography.caption,
    color: colors.slate,
    fontSize: 11,
  },
  statValue: {
    ...typography.heading,
    color: colors.waterDeep,
    fontSize: 20,
  },
  emptyInline: {
    ...typography.body,
    color: colors.slateDeep,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  payBlock: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  payLine: { gap: 6 },
  payHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  payLabel: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 14,
  },
  payMeta: {
    ...typography.caption,
    color: colors.slateDeep,
  },
  payTrack: {
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  payFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  exportFull: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.md,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.waterDeep,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  exportFullLabel: {
    ...typography.bodyStrong,
    color: colors.white,
    fontSize: 15,
  },
  exportHint: {
    ...typography.caption,
    color: colors.slate,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
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
  pressed: { opacity: 0.85 },
});
