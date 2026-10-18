import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { InferResponseType } from 'hono/client';
import { soldAtCommunities, soldAtShop, type BranchServices } from '@mana/domain';
import { IconCheck, colors, radius, spacing, typography } from '@mana/ui';
import type { api } from '../../../api/client';

export type PlanItem = InferResponseType<(typeof api)['business']['plans']['$get'], 200>['plans'][number];

/**
 * The wash plans a branch will sell. A plan comes with its wash: it's sold where that service (and
 * its better wash, if it has one) is switched on, at the counter when the branch runs a hub and the
 * plan is sold at the shop, and at communities when it runs communities and the plan is sold there.
 */
export function PlanList({
  plans,
  menu,
  runs,
  onSell,
}: {
  plans: PlanItem[];
  /** The services switched on. */
  menu: string[];
  runs: BranchServices;
  /** Switch on the services a plan needs. */
  onSell: (serviceIds: string[]) => void;
}) {
  const live = plans.filter((p) => p.active);
  if (!live.length) return <Text style={styles.hint}>No wash plans yet. Add them in More › Mana Wash HQ › Services and plans › Plans.</Text>;
  return (
    <View style={styles.band}>
      {live.map((p, i) => {
        const needs = [p.catalogServiceId, ...(p.upgradeServiceId ? [p.upgradeServiceId] : [])];
        const atShop = soldAtShop(p.soldAt) && runs.hub;
        const atCommunities = soldAtCommunities(p.soldAt) && runs.community;
        const where = atShop && atCommunities ? 'shop and communities' : atShop ? 'at the shop' : atCommunities ? 'at communities' : null;
        const sold = !!where && needs.every((id) => menu.includes(id));
        const washes = p.upgradeServiceName && p.upgradeEvery
          ? `${p.washes} ${p.serviceName ?? ''}, every ${p.upgradeEvery}th ${p.upgradeServiceName}`
          : `${p.washes} × ${p.serviceName ?? 'wash'}`;
        return (
          <View key={p.id} style={[styles.row, i < live.length - 1 && styles.divider]}>
            <View style={styles.flex}>
              <Text style={[styles.name, !sold && styles.nameOff]}>{p.name}</Text>
              <Text style={styles.meta}>
                {washes} · {p.months === 1 ? '1 month' : `${p.months} months`}
                {where ? ` · ${where}` : ''}
              </Text>
              {!where ? (
                <Text style={styles.meta}>
                  {soldAtShop(p.soldAt) && !soldAtCommunities(p.soldAt)
                    ? 'Sold at the shop: switch Hub on in the agreement to sell it here.'
                    : soldAtShop(p.soldAt)
                      ? 'Switch Hub or Community on in the agreement to sell it here.'
                      : 'Sold at communities: switch Community on in the agreement to sell it here.'}
                </Text>
              ) : null}
            </View>
            {sold ? (
              <View style={styles.sold}>
                <IconCheck size={12} color={colors.tealDeep} />
                <Text style={styles.soldText}>Sold here</Text>
              </View>
            ) : where ? (
              <Pressable onPress={() => onSell(needs)} hitSlop={6} style={({ pressed }) => [styles.sell, pressed && styles.pressed]} accessibilityRole="button">
                <Text style={styles.sellText}>Sell it</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  hint: { ...typography.body, fontSize: 13.5, color: colors.slateDeep, lineHeight: 19 },
  band: { backgroundColor: colors.white, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  name: { ...typography.bodyStrong, fontSize: 15, color: colors.ink, fontWeight: '700' },
  nameOff: { color: colors.slateDeep },
  meta: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  sold: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: '#CCFBF1' },
  soldText: { ...typography.caption, fontSize: 11.5, fontWeight: '800', color: colors.tealDeep, letterSpacing: 0 },
  sell: { paddingHorizontal: spacing.sm + 4, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.indigoPale },
  sellText: { ...typography.label, fontSize: 13, fontWeight: '800', color: colors.indigo },
});
