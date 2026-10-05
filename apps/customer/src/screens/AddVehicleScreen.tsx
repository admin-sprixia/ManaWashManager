import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { VEHICLE_MAKE_MAX, isValidRegistration, normalizeRegistration } from '@mana/domain';
import {
  Button,
  ChoiceChips,
  Notice,
  TextField,
  colors,
  showToast,
  spacing,
} from '@mana/ui';
import { EdgePanel, SectionLabel } from '../components/CardList';
import { ScreenHeader } from '../components/ScreenHeader';
import { api, send } from '../api/client';
import { errorMessage } from '../api/errors';
import { useAccount } from '../auth/AuthProvider';
import { useBranches } from '../branches/BranchesProvider';
import type { MainStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<MainStackParams, 'AddVehicle'>;

type Errors = Partial<Record<'branch' | 'type' | 'plate', string>>;

/** Ask the branch to add a car or bike to this number. The team checks it before it shows. */
export function AddVehicleScreen({ navigation }: Props) {
  const account = useAccount();
  const { byId, loading: branchesLoading, error: branchesError, reload } = useBranches();

  const [branchId, setBranchId] = useState<string | null>(account.branches.length === 1 ? account.branches[0]!.id : null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const branch = branchId ? byId(branchId) : undefined;
  const types = branch?.vehicleTypes ?? [];

  const submit = async () => {
    const registrationNumber = normalizeRegistration(plate);
    const next: Errors = {};
    if (!branchId) next.branch = 'Pick the branch';
    if (!typeId) next.type = 'Pick the vehicle type';
    if (!isValidRegistration(registrationNumber)) next.plate = 'Enter the registration number, e.g. AP39AB1234';
    setErrors(next);
    if (Object.keys(next).length > 0 || !branchId || !typeId) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const body = await send(
        api.vehicles.$post({
          json: {
            branchId,
            registrationNumber,
            vehicleTypeId: typeId,
            make: make.trim() || null,
            model: model.trim() || null,
          },
        }),
      );
      showToast(
        body.status === 'restored' ? `${registrationNumber} is back in your list` : 'Sent. The team will confirm it.',
        'success',
      );
      navigation.goBack();
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScreenHeader title="Add a vehicle" onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>
            The team checks the number before it shows here, usually on your next visit or call.
          </Text>
          <SectionLabel>Vehicle</SectionLabel>
          <EdgePanel style={styles.section}>
            {account.branches.length > 1 ? (
              <ChoiceChips
                label="Branch you visit"
                options={account.branches.map((b) => ({ value: b.id, label: b.city ? `${b.name}, ${b.city}` : b.name }))}
                value={branchId}
                onChange={(v) => {
                  setBranchId(v);
                  setTypeId(null);
                  setErrors((e) => ({ ...e, branch: undefined }));
                }}
                error={errors.branch}
              />
            ) : null}
            {branchId && !branch ? (
              branchesLoading ? (
                <ActivityIndicator color={colors.water} />
              ) : (
                <Notice tone="warning">{branchesError ?? 'Couldn’t load the vehicle types.'}</Notice>
              )
            ) : branch ? (
              <ChoiceChips
                label="Type"
                options={types.map((t) => ({ value: t.id, label: t.name }))}
                value={typeId}
                onChange={(v) => {
                  setTypeId(v);
                  setErrors((e) => ({ ...e, type: undefined }));
                }}
                error={errors.type}
              />
            ) : null}
            <TextField
              label="Registration number"
              placeholder="AP39AB1234"
              value={plate}
              onChangeText={(t) => {
                setPlate(t.toUpperCase());
                if (errors.plate) setErrors((e) => ({ ...e, plate: undefined }));
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={20}
              error={errors.plate}
            />
            <TextField
              label="Make"
              optional
              placeholder="Maruti, Honda…"
              value={make}
              onChangeText={setMake}
              autoCapitalize="words"
              maxLength={VEHICLE_MAKE_MAX}
            />
            <TextField
              label="Model"
              optional
              placeholder="Swift, Activa…"
              value={model}
              onChangeText={setModel}
              autoCapitalize="words"
              maxLength={VEHICLE_MAKE_MAX}
            />
          </EdgePanel>
          <View style={styles.actions}>
            {submitError ? <Notice tone="danger">{submitError}</Notice> : null}
            {branchId && !branch && !branchesLoading ? (
              <Button label="Try again" variant="secondary" onPress={() => void reload()} />
            ) : (
              <Button label="Send to the team" size="lg" loading={submitting} onPress={() => void submit()} />
            )}
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
  intro: { color: colors.slateDeep, fontSize: 14.5, lineHeight: 21, paddingHorizontal: 20, paddingTop: 16 },
  section: { gap: spacing.md },
  actions: { padding: spacing.md, gap: spacing.md },
});
