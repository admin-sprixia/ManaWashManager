import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  IconAlert,
  Notice,
  colors,
  spacing,
  typography,
} from '@mana/ui';
import { EdgeGroup, EdgePanel, EdgeRow, SectionLabel } from '../components/CardList';
import { ScreenHeader } from '../components/ScreenHeader';
import { api, send } from '../api/client';
import { useAccount } from '../auth/AuthProvider';
import { useBranches } from '../branches/BranchesProvider';
import { BranchCard } from '../components/BranchCard';
import { ProblemSummary } from '../components/ProblemSummary';
import { useRemote } from '../hooks/useRemote';
import type { MainStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<MainStackParams, 'Help'>;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** Reach the branch, report a problem, and follow up on earlier reports. */
export function HelpScreen({ navigation }: Props) {
  const account = useAccount();
  const { byId } = useBranches();
  const problems = useRemote(() => send(api.problems.$get()));
  const now = new Date();
  const mine = account.branches.map((b) => byId(b.id)).filter((b) => b != null);
  const list = problems.data?.problems ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScreenHeader title="Help & support" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={problems.refreshing} onRefresh={() => void problems.reload()} />}
      >
        {mine.map((b) => (
          <View key={b.id}>
            <SectionLabel>{mine.length > 1 ? (b.city ?? b.name) : 'Talk to your branch'}</SectionLabel>
            <BranchCard branch={b} now={now} />
          </View>
        ))}

        <SectionLabel>Something not right?</SectionLabel>
        <EdgeGroup>
          <EdgeRow
            icon={<IconAlert size={18} color={colors.amberDeep} />}
            iconBg={colors.amberPale}
            title="Report a problem"
            subtitle="About a bill, the staff or anything else"
            onPress={() => navigation.navigate('ReportProblem')}
          />
        </EdgeGroup>
        <Text style={styles.hint}>About a particular wash? Open it from Washes and report from there.</Text>

        <SectionLabel>Your reports</SectionLabel>
        {problems.loading ? (
          <ActivityIndicator color={colors.water} />
        ) : problems.error && !problems.data ? (
          <View style={styles.pad}>
            <Notice tone="warning">{problems.error}</Notice>
          </View>
        ) : list.length === 0 ? (
          <EdgePanel>
            <Text style={styles.body}>No reports. We hope it stays that way!</Text>
          </EdgePanel>
        ) : (
          <EdgeGroup>
            {list.map((p) => (
              <ProblemSummary
                key={p.id}
                problem={p}
                context={
                  p.wash
                    ? `${p.wash.registrationNumber}, wash of ${shortDate(p.wash.createdAt)}`
                    : account.branches.length > 1
                      ? p.branch.name
                      : undefined
                }
              />
            ))}
          </EdgeGroup>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.md },
  content: { paddingBottom: spacing.xl },
  pad: { paddingHorizontal: spacing.md },
  body: { ...typography.body, color: colors.slateDeep, fontSize: 15, lineHeight: 22 },
  hint: { fontSize: 12.5, color: colors.slate, paddingHorizontal: 20, marginTop: 8 },
});
