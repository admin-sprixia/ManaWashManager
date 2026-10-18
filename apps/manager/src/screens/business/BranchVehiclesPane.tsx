import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@mana/ui';
import { api } from '../../api/client';
import type { Catalog } from './shared';
import { VehicleKindsList } from './branch/VehicleKindsList';

type Branch = Catalog['branches'][number];
type Run = (call: () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>, done?: string) => Promise<string | null>;

/**
 * The kinds of vehicle a branch washes. A kind switched off here disappears from the branch's
 * New Wash and the customer app; its prices stay with head office. Which size each kind is priced
 * as is set in the vehicle size guide.
 */
export function BranchVehiclesPane({ catalog, branch, run }: { catalog: Catalog; branch: Branch; run: Run }) {
  const [on, setOn] = useState<string[]>(branch.vehicles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOn(branch.vehicles), [branch.vehicles]);

  const save = async (next: string[], what: string) => {
    if (!next.length) {
      setError('A branch washes at least one kind of vehicle.');
      return;
    }
    const before = on;
    setOn(next);
    setBusy(true);
    setError(null);
    const message = await run(
      () => api.business.branches[':id'].vehicles.$put({ param: { id: branch.id }, json: { bodyTypeIds: next } }),
      `${what} at ${branch.name}`,
    );
    setBusy(false);
    if (message) {
      setOn(before);
      setError(message);
    }
  };

  return (
    <View style={styles.pane}>
      <Text style={styles.title}>Vehicles washed here</Text>
      <Text style={styles.hint}>
        Switch on what {branch.name} washes. Its hub and community team take these. Each kind’s size (and so its price) is in the
        vehicle size guide.
      </Text>
      <Text style={styles.summary}>
        {on.length} of {catalog.bodyTypes.length} kinds on
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <VehicleKindsList catalog={catalog} value={on} disabled={busy} onChange={(next, what) => void save(next, what)} />
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { paddingHorizontal: spacing.md, gap: spacing.sm + 2 },
  title: { ...typography.heading, fontSize: 18, color: colors.ink, letterSpacing: -0.2 },
  hint: { ...typography.body, fontSize: 13.5, color: colors.slateDeep, lineHeight: 19 },
  summary: { ...typography.label, fontSize: 13, color: colors.waterInk, fontWeight: '800' },
  error: { ...typography.label, color: colors.danger },
});
