import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, shadow } from '@mana/ui';
import { Shimmer } from './Skeleton';

const Label = () => <View style={styles.label} />;

/** Placeholder shapes in the layout of Home while it loads. */
export function HomeSkeleton({ overlap }: { overlap?: boolean }) {
  return (
    <View>
      {overlap ? (
        <View style={[styles.card, styles.overlap]}>
          <View style={styles.row}>
            <Shimmer style={{ width: 48, height: 48, borderRadius: 15 }} />
            <View style={styles.flex}>
              <Shimmer style={{ height: 16, width: '62%' }} />
              <Shimmer style={{ height: 12, width: '80%', marginTop: 9 }} />
            </View>
          </View>
        </View>
      ) : null}
      <Label />
      <View style={styles.card}>
        <Shimmer style={{ height: 16, width: '46%' }} />
        <View style={[styles.row, { marginTop: 16 }]}>
          {Array.from({ length: 5 }, (_, i) => (
            <Shimmer key={i} style={{ width: 36, height: 42 }} />
          ))}
        </View>
        <Shimmer style={{ height: 12, width: '70%', marginTop: 16 }} />
      </View>
      <Label />
      <Shimmer style={{ height: 128, borderRadius: 22, marginHorizontal: 16 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E9EDFC',
    ...shadow('md'),
  },
  overlap: { marginTop: -44 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  flex: { flex: 1 },
  label: { height: 12, width: 110, marginTop: 26, marginBottom: 10, marginLeft: 20, borderRadius: 6, backgroundColor: '#E9EDFB' },
});
