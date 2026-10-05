import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { STAR_LABELS } from '@mana/domain';
import { IconStar, colors } from '@mana/ui';

/** Five tappable stars. Read-only when `onChange` is missing. */
export function StarRating({
  value,
  onChange,
  size = 34,
}: {
  value: number;
  onChange?: (stars: number) => void;
  size?: number;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row} accessibilityRole="adjustable" accessibilityLabel={`${value} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((s) => {
          const on = s <= value;
          const star = <IconStar size={size} color={on ? colors.amber : colors.indigoMist} filled={on} />;
          return onChange ? (
            <Pressable
              key={s}
              onPress={() => onChange(s)}
              hitSlop={6}
              style={({ pressed }) => [styles.star, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${s} ${s === 1 ? 'star' : 'stars'}, ${STAR_LABELS[s]}`}
            >
              {star}
            </Pressable>
          ) : (
            <View key={s} style={styles.star}>
              {star}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-start' },
  row: { flexDirection: 'row', gap: 6 },
  star: { padding: 2 },
  pressed: { transform: [{ scale: 0.92 }] },
});
