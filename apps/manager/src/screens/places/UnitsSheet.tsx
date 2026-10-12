import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { UNIT_BLOCK_MAX } from '@mana/domain';
import { BottomSheet, Button, TextField, colors, radius, showAlert, spacing, typography } from '@mana/ui';
import { api, type ApiResponse } from '../../api/client';
import type { PlaceDetail } from './shared';

type Unit = PlaceDetail['units'][number];

/**
 * The flats (or houses) people pick when they join. Typed as ranges, per block: "101-110, 201-210".
 * Tapping a flat takes it off the list (members already in it stay).
 */
export function UnitsSheet({
  visible,
  placeId,
  units,
  noun,
  onClose,
  run,
}: {
  visible: boolean;
  placeId: string;
  units: Unit[];
  noun: string;
  onClose: () => void;
  run: (call: () => Promise<ApiResponse>, done?: string) => Promise<string | null>;
}) {
  const [block, setBlock] = useState('');
  const [numbers, setNumbers] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setNumbers('');
    setError(null);
    setBusy(false);
  }, [visible]);

  const byBlock = useMemo(() => {
    const groups = new Map<string, Unit[]>();
    for (const u of units) groups.set(u.block ?? '', [...(groups.get(u.block ?? '') ?? []), u]);
    return [...groups.entries()];
  }, [units]);

  const add = async () => {
    if (!numbers.trim()) return setError('Type the numbers, e.g. 101-110, 201-210.');
    setBusy(true);
    setError(null);
    const message = await run(
      () => api.places[':id'].units.$post({ param: { id: placeId }, json: { block: block.trim() || null, numbers: numbers.trim() } }),
      `${noun}s added`,
    );
    setBusy(false);
    if (message) setError(message);
    else setNumbers('');
  };

  const archive = (u: Unit) =>
    showAlert(`Remove ${u.block ? `${u.block} · ` : ''}${u.number}?`, 'It won’t be offered to new members. Anyone living there stays.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          void run(() => api.places[':id'].units[':unitId'].$delete({ param: { id: placeId, unitId: u.id } }), 'Removed').then(
            (message) => message && setError(message),
          ),
      },
    ]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busy}
      title={`${noun}s`}
      subtitle={units.length ? `${units.length} on the list` : `Members pick their ${noun.toLowerCase()} from this list.`}
      footer={<Button label={`Add ${noun.toLowerCase()}s`} size="lg" loading={busy} onPress={() => void add()} />}
    >
      <View style={styles.body}>
        {byBlock.map(([name, list]) => (
          <View key={name} style={styles.group}>
            {name ? <Text style={styles.block}>Block {name}</Text> : null}
            <View style={styles.grid}>
              {list.map((u) => (
                <Pressable key={u.id} onPress={() => archive(u)} style={({ pressed }) => [styles.unit, pressed && styles.pressed]}>
                  <Text style={styles.unitText}>{u.number}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        <TextField label="Block or tower" optional value={block} onChangeText={setBlock} maxLength={UNIT_BLOCK_MAX} placeholder="A" autoCapitalize="characters" />
        <TextField
          label={`${noun} numbers`}
          value={numbers}
          onChangeText={(t) => {
            setNumbers(t);
            if (error) setError(null);
          }}
          placeholder="101-110, 201-210"
          hint="Ranges and lists both work. Ones already there are skipped."
          error={error}
          autoCapitalize="characters"
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  group: { gap: 6 },
  block: { ...typography.label, color: colors.slateDeep },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  unit: { minWidth: 52, paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: colors.waterPale, alignItems: 'center' },
  unitText: { fontSize: 13.5, fontWeight: '700', color: colors.waterDeep },
  pressed: { opacity: 0.6 },
});
