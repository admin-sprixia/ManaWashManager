import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { Service } from '@mana/domain';
import { colors, radius, spacing, typography, BottomSheet, Button } from '@mana/ui';
import { ComboIncludesPicker } from './ComboIncludesPicker';

interface EditServiceSheetProps {
  service: Service | null;
  /** Plain services a combo can bundle (the service itself is left out here). */
  plainServices: Service[];
  onClose: () => void;
  /** Resolves with an error message, or null when saved. */
  onSave: (changes: { name: string; description: string; includes?: string[] }) => Promise<string | null>;
}

/** Rename a service, change its short description, or what a combo includes. */
export function EditServiceSheet({ service, plainServices, onClose, onSave }: EditServiceSheetProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [includes, setIncludes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCombo = (service?.includes?.length ?? 0) > 0;
  const options = plainServices.filter((s) => s.id !== service?.id);

  useEffect(() => {
    if (!service) return;
    setName(service.name);
    setDescription(service.description ?? '');
    setIncludes((service.includes ?? []).filter((id) => plainServices.some((s) => s.id === id)));
    setBusy(false);
    setError(null);
    // Reset only when a different service is opened, not when the list refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service?.id]);

  const ready = name.trim().length > 0 && (!isCombo || includes.length >= 2);

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const message = await onSave({
      name: name.trim(),
      description: description.trim(),
      includes: isCombo ? includes : undefined,
    });
    setBusy(false);
    if (message) setError(message);
  };

  return (
    <BottomSheet
      visible={service != null}
      onClose={onClose}
      dismissable={!busy}
      title={isCombo ? 'Edit combo' : 'Edit service'}
      footer={
        <View style={styles.footer}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Save" size="lg" loading={busy} disabled={!ready} onPress={() => void save()} />
        </View>
      }
    >
      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.nameInput}
          value={name}
          onChangeText={setName}
          maxLength={60}
          placeholderTextColor={colors.slate}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Short description</Text>
        <TextInput
          style={styles.descInput}
          value={description}
          onChangeText={setDescription}
          placeholder="e.g. Foam, pressure rinse, tyre shine"
          placeholderTextColor={colors.slate}
          maxLength={160}
          multiline
        />
        <Text style={styles.helper}>Staff see this under the name on New Wash.</Text>
      </View>
      {isCombo ? (
        <View style={styles.field}>
          <Text style={styles.label}>What’s included</Text>
          <ComboIncludesPicker services={options} selected={includes} onChange={setIncludes} />
          {includes.length < 2 ? <Text style={styles.helperWarn}>Pick at least two services.</Text> : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  label: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  nameInput: {
    height: 52,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: 17,
    fontWeight: '600',
    color: colors.waterInk,
  },
  descInput: {
    minHeight: 72,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 15,
    lineHeight: 20,
    color: colors.waterInk,
    textAlignVertical: 'top',
  },
  helper: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0 },
  helperWarn: { ...typography.caption, color: colors.amberDeep, fontWeight: '700', letterSpacing: 0 },
  footer: { gap: spacing.sm },
  error: {
    ...typography.label,
    color: colors.danger,
    backgroundColor: '#FEE2E2',
    borderRadius: radius.sm,
    padding: spacing.sm + 2,
  },
});
