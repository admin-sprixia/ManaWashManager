import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  isValidPhone,
  isValidRegistration,
  normalizePhone,
  normalizeRegistration,
} from '@mana/domain';
import {
  BottomSheet,
  Button,
  PhoneField,
  TextField,
  colors,
  formatPhone,
  spacing,
  typography,
} from '@mana/ui';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
import { useDirectory } from '../offline/DirectoryProvider';

interface Props {
  visible: boolean;
  customer: { id: string; name: string | null; phone: string | null };
  vehicles: { id: string; registrationNumber: string }[];
  /** The owner can also move a vehicle (and its washes) to another customer. */
  canMove?: boolean;
  onClose: () => void;
  /** After a save: reload the profile and the offline customer list. */
  onSaved: () => void;
}

/**
 * The profile's Edit: fix the customer's name, their mobile number (where the WhatsApp ready
 * message and bill go) and a mistyped vehicle number. Owner and manager only.
 */
export function EditCustomerSheet({
  visible,
  customer,
  vehicles,
  canMove = false,
  onClose,
  onSaved,
}: Props) {
  const directory = useDirectory();
  /** The vehicle being moved to another customer; null while editing. */
  const [moving, setMoving] = useState<{ id: string; registrationNumber: string } | null>(null);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [plates, setPlates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(customer.name ?? '');
    setPhone((customer.phone ?? '').replace(/\D/g, '').slice(-10));
    setPlates(Object.fromEntries(vehicles.map((v) => [v.id, v.registrationNumber])));
    setError(null);
    setBusy(false);
    setMoving(null);
    setSearch('');
    // Filled in once, when the sheet opens: the screen behind redraws (every minute, on sync),
    // and that must never wipe what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Other customers matching the search (name, number or plate), one row each.
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    if (!moving || q.length < 2) return [];
    const seen = new Map<
      string,
      { id: string; name: string; phone: string | null; plates: string[] }
    >();
    for (const e of directory.entries) {
      if (e.customerId === customer.id || e.local) continue;
      const hit =
        e.customerName.toLowerCase().includes(q) ||
        (digits.length >= 3 && (e.customerPhone ?? '').includes(digits)) ||
        e.registrationNumber.toLowerCase().includes(q.replace(/\s+/g, ''));
      if (!hit) continue;
      const row = seen.get(e.customerId) ?? {
        id: e.customerId,
        name: e.customerName,
        phone: e.customerPhone,
        plates: [],
      };
      row.plates.push(e.registrationNumber);
      seen.set(e.customerId, row);
    }
    return [...seen.values()].slice(0, 8);
  }, [search, moving, directory.entries, customer.id]);

  const move = (to: { id: string; name: string }) => {
    if (!moving) return;
    Alert.alert(
      `Move ${moving.registrationNumber} to ${to.name || 'this customer'}?`,
      'The vehicle and all its washes go to their profile.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move',
          onPress: () => {
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                const res = await api.customers[':id'].vehicles[':vehicleId'].move.$post({
                  param: { id: customer.id, vehicleId: moving.id },
                  json: { toCustomerId: to.id },
                });
                if (!res.ok)
                  return setError(await apiErrorMessage(res, 'Couldn’t move the vehicle.'));
                onSaved();
                onClose();
              } catch (e) {
                setError(
                  e instanceof NetworkError
                    ? 'Moving needs a connection. Try again when online.'
                    : 'Couldn’t move the vehicle.',
                );
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  const nameChanged = name.trim() !== (customer.name ?? '').trim();
  const phoneChanged = phone !== (customer.phone ?? '').replace(/\D/g, '').slice(-10);
  const changedPlates = vehicles.filter((v) => normalizeRegistration(plates[v.id] ?? '') !== v.registrationNumber);
  const nothing = !nameChanged && !phoneChanged && changedPlates.length === 0;

  const save = async () => {
    if (!name.trim()) return setError('Enter the customer’s name.');
    // An empty number means the customer didn't give one (no WhatsApp messages).
    if (phone && !isValidPhone(phone)) return setError('Enter a valid 10-digit mobile number, or leave it empty.');
    const bad = changedPlates.find((v) => !isValidRegistration(normalizeRegistration(plates[v.id] ?? '')));
    if (bad) return setError(`“${plates[bad.id]}” isn’t a valid vehicle number.`);
    setBusy(true);
    setError(null);
    try {
      if (nameChanged || phoneChanged) {
        const res = await api.customers[':id'].$patch({
          param: { id: customer.id },
          json: { ...(nameChanged ? { name: name.trim() } : {}), ...(phoneChanged ? { phone: phone || null } : {}) },
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

  if (moving) {
    return (
      <BottomSheet
        visible={visible}
        onClose={onClose}
        dismissable={!busy}
        title={`Move ${moving.registrationNumber}`}
        subtitle="To the customer it really belongs to. Its washes go with it."
        footer={
          <Button
            label="Back"
            variant="secondary"
            size="lg"
            disabled={busy}
            onPress={() => setMoving(null)}
          />
        }
      >
        <TextField
          label="Find the customer"
          value={search}
          onChangeText={setSearch}
          placeholder="Name, mobile or vehicle number"
          autoFocus
        />
        {matches.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => move(m)}
            disabled={busy}
            style={({ pressed }) => [styles.match, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.matchName}>{m.name || 'No name'}</Text>
            <Text style={styles.matchMeta}>
              {[m.phone ? formatPhone(m.phone) : 'No number', m.plates.join(', ')].join(' · ')}
            </Text>
          </Pressable>
        ))}
        {search.trim().length >= 2 && matches.length === 0 ? (
          <Text style={styles.matchMeta}>No other customer matches.</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </BottomSheet>
    );
  }

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
      <PhoneField
        digits={phone}
        onChangeDigits={setPhone}
        normalize={normalizePhone}
        hint={phone ? undefined : 'Empty: no number, so no WhatsApp messages.'}
      />
      {vehicles.length > 0 ? (
        <View style={styles.vehicles}>
          {vehicles.map((v, i) => (
            <View key={v.id}>
              <TextField
                label={vehicles.length === 1 ? 'Vehicle number' : `Vehicle ${i + 1} number`}
                value={plates[v.id] ?? ''}
                onChangeText={(t) => setPlates((p) => ({ ...p, [v.id]: t.toUpperCase() }))}
                autoCapitalize="characters"
                maxLength={15}
                placeholder="AP 39 AB 1234"
              />
              {canMove ? (
                <Pressable
                  onPress={() => {
                    setError(null);
                    setMoving(v);
                  }}
                  hitSlop={6}
                  accessibilityRole="button"
                >
                  <Text style={styles.moveLink}>
                    Wrong customer? Move this vehicle to another customer
                  </Text>
                </Pressable>
              ) : null}
            </View>
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
  moveLink: { ...typography.caption, color: colors.indigo, marginTop: spacing.xs },
  match: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  matchName: { ...typography.bodyStrong, color: colors.ink },
  matchMeta: { ...typography.caption, color: colors.slate },
  pressed: { opacity: 0.6 },
});
