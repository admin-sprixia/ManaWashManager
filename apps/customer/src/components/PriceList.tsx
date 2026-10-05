import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  ChoiceChips,
  colors,
  formatRupees,
  spacing,
} from '@mana/ui';
import { EdgeGroup } from './CardList';
import type { Branch } from '../api/types';

type Category = 'car' | 'bike';

/** A branch's services as list rows, with the price for each vehicle size; cars and bikes apart. */
export function PriceList({ branch }: { branch: Branch }) {
  const categories = useMemo(
    () => (['car', 'bike'] as const).filter((c) => branch.vehicleTypes.some((t) => t.category === c)),
    [branch.vehicleTypes],
  );
  const [category, setCategory] = useState<Category>(categories[0] ?? 'car');

  const types = branch.vehicleTypes.filter((t) => t.category === category);
  const typeIds = new Set(types.map((t) => t.id));
  const services = branch.services
    .map((s) => ({ ...s, prices: s.prices.filter((p) => typeIds.has(p.vehicleTypeId)) }))
    .filter((s) => s.prices.length > 0);

  if (categories.length === 0) return null;
  return (
    <View>
      {categories.length > 1 ? (
        <View style={styles.chips}>
          <ChoiceChips<Category>
            options={categories.map((c) => ({ value: c, label: c === 'car' ? 'Cars' : 'Bikes' }))}
            value={category}
            onChange={setCategory}
          />
        </View>
      ) : null}
      <EdgeGroup>
        {services.map((s) => {
          const amounts = s.prices.map((p) => p.price);
          const lowest = Math.min(...amounts);
          const onePrice = amounts.every((a) => a === lowest) && s.prices.length === types.length;
          return (
            <View key={s.id} style={styles.row}>
              <View style={styles.head}>
                <Text style={styles.name}>{s.name}</Text>
                <Text style={styles.price}>{onePrice ? formatRupees(lowest) : `from ${formatRupees(lowest)}`}</Text>
              </View>
              {s.description ? <Text style={styles.description}>{s.description}</Text> : null}
              {s.includes.length > 0 ? (
                <Text style={styles.description}>Includes {s.includes.join(', ')}</Text>
              ) : null}
              {!onePrice ? (
                <View style={styles.sizes}>
                  {types.map((t) => {
                    const price = s.prices.find((p) => p.vehicleTypeId === t.id);
                    return price ? (
                      <View key={t.id} style={styles.size}>
                        <Text style={styles.sizeName}>{t.name}</Text>
                        <Text style={styles.sizePrice}>{formatRupees(price.price)}</Text>
                      </View>
                    ) : null;
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </EdgeGroup>
      <Text style={styles.note}>Prices can change; the team confirms before washing.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { paddingHorizontal: spacing.md, paddingBottom: 12 },
  row: { paddingHorizontal: spacing.md, paddingVertical: 14, gap: 4, backgroundColor: colors.white },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  name: { fontSize: 16.5, fontWeight: '700', color: colors.ink, flex: 1 },
  price: { fontSize: 15.5, fontWeight: '800', color: colors.indigoMid },
  description: { fontSize: 13, color: colors.slateDeep, lineHeight: 18 },
  sizes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 6 },
  size: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  sizeName: { fontSize: 13, color: colors.slateDeep },
  sizePrice: { fontSize: 13, fontWeight: '800', color: colors.ink },
  note: { textAlign: 'center', marginTop: 10, paddingHorizontal: 20, fontSize: 12.5, color: colors.slate },
});
