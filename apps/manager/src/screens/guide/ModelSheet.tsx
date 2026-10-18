import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheet, Button, ChoiceChips, TextField, colors, showAlert, showToast, spacing, typography } from '@mana/ui';
import { VEHICLE_MAKE_MAX, type VehicleCategory, type VehicleGuideRow } from '@mana/domain';
import { api, apiErrorMessage, type ApiResponse } from '../../api/client';
import { NetworkError } from '../../api/network';

export interface GuideKind {
  key: string;
  name: string;
  sizeKey: string | null;
}

/**
 * Head office adds a model to the list, or changes one: its company, name, or the kind of
 * vehicle it's priced as. A model can be taken off the list, and a changed one put back as it
 * ships with the app.
 */
export function ModelSheet({
  visible,
  category,
  row,
  kinds,
  onClose,
  onSaved,
}: {
  visible: boolean;
  category: VehicleCategory;
  /** The model being changed; null to add one. */
  row: VehicleGuideRow | null;
  kinds: GuideKind[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [bodyKey, setBodyKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setMake(row?.make ?? '');
    setModel(row?.model ?? '');
    setBodyKey(row?.bodyKey ?? null);
    setError(null);
    setBusy(false);
  }, [visible, row]);

  const send = async (call: () => Promise<ApiResponse>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await call();
      if (!res.ok) {
        setError(await apiErrorMessage(res, 'Couldn’t save that.'));
        return;
      }
      showToast(done, 'success');
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof NetworkError ? 'This needs a connection. Check your internet and try again.' : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!make.trim() || !model.trim()) return setError('Enter the company and the model.');
    if (!bodyKey) return setError('Pick the kind of vehicle it is.');
    void send(
      () =>
        api.business['vehicle-models'].$put({
          json: {
            make: make.trim(),
            model: model.trim(),
            category,
            bodyKey,
            ...(row ? { from: { make: row.make, model: row.model } } : {}),
          },
        }),
      row ? `${make.trim()} ${model.trim()} saved · every branch and the app updated` : `${make.trim()} ${model.trim()} added`,
    );
  };

  const remove = () => {
    if (!row) return;
    showAlert(`Take ${row.make} ${row.model} off the list?`, 'Staff and customers won’t see it any more. You can put it back later.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Take it off',
        style: 'destructive',
        onPress: () =>
          void send(
            () => api.business['vehicle-models'].$delete({ json: { make: row.make, model: row.model, category: row.category } }),
            `${row.model} taken off the list`,
          ),
      },
    ]);
  };

  const reset = () => {
    if (!row) return;
    void send(
      () => api.business['vehicle-models'].reset.$post({ json: { make: row.make, model: row.model } }),
      `${row.model} is back as it was`,
    );
  };

  const kind = kinds.find((k) => k.key === bodyKey);
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={row ? `${row.make} ${row.model}` : 'Add a model'}
      subtitle={row ? 'Change its company, name or kind' : `A ${category === 'bike' ? 'two-wheeler' : 'vehicle'} that isn’t on the list yet`}
      footer={
        <View style={styles.footer}>
          <Button label={row ? 'Save' : 'Add model'} size="lg" loading={busy} onPress={save} />
          {row?.change === 'moved' ? <Button label="Put it back as it was" variant="ghost" disabled={busy} onPress={reset} /> : null}
          {row ? <Button label="Take it off the list" variant="ghost" disabled={busy} onPress={remove} /> : null}
        </View>
      }
    >
      <View style={styles.form}>
        <TextField label="Company" value={make} onChangeText={setMake} placeholder="Maruti Suzuki" maxLength={VEHICLE_MAKE_MAX} autoCapitalize="words" />
        <TextField label="Model" value={model} onChangeText={setModel} placeholder="eVX" maxLength={VEHICLE_MAKE_MAX} autoCapitalize="words" />
        <ChoiceChips
          label="Kind of vehicle"
          options={kinds.map((k) => ({ value: k.key, label: k.sizeKey ? `${k.name} · ${k.sizeKey}` : k.name }))}
          value={bodyKey}
          onChange={setBodyKey}
        />
        {kind ? <Text style={styles.hint}>Priced as size {kind.sizeKey ?? '—'} at every branch.</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  footer: { gap: spacing.xs },
  hint: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  error: { ...typography.label, color: colors.danger },
});
