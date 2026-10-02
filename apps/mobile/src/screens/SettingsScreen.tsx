import React, { useCallback, useMemo, useState } from 'react';
import {
  Image,
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
import { NewServiceSheet, type NewServiceInput } from '../components/NewServiceSheet';
import { EditServiceSheet } from '../components/EditServiceSheet';
import { PriceSheet } from '../components/PriceSheet';
import { VehiclePickerSheet } from '../components/VehiclePickerSheet';
import { VehicleStack } from '../components/VehicleStack';
import { vehicleImageFor } from '../components/VehicleTypeIcon';
import { Button } from '../components/Button';
import { Fab } from '../components/Fab';
import { showAlert } from '../components/AppAlert';
import { IconChevronDown, IconChevronRight, IconEdit, IconPlus, IconSearch, IconSparkle, IconTrash } from '../components/Icons';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { api, apiErrorMessage } from '../api/client';
import { NetworkError } from '../api/network';
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
import { usePlan } from '../offline/PlanProvider';

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
    includes?: string[];
  }>,
): Service[] {
  return rows.map((s) => ({
    ...s,
    appliesTo: parseServiceAppliesTo(s.appliesTo),
  }));
}

const isCombo = (s: Service) => (s.includes?.length ?? 0) > 0;

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
  | {
      kind: 'editPrice';
      serviceId: string;
      serviceName: string;
      vehicleTypeId: string;
      vehicleTypeName: string;
      price: number | null;
    };

type SettingsScreenProps = NativeStackScreenProps<RootStackParamList, 'Settings'>;

const CATEGORIES: { id: VehicleCategory; label: string }[] = [
  { id: 'car', label: 'Cars & more' },
  { id: 'bike', label: 'Two-wheelers' },
];

export function SettingsScreen({ navigation }: SettingsScreenProps) {
  const { isPro } = usePlan();
  const [services, setServices] = useState<Service[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [prices, setPrices] = useState<(ServicePrice & { id?: string })[]>([]);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  // Separate from `prompt` so the picker can open over New service without closing it.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<VehicleCategory>('car');
  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(null);
  const [serviceQuery, setServiceQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [commissions, setCommissions] = useState<{ serviceId: string; vehicleTypeId: string; amount: number }[]>([]);
  const load = useCallback(async () => {
    try {
      const [servicesRes, vehicleTypesRes, pricesRes, commissionsRes] = await Promise.all([
        api.services.$get({ query: {} }),
        api.services['vehicle-types'].$get({ query: {} }),
        api.services.prices.$get({ query: {} }),
        api.services.commissions.$get(),
      ]);
      if (!servicesRes.ok || !vehicleTypesRes.ok || !pricesRes.ok) throw new Error('load_failed');
      setServices(normalizeServices(await servicesRes.json()));
      setVehicleTypes(normalizeVehicleTypes(await vehicleTypesRes.json()));
      setPrices(await pricesRes.json());
      if (commissionsRes.ok) setCommissions(await commissionsRes.json());
      setError(null);
    } catch (e) {
      setError(
        e instanceof NetworkError
          ? 'Settings need a connection. Check your internet and come back.'
          : 'Couldn’t load your services. Pull back and try again.',
      );
    }
  }, []);

  const commissionFor = useCallback(
    (serviceId: string, vehicleTypeId: string): number | null =>
      commissions.find((r) => r.serviceId === serviceId && r.vehicleTypeId === vehicleTypeId)?.amount ?? null,
    [commissions],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const typesForCategory = useMemo(
    () => vehicleTypes.filter((vt) => vt.category === category),
    [vehicleTypes, category],
  );

  // Combos first: they're the headline offers.
  const servicesForCategory = useMemo(
    () =>
      services
        .filter((s) => serviceAppliesToCategory(s.appliesTo, category))
        .sort((a, b) => Number(isCombo(b)) - Number(isCombo(a))),
    [services, category],
  );

  const serviceName = useCallback(
    (id: string) => services.find((s) => s.id === id)?.name ?? null,
    [services],
  );
  const plainServices = useMemo(() => services.filter((s) => !isCombo(s)), [services]);
  const editingService = services.find((s) => s.id === editingId) ?? null;

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

  const closePrompt = () => setPrompt(null);

  const saveEdit = async (changes: { name: string; description: string; includes?: string[] }) => {
    if (!editingId) return null;
    try {
      const res = await api.services[':id'].$patch({
        param: { id: editingId },
        json: { name: changes.name, description: changes.description || null, includes: changes.includes },
      });
      if (!res.ok) return apiErrorMessage(res, 'Could not save changes.');
      setEditingId(null);
      await load();
      return null;
    } catch (e) {
      return e instanceof NetworkError ? 'Saving needs a connection.' : 'Something went wrong.';
    }
  };

  const addService = async (input: NewServiceInput): Promise<string | null> => {
    try {
      const res = await api.services.$post({
        json: {
          name: input.name,
          description: input.description || undefined,
          includes: input.includes.length ? input.includes : undefined,
          vehicles: input.vehicles,
        },
      });
      if (!res.ok) return apiErrorMessage(res, 'Could not add this service.');
      closePrompt();
      animate();
      await load();
      return null;
    } catch (e) {
      return e instanceof NetworkError ? 'Adding services needs a connection.' : 'Something went wrong.';
    }
  };

  const removePrice = async (): Promise<string | null> => {
    if (prompt?.kind !== 'editPrice') return null;
    try {
      const res = await api.services.prices.$delete({
        json: { serviceId: prompt.serviceId, vehicleTypeId: prompt.vehicleTypeId },
      });
      if (!res.ok) return apiErrorMessage(res, 'Could not update this service.');
      closePrompt();
      await load();
      return null;
    } catch (e) {
      return e instanceof NetworkError ? 'Changing services needs a connection.' : 'Something went wrong.';
    }
  };

  const addVehicleType = async (name: string): Promise<string | null> => {
    try {
      const res = await api.services['vehicle-types'].$post({ json: { name, category } });
      if (!res.ok) return apiErrorMessage(res, 'Could not add this vehicle.');
      await load();
      return null;
    } catch (e) {
      return e instanceof NetworkError ? 'Adding vehicles needs a connection.' : 'Something went wrong.';
    }
  };

  const removeVehicleType = async (id: string): Promise<string | null> => {
    try {
      const res = await api.services['vehicle-types'][':id'].$delete({ param: { id } });
      if (!res.ok) return apiErrorMessage(res, 'Could not remove this vehicle.');
      await load();
      return null;
    } catch (e) {
      return e instanceof NetworkError ? 'Removing needs a connection.' : 'Something went wrong.';
    }
  };

  const deleteService = (service: Service) => {
    showAlert(
      `Delete ${service.name}?`,
      'It disappears from New Wash. Past washes and reports keep it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                const res = await api.services[':id'].$delete({ param: { id: service.id } });
                if (!res.ok) {
                  setError(await apiErrorMessage(res, 'Could not delete this service.'));
                  return;
                }
                animate();
                setExpandedServiceId(null);
                await load();
              } catch (e) {
                setError(e instanceof NetworkError ? 'Deleting needs a connection.' : 'Something went wrong.');
              }
            })();
          },
        },
      ],
      { icon: <IconTrash size={26} color={colors.danger} /> },
    );
  };

  const savePrice = async (price: number, commission: number | null): Promise<string | null> => {
    if (prompt?.kind !== 'editPrice') return null;
    const key = { serviceId: prompt.serviceId, vehicleTypeId: prompt.vehicleTypeId };
    try {
      if (price !== prompt.price) {
        const res = await api.services.prices.$put({ json: { ...key, price } });
        if (!res.ok) return apiErrorMessage(res, 'Could not save price.');
      }
      if (commission !== commissionFor(key.serviceId, key.vehicleTypeId)) {
        const res = await api.services.commissions.$put({ json: { ...key, amount: commission } });
        if (!res.ok) return apiErrorMessage(res, 'Could not save commission.');
      }
      closePrompt();
      await load();
      return null;
    } catch (e) {
      return e instanceof NetworkError ? 'Saving prices needs a connection.' : 'Something went wrong.';
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

  const familyWord = category === 'bike' ? 'two-wheeler' : 'vehicle';
  const openPicker = () => setPickerOpen(true);
  const openNewService = () => setPrompt({ kind: 'addService' });
  const vehicleCount = typesForCategory.length;

  return (
    <ScreenContainer>
      <ScreenHeader title="Services & prices" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Cars and two-wheelers keep separate vehicle lists and menus */}
        <View style={styles.segment}>
          {CATEGORIES.map((c) => {
            const on = category === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => switchCategory(c.id)}
                style={[styles.segmentBtn, on && styles.segmentBtnOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.segmentLabel, on && styles.segmentLabelOn]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Vehicles: one compact card, the full grid lives in the picker */}
        <Pressable
          onPress={openPicker}
          style={({ pressed }) => [styles.vehiclesCard, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel={`Vehicles you wash, ${vehicleCount}. Edit`}
        >
          <View style={styles.vehiclesTop}>
            <View style={styles.vehiclesCopy}>
              <Text style={styles.overline}>Vehicles you wash</Text>
              <Text style={styles.vehiclesCount}>
                {vehicleCount === 0
                  ? `No ${familyWord}s yet`
                  : `${vehicleCount} ${familyWord}${vehicleCount === 1 ? '' : 's'}`}
              </Text>
            </View>
            <View style={styles.editPill}>
              {vehicleCount === 0 ? <IconPlus size={14} color={colors.white} /> : null}
              <Text style={styles.editPillText}>{vehicleCount === 0 ? 'Add' : 'Edit'}</Text>
            </View>
          </View>
          {vehicleCount > 0 ? (
            <View style={styles.vehiclesBottom}>
              <VehicleStack names={typesForCategory.map((vt) => vt.name)} size={40} max={6} />
            </View>
          ) : (
            <Text style={styles.vehiclesHint}>
              Pick the {familyWord}s your shop washes. Staff choose one on every new wash.
            </Text>
          )}
        </Pressable>

        {/* Services for this family */}
        <View style={styles.servicesHead}>
          <Text style={styles.sectionTitle}>Services</Text>
          {servicesForCategory.length > 0 ? (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{servicesForCategory.length}</Text>
            </View>
          ) : null}
        </View>

        {servicesForCategory.length > 6 ? (
          <View style={styles.searchBand}>
            <IconSearch size={16} color={colors.slate} />
            <TextInput
              style={styles.searchInput}
              placeholder={`Search ${familyWord} services…`}
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

        {servicesForCategory.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <IconSparkle size={30} color={colors.water} />
            </View>
            <Text style={styles.emptyTitle}>Add your first service</Text>
            <Text style={styles.emptyBody}>
              Like Full Wash or Foam Wash. Choose which {familyWord}s it’s for and set a price for each.
            </Text>
            <View style={styles.emptyCta}>
              <Button label="Add service" icon={<IconPlus size={18} color={colors.white} />} onPress={openNewService} />
            </View>
          </View>
        ) : (
          <View style={styles.edgeList}>
            {visibleServices.map((service, index) => {
              const expanded = expandedServiceId === service.id;
              const offered = typesForCategory.filter((vt) => priceFor(service.id, vt.id) != null);
              const notOffered = typesForCategory.filter((vt) => priceFor(service.id, vt.id) == null);
              const set = offered.map((vt) => priceFor(service.id, vt.id) as number);
              const low = set.length ? Math.min(...set) : null;
              const high = set.length ? Math.max(...set) : null;
              const range =
                low == null ? null : low === high ? formatRupees(low) : `${formatRupees(low)}–${formatRupees(high!)}`;
              const last = index === visibleServices.length - 1;
              const combo = isCombo(service);
              const includedNames = (service.includes ?? [])
                .map(serviceName)
                .filter((n): n is string => n != null);
              const openPrice = (vt: VehicleType) =>
                setPrompt({
                  kind: 'editPrice',
                  serviceId: service.id,
                  serviceName: service.name,
                  vehicleTypeId: vt.id,
                  vehicleTypeName: vt.name,
                  price: priceFor(service.id, vt.id),
                });

              return (
                <View key={service.id} style={!last && styles.rowDivider}>
                  <Pressable
                    onPress={() => toggleService(service.id)}
                    style={({ pressed }) => [styles.serviceRow, (expanded || pressed) && styles.serviceRowOpen]}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                  >
                    <View style={styles.serviceCopy}>
                      <View style={styles.nameRow}>
                        {combo ? (
                          <View style={styles.comboTag}>
                            <Text style={styles.comboTagText}>COMBO</Text>
                          </View>
                        ) : null}
                        <Text style={styles.serviceName} numberOfLines={1}>
                          {service.name}
                        </Text>
                      </View>
                      {combo && includedNames.length > 0 ? (
                        <Text style={styles.includesText} numberOfLines={2}>
                          {includedNames.join(' + ')}
                        </Text>
                      ) : null}
                      {service.description ? (
                        <Text style={styles.descText} numberOfLines={expanded ? undefined : 1}>
                          {service.description}
                        </Text>
                      ) : null}
                      {offered.length > 0 ? (
                        <View style={styles.serviceMeta}>
                          <VehicleStack names={offered.map((vt) => vt.name)} size={24} max={4} />
                          <Text style={styles.serviceMetaText}>
                            {offered.length === vehicleCount
                              ? `All ${familyWord}s`
                              : `${offered.length} ${familyWord}${offered.length === 1 ? '' : 's'}`}
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.todoPill}>
                          <Text style={styles.todoPillText}>Not offered for any {familyWord}</Text>
                        </View>
                      )}
                    </View>
                    {range ? <Text style={styles.serviceRange}>{range}</Text> : null}
                    <View style={[styles.chevron, expanded && styles.chevronOpen]}>
                      <IconChevronDown size={18} color={expanded ? colors.waterDeep : colors.slate} />
                    </View>
                  </Pressable>

                  {expanded && (
                    <View style={styles.priceList}>
                      {offered.length > 0 ? <Text style={styles.priceGroupLabel}>Offered for</Text> : null}
                      {offered.map((vt) => {
                        const commission = commissionFor(service.id, vt.id);
                        return (
                          <Pressable
                            key={vt.id}
                            onPress={() => openPrice(vt)}
                            style={({ pressed }) => [styles.priceRow, pressed && styles.priceRowPressed]}
                            accessibilityRole="button"
                            accessibilityLabel={`${vt.name} price`}
                          >
                            <Image source={vehicleImageFor(vt.name)} style={styles.priceThumb} resizeMode="cover" />
                            <View style={styles.priceCopy}>
                              <Text style={styles.priceVehicle} numberOfLines={1}>
                                {vt.name}
                              </Text>
                              {commission != null ? (
                                <Text style={styles.priceCommission}>Staff gets {formatRupees(commission)}</Text>
                              ) : null}
                            </View>
                            <Text style={styles.priceValue}>{formatRupees(priceFor(service.id, vt.id) ?? 0)}</Text>
                            <IconChevronRight size={16} color={colors.slate} />
                          </Pressable>
                        );
                      })}
                      {notOffered.length > 0 ? (
                        <Text style={styles.priceGroupLabel}>Not offered</Text>
                      ) : null}
                      {notOffered.map((vt) => (
                        <Pressable
                          key={vt.id}
                          onPress={() => openPrice(vt)}
                          style={({ pressed }) => [styles.priceRow, pressed && styles.priceRowPressed]}
                          accessibilityRole="button"
                          accessibilityLabel={`Offer for ${vt.name}`}
                        >
                          <Image
                            source={vehicleImageFor(vt.name)}
                            style={[styles.priceThumb, styles.priceThumbOff]}
                            resizeMode="cover"
                          />
                          <View style={styles.priceCopy}>
                            <Text style={[styles.priceVehicle, styles.priceVehicleOff]} numberOfLines={1}>
                              {vt.name}
                            </Text>
                          </View>
                          <View style={styles.offerPill}>
                            <IconPlus size={12} color={colors.waterDeep} />
                            <Text style={styles.offerPillText}>Offer</Text>
                          </View>
                        </Pressable>
                      ))}
                      <View style={styles.actionsRow}>
                        <Pressable
                          onPress={() => setEditingId(service.id)}
                          style={({ pressed }) => [styles.editRow, pressed && styles.cardPressed]}
                          accessibilityRole="button"
                        >
                          <IconEdit size={16} color={colors.waterDeep} />
                          <Text style={styles.editText}>Edit details</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => deleteService(service)}
                          style={({ pressed }) => [styles.deleteRow, pressed && styles.cardPressed]}
                          accessibilityRole="button"
                        >
                          <IconTrash size={16} color={colors.danger} />
                          <Text style={styles.deleteText}>Delete</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.bottomPad} />
      </ScrollView>

      {servicesForCategory.length > 0 ? (
        <Fab label="Add service" icon={<IconPlus size={22} color={colors.white} />} onPress={openNewService} bottom={spacing.lg} />
      ) : null}

      <NewServiceSheet
        visible={prompt?.kind === 'addService'}
        category={category}
        vehicleTypes={vehicleTypes}
        services={services}
        priceFor={priceFor}
        onClose={closePrompt}
        onPickVehicles={openPicker}
        onSave={addService}
      />
      <EditServiceSheet
        service={editingService}
        plainServices={plainServices}
        onClose={() => setEditingId(null)}
        onSave={saveEdit}
      />
      <VehiclePickerSheet
        visible={pickerOpen}
        category={category}
        existing={typesForCategory.map((vt) => ({ id: vt.id, name: vt.name }))}
        onClose={() => setPickerOpen(false)}
        onAdd={addVehicleType}
        onRemove={removeVehicleType}
      />
      <PriceSheet
        visible={prompt?.kind === 'editPrice'}
        title={prompt?.kind === 'editPrice' ? `${prompt.serviceName} · ${prompt.vehicleTypeName}` : ''}
        price={prompt?.kind === 'editPrice' ? prompt.price : null}
        commission={prompt?.kind === 'editPrice' ? commissionFor(prompt.serviceId, prompt.vehicleTypeId) : null}
        commissionLocked={!isPro}
        onClose={closePrompt}
        onSave={savePrice}
        onRemove={prompt?.kind === 'editPrice' && prompt.price != null ? removePrice : undefined}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.sm,
  },
  cardPressed: { opacity: 0.85 },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#E8F1F8',
    borderRadius: radius.pill,
    padding: 4,
    marginBottom: spacing.md,
  },
  segmentBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    borderRadius: radius.pill,
  },
  segmentBtnOn: {
    backgroundColor: colors.white,
    ...shadow('sm'),
  },
  segmentLabel: {
    ...typography.bodyStrong,
    fontSize: 15,
    color: colors.slateDeep,
  },
  segmentLabelOn: { color: colors.waterDeep, fontWeight: '700' },
  vehiclesCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    marginBottom: spacing.lg,
    ...shadow('sm'),
  },
  vehiclesTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vehiclesCopy: { flex: 1, gap: 2 },
  overline: {
    ...typography.caption,
    color: colors.slateDeep,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  vehiclesCount: { ...typography.heading, color: colors.waterInk },
  vehiclesBottom: { flexDirection: 'row', alignItems: 'center' },
  vehiclesHint: { ...typography.body, fontSize: 14, color: colors.slateDeep, lineHeight: 20 },
  editPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.water,
  },
  editPillText: { ...typography.label, color: colors.white, fontWeight: '700' },
  servicesHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm + 2,
  },
  sectionTitle: { ...typography.heading, color: colors.waterInk },
  countBadge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: { ...typography.caption, color: colors.waterDeep, fontWeight: '800', letterSpacing: 0 },
  searchBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm + 2,
    height: 44,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    fontSize: 15,
    color: colors.waterInk,
    paddingVertical: 0,
  },
  clearSearch: { ...typography.caption, color: colors.water, fontWeight: '700' },
  empty: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    ...shadow('sm'),
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.waterPale,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: { ...typography.heading, color: colors.waterInk },
  emptyBody: {
    ...typography.body,
    fontSize: 15,
    color: colors.slateDeep,
    lineHeight: 21,
    textAlign: 'center',
  },
  emptyCta: { alignSelf: 'stretch', marginTop: spacing.md },
  edgeList: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginHorizontal: -spacing.md,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: spacing.md,
    minHeight: 76,
    backgroundColor: colors.white,
  },
  serviceRowOpen: { backgroundColor: colors.surface },
  serviceCopy: { flex: 1, gap: 6 },
  serviceName: { ...typography.bodyStrong, fontSize: 17, color: colors.waterInk, flexShrink: 1 },
  serviceMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  serviceMetaText: { ...typography.label, fontWeight: '500', color: colors.slateDeep },
  serviceRange: { ...typography.bodyStrong, fontSize: 15, color: colors.waterInk },
  todoPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: '#FEF3C7',
  },
  todoPillText: { ...typography.caption, color: colors.amberDeep, fontWeight: '700', letterSpacing: 0 },
  chevron: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronOpen: {
    backgroundColor: colors.waterPale,
    transform: [{ rotate: '180deg' }],
  },
  priceList: {
    backgroundColor: colors.surface,
    paddingBottom: spacing.md,
  },
  priceGroupLabel: {
    ...typography.caption,
    color: colors.slateDeep,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 60,
  },
  priceRowPressed: { backgroundColor: colors.waterPale },
  priceThumb: {
    width: 56,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: colors.waterMidnight,
  },
  priceThumbOff: { opacity: 0.4 },
  priceCopy: { flex: 1, gap: 2 },
  priceVehicle: { ...typography.body, fontSize: 15, color: colors.waterInk },
  priceVehicleOff: { color: colors.slate },
  priceCommission: { ...typography.caption, color: colors.teal, letterSpacing: 0 },
  priceValue: { ...typography.bodyStrong, color: colors.waterInk, fontSize: 17 },
  offerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
  },
  offerPillText: { ...typography.label, color: colors.waterDeep, fontWeight: '700' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  comboTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#EDE9FE',
  },
  comboTagText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: '#5B21B6' },
  includesText: { ...typography.label, fontWeight: '600', color: '#5B21B6' },
  descText: { ...typography.label, fontWeight: '400', color: colors.slateDeep, lineHeight: 18 },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.waterPale,
  },
  editText: { ...typography.label, color: colors.waterDeep, fontWeight: '700' },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: '#FEE2E2',
  },
  deleteText: { ...typography.label, color: colors.danger, fontWeight: '700' },
  bottomPad: { height: 120 },
  error: {
    color: colors.danger,
    ...typography.label,
    marginTop: spacing.md,
  },
});
