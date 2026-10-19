import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { vehicleMakeNames, vehicleModelNames, type VehicleModelEdit } from '@mana/domain';
import { MakeLogo, spacing, suggestedTypeId } from '@mana/ui';
import { SelectField } from '../SelectField';
import { api } from '../../api/client';
import { CacheKeys, readCache, writeCache } from '../../offline/cache';

/** A branch vehicle type, with the body type it stands for (how a model finds its type). */
export interface ModelPickType {
  id: string;
  name: string;
  bodyKey?: string | null;
}

/** The last list heard this app session, so New Wash opens with it. */
let editsMemory: VehicleModelEdit[] | null = null;

/**
 * Head office's changes to the built-in list of companies and models: the copy in memory or
 * on the phone at once, then the server's once `enabled`. Shares the size guide's saved copy,
 * so it works offline.
 */
export function useModelEdits(enabled = true): VehicleModelEdit[] {
  const [edits, setEdits] = useState<VehicleModelEdit[]>(() => editsMemory ?? []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (async () => {
      if (!editsMemory) {
        const cached = await readCache<{ models?: VehicleModelEdit[] }>(CacheKeys.vehicleSizes);
        if (alive && cached?.models?.length) {
          editsMemory = cached.models;
          setEdits(cached.models);
        }
      }
      try {
        const res = await api.services['vehicle-sizes'].$get();
        if (!res.ok) return;
        const fresh = await res.json();
        const models = fresh.models ?? [];
        if (fresh.bodyTypes.length) void writeCache(CacheKeys.vehicleSizes, fresh);
        const same = JSON.stringify(models) === JSON.stringify(editsMemory ?? []);
        editsMemory = models;
        if (alive && !same) setEdits(models);
      } catch {
        // Offline: the saved copy (or the built-in list) stands.
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled]);
  return edits;
}

/**
 * Company, then model: the model picks the branch's vehicle type (Swift → Hatchback), so the
 * menu and prices follow on their own. `onPick` gets the type that fits, or null when this
 * branch has none for the model (then the type is picked by hand).
 */
export function VehicleModelPicker({
  types,
  edits,
  make,
  model,
  onMake,
  onPick,
}: {
  types: readonly ModelPickType[];
  edits: readonly VehicleModelEdit[];
  make: string | null;
  model: string | null;
  onMake: (make: string) => void;
  onPick: (model: string, typeId: string | null) => void;
}) {
  const makes = useMemo(() => vehicleMakeNames(null, edits), [edits]);
  const makeOptions = useMemo(
    () => makes.map((m) => ({ value: m, label: m, leading: <MakeLogo make={m} height={24} /> })),
    [makes],
  );
  const typeName = useMemo(() => new Map(types.map((t) => [t.id, t.name])), [types]);
  const modelOptions = useMemo(() => {
    if (!make) return [];
    return vehicleModelNames(make, null, edits).map((m) => {
      const id = suggestedTypeId(types, make, m, edits);
      return { value: m, label: m, hint: id ? typeName.get(id) : 'Not washed here' };
    });
  }, [make, edits, types, typeName]);

  const pickModel = useCallback(
    (m: string) => onPick(m, make ? suggestedTypeId(types, make, m, edits) : null),
    [onPick, make, types, edits],
  );

  return (
    <View style={styles.wrap}>
      <SelectField
        label="Company"
        placeholder="Maruti Suzuki, Honda, Hero…"
        sheetTitle="Pick the company"
        options={makeOptions}
        value={make}
        onChange={onMake}
        searchable
      />
      <SelectField
        label="Model"
        placeholder={make ? `Which ${make}?` : 'Pick the company first'}
        sheetTitle={make ? `${make} models` : 'Models'}
        sheetSubtitle="The vehicle type and its menu come from the model"
        options={modelOptions}
        value={model}
        onChange={pickModel}
        searchable
        disabled={!make}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, paddingHorizontal: spacing.md },
});
