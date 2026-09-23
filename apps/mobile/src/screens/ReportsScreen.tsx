import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { ScreenHeader } from '../components/ScreenHeader';
import { Card } from '../components/Card';
import { colors, radius, spacing, typography } from '../theme';
import { api } from '../api/client';
import { formatRupees } from '../utils/format';
import type { RootStackParamList } from '../navigation/RootNavigator';

type ReportsScreenProps = NativeStackScreenProps<RootStackParamList, 'Reports'>;

type Range = 'today' | 'week';

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
}

const RANGE_LABEL: Record<Range, string> = { today: 'Today', week: 'Last 7 days' };

function PaymentBar({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
  return (
    <View style={styles.paymentRow}>
      <View style={styles.paymentHeader}>
        <Text style={styles.paymentLabel}>{label}</Text>
        <Text style={styles.paymentAmount}>{formatRupees(amount)}</Text>
      </View>
      <View style={styles.paymentTrack}>
        <View style={[styles.paymentFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export function ReportsScreen({ navigation }: ReportsScreenProps) {
  const [range, setRange] = useState<Range>('today');
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async (r: Range) => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await api.jobs.stats.$get({ query: { range: r } });
      if (res.status === 403) {
        setForbidden(true);
        setStats(null);
        return;
      }
      if (!res.ok) throw new Error(`Could not load reports (${res.status}).`);
      const json = await res.json();
      setStats(json);
    } catch (e) {
      setStats(null);
      setError(e instanceof Error ? e.message : 'Could not reach the API. Is it running on localhost:8787?');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(range);
    }, [range, load]),
  );

  return (
    <ScreenContainer>
      <ScreenHeader title="Reports" onBack={() => navigation.goBack()} />

      <View style={styles.toggleRow}>
        {(['today', 'week'] as const).map((r) => {
          const on = range === r;
          return (
            <Pressable
              key={r}
              onPress={() => setRange(r)}
              style={[styles.toggleChip, on && styles.toggleChipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.toggleChipText, on && styles.toggleChipTextOn]}>{RANGE_LABEL[r]}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {forbidden ? (
          <View style={styles.centerFill}>
            <Text style={styles.errorTitle}>Owner only</Text>
            <Text style={styles.errorBody}>Reports are only visible to the account owner.</Text>
          </View>
        ) : loading && !stats ? (
          <View style={styles.centerFill}>
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        ) : error ? (
          <View style={styles.centerFill}>
            <Text style={styles.errorTitle}>Couldn’t load reports</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Pressable onPress={() => void load(range)} style={styles.retryBtn} accessibilityRole="button">
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          </View>
        ) : stats ? (
          <>
            <Card elevation="md" style={styles.revenueCard}>
              <Text style={styles.revenueLabel}>Revenue — {RANGE_LABEL[range]}</Text>
              <Text style={styles.revenueValue}>{formatRupees(stats.revenue)}</Text>
              <Text style={styles.revenueMeta}>
                {stats.carsWashed} car{stats.carsWashed === 1 ? '' : 's'}
                {stats.voided > 0 ? ` · ${stats.voided} voided` : ''}
              </Text>
            </Card>

            <View style={styles.statGrid}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{stats.pendingNow}</Text>
                <Text style={styles.statLabel}>In the shop now</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{stats.newCustomers}</Text>
                <Text style={styles.statLabel}>New customers</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{stats.repeatCustomers}</Text>
                <Text style={styles.statLabel}>Repeat customers</Text>
              </View>
            </View>

            <Text style={styles.sectionLabel}>Payment split</Text>
            {stats.revenue === 0 ? (
              <Text style={styles.emptyText}>No payments collected {RANGE_LABEL[range].toLowerCase()} yet.</Text>
            ) : (
              <Card elevation="sm" style={styles.paymentCard}>
                <PaymentBar label="Cash" amount={stats.cash} total={stats.revenue} color={colors.teal} />
                <PaymentBar label="UPI" amount={stats.upi} total={stats.revenue} color={colors.water} />
                {stats.other > 0 ? (
                  <PaymentBar label="Other" amount={stats.other} total={stats.revenue} color={colors.slate} />
                ) : null}
              </Card>
            )}
            <View style={styles.bottomPad} />
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  toggleChip: {
    flex: 1,
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: spacing.sm,
  },
  toggleChipOn: {
    backgroundColor: colors.waterInk,
    borderColor: colors.waterInk,
  },
  toggleChipText: {
    ...typography.label,
    color: colors.waterDeep,
    textTransform: 'none',
  },
  toggleChipTextOn: {
    color: colors.white,
  },
  content: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
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
  revenueCard: {
    alignItems: 'flex-start',
    gap: 2,
  },
  revenueLabel: {
    ...typography.label,
    color: colors.slateDeep,
    textTransform: 'none',
  },
  revenueValue: {
    ...typography.display,
    color: colors.waterInk,
    fontSize: 36,
  },
  revenueMeta: {
    ...typography.body,
    color: colors.slateDeep,
  },
  statGrid: {
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
    fontSize: 20,
  },
  statLabel: {
    ...typography.caption,
    color: colors.slateDeep,
    textAlign: 'center',
  },
  sectionLabel: {
    ...typography.label,
    color: colors.slateDeep,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  emptyText: {
    ...typography.body,
    color: colors.slateDeep,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  paymentCard: {
    gap: spacing.md,
  },
  paymentRow: {
    gap: spacing.xs,
  },
  paymentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  paymentLabel: {
    ...typography.bodyStrong,
    color: colors.waterInk,
  },
  paymentAmount: {
    ...typography.bodyStrong,
    color: colors.waterDeep,
  },
  paymentTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  paymentFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  bottomPad: {
    height: spacing.lg,
  },
});
