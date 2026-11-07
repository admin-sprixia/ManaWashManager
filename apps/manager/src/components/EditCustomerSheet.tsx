import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { isValidPhone, isValidRegistration, normalizePhone, normalizeRegistration } from '@mana/domain';
import { BottomSheet, Button, PhoneField, TextField, colors, spacing, typography } from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';

interface Props {
  visible: boolean;
  customer: { id: string; name: string | null; phone: string };
  vehicles: { id: string; registrationNumber: string }[];
  onClose: () => void;
  /** After a save: reload the profile and the offline customer list. */
  onSaved: () => void;
}

/**
 * The profile's Edit: fix the customer's name, their mobile number (where the WhatsApp ready
 * message and bill go) and a mistyped vehicle number. Owner and manager only.
 */
export function EditCustomerSheet({ visible, customer, vehicles, onClose, onSaved }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [plates, setPlates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(customer.name ?? '');
    setPhone(customer.phone.replace(/\D/g, '').slice(-10));
    setPlates(Object.fromEntries(vehicles.map((v) => [v.id, v.registrationNumber])));
    setError(null);
    setBusy(false);
  }, [visible, customer, vehicles]);

  const nameChanged = name.trim() !== (customer.name ?? '').trim();
  const phoneChanged = phone !== customer.phone.replace(/\D/g, '').slice(-10);
  const changedPlates = vehicles.filter((v) => normalizeRegistration(plates[v.id] ?? '') !== v.registrationNumber);
  const nothing = !nameChanged && !phoneChanged && changedPlates.length === 0;

  const save = async () => {
    if (!name.trim()) return setError('Enter the customer’s name.');
    if (!isValidPhone(phone)) return setError('Enter a valid 10-digit mobile number.');
    const bad = changedPlates.find((v) => !isValidRegistration(normalizeRegistration(plates[v.id] ?? '')));
    if (bad) return setError(`“${plates[bad.id]}” isn’t a valid vehicle number.`);
    setBusy(true);
    setError(null);
    try {
      if (nameChanged || phoneChanged) {
        const res = await api.customers[':id'].$patch({
          param: { id: customer.id },
          json: { ...(nameChanged ? { name: name.trim() } : {}), ...(phoneChanged ? { phone } : {}) },
        });
        if (!res.ok) return setError(await apiErrorMessage(res, 'Couldn’t save.'));
      }
      for (const v of changedPlates) {
        const res = await api.customers[':id'].vehicles[':vehicleId'].$patch({
          param: { id: customer.id, vehicleId: v.id },
          json: { registrationNumber: normalizeRegistration(plates[v.id] ?? '') },
        });
        if (!res.ok) return setError(await apiErrorMessage(res, 'Couldn’t save the vehicle number.'));
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof NetworkError ? 'Editing needs a connection. Try again when online.' : 'Couldn’t save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title="Edit customer"
      subtitle="The WhatsApp ready message and bill go to this number"
      footer={<Button label="Save changes" size="lg" loading={busy} disabled={nothing} onPress={() => void save()} />}
    >
      <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" maxLength={60} />
      <PhoneField digits={phone} onChangeDigits={setPhone} normalize={normalizePhone} />
      {vehicles.length > 0 ? (
        <View style={styles.vehicles}>
          {vehicles.map((v, i) => (
            <TextField
              key={v.id}
              label={vehicles.length === 1 ? 'Vehicle number' : `Vehicle ${i + 1} number`}
              value={plates[v.id] ?? ''}
              onChangeText={(t) => setPlates((p) => ({ ...p, [v.id]: t.toUpperCase() }))}
              autoCapitalize="characters"
              maxLength={15}
              placeholder="AP 39 AB 1234"
            />
          ))}
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  vehicles: { gap: spacing.sm },
  error: { ...typography.label, color: colors.danger, textTransform: 'none' },
});
