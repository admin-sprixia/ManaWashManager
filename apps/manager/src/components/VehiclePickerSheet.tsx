import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import type { VehicleCategory } from '@mana/domain';
import {
  colors,
  radius,
  shadow,
  spacing,
  typography,
  BottomSheet,
  Button,
  IconClose,
  IconPlus,
  IconSearch,
} from '@mana/ui';
import { catalogGroups, catalogVehicleFor, VEHICLE_CATALOG } from '../config/vehicleCatalog';
import { VehicleStack } from './VehicleStack';
import { VehicleTile } from './VehicleTile';
import { vehicleImageFor } from './VehicleTypeIcon';

interface VehiclePickerSheetProps {
  visible: boolean;
  category: VehicleCategory;
  /** Vehicle types the shop already has, so those tiles show as selected. */
  existing: { id: string; name: string }[];
  onClose: () => void;
  /** Adds one vehicle type; returns an error message, or null when saved. */
  onAdd: (name: string) => Promise<string | null>;
  /** Removes one vehicle type; returns an error message, or null when removed. */
  onRemove: (id: string) => Promise<string | null>;
}

const COLUMNS = 3;
const ALL = 'All';

/**
 * Photo grid of every vehicle a shop might wash, grouped (Cars, Vans & buses, Trucks…). Tap a
 * tile to select it, tap again to remove it; anything missing can still be typed by hand.
 */
export function VehiclePickerSheet({ visible, category, existing, onClose, onAdd, onRemove }: VehiclePickerSheetProps) {
  const { width } = useWindowDimensions();
  const tileWidth = Math.floor((width - spacing.lg * 2 - spacing.sm * (COLUMNS - 1)) / COLUMNS);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customName, setCustomName] = useState('');
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState(ALL);

  useEffect(() => {
    if (!visible) return;
    setBusyKey(null);
    setError(null);
    setCustomName('');
    setQuery('');
    setGroupFilter(ALL);
  }, [visible]);

  const byName = new Map(existing.map((e) => [e.name.trim().toLowerCase(), e.id]));
  const isPicked = (label: string) => byName.has(label.toLowerCase());
  const catalogLabels = new Set(VEHICLE_CATALOG.map((v) => v.label.toLowerCase()));
  const ownTypes = existing.filter((e) => !catalogLabels.has(e.name.trim().toLowerCase()));
  const groups = useMemo(() => catalogGroups(category), [category]);

  const q = query.trim().toLowerCase();
  const visibleGroups = groups
    .filter(({ group }) => groupFilter === ALL || group === groupFilter)
    .map(({ group, vehicles }) => ({
      group,
      vehicles: q
        ? vehicles.filter((v) => v.label.toLowerCase().includes(q) || v.hint.toLowerCase().includes(q))
        : vehicles,
    }))
    .filter((g) => g.vehicles.length > 0);
  const showOwn = ownTypes.length > 0 && groupFilter === ALL && !q;

  const run = async (key: string, action: () => Promise<string | null>) => {
    if (busyKey) return;
    setBusyKey(key);
    setError(null);
    const message = await action();
    setBusyKey(null);
    if (message) setError(message);
    else if (key === 'custom') setCustomName('');
  };

  const toggle = (key: string, name: string) => {
    const id = byName.get(name.trim().toLowerCase());
    void run(key, () => (id ? onRemove(id) : onAdd(name)));
  };

  const selectAll = (group: string, labels: string[]) =>
    void run(`group:${group}`, async () => {
      for (const label of labels) {
        const message = await onAdd(label);
        if (message) return message;
      }
      return null;
    });

  const custom = customName.trim();
  const customTaken = custom.length > 0 && byName.has(custom.toLowerCase());
  const customMatch = custom.length >= 2 ? catalogVehicleFor(custom) : null;
  const count = existing.length;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      dismissable={!busyKey}
      title={category === 'bike' ? 'Two-wheelers you wash' : 'Vehicles you wash'}
      subtitle="Tap a photo to add it. Tap again to remove."
      footer={
        <View style={styles.footer}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.summary}>
            {count > 0 ? (
              <VehicleStack names={existing.map((e) => e.name)} size={26} max={5} />
            ) : null}
            <Text style={[styles.summaryText, count > 0 && styles.summaryTextOn]}>
              {count === 0 ? 'Nothing selected yet' : `${count} vehicle${count === 1 ? '' : 's'} in your shop`}
            </Text>
          </View>
          <Button label="Done" size="lg" onPress={onClose} disabled={!!busyKey} />
        </View>
      }
    >
      {/* Search */}
      <View style={styles.search}>
        <IconSearch size={18} color={colors.slate} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={category === 'bike' ? 'Search, e.g. Activa or Bullet' : 'Search, e.g. Innova or Bus'}
          placeholderTextColor={colors.slate}
          returnKeyType="search"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10} style={styles.searchClear}>
            <IconClose size={12} color={colors.white} />
          </Pressable>
        ) : null}
      </View>

      {/* Group filter */}
      {groups.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
          keyboardShouldPersistTaps="handled"
        >
          {[ALL, ...groups.map((g) => g.group)].map((g) => {
            const on = g === groupFilter;
            const picked =
              g === ALL ? count : (groups.find((x) => x.group === g)?.vehicles ?? []).filter((v) => isPicked(v.label)).length;
            return (
              <Pressable
                key={g}
                onPress={() => setGroupFilter(g)}
                style={({ pressed }) => [styles.filterChip, on && styles.filterChipOn, pressed && styles.pressed]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.filterText, on && styles.filterTextOn]}>{g}</Text>
                {picked > 0 ? (
                  <View style={[styles.filterCount, on && styles.filterCountOn]}>
                    <Text style={[styles.filterCountText, on && styles.filterCountTextOn]}>{picked}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {showOwn ? (
        <View style={styles.group}>
          <View style={styles.groupHead}>
            <Text style={styles.groupLabel}>Your own</Text>
            <Text style={styles.groupMeta}>{ownTypes.length} added</Text>
          </View>
          <View style={styles.grid}>
            {ownTypes.map((t) => (
              <VehicleTile
                key={t.id}
                label={t.name}
                image={vehicleImageFor(t.name)}
                width={tileWidth}
                selected
                busy={busyKey === t.id}
                disabled={!!busyKey}
                onPress={() => void run(t.id, () => onRemove(t.id))}
              />
            ))}
          </View>
        </View>
      ) : null}

      {visibleGroups.map(({ group, vehicles }) => {
        const picked = vehicles.filter((v) => isPicked(v.label)).length;
        const missing = vehicles.filter((v) => !isPicked(v.label)).map((v) => v.label);
        const groupBusy = busyKey === `group:${group}`;
        return (
          <View key={group} style={styles.group}>
            <View style={styles.groupHead}>
              <View style={styles.groupTitleRow}>
                <Text style={styles.groupLabel}>{group}</Text>
                <Text style={styles.groupMeta}>
                  {picked} of {vehicles.length}
                </Text>
              </View>
              {missing.length > 0 && !q ? (
                <Pressable
                  onPress={() => selectAll(group, missing)}
                  disabled={!!busyKey}
                  hitSlop={8}
                  style={({ pressed }) => [styles.selectAll, pressed && styles.pressed]}
                >
                  {groupBusy ? (
                    <ActivityIndicator size="small" color={colors.waterDeep} />
                  ) : (
                    <Text style={styles.selectAllText}>Select all</Text>
                  )}
                </Pressable>
              ) : picked > 0 && !q ? (
                <View style={styles.allSet}>
                  <Text style={styles.allSetText}>All added</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.grid}>
              {vehicles.map((v) => (
                <VehicleTile
                  key={v.key}
                  label={v.label}
                  hint={v.hint}
                  image={v.image}
                  width={tileWidth}
                  selected={isPicked(v.label)}
                  busy={busyKey === v.key}
                  disabled={!!busyKey}
                  onPress={() => toggle(v.key, v.label)}
                />
              ))}
            </View>
          </View>
        );
      })}

      {visibleGroups.length === 0 && q ? (
        <Text style={styles.noMatch}>No vehicle called “{query.trim()}” — add it below.</Text>
      ) : null}

      {/* Anything not in the catalogue */}
      <View style={[styles.customCard, shadow('sm')]}>
        <View style={styles.customHead}>
          <View style={styles.customIcon}>
            {customMatch ? (
              <Image source={customMatch.image} style={styles.customPhoto} resizeMode="cover" />
            ) : (
              <IconPlus size={18} color={colors.waterDeep} />
            )}
          </View>
          <View style={styles.customCopy}>
            <Text style={styles.customTitle}>Not in the list?</Text>
            <Text style={styles.customSub}>Type any vehicle and add it to your shop.</Text>
          </View>
        </View>
        <View style={styles.customRow}>
          <TextInput
            style={styles.customInput}
            value={customName}
            onChangeText={(t) => {
              setCustomName(t);
              setError(null);
            }}
            placeholder={category === 'bike' ? 'e.g. Electric bike' : 'e.g. Ambulance'}
            placeholderTextColor={colors.slate}
            maxLength={40}
          />
          <Pressable
            onPress={() => void run('custom', () => onAdd(custom))}
            disabled={custom.length < 2 || customTaken || !!busyKey}
            style={({ pressed }) => [
              styles.customAdd,
              (custom.length < 2 || customTaken) && styles.customAddOff,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Add vehicle"
          >
            {busyKey === 'custom' ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.customAddText}>Add</Text>
            )}
          </Pressable>
        </View>
        {custom.length >= 2 ? (
          <Text style={[styles.customHint, customTaken && styles.customHintWarn]}>
            {customTaken
              ? 'Your shop already has this one.'
              : customMatch
                ? `Will use the ${customMatch.label} photo.`
                : 'Will use a general vehicle photo.'}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.65 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 46,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.waterInk, paddingVertical: 0 },
  searchClear: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.slate,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: { gap: spacing.sm, paddingRight: spacing.lg },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipOn: { backgroundColor: colors.waterInk, borderColor: colors.waterInk },
  filterText: { ...typography.label, fontSize: 14, color: colors.waterInk },
  filterTextOn: { color: colors.white, fontWeight: '700' },
  filterCount: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCountOn: { backgroundColor: 'rgba(255,255,255,0.2)' },
  filterCountText: { ...typography.caption, fontSize: 11, fontWeight: '800', color: colors.waterDeep, letterSpacing: 0 },
  filterCountTextOn: { color: colors.white },
  group: { gap: spacing.sm + 4, marginTop: spacing.xs },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  groupTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  groupLabel: { ...typography.heading, fontSize: 18, color: colors.waterInk, letterSpacing: -0.2 },
  groupMeta: { ...typography.caption, fontSize: 13, color: colors.slateDeep, letterSpacing: 0 },
  selectAll: {
    minWidth: 84,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectAllText: { ...typography.caption, fontSize: 12.5, color: colors.waterDeep, fontWeight: '700', letterSpacing: 0 },
  allSet: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: '#CCFBF1',
    justifyContent: 'center',
  },
  allSetText: { ...typography.caption, fontSize: 12.5, color: colors.tealDeep, fontWeight: '700', letterSpacing: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.sm, rowGap: spacing.md },
  noMatch: { ...typography.body, fontSize: 14, color: colors.slateDeep, textAlign: 'center', paddingVertical: spacing.md },
  customCard: {
    gap: spacing.sm + 4,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  customHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  customIcon: {
    width: 52,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  customPhoto: { width: '100%', height: '100%' },
  customCopy: { flex: 1, gap: 2 },
  customTitle: { ...typography.bodyStrong, fontSize: 16, color: colors.waterInk },
  customSub: { ...typography.caption, fontSize: 13, color: colors.slateDeep, letterSpacing: 0 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  customInput: {
    flex: 1,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.waterInk,
  },
  customAdd: {
    height: 46,
    minWidth: 76,
    paddingHorizontal: spacing.md + 4,
    borderRadius: radius.pill,
    backgroundColor: colors.water,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customAddOff: { backgroundColor: colors.border },
  customAddText: { ...typography.label, fontSize: 15, color: colors.white, fontWeight: '700' },
  customHint: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0 },
  customHintWarn: { color: colors.amberDeep },
  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  summaryText: { ...typography.caption, fontSize: 13, color: colors.slateDeep, letterSpacing: 0 },
  summaryTextOn: { color: colors.waterInk, fontWeight: '700' },
  error: {
    ...typography.label,
    color: colors.danger,
    backgroundColor: '#FEE2E2',
    borderRadius: radius.sm,
    padding: spacing.sm + 2,
  },
  footer: { gap: spacing.sm + 2 },
});
