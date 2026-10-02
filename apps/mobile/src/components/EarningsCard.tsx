import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme';
import { api } from '../api/client';
import { useSync } from '../offline/SyncProvider';
import { formatRupees } from '../utils/format';
import { PeriodSelect, type PeriodKey } from './PeriodSelect';

interface Earnings {
  servicesSold: number;
  commission: number;
  attendance: { present: number; half: number; absent: number; daysWorked: number };
}

const OPTIONS: { key: PeriodKey; label: string; hint: string }[] = [
  { key: 'today', label: 'Today', hint: 'Since midnight' },
  { key: 'week', label: 'Last 7 days', hint: 'Rolling week, including today' },
  { key: 'month', label: 'This month', hint: 'From the 1st' },
];

/** A staff member's own numbers: commission from the special services they got customers to take, and days worked. */
export function EarningsCard() {
  const { version } = useSync();
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [data, setData] = useState<Earnings | null>(null);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.shop.me.earnings.$get({ query: { range: period } });
      if (!res.ok) return;
      const body = await res.json();
      if ('commission' in body) setData(body);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [period]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load, version]);

  return (
    <View>
      <PeriodSelect value={period} onChange={setPeriod} options={OPTIONS} menuTitle="Show my numbers for" />
      <View style={styles.cells}>
        {data ? (
          <>
            <View style={styles.cell}>
              <Text style={styles.value}>{formatRupees(data.commission)}</Text>
              <Text style={styles.label}>Commission</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.cell}>
              <Text style={styles.value}>{data.servicesSold}</Text>
              <Text style={styles.label}>Services got</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.cell}>
              <Text style={styles.value}>{data.attendance.daysWorked}</Text>
              <Text style={styles.label}>Days worked</Text>
            </View>
          </>
        ) : offline ? (
          <Text style={styles.offline}>Your numbers load when you’re online.</Text>
        ) : (
          <ActivityIndicator color={colors.water} style={styles.loader} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cells: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    minHeight: 72,
    alignItems: 'center',
  },
  cell: { flex: 1, alignItems: 'center', gap: 2 },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: colors.border },
  value: { ...typography.heading, color: colors.waterInk, fontSize: 20 },
  label: { ...typography.caption, color: colors.slate, textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.6 },
  offline: { ...typography.body, color: colors.slateDeep, flex: 1, textAlign: 'center' },
  loader: { flex: 1 },
});
