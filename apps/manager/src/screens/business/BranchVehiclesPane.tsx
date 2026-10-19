import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@mana/ui';
import { VehicleKindsList, type KindsCatalog } from './branch/VehicleKindsList';

/**
 * The kinds of vehicle a branch washes, switched on HQ's page for the branch and in the owner's
 * Vehicles — the same list and the same screen. A kind switched off disappears from the branch's
 * New Wash and the customer app; its prices stay with head office. Which size each kind is
 * priced as is set in the vehicle size guide.
 */
export function BranchVehiclesPane({
  catalog,
  branchName,
  value,
  onSave,
  heading = true,
}: {
  catalog: KindsCatalog;
  branchName: string;
  /** The title, help and count above the list; off where the screen's header card says it. */
  heading?: boolean;
  /** The kinds switched on (body type ids). */
  value: string[];
  /** Saves the new list; resolves with an error message, or null once saved. */
  onSave: (next: string[], what: string) => Promise<string | null>;
}) {
  const [on, setOn] = useState<string[]>(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOn(value), [value]);

  const save = async (next: string[], what: string) => {
    if (!next.length) {
      setError('A branch washes at least one kind of vehicle.');
      return;
    }
    const before = on;
    setOn(next);
    setBusy(true);
    setError(null);
    const message = await onSave(next, what);
    setBusy(false);
    if (message) {
      setOn(before);
      setError(message);
    }
  };

  return (
    <View style={styles.pane}>
      {heading ? (
        <>
          <Text style={styles.title}>Vehicles washed here</Text>
          <Text style={styles.hint}>
            Switch on what {branchName} washes. Its hub and community team take these. Each kind’s size (and so its price) is in
            the vehicle size guide.
          </Text>
          <Text style={styles.summary}>
            {on.length} of {catalog.bodyTypes.length} kinds on
          </Text>
        </>
      ) : null}
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
