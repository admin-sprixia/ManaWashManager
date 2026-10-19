import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  FieldLabel,
  FieldMessage,
  IconCheck,
  VehicleArt,
  colors,
  radius,
} from '@mana/ui';

const COLUMNS = 3;
const GAP = 10;

/** A branch's vehicle type: its catalog body type when it has one, else matched by name. */
export interface TypeLike {
  name: string;
  category: 'car' | 'bike';
  bodyKey?: string | null;
}

/** A branch's vehicle type drawn as a bike or car icon, filling `style`. */
export function VehicleTypeArt({ type, style }: { type: TypeLike; style?: React.ComponentProps<typeof VehicleArt>['style'] }) {
  return <VehicleArt name={type.name} bodyKey={type.bodyKey} category={type.category} style={style} />;
}

interface VehicleTypePickerProps {
  label: string;
  types: (TypeLike & { id: string })[];
  value: string | null;
  /** Tapping the picked type again clears it (null). */
  onChange: (id: string | null) => void;
  error?: string;
  hint?: string;
  required?: boolean;
}

/** The branch's vehicle types as photos, three to a row, with an indigo ring and tick on the picked one; tap it again to unpick. */
export function VehicleTypePicker({
  label,
  types,
  value,
  onChange,
  error,
  hint,
  required,
}: VehicleTypePickerProps) {
  const [width, setWidth] = useState(0);
  const tile = width ? Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS) : 0;

  return (
    <View>
      <FieldLabel required={required}>{label}</FieldLabel>
      <View
        style={styles.grid}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessibilityRole="radiogroup"
      >
        {tile > 0
          ? types.map((t) => {
              const selected = t.id === value;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => onChange(selected ? null : t.id)}
                  style={({ pressed }) => [{ width: tile }, pressed && styles.pressed]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={t.name}
                >
                  <View
                    style={[
                      styles.frame,
                      { height: Math.round(tile * 0.74) },
                      selected && styles.frameOn,
                    ]}
                  >
                    <VehicleTypeArt type={t} style={styles.photo} />
                    {selected ? (
                      <View style={styles.tick}>
                        <IconCheck size={12} color={colors.white} />
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.name, selected && styles.nameOn]} numberOfLines={2}>
                    {t.name}
                  </Text>
                </Pressable>
              );
            })
          : null}
      </View>
      <FieldMessage error={error} hint={hint} />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  frame: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 2.5,
    borderColor: 'transparent',
  },
  frameOn: { borderColor: colors.indigo },
  photo: { width: '100%', height: '100%' },
  tick: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.indigo,
    borderWidth: 2,
    borderColor: colors.white,
  },
  name: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
    color: colors.slateDeep,
    textAlign: 'center',
  },
  nameOn: { color: colors.indigoMid, fontWeight: '800' },
});
