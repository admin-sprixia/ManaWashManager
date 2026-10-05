import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  PROBLEM_DETAILS_MAX,
  PROBLEM_DETAILS_MIN,
  PROBLEM_KINDS,
  PROBLEM_KIND_LABELS,
  type ProblemKind,
} from '@mana/domain';
import {
  Button,
  ChoiceChips,
  IconDroplet,
  Notice,
  TextField,
  colors,
  showToast,
  spacing,
  typography,
} from '@mana/ui';
import { EdgeGroup, EdgePanel, EdgeRow, SectionLabel } from '../components/CardList';
import { ScreenHeader } from '../components/ScreenHeader';
import { api, send } from '../api/client';
import { errorMessage } from '../api/errors';
import { useAccount } from '../auth/AuthProvider';
import type { MainStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<MainStackParams, 'ReportProblem'>;

/** Damage and billing make no sense without a wash; everything else can be about the branch. */
const GENERAL_KINDS: readonly ProblemKind[] = ['staff', 'billing', 'other'];

type Errors = Partial<Record<'kind' | 'branch' | 'details', string>>;

/** Tell the branch something went wrong — about one wash, or in general. The team replies in the app. */
export function ReportProblemScreen({ navigation, route }: Props) {
  const washId = route.params?.washId;
  const account = useAccount();
  const kinds = washId ? PROBLEM_KINDS : GENERAL_KINDS;

  const [kind, setKind] = useState<ProblemKind | null>(null);
  const [branchId, setBranchId] = useState<string | null>(account.branches.length === 1 ? account.branches[0]!.id : null);
  const [details, setDetails] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const askBranch = !washId && account.branches.length > 1;

  const submit = async () => {
    const next: Errors = {};
    if (!kind) next.kind = 'Pick what it’s about';
    if (askBranch && !branchId) next.branch = 'Pick the branch';
    if (details.trim().length < PROBLEM_DETAILS_MIN) next.details = 'Tell us a little more, so the team can help';
    setErrors(next);
    if (Object.keys(next).length > 0 || !kind) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      await send(
        api.problems.$post({
          json: { washId: washId ?? null, branchId: washId ? null : branchId, kind, details: details.trim() },
        }),
      );
      showToast('Sent. The team will look into it.', 'success');
      navigation.goBack();
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScreenHeader title="Report a problem" onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {route.params?.label ? (
            <>
              <SectionLabel>About this wash</SectionLabel>
              <EdgeGroup>
                <EdgeRow
                  icon={<IconDroplet size={18} color={colors.waterDeep} />}
                  title={route.params.label}
                />
              </EdgeGroup>
            </>
          ) : null}
          <SectionLabel>Your report</SectionLabel>
          <EdgePanel style={styles.section}>
            <ChoiceChips
              label="What’s it about?"
              options={kinds.map((value) => ({ value, label: PROBLEM_KIND_LABELS[value] }))}
              value={kind}
              onChange={(v) => {
                setKind(v);
                setErrors((e) => ({ ...e, kind: undefined }));
              }}
              error={errors.kind}
            />
            {askBranch ? (
              <ChoiceChips
                label="Which branch?"
                options={account.branches.map((b) => ({ value: b.id, label: b.city ? `${b.name}, ${b.city}` : b.name }))}
                value={branchId}
                onChange={(v) => {
                  setBranchId(v);
                  setErrors((e) => ({ ...e, branch: undefined }));
                }}
                error={errors.branch}
              />
            ) : null}
            <TextField
              label="What happened?"
              placeholder="A few words help the team sort it quickly"
              value={details}
              onChangeText={(t) => {
                setDetails(t);
                if (errors.details) setErrors((e) => ({ ...e, details: undefined }));
              }}
              multiline
              maxLength={PROBLEM_DETAILS_MAX}
              error={errors.details}
              hint={`${details.trim().length}/${PROBLEM_DETAILS_MAX}`}
            />
          </EdgePanel>
          <View style={styles.actions}>
            {submitError ? <Notice tone="danger">{submitError}</Notice> : null}
            <Button label="Send to the team" size="lg" loading={submitting} onPress={() => void submit()} />
            <Text style={styles.footnote}>
              The branch team sees this with your name and number, and replies here. For anything urgent, please call
              the branch.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  header: { paddingHorizontal: spacing.md },
  scroll: { paddingBottom: spacing.xl },
  section: { gap: spacing.md },
  actions: { padding: spacing.md, gap: spacing.md },
  footnote: { ...typography.caption, color: colors.slate, letterSpacing: 0, textAlign: 'center', lineHeight: 17 },
});
