import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Gradient, colors, initials } from '@mana/ui';

/** The customer's initials on an indigo gradient disc. */
export function ProfileAvatar({ name, size = 56 }: { name: string; size?: number }) {
  return (
    <Gradient
      spec={{
        colors: ['#7F93E6', colors.indigo, colors.indigoDeep],
        locations: [0, 0.55, 1],
        start: { x: 0.2, y: 0 },
        end: { x: 0.8, y: 1 },
      }}
      style={[styles.disc, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Text style={[styles.text, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
    </Gradient>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.indigo,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 8 },
  },
  text: { color: colors.white, fontWeight: '800', letterSpacing: 0.3 },
});
