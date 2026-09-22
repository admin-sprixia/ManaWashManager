import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { colors, radius, spacing, typography } from '../theme';
import { api } from '../api/client';
import { getSessionUser } from '../api/session';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { canTransition, type JobStatus } from '@mana/domain';

type JobBoardScreenProps = NativeStackScreenProps<RootStackParamList, 'JobBoard'>;

interface JobListItem {
  id: string;
  status: JobStatus;
  total: number;
  customer: { name: string | null; phone: string };
  vehicle: { registrationNumber: string; vehicleType: { name: string } };
}

const STATUS_LABEL: Record<JobStatus, string> = {
  waiting: 'Waiting',
  washing: 'Washing',
  ready: 'Ready',
  paid: 'Paid',
  void: 'Void',
};

const NEXT_STATUS: Partial<Record<JobStatus, JobStatus>> = {
  waiting: 'washing',
  washing: 'ready',
};

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toFixed(0)}`;
}

export function JobBoardScreen({ navigation }: JobBoardScreenProps) {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isOwner, setIsOwner] = useState(false);

  const load = useCallback(async () => {
    const res = await api.jobs.today.$get();
    setJobs(await res.json());
  }, []);

  // Reload every time this screen comes into focus, not just on first mount — otherwise
  // navigating back here after starting a wash still shows the stale (pre-job) list, since
  // the screen was never unmounted, just backgrounded.
  useFocusEffect(
    useCallback(() => {
      void load();
      void getSessionUser().then((user) => setIsOwner(user?.role === 'owner'));
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const advance = async (job: JobListItem) => {
    const next = NEXT_STATUS[job.status];
    if (!next || !canTransition(job.status, next)) return;
    await api.jobs[':id'].status.$patch({ param: { id: job.id }, json: { status: next } });
    await load();
  };

  const markPaid = async (job: JobListItem) => {
    await api.jobs[':id'].pay.$post({ param: { id: job.id }, json: { paymentMethod: 'cash' } });
    await load();
  };

  return (
    <ScreenContainer>
      <Text style={styles.title}>Today</Text>
      <View style={styles.actionRow}>
        <View style={styles.newWashButton}>
          <Button label="+ New Wash" onPress={() => navigation.navigate('NewWash')} />
        </View>
        {isOwner && (
          <View style={styles.settingsButton}>
            <Button label="Settings" variant="secondary" onPress={() => navigation.navigate('Settings')} />
          </View>
        )}
      </View>
      <FlatList
        data={jobs}
        keyExtractor={(job) => job.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.water} />}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.regNumber}>{item.vehicle.registrationNumber}</Text>
              <Text style={styles.status}>{STATUS_LABEL[item.status]}</Text>
            </View>
            <Text style={styles.subtext}>
              {item.customer.name ?? item.customer.phone} · {item.vehicle.vehicleType.name}
            </Text>
            <View style={styles.cardFooter}>
              <Text style={styles.price}>{formatRupees(item.total)}</Text>
              {item.status === 'ready' ? (
                <Text style={styles.action} onPress={() => markPaid(item)} suppressHighlighting>
                  Mark Paid
                </Text>
              ) : NEXT_STATUS[item.status] ? (
                <Text style={styles.action} onPress={() => advance(item)} suppressHighlighting>
                  Move to {STATUS_LABEL[NEXT_STATUS[item.status]!]}
                </Text>
              ) : null}
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No jobs yet today.</Text>}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.waterInk,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  newWashButton: {
    flex: 1,
  },
  settingsButton: {
    width: 140,
  },
  list: {
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.offWhite,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  regNumber: {
    ...typography.heading,
    color: colors.waterInk,
  },
  status: {
    ...typography.label,
    color: colors.water,
  },
  subtext: {
    ...typography.body,
    color: colors.waterInk,
    opacity: 0.7,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  price: {
    ...typography.heading,
    color: colors.waterDeep,
  },
  action: {
    ...typography.label,
    color: colors.white,
    backgroundColor: colors.water,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  empty: {
    ...typography.body,
    color: colors.waterInk,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
