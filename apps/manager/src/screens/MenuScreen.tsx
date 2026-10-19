import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { VehicleCategory } from '@mana/domain';
import {
  GradientHero,
  MakeLogo,
  ScreenContainer,
  brandGradients,
  showToast,
  IconAlert,
  IconCar,
  IconChevronLeft,
  IconClock,
  IconClose,
  IconCloudOff,
  IconShare,
  IconSparkle,
  colors,
  radius,
  spacing,
  typography,
} from '@mana/ui';
import { LaneTabs } from '../components/board/LaneTabs';
import { LANE_META, LANE_ORDER, type Lane } from '../components/board/lanes';
import { VehicleModelPicker, useModelEdits } from '../components/newWash/VehicleModelPicker';
import { useShop } from '../offline/ShopProvider';
import { useOpened } from '../utils/useOpened';
import { formatRupees } from '../utils/format';
import {
  forCategory,
  forVehicle,
  laneMenu,
  lowestPrice,
  useBranchMenu,
  visitChargeLine,
  type MenuItem,
  type MenuVehicleType,
} from '../utils/branchMenu';
import { shareMenuPdf } from '../utils/menuPdf';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Menu'>;

const CATEGORY_LABEL: Record<VehicleCategory, string> = { car: 'Cars', bike: 'Two-wheelers' };
const MENU_NAME: Record<Lane, string> = {
  hub: 'hub',
  community: 'community',
  doorstep: 'doorstep',
};

const CARD_SHADOW = {
  shadowColor: '#0C1442',
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

/** How many size chips a card shows before "+N more". */
const CHIPS_SHOWN = 6;

/**
 * One service or plan. Memoized: a tap elsewhere (another filter, the share button) doesn't
 * redraw every card, and only a few size chips are drawn until "+N more" is tapped.
 */
const MenuCard = React.memo(function MenuCard({
  item,
  pickedTypeId,
  types,
  accent,
  onPickType,
}: {
  item: MenuItem;
  pickedTypeId: string | null;
  types: readonly MenuVehicleType[];
  accent: string;
  onPickType: (t: MenuVehicleType) => void;
}) {
  const [allChips, setAllChips] = useState(false);
  const one = pickedTypeId ? (item.prices.get(pickedTypeId) ?? null) : null;
  const sized = useMemo(() => types.filter((t) => item.prices.has(t.id)), [types, item]);
  const from = useMemo(
    () =>
      lowestPrice(
        item,
        sized.map((t) => t.id),
      ),
    [item, sized],
  );
  const sub = item.includedNames.length
    ? `Includes ${item.includedNames.join(', ')}`
    : item.service.description;
  const saving = pickedTypeId ? (item.saving?.get(pickedTypeId) ?? null) : null;
  const chips = allChips ? sized : sized.slice(0, CHIPS_SHOWN);
  return (
    <View style={styles.item}>
      <View style={styles.itemTop}>
        <View style={styles.flex}>
          <View style={styles.nameRow}>
            <Text style={styles.itemName} numberOfLines={2}>
              {item.service.name}
            </Text>
            {item.service.popular ? (
              <View style={styles.popular}>
                <IconSparkle size={10} color="#8A5A12" />
                <Text style={styles.popularText}>Popular</Text>
              </View>
            ) : null}
          </View>
          {sub ? (
            <Text style={styles.itemSub} numberOfLines={3}>
              {sub}
            </Text>
          ) : null}
          {item.service.durationMin ? (
            <View style={styles.durRow}>
              <IconClock size={11} color={colors.slate} />
              <Text style={styles.durText}>{item.service.durationMin} min</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.priceBox}>
          {one != null ? (
            <>
              <Text style={[styles.priceBig, { color: accent }]}>{formatRupees(one)}</Text>
              {saving ? (
                <View style={styles.savePill}>
                  <Text style={styles.saveText}>Save {formatRupees(saving)}</Text>
                </View>
              ) : null}
            </>
          ) : from != null ? (
            <>
              <Text style={styles.fromLabel}>{sized.length > 1 ? 'from' : ''}</Text>
              <Text style={[styles.priceBig, { color: accent }]}>{formatRupees(from)}</Text>
            </>
          ) : null}
        </View>
      </View>
      {one == null && sized.length > 1 ? (
        <View style={styles.chipWrap}>
          {chips.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => onPickType(t)}
              style={({ pressed }) => [styles.sizeChip, pressed && styles.pressed]}
            >
              <Text style={styles.sizeName} numberOfLines={1}>
                {t.name}
              </Text>
              <Text style={styles.sizePrice}>{formatRupees(item.prices.get(t.id)!)}</Text>
            </Pressable>
          ))}
          {sized.length > CHIPS_SHOWN ? (
            <Pressable
              onPress={() => setAllChips((v) => !v)}
              style={({ pressed }) => [styles.sizeChip, styles.moreChip, pressed && styles.pressed]}
            >
              <Text style={[styles.sizePrice, { color: accent }]}>
                {allChips ? 'Fewer' : `+${sized.length - CHIPS_SHOWN} more`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

/**
 * The branch's menu: its hub, community and doorstep menus (only the ones it runs), for every
 * vehicle or one — picked by company and model, or by size — with only the vehicles this branch
 * washes. Shared as a print-ready PDF on the logo's night indigo.
 */
export function MenuScreen({ navigation }: Props) {
  const { info: shop } = useShop();
  const { catalog, loading, error, reload } = useBranchMenu();
  /** The menu (hundreds of prices) is drawn once the screen has slid in, so opening is instant. */
  const opened = useOpened(navigation, 300);
  const edits = useModelEdits(opened);
  const [laneChoice, setLaneChoice] = useState<Lane | null>(null);
  const [category, setCategory] = useState<VehicleCategory | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [make, setMake] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [notWashed, setNotWashed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sharing, setSharing] = useState(false);

  const lanes = useMemo(() => {
    if (!catalog) return ['hub'] as Lane[];
    const on = LANE_ORDER.filter((l) => catalog.lanes[l]);
    return on.length ? on : (['hub'] as Lane[]);
  }, [catalog]);
  const lane: Lane = laneChoice && lanes.includes(laneChoice) ? laneChoice : lanes[0]!;
  const meta = LANE_META[lane];
  const accent = meta.accent;

  const full = useMemo(
    () => (catalog ? laneMenu(catalog, lane) : { sections: [], vehicleTypes: [] }),
    [catalog, lane],
  );
  const categories = useMemo(() => [...new Set(full.vehicleTypes.map((t) => t.category))], [full]);
  // A picked size this menu doesn't sell drops back to every vehicle.
  const pickedType = typeId ? (full.vehicleTypes.find((t) => t.id === typeId) ?? null) : null;
  const shown = useMemo(
    () =>
      pickedType
        ? forVehicle(full, pickedType.id)
        : forCategory(full, category && categories.includes(category) ? category : null),
    [full, pickedType, category, categories],
  );
  const shownTypes = shown.vehicleTypes;
  const itemCount = shown.sections.reduce((n, s) => n + s.items.length, 0);

  const clearVehicle = () => {
    setTypeId(null);
    setMake(null);
    setModel(null);
    setNotWashed(false);
  };
  const pickLane = (l: Lane) => {
    setLaneChoice(l);
    setNotWashed(false);
  };
  const pickType = useCallback((t: MenuVehicleType | null) => {
    setTypeId(t?.id ?? null);
    setMake(null);
    setModel(null);
    setNotWashed(false);
    if (t) setCategory(t.category);
  }, []);

  const vehicleLabel = pickedType
    ? make && model
      ? `${make} ${model} · ${pickedType.name}`
      : pickedType.name
    : null;

  const share = async () => {
    if (!catalog || sharing) return;
    setSharing(true);
    try {
      await shareMenuPdf({
        lane,
        menu: shown,
        branch: {
          name: shop?.name ?? 'Mana Wash',
          code: shop?.code ?? null,
          city: shop?.city ?? null,
        },
        vehicleLabel:
          vehicleLabel ?? (category && categories.length > 1 ? CATEGORY_LABEL[category] : null),
        vehicleTypeId: pickedType?.id ?? null,
        visit: catalog.visit,
      });
    } catch (e) {
      showToast(
        e instanceof Error ? `Couldn’t make the PDF: ${e.message}` : 'Couldn’t make the PDF.',
        'error',
      );
    } finally {
      setSharing(false);
    }
  };

  return (
    <ScreenContainer noPadding edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void reload().finally(() => setRefreshing(false));
            }}
            tintColor={colors.white}
            colors={[accent]}
          />
        }
      >
        <GradientHero palette={meta.palette}>
          <View style={styles.heroContent}>
            <View style={styles.topRow}>
              <Pressable
                onPress={() => navigation.goBack()}
                hitSlop={8}
                style={({ pressed }) => [styles.glassBtn, pressed && styles.pressed]}
                accessibilityLabel="Back"
              >
                <IconChevronLeft size={20} color={colors.white} />
              </Pressable>
              <View style={styles.flex}>
                <Text style={styles.eyebrow}>
                  {shop ? `${shop.name} · ${shop.code}` : 'Branch menu'}
                </Text>
                <Text style={styles.heroTitle}>Menu</Text>
              </View>
            </View>
            {lanes.length > 1 ? <LaneTabs lanes={lanes} value={lane} onChange={pickLane} /> : null}
            <View style={styles.heroChips}>
              <View style={styles.heroChip}>
                <Text style={styles.heroChipLabel}>Services</Text>
                <Text style={styles.heroChipValue}>{itemCount}</Text>
              </View>
              <View style={styles.heroChip}>
                <Text style={styles.heroChipLabel}>{pickedType ? 'Vehicle' : 'Vehicle sizes'}</Text>
                <Text style={styles.heroChipValue} numberOfLines={1}>
                  {pickedType ? pickedType.name : shownTypes.length}
                </Text>
              </View>
            </View>
          </View>
        </GradientHero>

        <View style={styles.body}>
          {error ? (
            <View style={styles.notice}>
              {error.startsWith('Offline') ? (
                <IconCloudOff size={15} color={colors.amberDeep} />
              ) : (
                <IconAlert size={15} color={colors.amberDeep} />
              )}
              <Text style={styles.noticeText}>{error}</Text>
            </View>
          ) : null}

          {/* Which vehicle: every one, cars or bikes, a size, or a company and model */}
          {opened ? (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={[styles.cardIcon, { backgroundColor: colors.indigoPale }]}>
                  <IconCar size={16} color={colors.indigo} />
                </View>
                <Text style={styles.cardTitle}>Which vehicle?</Text>
                {pickedType || category ? (
                  <Pressable
                    onPress={() => {
                      clearVehicle();
                      setCategory(null);
                    }}
                    hitSlop={6}
                    style={styles.resetBtn}
                  >
                    <Text style={styles.resetText}>Show all</Text>
                  </Pressable>
                ) : null}
              </View>

              {pickedType ? (
                <View style={[styles.picked, { borderColor: accent }]}>
                  {make ? <MakeLogo make={make} height={30} /> : null}
                  <View style={styles.flex}>
                    <Text style={styles.pickedTitle} numberOfLines={1}>
                      {make && model ? `${make} ${model}` : pickedType.name}
                    </Text>
                    <Text style={styles.pickedSub}>
                      {make && model
                        ? `Priced as ${pickedType.name}`
                        : CATEGORY_LABEL[pickedType.category]}
                    </Text>
                  </View>
                  <Pressable
                    onPress={clearVehicle}
                    hitSlop={8}
                    style={styles.clearBtn}
                    accessibilityLabel="Clear vehicle"
                  >
                    <IconClose size={12} color={colors.slateDeep} />
                  </Pressable>
                </View>
              ) : (
                <View style={styles.segment}>
                  {[null, ...categories].map((c) => {
                    const on = category === c || (c === null && !category);
                    return (
                      <Pressable
                        key={c ?? 'all'}
                        onPress={() => setCategory(c)}
                        style={[styles.segmentItem, on && { backgroundColor: accent }]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                          {c ? CATEGORY_LABEL[c] : 'All vehicles'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <Text style={styles.subLabel}>By size</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.typeStrip}
              >
                {full.vehicleTypes
                  .filter((t) => !category || t.category === category || t.id === typeId)
                  .map((t) => {
                    const on = pickedType?.id === t.id;
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => (on ? clearVehicle() : pickType(t))}
                        style={({ pressed }) => [
                          styles.typeChip,
                          on && { backgroundColor: accent, borderColor: accent },
                          pressed && !on && styles.pressed,
                        ]}
                      >
                        <Text style={[styles.typeText, on && styles.typeTextOn]}>{t.name}</Text>
                      </Pressable>
                    );
                  })}
              </ScrollView>

              <Text style={styles.subLabel}>Or by company and model</Text>
              <View style={styles.pickerWrap}>
                <VehicleModelPicker
                  types={full.vehicleTypes}
                  edits={edits}
                  make={make}
                  model={model}
                  onMake={(m) => {
                    setMake(m);
                    setModel(null);
                    setTypeId(null);
                    setNotWashed(false);
                  }}
                  onPick={(m, id) => {
                    setModel(m);
                    if (id) {
                      setTypeId(id);
                      const t = full.vehicleTypes.find((x) => x.id === id);
                      if (t) setCategory(t.category);
                      setNotWashed(false);
                    } else {
                      setTypeId(null);
                      setNotWashed(true);
                    }
                  }}
                />
              </View>
              {notWashed ? (
                <View style={styles.warn}>
                  <IconAlert size={14} color={colors.amberDeep} />
                  <Text style={styles.warnText}>
                    {make} {model} isn’t on this branch’s {MENU_NAME[lane]} menu. Pick a size above
                    to see the closest prices.
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {lane === 'doorstep' && catalog?.visit ? (
            <View style={[styles.visit, { borderColor: accent }]}>
              <meta.Icon size={16} color={accent} />
              <Text style={styles.visitText}>
                <Text style={styles.visitStrong}>Plus a visit charge: </Text>
                {visitChargeLine(catalog.visit, formatRupees)}. Two cars at one home share it.
              </Text>
            </View>
          ) : null}

          {!opened || (loading && !catalog) ? (
            <ActivityIndicator color={accent} style={styles.loader} />
          ) : shown.sections.length === 0 ? (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.indigoPale }]}>
                <meta.Icon size={26} color={accent} />
              </View>
              <Text style={styles.emptyTitle}>
                Nothing on this menu{pickedType ? ` for ${pickedType.name}` : ''}
              </Text>
              <Text style={styles.emptyBody}>
                Services and prices come from Mana Wash HQ. Ask HQ to switch them on for this
                branch.
              </Text>
            </View>
          ) : (
            shown.sections.map((section) => (
              <View key={section.group} style={styles.section}>
                <View style={styles.sectionHead}>
                  <View style={[styles.sectionBar, { backgroundColor: accent }]} />
                  <Text style={styles.sectionTitle}>{section.group}</Text>
                  <Text style={styles.sectionMeta}>
                    {section.items.length} {section.group === 'Plans' ? 'plan' : 'service'}
                    {section.items.length === 1 ? '' : 's'}
                  </Text>
                </View>
                <View style={styles.sectionCard}>
                  {section.items.map((item) => (
                    <MenuCard
                      key={item.service.id}
                      item={item}
                      pickedTypeId={pickedType?.id ?? null}
                      types={shownTypes}
                      accent={accent}
                      onPickType={pickType}
                    />
                  ))}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={() => void share()}
          disabled={!catalog || sharing || shown.sections.length === 0}
          style={({ pressed }) => [
            (!catalog || shown.sections.length === 0) && styles.off,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Share this menu as a PDF"
        >
          <LinearGradient
            colors={(meta.fabTint ?? brandGradients.primary.colors) as unknown as string[]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.shareBtn}
          >
            {sharing ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <IconShare size={18} color={colors.white} />
            )}
            <Text style={styles.shareText}>
              {sharing ? 'Making the PDF…' : `Share ${MENU_NAME[lane]} menu PDF`}
            </Text>
          </LinearGradient>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  off: { opacity: 0.45 },
  scroll: { paddingBottom: spacing.xl },
  loader: { marginTop: spacing.xl },

  heroContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md + 4,
    gap: spacing.md,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  glassBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    ...typography.caption,
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0,
  },
  heroTitle: { ...typography.display, fontSize: 28, color: colors.white, letterSpacing: -0.4 },
  heroChips: { flexDirection: 'row', gap: spacing.sm },
  heroChip: {
    flex: 1,
    padding: spacing.sm + 2,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  heroChipLabel: {
    ...typography.caption,
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0,
  },
  heroChipValue: { ...typography.heading, fontSize: 18, color: colors.white, marginTop: 2 },

  body: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: 14,
    backgroundColor: '#FFF7ED',
  },
  noticeText: {
    ...typography.caption,
    flex: 1,
    fontSize: 12.5,
    color: colors.amberDeep,
    letterSpacing: 0,
  },

  card: {
    backgroundColor: colors.white,
    borderRadius: 22,
    padding: spacing.md,
    gap: spacing.sm + 2,
    ...CARD_SHADOW,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    ...typography.bodyStrong,
    flex: 1,
    fontSize: 15,
    color: colors.ink,
    fontWeight: '800',
  },
  resetBtn: {
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  resetText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.indigo,
    fontWeight: '800',
    letterSpacing: 0,
  },
  segment: {
    flexDirection: 'row',
    padding: 4,
    gap: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  segmentItem: {
    flex: 1,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: { ...typography.label, fontSize: 13, color: colors.slateDeep },
  segmentTextOn: { color: colors.white, fontWeight: '800' },
  picked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    padding: spacing.sm + 2,
    borderRadius: 16,
    borderWidth: 1.5,
    backgroundColor: '#F5F7FF',
  },
  pickedTitle: { ...typography.bodyStrong, fontSize: 15, color: colors.ink, fontWeight: '800' },
  pickedSub: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  clearBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subLabel: {
    ...typography.caption,
    fontSize: 11.5,
    color: colors.slate,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
    marginTop: 2,
  },
  typeStrip: { gap: spacing.sm, paddingVertical: 2 },
  typeChip: {
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    justifyContent: 'center',
  },
  typeText: { ...typography.label, fontSize: 13, color: colors.ink, fontWeight: '600' },
  typeTextOn: { color: colors.white, fontWeight: '800' },
  pickerWrap: { marginHorizontal: -spacing.md },
  warn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: spacing.sm + 2,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
  },
  warnText: {
    ...typography.caption,
    flex: 1,
    fontSize: 12.5,
    color: colors.amberDeep,
    letterSpacing: 0,
  },

  visit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    padding: spacing.md,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: colors.white,
  },
  visitText: { ...typography.body, flex: 1, fontSize: 13, color: colors.slateDeep },
  visitStrong: { fontWeight: '800', color: colors.ink },

  section: { gap: spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionBar: { width: 4, height: 18, borderRadius: 2 },
  sectionTitle: { ...typography.heading, flex: 1, fontSize: 17, color: colors.ink },
  sectionMeta: { ...typography.caption, fontSize: 12, color: colors.slateDeep, letterSpacing: 0 },
  sectionCard: {
    backgroundColor: colors.white,
    borderRadius: 22,
    paddingHorizontal: spacing.md,
    ...CARD_SHADOW,
  },
  item: {
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemTop: { flexDirection: 'row', gap: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  itemName: {
    ...typography.bodyStrong,
    fontSize: 15.5,
    color: colors.ink,
    fontWeight: '800',
    flexShrink: 1,
  },
  popular: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FCEFD6',
  },
  popularText: {
    ...typography.caption,
    fontSize: 10.5,
    color: '#8A5A12',
    fontWeight: '800',
    letterSpacing: 0,
  },
  itemSub: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.slateDeep,
    letterSpacing: 0,
    marginTop: 3,
    lineHeight: 17,
  },
  durRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  durText: { ...typography.caption, fontSize: 11.5, color: colors.slate, letterSpacing: 0 },
  priceBox: { alignItems: 'flex-end', minWidth: 72 },
  savePill: {
    marginTop: 4,
    paddingHorizontal: 8,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#DDF5EF',
    justifyContent: 'center',
  },
  saveText: {
    ...typography.caption,
    fontSize: 11,
    color: colors.tealDeep,
    fontWeight: '800',
    letterSpacing: 0,
  },
  fromLabel: { ...typography.caption, fontSize: 11, color: colors.slate, letterSpacing: 0 },
  priceBig: { ...typography.display, fontSize: 21, letterSpacing: -0.3 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sizeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface,
  },
  sizeName: {
    ...typography.caption,
    fontSize: 12,
    color: colors.slateDeep,
    letterSpacing: 0,
    maxWidth: 140,
  },
  moreChip: { backgroundColor: colors.indigoPale },
  sizePrice: {
    ...typography.caption,
    fontSize: 12,
    color: colors.ink,
    fontWeight: '800',
    letterSpacing: 0,
  },

  empty: {
    backgroundColor: colors.white,
    borderRadius: 22,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    ...CARD_SHADOW,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { ...typography.heading, fontSize: 17, color: colors.ink, textAlign: 'center' },
  emptyBody: { ...typography.body, fontSize: 13, color: colors.slateDeep, textAlign: 'center' },

  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.md,
    backgroundColor: colors.white,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    ...CARD_SHADOW,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  shareBtn: {
    height: 54,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareText: { ...typography.bodyStrong, fontSize: 15.5, color: colors.white },
});
