import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { UNIT_TEXT_MAX, compareUnits, unitLabel } from '@mana/domain';
import { ChoiceChips, FieldMessage, TextField, colors, radius } from '@mana/ui';
import type { PlaceUnit } from '../../api/types';

export type UnitValue = { unitId: string } | { text: string } | null;

interface UnitPickerProps {
  units: PlaceUnit[];
  /** "Flat" for buildings, "House" for colonies and streets. */
  noun: 'Flat' | 'House';
  value: UnitValue;
  onChange: (value: UnitValue) => void;
  error?: string | null;
}

const NO_BLOCK = '·';

/**
 * Pick the flat from the team's list: block first when the building has blocks, then the number.
 * When the team hasn't added flats (or yours is missing), type it.
 */
export function UnitPicker({ units, noun, value, onChange, error }: UnitPickerProps) {
  const blocks = useMemo(() => [...new Set(units.map((u) => u.block ?? NO_BLOCK))].sort(), [units]);
  const picked = value && 'unitId' in value ? units.find((u) => u.id === value.unitId) ?? null : null;
  const [block, setBlock] = useState<string>(picked?.block ?? blocks[0] ?? NO_BLOCK);
  const [typing, setTyping] = useState(units.length === 0 || (value != null && 'text' in value));

  const inBlock = useMemo(
    () =>
      units
        .filter((u) => (u.block ?? NO_BLOCK) === block)
        .sort((a, b) => compareUnits(a.number, b.number)),
    [units, block],
  );

  if (typing) {
    return (
      <View style={styles.wrap}>
        <TextField
          label={`${noun} number`}
          placeholder={noun === 'Flat' ? 'e.g. A-204' : 'e.g. 12-3/4'}
          value={value && 'text' in value ? value.text : ''}
          onChangeText={(t) => onChange(t.trim() ? { text: t } : null)}
          maxLength={UNIT_TEXT_MAX}
          autoCapitalize="characters"
          error={error}
        />
        {units.length ? (
          <Text style={styles.link} onPress={() => (setTyping(false), onChange(null))} accessibilityRole="button">
            Pick from the list instead
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {blocks.length > 1 ? (
        <ChoiceChips
          label="Block"
          options={blocks.map((b) => ({ value: b, label: b === NO_BLOCK ? 'No block' : `Block ${b}` }))}
          value={block}
          onChange={(b) => {
            setBlock(b);
            if (picked && (picked.block ?? NO_BLOCK) !== b) onChange(null);
          }}
        />
      ) : null}
      <View style={styles.grid} accessibilityRole="radiogroup">
        {inBlock.map((u) => {
          const selected = picked?.id === u.id;
          return (
            <Pressable
              key={u.id}
              onPress={() => onChange({ unitId: u.id })}
              style={({ pressed }) => [styles.cell, selected && styles.cellOn, pressed && styles.cellPressed]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${noun} ${unitLabel(u.block, u.number)}`}
            >
              <Text style={[styles.cellText, selected && styles.cellTextOn]}>{u.number}</Text>
            </Pressable>
          );
        })}
      </View>
      <FieldMessage error={error} />
      <Text style={styles.link} onPress={() => (setTyping(true), onChange(null))} accessibilityRole="button">
        My {noun.toLowerCase()} isn’t in the list
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: {
    minWidth: 64,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
  },
  cellOn: { borderColor: colors.indigo, backgroundColor: colors.indigoPale },
  cellPressed: { opacity: 0.8 },
  cellText: { fontSize: 15, fontWeight: '700', color: colors.slateDeep },
  cellTextOn: { color: colors.indigoMid },
  link: { fontSize: 14, fontWeight: '700', color: colors.indigo, paddingVertical: 4 },
});
