import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { VehicleArt, colors, radius, spacing, typography } from '@mana/ui';
import type { Catalog } from '../shared';

/**
 * The kinds of vehicle a branch washes, by group (Cars, Two-wheelers, Farm & machines…) and,
 * inside each group, by size: S · Small, M · Medium… with a switch for the group and for each
 * kind. Used on a branch's page and when opening a branch.
 */
export function VehicleKindsList({
  catalog,
  value,
  onChange,
  disabled,
}: {
  catalog: Catalog;
  /** The kinds switched on (body type ids). */
  value: string[];
  /** The new list, and what changed ("Tractor on", "Cars off") for a message. */
  onChange: (next: string[], what: string) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.wrap}>
      {catalog.classes.map((cls) => {
        const kinds = catalog.bodyTypes.filter((b) => b.classId === cls.id);
        if (!kinds.length) return null;
        const ids = kinds.map((b) => b.id);
        const onHere = kinds.filter((b) => value.includes(b.id)).length;
        const sizes = cls.sizes.filter((z) => kinds.some((b) => b.sizeId === z.id));
        return (
          <View key={cls.id} style={styles.group}>
            <View style={[styles.groupHead, onHere === 0 && styles.groupHeadOff]}>
              <View style={styles.flex}>
                <Text style={styles.groupTitle}>{cls.name}</Text>
                <Text style={styles.groupMeta}>
                  {onHere === kinds.length ? `All ${kinds.length} on` : onHere === 0 ? 'Not washed here' : `${onHere} of ${kinds.length} on`}
                </Text>
              </View>
              <Switch
                value={onHere > 0}
                disabled={disabled}
                onValueChange={(next) =>
                  onChange(next ? [...new Set([...value, ...ids])] : value.filter((id) => !ids.includes(id)), `${cls.name} ${next ? 'on' : 'off'}`)
                }
                trackColor={{ true: colors.indigo, false: colors.border }}
                thumbColor={colors.white}
                accessibilityLabel={cls.name}
              />
            </View>
            {onHere > 0 ? (
              <View style={styles.band}>
                {sizes.map((z, zi) => (
                  <View key={z.id} style={[zi > 0 && styles.sizeDivider]}>
                    <View style={styles.sizeHead}>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{z.key}</Text>
                      </View>
                      <Text style={styles.sizeName}>{z.name}</Text>
                    </View>
                    {kinds
                      .filter((b) => b.sizeId === z.id)
                      .map((b) => {
                        const on = value.includes(b.id);
                        return (
                          <View key={b.id} style={styles.row}>
                            <VehicleArt name={b.name} bodyKey={b.key} style={styles.art} />
                            <Text style={[styles.name, !on && styles.nameOff]} numberOfLines={1}>
                              {b.name}
                            </Text>
                            <Switch
                              value={on}
                              disabled={disabled}
                              onValueChange={(next) =>
                                onChange(next ? [...value, b.id] : value.filter((x) => x !== b.id), `${b.name} ${next ? 'on' : 'off'}`)
                              }
                              trackColor={{ true: colors.indigo, false: colors.border }}
                              thumbColor={colors.white}
                              accessibilityLabel={b.name}
                            />
                          </View>
                        );
                      })}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  wrap: { gap: spacing.md },
  group: { gap: 6 },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.lg,
    backgroundColor: colors.indigoPale,
  },
  groupHeadOff: { backgroundColor: '#F1F5F9' },
  groupTitle: { ...typography.bodyStrong, fontSize: 16, fontWeight: '800', color: colors.waterInk },
  groupMeta: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0 },
  band: { backgroundColor: colors.white, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  sizeDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sizeHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm + 2, paddingBottom: 2 },
  badge: { minWidth: 30, height: 24, paddingHorizontal: 6, borderRadius: 12, backgroundColor: colors.indigoPale, alignItems: 'center', justifyContent: 'center' },
  badgeText: { ...typography.label, fontSize: 12, fontWeight: '800', color: colors.indigo },
  sizeName: { ...typography.label, fontSize: 13, fontWeight: '800', color: colors.waterInk },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  art: { width: 40, height: 32, borderRadius: 8 },
  name: { flex: 1, ...typography.bodyStrong, fontSize: 15, color: colors.ink, fontWeight: '700' },
  nameOff: { color: colors.slateDeep },
});
