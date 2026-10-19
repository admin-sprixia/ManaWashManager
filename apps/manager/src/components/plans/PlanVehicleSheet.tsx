import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { isValidRegistration, normalizeRegistration } from '@mana/domain';
import {
  BottomSheet,
  Button,
  IconChevronRight,
  IconPlus,
  MakeLogo,
  Notice,
  TextField,
  VehicleArt,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { api } from '../../api/client';
import { useDirectory } from '../../offline/DirectoryProvider';
import { SelectField } from '../SelectField';
import { VehicleModelPicker, useModelEdits, type ModelPickType } from '../newWash/VehicleModelPicker';

/** The vehicle a plan is being sold for: one of the customer's, or one they're adding now. */
export interface PlanVehicle {
  registrationNumber: string;
  vehicleTypeId: string;
  vehicleName: string;
  make?: string;
  model?: string;
  /** The plate is with another customer today: selling moves it to this one. */
  ownership?: 'new_owner';
}

interface SavedVehicle {
  registrationNumber: string;
  vehicleTypeId?: string;
  vehicleType: { name: string };
  make?: string | null;
  model?: string | null;
}

/**
 * Step one of selling a plan from a customer's profile: which vehicle. One of theirs, or another
 * vehicle (plate, then company and model, which picks its type). The plans for that type come next.
 */
export function PlanVehicleSheet({
  visible,
  customerPhone,
  vehicles,
  onClose,
  onPicked,
}: {
  visible: boolean;
  customerPhone: string;
  vehicles: SavedVehicle[];
  onClose: () => void;
  onPicked: (vehicle: PlanVehicle) => void;
}) {
  const directory = useDirectory();
  const edits = useModelEdits(visible);
  const [adding, setAdding] = useState(false);
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [types, setTypes] = useState<(ModelPickType & { category: string })[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAdding(vehicles.length === 0);
    setPlate('');
    setMake(null);
    setModel(null);
    setTypeId(null);
    setError(null);
  }, [visible, vehicles.length]);

  // The branch's vehicle types, for a vehicle added here (selling a plan needs internet anyway).
  useEffect(() => {
    if (!visible || !adding || types.length) return;
    let alive = true;
    void (async () => {
      try {
        const res = await api.services['vehicle-types'].$get({ query: {} });
        if (!res.ok || !alive) return;
        const rows = await res.json();
        if (alive) setTypes(rows.map((t) => ({ id: t.id, name: t.name, bodyKey: t.bodyKey, category: t.category })));
      } catch {
        if (alive) setError('Adding a vehicle needs internet.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, adding, types.length]);

  const listed = vehicles.filter((v) => !v.registrationNumber.startsWith('WALK-IN') && v.vehicleTypeId);
  const reg = normalizeRegistration(plate);
  const plateOk = isValidRegistration(reg);
  const theirs = listed.find((v) => v.registrationNumber === reg);
  // The plate is saved under someone else: say so before it moves.
  const elsewhere = useMemo(() => {
    if (!plateOk || theirs) return null;
    const entry = directory.entries.find((e) => e.registrationNumber === reg);
    return entry && entry.customerPhone !== customerPhone ? entry : null;
  }, [plateOk, theirs, directory.entries, reg, customerPhone]);
  const typeOptions = useMemo(() => types.map((t) => ({ value: t.id, label: t.name })), [types]);
  const picked = types.find((t) => t.id === typeId) ?? null;

  const pickModel = (m: string, suggested: string | null) => {
    setModel(m);
    setTypeId(suggested);
  };
  const pickMake = (m: string) => {
    setMake(m);
    setModel(null);
    setTypeId(null);
  };

  const next = () => {
    if (!plateOk) return setError('Enter the number like AP39AB1234.');
    if (theirs?.vehicleTypeId) {
      return onPicked({ registrationNumber: reg, vehicleTypeId: theirs.vehicleTypeId, vehicleName: theirs.vehicleType.name });
    }
    if (!picked) return setError('Pick the company and model (or the vehicle type).');
    onPicked({
      registrationNumber: reg,
      vehicleTypeId: picked.id,
      vehicleName: picked.name,
      ...(make && model ? { make, model } : {}),
      ...(elsewhere ? { ownership: 'new_owner' as const } : {}),
    });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Sell a plan"
      subtitle={adding ? 'Another vehicle' : 'Which vehicle is the plan for?'}
      footer={adding ? <Button label="Show the plans" size="lg" onPress={next} /> : undefined}
    >
      {!adding ? (
        <View style={styles.list}>
          {listed.map((v) => {
            const name = [v.make, v.model].filter(Boolean).join(' ');
            return (
              <Pressable
                key={v.registrationNumber}
                onPress={() =>
                  onPicked({ registrationNumber: v.registrationNumber, vehicleTypeId: v.vehicleTypeId!, vehicleName: v.vehicleType.name })
                }
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Plan for ${v.registrationNumber}`}
              >
                <View style={styles.lead}>
                  {v.make ? <MakeLogo make={v.make} height={26} /> : <VehicleArt name={v.vehicleType.name} style={styles.art} />}
                </View>
                <View style={styles.copy}>
                  <Text style={styles.title}>{v.registrationNumber}</Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {name ? `${name} · ${v.vehicleType.name}` : v.vehicleType.name}
                  </Text>
                </View>
                <IconChevronRight size={16} color={colors.slate} />
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setAdding(true)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <View style={[styles.lead, styles.addLead]}>
              <IconPlus size={18} color={colors.indigo} />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, styles.addTitle]}>Another vehicle</Text>
              <Text style={styles.meta}>Add it to this customer and sell the plan for it</Text>
            </View>
            <IconChevronRight size={16} color={colors.slate} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.form}>
          <TextField
            label="Number plate"
            value={plate}
            onChangeText={(t) => {
              setPlate(t.toUpperCase());
              setError(null);
            }}
            placeholder="AP39AB1234"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
          />
          {theirs ? <Notice tone="info">This vehicle is already on their profile.</Notice> : null}
          {elsewhere ? (
            <Notice tone="warning" title="Saved under another customer">
              {`${elsewhere.customerName || elsewhere.customerPhone} has this plate today. Selling the plan moves it to this customer.`}
            </Notice>
          ) : null}
          {!theirs ? (
            <>
              <View style={styles.picker}>
                <VehicleModelPicker types={types} edits={edits} make={make} model={model} onMake={pickMake} onPick={pickModel} />
              </View>
              {model && !typeId ? <Text style={styles.hint}>This branch has no type for that model. Pick the closest one:</Text> : null}
              {(model && !typeId) || !make ? (
                <SelectField
                  label="Vehicle type"
                  placeholder={make ? 'Pick the type' : 'Or pick the type directly'}
                  options={typeOptions}
                  value={typeId}
                  onChange={setTypeId}
                  searchable
                />
              ) : picked ? (
                <Text style={styles.hint}>{`Type: ${picked.name} (from the model)`}</Text>
              ) : null}
            </>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {listed.length ? <Button label="Back to their vehicles" variant="ghost" onPress={() => setAdding(false)} /> : null}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { marginHorizontal: -spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.white,
  },
  pressed: { backgroundColor: colors.surface },
  lead: { width: 44, height: 34, alignItems: 'center', justifyContent: 'center' },
  addLead: { borderRadius: radius.md, backgroundColor: colors.indigoPale },
  art: { width: 44, height: 30 },
  copy: { flex: 1, gap: 2 },
  title: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 15, letterSpacing: 0.6 },
  addTitle: { color: colors.indigo, letterSpacing: 0 },
  meta: { ...typography.caption, color: colors.slate, fontSize: 12.5, letterSpacing: 0 },
  form: { gap: spacing.md },
  picker: { marginHorizontal: -spacing.md },
  hint: { ...typography.caption, color: colors.slateDeep, fontSize: 12.5, letterSpacing: 0 },
  error: { ...typography.label, color: colors.danger },
});
