import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatDuration } from '@mana/domain';
import { colors, formatRupees, radius } from '@mana/ui';
import { EdgeGroup } from './CardList';
import { VehicleTypeArt } from './VehicleTypePicker';
import type { Branch } from '../api/types';

const TILE = 92;

type Mode = 'hub' | 'doorstep';
type Service = Branch['services'][number];

const MODE_LABEL: Record<Mode, string> = { hub: 'At the shop', doorstep: 'At your door' };
const pricesFor = (s: Service, mode: Mode) => (mode === 'doorstep' ? s.doorstepPrices : s.prices);

/**
 * A branch's prices without the scroll: pick the vehicle once from a strip of photos, then every
 * service is one line with that vehicle's price. A branch that also comes to the door gets a
 * switch between its shop and doorstep prices.
 */
export function PriceList({ branch }: { branch: Branch }) {
  const modes = (['hub', 'doorstep'] as const).filter(
    (m) => branch.modes.includes(m) && branch.services.some((s) => pricesFor(s, m).length > 0),
  );
  const [modePick, setMode] = useState<Mode | null>(null);
  const mode = modePick && modes.includes(modePick) ? modePick : (modes[0] ?? 'hub');
  const types = branch.vehicleTypes.filter((t) =>
    branch.services.some((s) => pricesFor(s, mode).some((p) => p.vehicleTypeId === t.id)),
  );
  const [typeId, setTypeId] = useState<string | null>(types[0]?.id ?? null);
  const picked = types.find((t) => t.id === typeId) ?? types[0];
  if (!picked) return null;

  const rows = branch.services.flatMap((s) => {
    const price = pricesFor(s, mode).find((p) => p.vehicleTypeId === picked.id);
    if (!price) return [];
    const detail =
      (s.checklist.length > 0 ? s.checklist.join(' · ') : null) ||
      s.description ||
      (s.includes.length > 0 ? `Includes ${s.includes.join(', ')}` : null);
    const time = s.durationMin ? formatDuration(s.durationMin) : null;
    return [{ id: s.id, name: s.name, detail, time, popular: s.popular, price: price.price }];
  });

  return (
    <View>
      {modes.length > 1 ? (
        <View style={styles.segment} accessibilityRole="tablist">
          {modes.map((m) => {
            const on = m === mode;
            return (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={[styles.segmentItem, on && styles.segmentItemOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{MODE_LABEL[m]}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        accessibilityRole="radiogroup"
      >
        {types.map((t) => {
          const on = t.id === picked.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTypeId(t.id)}
              style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Prices for ${t.name}`}
            >
              <View style={[styles.photoFrame, on && styles.photoFrameOn]}>
                <VehicleTypeArt type={t} style={styles.photo} />
              </View>
              <Text style={[styles.tileName, on && styles.tileNameOn]} numberOfLines={2}>
                {t.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <EdgeGroup>
        {rows.map((r) => (
          <View key={r.id} style={styles.row}>
            <View style={styles.copy}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {r.name}
                </Text>
                {r.popular ? (
                  <View style={styles.popular}>
                    <Text style={styles.popularText}>Most popular</Text>
                  </View>
                ) : null}
              </View>
              {r.time || r.detail ? (
                <Text style={styles.detail} numberOfLines={2}>
                  {[r.time, r.detail].filter(Boolean).join(' · ')}
                </Text>
              ) : null}
            </View>
            <Text style={styles.price}>{formatRupees(r.price)}</Text>
          </View>
        ))}
      </EdgeGroup>
      {mode === 'doorstep' && branch.visit ? (
        <View style={styles.visit}>
          <Text style={styles.visitTitle}>
            + {formatRupees(branch.visit.visitFeePaise)} visit charge
            {branch.visit.perKmPaise
              ? `, and ${formatRupees(branch.visit.perKmPaise)} a km after ${branch.visit.freeKm} km`
              : ''}
          </Text>
          <Text style={styles.visitBody}>
            Once per visit, however many vehicles we wash at your home. We come up to {branch.visit.maxKm} km from the branch.
          </Text>
        </View>
      ) : null}
      <Text style={styles.note}>
        {mode === 'doorstep'
          ? `${picked.name} prices, washed at your door${branch.visit ? ', plus the visit charge' : ''}. They can change; the team confirms before washing.`
          : `${picked.name} prices at the shop. They can change; the team confirms before washing.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  visit: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    gap: 4,
    borderRadius: radius.lg,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
  },
  visitTitle: { fontSize: 14.5, fontWeight: '800', color: colors.tealDeep },
  visitBody: { fontSize: 13, lineHeight: 18, color: colors.slateDeep },
  segment: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.pill },
  segmentItemOn: { backgroundColor: colors.indigo },
  segmentText: { fontSize: 13.5, fontWeight: '700', color: colors.slateDeep },
  segmentTextOn: { color: colors.white },
  strip: { gap: 10, paddingHorizontal: 16, paddingBottom: 14 },
  tile: { width: TILE },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  photoFrame: {
    height: Math.round(TILE * 0.68),
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 2.5,
    borderColor: 'transparent',
    backgroundColor: colors.white,
  },
  photoFrameOn: { borderColor: colors.indigo },
  photo: { width: '100%', height: '100%' },
  tileName: {
    marginTop: 5,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '600',
    color: colors.slateDeep,
    textAlign: 'center',
  },
  tileNameOn: { color: colors.indigoMid, fontWeight: '800' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: colors.white,
  },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  name: { flexShrink: 1, fontSize: 15.5, fontWeight: '700', color: colors.ink },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  popular: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: '#FEF3C7' },
  popularText: { fontSize: 10.5, fontWeight: '800', color: '#92400E' },
  detail: { fontSize: 12.5, color: colors.slateDeep },
  price: { fontSize: 15.5, fontWeight: '800', color: colors.indigoMid },
  note: {
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 20,
    fontSize: 12.5,
    color: colors.slate,
  },
});
