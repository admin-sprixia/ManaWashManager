import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  VEHICLE_MAKE_MAX,
  isValidRegistration,
  normalizeRegistration,
  vehicleMakeNames,
  vehicleModelNames,
} from '@mana/domain';
import { Button, ChoiceChips, MakeLogo, Notice, TextField, colors, showToast, spacing, suggestedTypeId } from '@mana/ui';
import { EdgePanel, SectionLabel } from '../components/CardList';
import { ScreenHeader } from '../components/ScreenHeader';
import { SearchSelect } from '../components/SearchSelect';
import { VehicleTypePicker } from '../components/VehicleTypePicker';
import { api, send } from '../api/client';
import { errorMessage } from '../api/errors';
import { useAccount } from '../auth/AuthProvider';
import { useBranches } from '../branches/BranchesProvider';
import { usePageStyle } from '../layout/Layout';
import type { MainStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<MainStackParams, 'AddVehicle'>;

type Errors = Partial<Record<'branch' | 'type' | 'plate' | 'make' | 'model', string>>;

/** Ask the branch to add a car or bike to this number. The team checks it before it shows. */
export function AddVehicleScreen({ navigation }: Props) {
  const pageStyle = usePageStyle();
  const account = useAccount();
  const { byId, vehicleModels, loading: branchesLoading, error: branchesError, reload } = useBranches();

  const [branchId, setBranchId] = useState<string | null>(
    account.branches.length === 1 ? account.branches[0]!.id : null,
  );
  const [typeId, setTypeId] = useState<string | null>(null);
  /** The type was picked from the make and model, not by the customer. */
  const [typeFromModel, setTypeFromModel] = useState(false);
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const branch = branchId ? byId(branchId) : undefined;
  const types = branch?.vehicleTypes ?? [];
  const makes = useMemo(() => vehicleMakeNames(null, vehicleModels), [vehicleModels]);
  const models = useMemo(() => vehicleModelNames(make, null, vehicleModels), [make, vehicleModels]);

  /** Picks the type that suits the make and model; a type the customer chose stays unless this one fits. */
  const applySuggestion = (
    branchTypes: readonly { id: string; name: string; bodyKey?: string | null }[],
    nextMake: string,
    nextModel: string,
  ) => {
    const suggested = nextModel ? suggestedTypeId(branchTypes, nextMake, nextModel, vehicleModels) : null;
    if (suggested) {
      setTypeId(suggested);
      setTypeFromModel(true);
      setErrors((e) => ({ ...e, type: undefined }));
    } else if (typeFromModel) {
      setTypeId(null);
      setTypeFromModel(false);
    }
  };

  const submit = async () => {
    const registrationNumber = normalizeRegistration(plate);
    const next: Errors = {};
    if (!branchId) next.branch = 'Pick the branch';
    if (!typeId) next.type = 'Pick the vehicle type';
    if (!isValidRegistration(registrationNumber))
      next.plate = 'Enter the registration number, e.g. AP39AB1234';
    if (!make.trim()) next.make = 'Pick the make';
    if (!model.trim()) next.model = 'Pick the model';
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
            make: make.trim(),
            model: model.trim(),
          },
        }),
      );
      showToast(
        body.status === 'restored'
          ? `${registrationNumber} is back in your list`
          : 'Sent. The team will confirm it.',
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, pageStyle]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.intro}>
            The team checks the number before it shows here, usually on your next visit or call.
          </Text>
          <SectionLabel>Vehicle</SectionLabel>
          <EdgePanel style={styles.section}>
            {account.branches.length > 1 ? (
              <ChoiceChips
                label="Branch you visit"
                required
                options={account.branches.map((b) => ({
                  value: b.id,
                  label: b.city ? `${b.name}, ${b.city}` : b.name,
                }))}
                value={branchId}
                onChange={(v) => {
                  setBranchId(v);
                  setTypeId(null);
                  setTypeFromModel(false);
                  setErrors((e) => ({ ...e, branch: undefined }));
                  const nextTypes = byId(v)?.vehicleTypes ?? [];
                  const suggested = model ? suggestedTypeId(nextTypes, make, model, vehicleModels) : null;
                  if (suggested) {
                    setTypeId(suggested);
                    setTypeFromModel(true);
                  }
                }}
                error={errors.branch}
              />
            ) : null}
            <SearchSelect
              label="Make"
              required
              noun="make"
              renderIcon={(m) => <MakeLogo make={m} />}
              placeholder="Maruti Suzuki, Honda…"
              options={makes}
              value={make}
              onChange={(v) => {
                if (v !== make) {
                  setModel('');
                  applySuggestion(types, v, '');
                }
                setMake(v);
                setErrors((e) => ({ ...e, make: undefined }));
              }}
              maxLength={VEHICLE_MAKE_MAX}
              error={errors.make}
            />
            <SearchSelect
              label="Model"
              required
              noun="model"
              placeholder={make ? `${make} model` : 'Swift, Activa…'}
              options={models}
              value={model}
              onChange={(v) => {
                setModel(v);
                setErrors((e) => ({ ...e, model: undefined }));
                applySuggestion(types, make, v);
              }}
              disabledHint={make ? undefined : 'Pick the make first'}
              maxLength={VEHICLE_MAKE_MAX}
              error={make ? errors.model : undefined}
            />
            {branchId && !branch ? (
              branchesLoading ? (
                <ActivityIndicator color={colors.water} />
              ) : (
                <Notice tone="warning">
                  {branchesError ?? 'Couldn’t load the vehicle types.'}
                </Notice>
              )
            ) : branch ? (
              <VehicleTypePicker
                label="Type"
                required
                types={types}
                value={typeId}
                onChange={(v) => {
                  setTypeId(v);
                  setTypeFromModel(false);
                  setErrors((e) => ({ ...e, type: undefined }));
                }}
                hint={
                  typeFromModel && typeId
                    ? `Picked from the ${model}. Tap another if it’s wrong.`
                    : undefined
                }
                error={errors.type}
              />
            ) : null}
            <TextField
              label="Registration number"
              required
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
          </EdgePanel>
          <View style={styles.actions}>
            {submitError ? <Notice tone="danger">{submitError}</Notice> : null}
            {branchId && !branch && !branchesLoading ? (
              <Button label="Try again" variant="secondary" onPress={() => void reload()} />
            ) : (
              <Button
                label="Send to the team"
                size="lg"
                loading={submitting}
                onPress={() => void submit()}
              />
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
  intro: {
    color: colors.slateDeep,
    fontSize: 14.5,
    lineHeight: 21,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  section: { gap: spacing.md },
  actions: { padding: spacing.md, gap: spacing.md },
});
