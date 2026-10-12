import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Gradient, IconPerson, colors, initials } from '@mana/ui';

/** The customer's initials (or a person, before they add a name) on an indigo gradient disc. */
export function ProfileAvatar({ name, size = 56 }: { name: string | null; size?: number }) {
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
      {name?.trim() ? (
        <Text style={[styles.text, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
      ) : (
        <IconPerson size={size * 0.42} color={colors.white} />
      )}
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
