import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { EXPENSE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL, type ExpenseCategory, type PaymentMethod } from '@mana/domain';
import { ScreenContainer } from '../components/ScreenContainer';
import { ScreenHeader } from '../components/ScreenHeader';
import { Avatar } from '../components/Avatar';
import { PeriodSelect, type PeriodKey } from '../components/PeriodSelect';
import { SectionLabel } from '../components/EdgeList';
import { Button } from '../components/Button';
import { IconBan, IconChevronRight, IconEdit, IconReceipt, IconShield } from '../components/Icons';
import { colors, radius, shadow, spacing, typography } from '../theme';
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
  job_void: { label: 'Job voided', Icon: IconBan, fg: colors.danger, bg: '#FEE2E2' },
  payment_change: { label: 'Payment corrected', Icon: IconEdit, fg: colors.amberDeep, bg: '#FEF3C7' },
  expense_void: { label: 'Expense voided', Icon: IconReceipt, fg: '#9D174D', bg: '#FCE7F3' },
} as const;

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
      washes: t.washes + r.washesStarted,
      flags: t.flags + r.voids + r.corrections,
    }),
    { collected: 0, washes: 0, flags: 0 },
  );
  const best = rows.length > 0 && rows[0]!.collected > 0 ? rows[0]! : null;

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Staff report" onBack={() => navigation.goBack()} />
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {(
          [
            { key: 'performance', label: 'Performance' },
            { key: 'audit', label: `Corrections${audit.length ? ` · ${audit.length}` : ''}` },
          ] as const
        ).map((t) => {
          const on = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tab, on && styles.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.water}
            colors={[colors.water]}
          />
        }
      >
        <View style={styles.periodWrap}>
          <PeriodSelect value={period} onChange={setPeriod} />
        </View>

        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.water} />
        ) : error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : tab === 'performance' ? (
          <>
            <View style={styles.summary}>
              <View style={styles.summaryCell}>
                <Text style={styles.summaryValue}>{formatRupees(totals.collected)}</Text>
                <Text style={styles.summaryLabel}>Collected</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryCell}>
                <Text style={styles.summaryValue}>{totals.washes}</Text>
                <Text style={styles.summaryLabel}>Washes</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryCell}>
                <Text style={[styles.summaryValue, totals.flags > 0 && styles.flagValue]}>{totals.flags}</Text>
                <Text style={styles.summaryLabel}>Voids & fixes</Text>
              </View>
            </View>

            <SectionLabel>By person</SectionLabel>
            {rows.length === 0 ? (
              <Text style={styles.empty}>No activity in this period yet.</Text>
            ) : (
              <View style={styles.list}>
                {rows.map((r, i) => {
                  const total = r.cash + r.upi + r.other;
                  const flags = r.voids + r.corrections;
                  return (
                    <View key={r.userId} style={[styles.person, i < rows.length - 1 && styles.divider]}>
                      <View style={styles.personTop}>
                        <Avatar name={r.name} id={r.userId} size={40} muted={!r.active} />
                        <View style={styles.personCopy}>
                          <Text style={styles.personName} numberOfLines={1}>
                            {r.name}
                            {best?.userId === r.userId && rows.length > 1 ? '  ★' : ''}
                          </Text>
                          <Text style={styles.personMeta}>
                            {r.role === 'owner' ? 'Owner' : 'Staff'}
                            {!r.active ? ' · turned off' : ''}
                          </Text>
                        </View>
                        <View style={styles.personRight}>
                          <Text style={styles.personAmount}>{formatRupees(r.collected)}</Text>
                          <Text style={styles.personMeta}>collected</Text>
                        </View>
                      </View>

                      {total > 0 ? (
                        <View style={styles.bar}>
                          {r.cash > 0 ? <View style={[styles.barSeg, { flex: r.cash, backgroundColor: colors.teal }]} /> : null}
                          {r.upi > 0 ? <View style={[styles.barSeg, { flex: r.upi, backgroundColor: colors.water }]} /> : null}
                          {r.other > 0 ? <View style={[styles.barSeg, { flex: r.other, backgroundColor: colors.slate }]} /> : null}
                        </View>
                      ) : null}

                      <View style={styles.statsLine}>
                        <Text style={styles.stat}>
                          <Text style={styles.statStrong}>{r.washesStarted}</Text> started
                        </Text>
                        <Text style={styles.stat}>
                          <Text style={styles.statStrong}>{r.jobsCollected}</Text> paid
                        </Text>
                        {total > 0 ? (
                          <Text style={styles.stat}>
                            <Text style={[styles.statStrong, { color: colors.teal }]}>{formatRupees(r.cash)}</Text> cash ·{' '}
                            <Text style={[styles.statStrong, { color: colors.waterDeep }]}>{formatRupees(r.upi)}</Text> UPI
                          </Text>
                        ) : null}
                      </View>
                      {flags > 0 ? (
                        <Pressable onPress={() => setTab('audit')} style={styles.flagLine}>
                          <Text style={styles.flagText}>
                            {r.voids > 0 ? `${r.voids} void${r.voids === 1 ? '' : 's'}` : ''}
                            {r.voids > 0 && r.corrections > 0 ? ' · ' : ''}
                            {r.corrections > 0 ? `${r.corrections} payment fix${r.corrections === 1 ? '' : 'es'}` : ''}
                          </Text>
                          <Text style={styles.flagLink}>See why</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
            <Text style={styles.footnote}>
              “Started” counts washes each person created; “collected” is money they marked paid, for washes started in
              this period. Use it to reconcile each person’s cash at the end of a shift.
            </Text>
          </>
        ) : audit.length === 0 ? (
          <View style={styles.cleanBox}>
            <View style={styles.cleanIcon}>
              <IconShield size={28} color={colors.teal} />
            </View>
            <Text style={styles.cleanTitle}>Clean books</Text>
            <Text style={styles.cleanBody}>No voids or payment corrections in this period.</Text>
          </View>
        ) : (
          <>
            <SectionLabel>Every void and correction</SectionLabel>
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
                        <Text style={styles.auditChange}>
                          {methodLabel(a.fromValue)} → {methodLabel(a.toValue)}
                        </Text>
                      ) : null}
                      {a.reason ? <Text style={styles.auditReason}>“{a.reason}”</Text> : null}
                      <Text style={styles.auditBy}>
                        {a.by.name} · {formatDateTime(a.at)}
                      </Text>
                    </View>
                    {a.jobId ? <IconChevronRight size={16} /> : null}
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
  scroll: { paddingBottom: spacing.xxl },
  pressed: { backgroundColor: colors.surface },
  loader: { marginTop: spacing.xxl },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.waterPale,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm + 2, borderRadius: radius.sm },
  tabOn: { backgroundColor: colors.white, ...shadow('sm') },
  tabText: { ...typography.label, color: colors.slateDeep, fontSize: 14 },
  tabTextOn: { color: colors.waterDeep },
  periodWrap: { marginTop: spacing.md },
  errorBox: { padding: spacing.lg, gap: spacing.md, alignItems: 'center' },
  errorText: { ...typography.body, color: colors.slateDeep, textAlign: 'center' },
  summary: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
  },
  summaryCell: { flex: 1, alignItems: 'center', gap: 2 },
  summaryDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  summaryValue: { ...typography.heading, color: colors.waterInk, fontSize: 20 },
  flagValue: { color: colors.amberDeep },
  summaryLabel: { ...typography.caption, color: colors.slate, textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.6 },
  list: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  empty: { ...typography.body, color: colors.slateDeep, textAlign: 'center', padding: spacing.lg },
  person: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.sm },
  personTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 4 },
  personCopy: { flex: 1, gap: 1 },
  personName: { ...typography.bodyStrong, color: colors.waterInk },
  personMeta: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
  personRight: { alignItems: 'flex-end' },
  personAmount: { ...typography.heading, color: colors.waterDeep, fontSize: 18 },
  bar: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.surface, gap: 2 },
  barSeg: { height: 6 },
  statsLine: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 2 },
  stat: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0, fontSize: 13 },
  statStrong: { fontWeight: '700', color: colors.waterInk },
  flagLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
  },
  flagText: { ...typography.caption, color: colors.amberDeep, fontWeight: '700', letterSpacing: 0 },
  flagLink: { ...typography.caption, color: colors.amberDeep, textDecorationLine: 'underline', letterSpacing: 0 },
  footnote: {
    ...typography.caption,
    color: colors.slate,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    letterSpacing: 0,
    lineHeight: 18,
  },
  cleanBox: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm, marginTop: spacing.lg },
  cleanIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cleanTitle: { ...typography.heading, color: colors.waterInk },
  cleanBody: { ...typography.body, color: colors.slateDeep, textAlign: 'center' },
  auditRow: { flexDirection: 'row', gap: spacing.sm + 4, paddingHorizontal: spacing.md, paddingVertical: spacing.md, alignItems: 'center' },
  auditIcon: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  auditBody: { flex: 1, gap: 3 },
  auditTop: { flexDirection: 'row', justifyContent: 'space-between' },
  auditKind: { ...typography.caption, fontWeight: '700', textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.5 },
  auditAmount: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15 },
  auditTitle: { ...typography.bodyStrong, color: colors.waterInk },
  auditSub: { fontWeight: '400', color: colors.slateDeep },
  auditChange: { ...typography.label, color: colors.amberDeep, textTransform: 'none' },
  auditReason: {
    ...typography.body,
    color: colors.slateDeep,
    fontStyle: 'italic',
    fontSize: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    overflow: 'hidden',
  },
  auditBy: { ...typography.caption, color: colors.slate, letterSpacing: 0 },
});
