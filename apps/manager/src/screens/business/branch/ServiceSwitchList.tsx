import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { formatDuration, servicePlacesLabel, type BranchServices } from '@mana/domain';
import { colors, radius, spacing, typography } from '@mana/ui';
import { formatRupees } from '../../../utils/format';
import type { Catalog } from '../shared';
import { groupServices, startingPrice } from '../servicesShared';

/**
 * Every head-office service with a switch, grouped as in Services. Used on a branch's page (each
 * switch saves straight away) and when opening a branch (picked before it opens). A switched-on
 * service that still won't sell says why: no price yet, or a place the branch doesn't work.
 */
export function ServiceSwitchList({
  catalog,
  value,
  onToggle,
  onAll,
  runs,
  disabled,
}: {
  catalog: Catalog;
  /** The services switched on. */
  value: string[];
  onToggle: (id: string, on: boolean) => void;
  onAll: (on: boolean) => void;
  /** Where the branch works (its agreement, or what's switched on): explains services that won't sell. */
  runs: BranchServices;
  disabled?: boolean;
}) {
  const live = catalog.services.filter((s) => s.active);
  const groups = groupServices(catalog, live);
  const onCount = live.filter((s) => value.includes(s.id)).length;

  const blocker = (s: Catalog['services'][number]): string | null => {
    if (startingPrice(catalog, s) == null) return 'No prices yet: it shows once it’s priced in Base prices';
    const sells = (s.places.shop && runs.hub) || (s.places.community && runs.community) || (s.places.doorstep && runs.doorstep);
    if (!sells) return `Not sold here: this branch doesn’t do ${servicePlacesLabel(s.places).replace(' only', '').toLowerCase()}`;
    return null;
  };

  if (!live.length) return <Text style={styles.hint}>No services yet. Add them in More › Mana Wash HQ › Services and plans.</Text>;

  return (
    <View style={styles.wrap}>
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {onCount} of {live.length} on
        </Text>
        <Pressable onPress={() => onAll(true)} disabled={disabled || onCount === live.length} hitSlop={6} accessibilityRole="button">
          <Text style={[styles.link, (disabled || onCount === live.length) && styles.linkOff]}>All on</Text>
        </Pressable>
        <Pressable onPress={() => onAll(false)} disabled={disabled || onCount === 0} hitSlop={6} accessibilityRole="button">
          <Text style={[styles.link, (disabled || onCount === 0) && styles.linkOff]}>All off</Text>
        </Pressable>
      </View>
      {groups.map((g) => (
        <View key={g.key} style={styles.group}>
          <Text style={styles.groupTitle}>{g.title}</Text>
          <View style={styles.band}>
            {g.items.map((s, i) => {
              const on = value.includes(s.id);
              const from = startingPrice(catalog, s);
              const why = on ? blocker(s) : null;
              const parts = s.includes.map((id) => catalog.services.find((x) => x.id === id)?.name).filter(Boolean);
              return (
                <View key={s.id} style={[styles.row, i < g.items.length - 1 && styles.divider]}>
                  <View style={styles.flex}>
                    <Text style={[styles.name, !on && styles.nameOff]}>{s.name}</Text>
                    <Text style={styles.meta} numberOfLines={2}>
                      {[
                        from != null ? `From ${formatRupees(from)}` : 'No prices yet',
                        servicePlacesLabel(s.places),
                        s.durationMin ? formatDuration(s.durationMin) : null,
                        parts.length ? `Combo: ${parts.join(' + ')}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    {why ? <Text style={styles.warn}>{why}</Text> : null}
                  </View>
                  <Switch
                    value={on}
                    onValueChange={(next) => onToggle(s.id, next)}
                    disabled={disabled}
                    trackColor={{ true: colors.indigo, false: colors.border }}
                    thumbColor={colors.white}
                    accessibilityLabel={s.name}
                  />
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  wrap: { gap: spacing.sm + 2 },
  hint: { ...typography.body, fontSize: 13.5, color: colors.slateDeep, lineHeight: 19 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryText: { ...typography.label, flex: 1, fontSize: 13, color: colors.waterInk, fontWeight: '800' },
  link: { ...typography.caption, fontSize: 13, color: colors.indigo, fontWeight: '700', letterSpacing: 0 },
  linkOff: { color: colors.slate },
  group: { gap: 6 },
  groupTitle: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0.4, fontWeight: '800', textTransform: 'uppercase' },
  band: { backgroundColor: colors.white, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  name: { ...typography.bodyStrong, fontSize: 15, color: colors.ink, fontWeight: '700' },
  nameOff: { color: colors.slateDeep },
  meta: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  warn: { ...typography.caption, fontSize: 12, color: colors.amberDeep, fontWeight: '700', letterSpacing: 0, marginTop: 2 },
});
