import React, { memo, useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { categoryForClass, type VehicleCategory } from '@mana/domain';
import { IconPlus, colors, radius, showToast, spacing, typography } from '@mana/ui';
import { api, apiErrorMessage, type ApiResponse } from '../../api/client';
import { useCatalog } from '../business/shared';
import { SizesPanel } from '../business/prices/SizesPanel';

/**
 * Head office's tools in the vehicle size guide: which size each kind of vehicle is priced as
 * (and their names) for every group in this tab, adding a model, and putting back models taken
 * off the list. Changes reach every branch and the customer app.
 */
export const GuideEditor = memo(function GuideEditor({
  category,
  removed,
  onAddModel,
  onChanged,
}: {
  category: VehicleCategory;
  removed: { make: string; model: string; category: string }[];
  onAddModel: () => void;
  /** The guide reloads after a change here. */
  onChanged: () => Promise<void>;
}) {
  const { catalog, run } = useCatalog();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Saving reloads the business catalog (run) and then the guide.
  const runAndReload = useCallback(
    async (call: () => Promise<ApiResponse>, done?: string) => {
      const message = await run(call, done);
      if (!message) await onChanged();
      return message;
    },
    [run, onChanged],
  );

  const putBack = async (m: { make: string; model: string }) => {
    setBusyKey(`${m.make}|${m.model}`);
    try {
      const res = await api.business['vehicle-models'].reset.$post({ json: { make: m.make, model: m.model } });
      if (!res.ok) showToast(await apiErrorMessage(res, 'Couldn’t put it back.'), 'error');
      else {
        showToast(`${m.model} is back on the list`, 'success');
        await onChanged();
      }
    } catch {
      showToast('This needs a connection. Check your internet and try again.', 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const classes = catalog?.classes.filter((c) => categoryForClass(c.key) === category) ?? [];
  // One group's sizes at a time (Cars, Commercial…), so opening edit mode stays quick.
  const [groupId, setGroupId] = useState<string | null>(null);
  const group = classes.find((c) => c.id === groupId) ?? classes[0] ?? null;
  const removedHere = removed.filter((m) => m.category === category);

  return (
    <View style={styles.wrap}>
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>Editing the guide</Text>
        <Text style={styles.bannerBody}>
          Only head office sees this. Moving a kind to another size changes its price at every branch. Tap a model below to change it.
        </Text>
      </View>

      <Pressable onPress={onAddModel} style={({ pressed }) => [styles.add, pressed && styles.pressed]} accessibilityRole="button">
        <IconPlus size={18} color={colors.indigo} />
        <Text style={styles.addText}>Add a model</Text>
      </Pressable>

      {catalog && group ? (
        <>
          {classes.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groups}>
              {classes.map((c) => {
                const on = c.id === group.id;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setGroupId(c.id)}
                    style={({ pressed }) => [styles.groupChip, on && styles.groupChipOn, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.groupChipText, on && styles.groupChipTextOn]}>{c.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          <SizesPanel catalog={catalog} run={runAndReload} classId={group.id} />
        </>
      ) : (
        <ActivityIndicator color={colors.indigo} />
      )}

      {removedHere.length ? (
        <View style={styles.removed}>
          <Text style={styles.removedTitle}>Taken off the list ({removedHere.length})</Text>
          {removedHere.map((m) => {
            const key = `${m.make}|${m.model}`;
            return (
              <View key={key} style={styles.removedRow}>
                <Text style={styles.removedName} numberOfLines={1}>
                  {m.make} {m.model}
                </Text>
                <Pressable onPress={() => void putBack(m)} disabled={busyKey != null} hitSlop={8} accessibilityRole="button">
                  {busyKey === key ? <ActivityIndicator size="small" color={colors.indigo} /> : <Text style={styles.link}>Put back</Text>}
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  wrap: { gap: spacing.sm + 2, marginHorizontal: -spacing.md },
  banner: {
    marginHorizontal: spacing.md,
    padding: spacing.sm + 4,
    gap: 3,
    borderRadius: radius.lg,
    backgroundColor: colors.amberPale,
    borderWidth: 1,
    borderColor: colors.amberLight,
  },
  bannerTitle: { ...typography.bodyStrong, fontSize: 14.5, fontWeight: '800', color: colors.amberDeep },
  bannerBody: { ...typography.caption, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, lineHeight: 17 },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.md,
    padding: spacing.sm + 4,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.indigoMist,
    backgroundColor: colors.indigoPale,
  },
  addText: { ...typography.label, fontSize: 14, color: colors.indigo, fontWeight: '800' },
  groups: { gap: spacing.xs + 2, paddingHorizontal: spacing.md },
  groupChip: {
    paddingHorizontal: spacing.sm + 6,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  groupChipOn: { backgroundColor: colors.indigo, borderColor: colors.indigo },
  groupChipText: { fontSize: 13.5, fontWeight: '700', color: colors.slateDeep },
  groupChipTextOn: { color: colors.white },
  removed: {
    marginHorizontal: spacing.md,
    padding: spacing.sm + 4,
    gap: 6,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  removedTitle: { ...typography.label, fontSize: 13, color: colors.waterInk, fontWeight: '800' },
  removedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  removedName: { flex: 1, ...typography.body, fontSize: 14, color: colors.slateDeep },
  link: { ...typography.label, fontSize: 13, color: colors.indigo, fontWeight: '800' },
});
