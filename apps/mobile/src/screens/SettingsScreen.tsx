import React, { useCallback, useMemo, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { ScreenHeader } from '../components/ScreenHeader';
import { PromptModal } from '../components/PromptModal';
import { IconPlus } from '../components/Icons';
import { colors, radius, spacing, typography } from '../theme';
import { api } from '../api/client';
import { formatRupees } from '../utils/format';
import {
  parseServiceAppliesTo,
  parseVehicleCategory,
  serviceAppliesToCategory,
  type Service,
  type ServicePrice,
  type VehicleCategory,
  type VehicleType,
} from '@mana/domain';
import type { RootStackParamList } from '../navigation/RootNavigator';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function animate() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

function normalizeServices(
  rows: Array<{
    id: string;
    name: string;
    description: string | null;
    active: boolean;
    sortOrder: number;
    appliesTo: string;
  }>,
): Service[] {
  return rows.map((s) => ({
    ...s,
    appliesTo: parseServiceAppliesTo(s.appliesTo),
  }));
}

function normalizeVehicleTypes(
  rows: Array<{ id: string; name: string; sortOrder: number; category: string }>,
): VehicleType[] {
  return rows.map((vt) => ({
    ...vt,
    category: parseVehicleCategory(vt.category),
  }));
}

type Prompt =
  | { kind: 'addService' }
  | { kind: 'addVehicleType' }
  | {
      kind: 'editPrice';
      serviceId: string;
      serviceName: string;
      vehicleTypeId: string;
      vehicleTypeName: string;
      price: number | null;
    };

type SettingsScreenProps = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const CATEGORIES: { id: VehicleCategory; label: string; hint: string }[] = [
  { id: 'car', label: 'Cars', hint: 'Hatchback, Sedan, SUV…' },
  { id: 'bike', label: 'Bikes', hint: 'Bike, Scooter…' },
];

export function SettingsScreen({ navigation }: SettingsScreenProps) {
  const [services, setServices] = useState<Service[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [prices, setPrices] = useState<(ServicePrice & { id?: string })[]>([]);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<VehicleCategory>('car');
  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(null);
  const [serviceQuery, setServiceQuery] = useState('');
  const load = useCallback(async () => {
    const [servicesRes, vehicleTypesRes, pricesRes] = await Promise.all([
      api.services.$get({ query: {} }),
      api.services['vehicle-types'].$get({ query: {} }),
      api.services.prices.$get({ query: {} }),
    ]);
    setServices(normalizeServices(await servicesRes.json()));
    setVehicleTypes(normalizeVehicleTypes(await vehicleTypesRes.json()));
    setPrices(await pricesRes.json());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const typesForCategory = useMemo(
    () => vehicleTypes.filter((vt) => vt.category === category),
    [vehicleTypes, category],
  );

  const servicesForCategory = useMemo(
    () => services.filter((s) => serviceAppliesToCategory(s.appliesTo, category)),
    [services, category],
  );

  const visibleServices = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase();
    if (!q) return servicesForCategory;
    return servicesForCategory.filter((s) => s.name.toLowerCase().includes(q));
  }, [servicesForCategory, serviceQuery]);

  const priceFor = useCallback(
    (serviceId: string, vehicleTypeId: string): number | null => {
      const match = prices.find((p) => p.serviceId === serviceId && p.vehicleTypeId === vehicleTypeId);
      return match ? match.price : null;
    },
    [prices],
  );

  const coverage = useMemo(() => {
    const map = new Map<string, { set: number; total: number }>();
    for (const service of servicesForCategory) {
      let set = 0;
      for (const vt of typesForCategory) {
        if (priceFor(service.id, vt.id) != null) set += 1;
      }
      map.set(service.id, { set, total: typesForCategory.length });
    }
    return map;
  }, [servicesForCategory, typesForCategory, priceFor]);

  const closePrompt = () => setPrompt(null);

  const submitPrompt = async (value: string) => {
    setError(null);
    try {
      if (prompt?.kind === 'addService') {
        const res = await api.services.$post({
          json: { name: value.trim(), appliesTo: category },
        });
        if (!res.ok) throw new Error('Could not add service.');
      } else if (prompt?.kind === 'addVehicleType') {
        const res = await api.services['vehicle-types'].$post({
          json: { name: value.trim(), category },
        });
        if (!res.ok) throw new Error('Could not add vehicle type.');
      } else if (prompt?.kind === 'editPrice') {
        const rupees = Number(value);
        if (!Number.isFinite(rupees) || rupees < 0) throw new Error('Enter a valid price in rupees.');
        const res = await api.services.prices.$put({
          json: {
            serviceId: prompt.serviceId,
            vehicleTypeId: prompt.vehicleTypeId,
            price: Math.round(rupees * 100),
          },
        });
        if (!res.ok) throw new Error('Could not save price.');
      }
      closePrompt();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const switchCategory = (next: VehicleCategory) => {
    if (next === category) return;
    animate();
    setCategory(next);
    setExpandedServiceId(null);
    setServiceQuery('');
  };

  const toggleService = (serviceId: string) => {
    animate();
    setExpandedServiceId((current) => (current === serviceId ? null : serviceId));
  };

  const categoryMeta = CATEGORIES.find((c) => c.id === category)!;

  return (
    <ScreenContainer>
      <ScreenHeader title="Settings" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Family switch — Cars vs Bikes keep separate menus */}
        <View style={styles.segment}>
          {CATEGORIES.map((c) => {
            const on = category === c.id;
            const count = vehicleTypes.filter((vt) => vt.category === c.id).length;
            return (
              <Pressable
                key={c.id}
                onPress={() => switchCategory(c.id)}
                style={[styles.segmentBtn, on && styles.segmentBtnOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.segmentLabel, on && styles.segmentLabelOn]}>{c.label}</Text>
                <Text style={[styles.segmentMeta, on && styles.segmentMetaOn]}>
                  {count} type{count === 1 ? '' : 's'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.subtitle}>
          {category === 'car'
            ? 'Car services and sizes — bikes never see these on New Wash.'
            : 'Bike & scooter services — cars never see these on New Wash.'}
        </Text>

        {/* Vehicle sizes for this family */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionLabel}>Vehicle sizes</Text>
          <Pressable
            onPress={() => setPrompt({ kind: 'addVehicleType' })}
            style={styles.inlineAdd}
            accessibilityRole="button"
          >
            <IconPlus size={14} color={colors.water} />
            <Text style={styles.inlineAddText}>Add</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.typeStrip}
        >
          {typesForCategory.length === 0 ? (
            <Pressable
              onPress={() => setPrompt({ kind: 'addVehicleType' })}
              style={styles.typeEmpty}
              accessibilityRole="button"
            >
              <Text style={styles.typeEmptyText}>+ Add first {categoryMeta.label.slice(0, -1).toLowerCase()} size</Text>
            </Pressable>
          ) : (
            typesForCategory.map((vt) => (
              <View key={vt.id} style={styles.typeChip}>
                <Text style={styles.typeChipText}>{vt.name}</Text>
              </View>
            ))
          )}
        </ScrollView>

        {/* Services for this family */}
        <View style={styles.sectionHead}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionLabel}>Services</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{servicesForCategory.length}</Text>
            </View>
          </View>
          <Pressable
            onPress={() => setPrompt({ kind: 'addService' })}
            style={styles.inlineAdd}
            accessibilityRole="button"
          >
            <IconPlus size={14} color={colors.water} />
            <Text style={styles.inlineAddText}>Add</Text>
          </Pressable>
        </View>

        {servicesForCategory.length > 6 ? (
          <View style={styles.searchBand}>
            <Text style={styles.searchGlyph}>⌕</Text>
            <TextInput
              style={styles.searchInput}
              placeholder={`Search ${categoryMeta.label.toLowerCase()} services…`}
              placeholderTextColor={colors.slate}
              value={serviceQuery}
              onChangeText={setServiceQuery}
              autoCorrect={false}
            />
            {serviceQuery.length > 0 ? (
              <Pressable onPress={() => setServiceQuery('')} hitSlop={8}>
                <Text style={styles.clearSearch}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.edgeList}>
          {visibleServices.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyTitle}>No {categoryMeta.label.toLowerCase()} services yet</Text>
              <Text style={styles.emptyBody}>
                Add services here — they only appear when a {category} is picked on New Wash.
              </Text>
              <Pressable onPress={() => setPrompt({ kind: 'addService' })} style={styles.emptyCta}>
                <Text style={styles.emptyCtaText}>+ Add service</Text>
              </Pressable>
            </View>
          ) : (
            visibleServices.map((service, index) => {
              const expanded = expandedServiceId === service.id;
              const cov = coverage.get(service.id) ?? { set: 0, total: typesForCategory.length };
              const complete = cov.total > 0 && cov.set === cov.total;
              const missing = cov.total - cov.set;

              return (
                <View key={service.id}>
                  <Pressable
                    onPress={() => toggleService(service.id)}
                    style={[
                      styles.serviceHeader,
                      index < visibleServices.length - 1 && !expanded && styles.rowDivider,
                      expanded && styles.serviceHeaderOpen,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                  >
                    <View style={styles.serviceCopy}>
                      <Text style={styles.serviceName}>{service.name}</Text>
                      <Text style={[styles.coverage, complete ? styles.coverageOk : styles.coverageWarn]}>
                        {typesForCategory.length === 0
                          ? 'Add a vehicle size first'
                          : complete
                            ? `Priced for all ${typesForCategory.length} sizes`
                            : missing === cov.total
                              ? 'No prices set'
                              : `${missing} of ${cov.total} sizes missing`}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
                  </Pressable>

                  {expanded && (
                    <View style={[styles.priceList, index < visibleServices.length - 1 && styles.rowDivider]}>
                      {typesForCategory.length === 0 ? (
                        <Text style={styles.emptyHint}>Add a vehicle size above, then set prices.</Text>
                      ) : (
                        typesForCategory.map((vt, vtIndex) => {
                          const price = priceFor(service.id, vt.id);
                          return (
                            <Pressable
                              key={vt.id}
                              onPress={() =>
                                setPrompt({
                                  kind: 'editPrice',
                                  serviceId: service.id,
                                  serviceName: service.name,
                                  vehicleTypeId: vt.id,
                                  vehicleTypeName: vt.name,
                                  price,
                                })
                              }
                              style={[
                                styles.priceRow,
                                vtIndex < typesForCategory.length - 1 && styles.priceRowDivider,
                              ]}
                              accessibilityRole="button"
                              accessibilityLabel={`${vt.name} price`}
                            >
                              <Text style={styles.priceVehicle}>{vt.name}</Text>
                              <View style={styles.priceRight}>
                                <Text style={[styles.priceValue, price == null && styles.priceUnset]}>
                                  {price != null ? formatRupees(price) : 'Set price'}
                                </Text>
                                <Text style={styles.priceEdit}>Edit</Text>
                              </View>
                            </Pressable>
                          );
                        })
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.bottomPad} />
      </ScrollView>

      <PromptModal
        visible={prompt?.kind === 'addService'}
        title={`Add ${category} service`}
        label={
          category === 'bike'
            ? 'Service name (e.g. Chain Clean & Lube)'
            : 'Service name (e.g. Ceramic Coating)'
        }
        onCancel={closePrompt}
        onSubmit={submitPrompt}
      />
      <PromptModal
        visible={prompt?.kind === 'addVehicleType'}
        title={`Add ${category} size`}
        label={
          category === 'bike'
            ? 'Size name (e.g. Scooter, Sports bike)'
            : 'Size name (e.g. Compact SUV)'
        }
        onCancel={closePrompt}
        onSubmit={submitPrompt}
      />
      <PromptModal
        visible={prompt?.kind === 'editPrice'}
        title={prompt?.kind === 'editPrice' ? `${prompt.serviceName} — ${prompt.vehicleTypeName}` : ''}
        label="Price in rupees (e.g. 400)"
        initialValue={prompt?.kind === 'editPrice' && prompt.price !== null ? String(prompt.price / 100) : ''}
        keyboardType="numeric"
        onCancel={closePrompt}
        onSubmit={submitPrompt}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.waterPale,
    borderRadius: radius.lg,
    padding: 4,
    gap: 4,
    marginBottom: spacing.md,
  },
  segmentBtn: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  segmentBtnOn: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentLabel: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 16,
  },
  segmentLabelOn: {
    color: colors.waterDeep,
  },
  segmentMeta: {
    ...typography.caption,
    color: colors.slateDeep,
    marginTop: 2,
  },
  segmentMetaOn: {
    color: colors.water,
  },
  subtitle: {
    ...typography.body,
    color: colors.slateDeep,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.slateDeep,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  inlineAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  inlineAddText: {
    ...typography.bodyStrong,
    color: colors.water,
    fontSize: 14,
  },
  countBadge: {
    backgroundColor: colors.waterPale,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  countBadgeText: {
    ...typography.caption,
    color: colors.waterDeep,
    fontWeight: '700',
  },
  typeStrip: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingRight: spacing.md,
    marginBottom: spacing.md,
  },
  typeChip: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  typeChipText: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 14,
  },
  typeEmpty: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  typeEmptyText: {
    ...typography.bodyStrong,
    color: colors.water,
    fontSize: 14,
  },
  searchBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 44,
  },
  searchGlyph: {
    fontSize: 16,
    color: colors.slate,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.waterInk,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
  },
  clearSearch: {
    ...typography.caption,
    color: colors.water,
    fontWeight: '600',
  },
  edgeList: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginHorizontal: -spacing.md,
  },
  emptyBlock: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  emptyTitle: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 16,
  },
  emptyBody: {
    ...typography.body,
    color: colors.slateDeep,
    lineHeight: 20,
  },
  emptyCta: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  emptyCtaText: {
    ...typography.bodyStrong,
    color: colors.water,
  },
  serviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 64,
    backgroundColor: colors.white,
  },
  serviceHeaderOpen: {
    backgroundColor: colors.waterPale,
  },
  serviceCopy: {
    flex: 1,
    gap: 2,
  },
  serviceName: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 16,
  },
  coverage: {
    ...typography.caption,
  },
  coverageOk: {
    color: colors.teal,
  },
  coverageWarn: {
    color: colors.amberDeep,
  },
  chevron: {
    fontSize: 16,
    color: colors.slate,
    width: 18,
    textAlign: 'center',
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  priceList: {
    backgroundColor: colors.white,
    paddingBottom: spacing.xs,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    paddingLeft: spacing.lg,
  },
  priceRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  priceVehicle: {
    ...typography.body,
    color: colors.waterInk,
    flex: 1,
    paddingRight: spacing.sm,
  },
  priceRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  priceValue: {
    ...typography.bodyStrong,
    color: colors.waterDeep,
    fontSize: 16,
  },
  priceUnset: {
    color: colors.water,
    fontWeight: '600',
  },
  priceEdit: {
    ...typography.caption,
    color: colors.slate,
  },
  emptyHint: {
    ...typography.body,
    color: colors.slateDeep,
    padding: spacing.md,
  },
  bottomPad: {
    height: spacing.xl,
  },
  error: {
    color: colors.danger,
    ...typography.label,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
});
