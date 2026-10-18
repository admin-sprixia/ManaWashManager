import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  BODY_TYPES,
  SIZE_NAMES,
  VEHICLE_CLASSES,
  categoryForClass,
  vehicleGuideRows,
  type VehicleCategory,
  type VehicleGuideRow,
  type VehicleModelEdit,
} from '@mana/domain';
import {
  IconClose,
  IconSearch,
  ScreenContainer,
  ScreenHeader,
  catalogVehicleByKey,
  colors,
  radius,
  spacing,
  typography,
  VehicleArt,
} from '@mana/ui';
import { api } from '../api/client';
import { SelectField } from '../components/SelectField';
import { CacheKeys, readCache, writeCache } from '../offline/cache';
import { GuideEditor } from './guide/GuideEditor';
import { ModelSheet } from './guide/ModelSheet';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'VehicleGuide'>;

interface SizeData {
  classes: { key: string; name: string; category: VehicleCategory; sizes: { key: string; name: string }[] }[];
  bodyTypes: { key: string; name: string; classKey: string | null; sizeKey: string | null; active: boolean }[];
  /** Head office may edit the guide; everyone else looks things up. */
  canEdit?: boolean;
  /** Head office's changes to the built-in list of models. */
  models?: VehicleModelEdit[];
  /** Models head office took off the list (for head office, to put back). */
  removed?: { make: string; model: string; category: string }[];
}

/** Until head office's list loads (or with no connection ever), the sizes every business starts with. */
const DEFAULT_SIZES: SizeData = {
  classes: VEHICLE_CLASSES.map((c) => ({
    key: c.key,
    name: c.name,
    category: c.category,
    sizes: c.sizes.map((s) => ({ key: s, name: SIZE_NAMES[s] })),
  })),
  bodyTypes: BODY_TYPES.map((b) => ({ key: b.key, name: b.label, classKey: b.classKey, sizeKey: b.size, active: true })),
};

const SIZE_TONE: Record<string, { bg: string; fg: string }> = {
  S: { bg: '#DCFCE7', fg: '#166534' },
  M: { bg: '#DBEAFE', fg: '#1E40AF' },
  L: { bg: '#FEF3C7', fg: '#92400E' },
  XL: { bg: '#EDE9FE', fg: '#5B21B6' },
};
const CATEGORY_LABEL: Record<VehicleCategory, string> = { car: 'Cars & more', bike: 'Two-wheelers' };
/** The class whose sizes the filter chips and legend show for each tab. */
const MAIN_CLASS: Record<VehicleCategory, string> = { car: 'car', bike: 'twoWheeler' };

const squash = (t: string) => t.toLowerCase().replace(/[\s\-.]+/g, '');

/**
 * Which size every vehicle is priced as: every company and model we list, its body type, and its
 * size (S, M, L, XL) as head office set them. Search by company or model, filter by size, company
 * or body type. Works offline: the list ships with the app and the sizes are kept on the phone.
 */
export function VehicleGuideScreen({ navigation, route }: Props) {
  const [data, setData] = useState<SizeData>(DEFAULT_SIZES);
  const [category, setCategory] = useState<VehicleCategory>(route.params?.category ?? 'car');
  const [query, setQuery] = useState('');
  const [size, setSize] = useState<string | null>(route.params?.size ?? null);
  const [make, setMake] = useState<string | null>(null);
  const [bodyKey, setBodyKey] = useState<string | null>(null);
  const [showOff, setShowOff] = useState(false);
  const [editing, setEditing] = useState(false);
  /** The model head office is changing; 'new' to add one. */
  const [modelSheet, setModelSheet] = useState<VehicleGuideRow | 'new' | null>(null);
  const allRows = useMemo(() => vehicleGuideRows(data.models ?? []), [data.models]);
  const removedList = useMemo(() => data.removed ?? [], [data.removed]);

  /** The guide from the server; the copy on the phone first only when the screen opens. */
  const fetchFresh = useCallback(async () => {
    try {
      const res = await api.services['vehicle-sizes'].$get();
      if (!res.ok) return;
      const fresh = (await res.json()) as SizeData;
      if (fresh.bodyTypes.length) {
        setData(fresh);
        void writeCache(CacheKeys.vehicleSizes, fresh);
      }
    } catch {
      // Offline: the copy on this phone (or the starting sizes) stands.
    }
  }, []);
  // After head office saves a change: just the fresh guide, drawn once.
  const load = fetchFresh;
  useEffect(() => {
    void (async () => {
      const cached = await readCache<SizeData>(CacheKeys.vehicleSizes);
      if (cached?.bodyTypes.length) setData(cached);
      await fetchFresh();
    })();
  }, [fetchFresh]);

  const body = useMemo(() => new Map(data.bodyTypes.map((b) => [b.key, b])), [data]);
  const sizeName = useCallback(
    (classKey: string | null, key: string | null) =>
      data.classes.find((c) => c.key === classKey)?.sizes.find((s) => s.key === key)?.name ?? (key ? SIZE_NAMES[key as keyof typeof SIZE_NAMES] : ''),
    [data],
  );
  const mainSizes = data.classes.find((c) => c.key === MAIN_CLASS[category])?.sizes ?? [];

  // Reset the narrower filters when switching between cars and two-wheelers.
  const switchCategory = (next: VehicleCategory) => {
    setCategory(next);
    setMake(null);
    setBodyKey(null);
    setSize(null);
  };

  const inCategory = useMemo(
    () => allRows.filter((r) => r.category === category && (showOff || body.get(r.bodyKey)?.active !== false)),
    [allRows, category, showOff, body],
  );
  const makes = useMemo(() => [...new Set(inCategory.map((r) => r.make))], [inCategory]);
  const bodies = useMemo(
    () =>
      data.bodyTypes
        .filter((b) => b.classKey && categoryForClass(b.classKey) === category && (showOff || b.active))
        .filter((b) => inCategory.some((r) => r.bodyKey === b.key)),
    [data, category, showOff, inCategory],
  );

  // What a search matches, worked out once per model (not on every letter typed).
  const searchText = useMemo(
    () => new Map(allRows.map((r) => [r, `${squash(r.model)}|${squash(r.make)}|${squash(`${r.make}${r.model}`)}`])),
    [allRows],
  );
  // The list follows the search box a moment later, so typing never waits for it.
  const typed = useDeferredValue(query);
  const rows = useMemo(() => {
    const q = squash(typed.trim());
    return inCategory.filter((r) => {
      if (size && body.get(r.bodyKey)?.sizeKey !== size) return false;
      if (make && r.make !== make) return false;
      if (bodyKey && r.bodyKey !== bodyKey) return false;
      return !q || (searchText.get(r)?.includes(q) ?? false);
    });
  }, [inCategory, typed, size, make, bodyKey, body, searchText]);

  const sections = useMemo(() => {
    const byMake = new Map<string, VehicleGuideRow[]>();
    for (const r of rows) byMake.set(r.make, [...(byMake.get(r.make) ?? []), r]);
    return [...byMake.entries()].map(([title, items]) => ({ title, data: items }));
  }, [rows]);

  const filtering = query.trim() || size || make || bodyKey;
  const clearAll = () => {
    setQuery('');
    setSize(null);
    setMake(null);
    setBodyKey(null);
  };

  const openModel = useCallback((row: VehicleGuideRow) => setModelSheet(row), []);
  const addModel = useCallback(() => setModelSheet('new'), []);
  const renderItem = useCallback(
    ({ item }: { item: VehicleGuideRow }) => {
      const b = body.get(item.bodyKey);
      return (
        <GuideRow
          item={item}
          kindName={b?.name ?? item.bodyKey}
          sizeKey={b?.sizeKey ?? null}
          sizeLabel={sizeName(b?.classKey ?? null, b?.sizeKey ?? null)}
          off={b?.active === false}
          showChange={!!data.canEdit}
          onPress={editing ? openModel : undefined}
        />
      );
    },
    [body, sizeName, data.canEdit, editing, openModel],
  );
  const modelKinds = useMemo(
    () =>
      data.bodyTypes
        .filter((b) => b.classKey && categoryForClass(b.classKey) === category)
        .map((b) => ({ key: b.key, name: b.name, sizeKey: b.sizeKey })),
    [data.bodyTypes, category],
  );

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['car', 'bike'] as const).map((c) => {
          const on = c === category;
          return (
            <Pressable
              key={c}
              onPress={() => switchCategory(c)}
              style={[styles.tab, on && styles.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{CATEGORY_LABEL[c]}</Text>
            </Pressable>
          );
        })}
      </View>

      {data.canEdit ? (
        <Pressable
          onPress={() => setEditing((v) => !v)}
          style={({ pressed }) => [styles.editToggle, editing && styles.editToggleOn, pressed && styles.pressed]}
          accessibilityRole="switch"
          accessibilityState={{ checked: editing }}
        >
          <Text style={[styles.editToggleText, editing && styles.editToggleTextOn]}>{editing ? 'Done editing' : 'Edit guide (head office)'}</Text>
        </Pressable>
      ) : null}
      {data.canEdit && editing ? (
        <GuideEditor category={category} removed={removedList} onAddModel={addModel} onChanged={load} />
      ) : null}

      {/* What each size means, with the body types in it — tap one to see its models */}
      <View style={styles.legend}>
        {mainSizes.map((s) => {
          const kinds = data.bodyTypes.filter((b) => b.classKey === MAIN_CLASS[category] && b.sizeKey === s.key && (showOff || b.active));
          if (!kinds.length) return null;
          const on = size === s.key;
          const tone = SIZE_TONE[s.key] ?? SIZE_TONE.M!;
          return (
            <Pressable
              key={s.key}
              onPress={() => setSize(on ? null : s.key)}
              style={({ pressed }) => [styles.legendRow, on && styles.legendRowOn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <View style={[styles.sizeBadge, { backgroundColor: tone.bg }]}>
                <Text style={[styles.sizeBadgeText, { color: tone.fg }]}>{s.key}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.legendName}>{s.name}</Text>
                <Text style={styles.legendKinds} numberOfLines={2}>
                  {kinds.map((k) => k.name).join(', ')}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.search}>
        <IconSearch size={17} color={colors.slate} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search a company or model — Creta, Swift, Activa"
          placeholderTextColor={colors.slate}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
            <IconClose size={16} color={colors.slate} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.filters}>
        <View style={styles.flex}>
          <SelectField
            label="Company"
            value={make}
            options={makes.map((m) => ({ value: m, label: m }))}
            onChange={setMake}
            placeholder="All companies"
            sheetTitle="Pick a company"
            searchable
          />
        </View>
        <View style={styles.flex}>
          <SelectField
            label="Body type"
            value={bodyKey}
            options={bodies.map((b) => ({ value: b.key, label: b.name, hint: `${b.sizeKey ?? ''} · ${sizeName(b.classKey, b.sizeKey)}` }))}
            onChange={setBodyKey}
            placeholder="All types"
            sheetTitle="Pick a body type"
          />
        </View>
      </View>

      <View style={styles.countRow}>
        <Text style={styles.count}>
          {rows.length} {rows.length === 1 ? 'model' : 'models'}
          {size ? ` · size ${size}` : ''}
        </Text>
        {filtering ? (
          <Pressable onPress={clearAll} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>Clear filters</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => setShowOff((v) => !v)} hitSlop={8} accessibilityRole="switch" accessibilityState={{ checked: showOff }}>
          <Text style={styles.link}>{showOff ? 'Hide vehicles we don’t wash' : 'Show all vehicles'}</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <ScreenContainer noPadding>
      <View style={styles.headerPad}>
        <ScreenHeader title="Vehicle size guide" onBack={() => navigation.goBack()} />
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(r) => `${r.make}|${r.model}|${r.bodyKey}`}
        ListHeaderComponent={header}
        stickySectionHeadersEnabled
        initialNumToRender={20}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <Text style={styles.sectionCount}>{section.data.length}</Text>
          </View>
        )}
        renderItem={renderItem}
        windowSize={7}
        maxToRenderPerBatch={20}
        updateCellsBatchingPeriod={40}
        removeClippedSubviews
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No model matches</Text>
            <Text style={styles.emptyBody}>
              Check the spelling, or pick the body type instead: a car not listed is priced like others of its shape.
            </Text>
          </View>
        }
      />
      <ModelSheet
        visible={modelSheet != null}
        category={category}
        row={modelSheet === 'new' ? null : modelSheet}
        kinds={modelKinds}
        onClose={() => setModelSheet(null)}
        onSaved={load}
      />
    </ScreenContainer>
  );
}

/** One model in the guide; drawn again only when its own details change (lists have 1,800). */
const GuideRow = memo(function GuideRow({
  item,
  kindName,
  sizeKey,
  sizeLabel,
  off,
  showChange,
  onPress,
}: {
  item: VehicleGuideRow;
  kindName: string;
  sizeKey: string | null;
  sizeLabel: string;
  off: boolean;
  showChange: boolean;
  /** Head office editing: tap to change the model. */
  onPress?: (row: VehicleGuideRow) => void;
}) {
  const tone = SIZE_TONE[sizeKey ?? 'M'] ?? SIZE_TONE.M!;
  return (
    <Pressable
      onPress={onPress ? () => onPress(item) : undefined}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, off && styles.rowOff, onPress && pressed && styles.pressed]}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <VehicleArt name={kindName} bodyKey={item.bodyKey} style={styles.thumb} />
      <View style={styles.flex}>
        <Text style={styles.model} numberOfLines={1}>
          {item.model}
        </Text>
        <Text style={styles.kind} numberOfLines={1}>
          {kindName}
          {item.luxury && item.bodyKey === 'luxury' ? ' · luxury brand' : ''}
          {off ? ' · we don’t wash these' : ''}
        </Text>
      </View>
      {showChange && item.change ? (
        <View style={styles.changeTag}>
          <Text style={styles.changeTagText}>{item.change === 'added' ? 'Added' : 'Changed'}</Text>
        </View>
      ) : null}
      <View style={[styles.sizePill, { backgroundColor: tone.bg }]}>
        <Text style={[styles.sizePillKey, { color: tone.fg }]}>{sizeKey ?? '—'}</Text>
        <Text style={[styles.sizePillName, { color: tone.fg }]} numberOfLines={1}>
          {sizeLabel}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.75 },
  headerPad: { paddingHorizontal: spacing.md },
  list: { paddingBottom: spacing.xxl },
  headerBlock: { paddingHorizontal: spacing.md, gap: spacing.sm + 2, paddingBottom: spacing.sm },
  tabs: { flexDirection: 'row', padding: 3, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tab: { flex: 1, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.indigo },
  tabText: { ...typography.label, fontSize: 13.5, color: colors.slateDeep, fontWeight: '700' },
  tabTextOn: { color: colors.white },
  legend: { backgroundColor: colors.white, borderRadius: radius.xl, padding: spacing.sm, gap: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, padding: spacing.sm, borderRadius: radius.lg },
  legendRowOn: { backgroundColor: colors.indigoPale },
  legendName: { ...typography.bodyStrong, fontSize: 14, color: colors.ink, fontWeight: '700' },
  legendKinds: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  sizeBadge: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sizeBadgeText: { ...typography.heading, fontSize: 16, fontWeight: '800' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { ...typography.body, flex: 1, fontSize: 15, color: colors.ink, paddingVertical: 0 },
  filters: { flexDirection: 'row', gap: spacing.sm },
  countRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md },
  count: { ...typography.caption, flex: 1, fontSize: 12.5, color: colors.slateDeep, letterSpacing: 0, fontWeight: '700' },
  link: { ...typography.caption, fontSize: 12.5, color: colors.indigo, fontWeight: '700', letterSpacing: 0 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  sectionTitle: { ...typography.label, fontSize: 13, color: colors.waterInk, fontWeight: '800' },
  sectionCount: { ...typography.caption, fontSize: 12, color: colors.slate, letterSpacing: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowOff: { opacity: 0.55 },
  editToggle: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.amber,
    backgroundColor: colors.white,
  },
  editToggleOn: { backgroundColor: colors.amberDeep, borderColor: colors.amberDeep },
  editToggleText: { ...typography.label, fontSize: 13.5, color: colors.amberDeep, fontWeight: '800' },
  editToggleTextOn: { color: colors.white },
  changeTag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.amberPale },
  changeTagText: { ...typography.caption, fontSize: 10.5, fontWeight: '800', color: colors.amberDeep, letterSpacing: 0.2 },
  thumb: { width: 48, height: 34, borderRadius: 8, backgroundColor: colors.surface },
  model: { ...typography.bodyStrong, fontSize: 14.5, color: colors.ink, fontWeight: '700' },
  kind: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  sizePill: { minWidth: 64, maxWidth: 110, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, alignItems: 'center' },
  sizePillKey: { ...typography.heading, fontSize: 15, fontWeight: '800' },
  sizePillName: { ...typography.caption, fontSize: 10, fontWeight: '700', letterSpacing: 0 },
  empty: { margin: spacing.md, padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.white, gap: 6 },
  emptyTitle: { ...typography.bodyStrong, fontSize: 16, color: colors.ink, fontWeight: '800' },
  emptyBody: { ...typography.body, fontSize: 14, color: colors.slateDeep, lineHeight: 20 },
});
