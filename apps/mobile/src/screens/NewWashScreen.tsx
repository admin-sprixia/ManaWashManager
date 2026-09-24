import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { VehicleTypeCard } from '../components/VehicleTypeIcon';
import { ServicePickRow, GROUP_TONE, type ServiceGroup } from '../components/ServicePickRow';
import { IconChevronLeft, IconDroplet, IconPlus } from '../components/Icons';
import { colors, gradients, radius, shadow, spacing, typography } from '../theme';
import { api } from '../api/client';
import type { RootStackParamList } from '../navigation/RootNavigator';
import {
  calculatePrice,
  parseServiceAppliesTo,
  parseVehicleCategory,
  serviceAppliesToCategory,
  type Service,
  type ServicePrice,
  type VehicleCategory,
  type VehicleType,
} from '@mana/domain';
import { formatRupees } from '../utils/format';

type NewWashScreenProps = NativeStackScreenProps<RootStackParamList, 'NewWash'>;

const GROUP_ORDER: ServiceGroup[] = ['Wash', 'Interior', 'Protect', 'Add-ons', 'Other'];

const VEHICLE_FAMILIES: { id: VehicleCategory; label: string }[] = [
  { id: 'car', label: 'Cars' },
  { id: 'bike', label: 'Bikes' },
];

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

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function normalizeReg(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function groupForService(name: string): ServiceGroup {
  const n = name.toLowerCase();
  if (
    n.includes('combo') ||
    n.includes('wash') ||
    n.includes('exterior') ||
    n.includes('underbody') ||
    n.includes('foam') ||
    n.includes('degrease') ||
    n.includes('chain')
  ) {
    return 'Wash';
  }
  if (
    n.includes('interior') ||
    n.includes('cabin') ||
    n.includes('ac ') ||
    n.startsWith('ac') ||
    n.includes('seat')
  ) {
    return 'Interior';
  }
  if (n.includes('ceramic') || n.includes('coat') || n.includes('polish') || n.includes('wax')) {
    return 'Protect';
  }
  if (
    n.includes('tyre') ||
    n.includes('tire') ||
    n.includes('dashboard') ||
    n.includes('fragrance') ||
    n.includes('dressing') ||
    n.includes('lube')
  ) {
    return 'Add-ons';
  }
  return 'Other';
}

export function NewWashScreen({ navigation }: NewWashScreenProps) {
  const insets = useSafeAreaInsets();
  const [services, setServices] = useState<Service[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [prices, setPrices] = useState<ServicePrice[]>([]);

  const [phone, setPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [registration, setRegistration] = useState('');
  const [vehicleFamily, setVehicleFamily] = useState<VehicleCategory>('car');
  const [vehicleTypeId, setVehicleTypeId] = useState<string | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const [serviceQuery, setServiceQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<ServiceGroup | 'All'>('All');
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountRupees, setDiscountRupees] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const [servicesRes, vehicleTypesRes, pricesRes] = await Promise.all([
        api.services.$get({ query: {} }),
        api.services['vehicle-types'].$get({ query: {} }),
        api.services.prices.$get({ query: {} }),
      ]);
      if (!servicesRes.ok || !vehicleTypesRes.ok || !pricesRes.ok) {
        throw new Error('Could not load services or vehicle types.');
      }
      const [servicesJson, vehicleTypesJson, pricesJson] = await Promise.all([
        servicesRes.json(),
        vehicleTypesRes.json(),
        pricesRes.json(),
      ]);
      if (!Array.isArray(vehicleTypesJson)) {
        throw new Error('Vehicle types response was invalid.');
      }
      setServices(normalizeServices(Array.isArray(servicesJson) ? servicesJson : []));
      setVehicleTypes(normalizeVehicleTypes(vehicleTypesJson));
      setPrices(Array.isArray(pricesJson) ? pricesJson : []);
    } catch (e) {
      setCatalogError(
        e instanceof Error
          ? e.message
          : 'Could not reach the API. Is it running on localhost:8787?',
      );
      setVehicleTypes([]);
      setServices([]);
      setPrices([]);
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const typesInFamily = useMemo(
    () => vehicleTypes.filter((vt) => vt.category === vehicleFamily),
    [vehicleTypes, vehicleFamily],
  );

  const selectedVehicle = useMemo(
    () => vehicleTypes.find((v) => v.id === vehicleTypeId) ?? null,
    [vehicleTypes, vehicleTypeId],
  );

  const servicesForVehicle = useMemo(() => {
    if (!selectedVehicle) return [];
    return services.filter((s) => serviceAppliesToCategory(s.appliesTo, selectedVehicle.category));
  }, [services, selectedVehicle]);

  const switchFamily = useCallback((next: VehicleCategory) => {
    setVehicleFamily(next);
    setVehicleTypeId(null);
    setSelectedServiceIds(new Set());
    setActiveGroup('All');
    setServiceQuery('');
  }, []);

  const toggleVehicle = useCallback((id: string) => {
    setVehicleTypeId((prev) => {
      if (prev === id) {
        setSelectedServiceIds(new Set());
        return null;
      }
      setSelectedServiceIds(new Set());
      setActiveGroup('All');
      setServiceQuery('');
      return id;
    });
  }, []);

  const toggleService = useCallback((serviceId: string) => {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev);
      next.has(serviceId) ? next.delete(serviceId) : next.add(serviceId);
      return next;
    });
  }, []);

  const priceFor = useCallback(
    (serviceId: string): number | null => {
      if (!vehicleTypeId) return null;
      const match = prices.find((p) => p.serviceId === serviceId && p.vehicleTypeId === vehicleTypeId);
      return match ? match.price : null;
    },
    [prices, vehicleTypeId],
  );

  const availableGroups = useMemo(() => {
    const present = new Set(servicesForVehicle.map((s) => groupForService(s.name)));
    return GROUP_ORDER.filter((g) => present.has(g));
  }, [servicesForVehicle]);

  const filteredServices = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase();
    return servicesForVehicle.filter((s) => {
      if (activeGroup !== 'All' && groupForService(s.name) !== activeGroup) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q);
    });
  }, [servicesForVehicle, serviceQuery, activeGroup]);

  const selectedServices = useMemo(
    () => servicesForVehicle.filter((s) => selectedServiceIds.has(s.id)),
    [servicesForVehicle, selectedServiceIds],
  );

  const selectedVehicleName = selectedVehicle?.name ?? null;

  const breakdown = useMemo(() => {
    if (!vehicleTypeId || selectedServiceIds.size === 0) return null;
    try {
      return calculatePrice(
        Array.from(selectedServiceIds).map((serviceId) => ({ serviceId, quantity: 1 })),
        vehicleTypeId,
        prices,
      );
    } catch {
      return null;
    }
  }, [vehicleTypeId, selectedServiceIds, prices]);

  const discountPaise = useMemo(() => {
    const rupees = Number(discountRupees);
    if (!discountRupees.trim() || !Number.isFinite(rupees) || rupees <= 0) return 0;
    return Math.round(rupees * 100);
  }, [discountRupees]);

  const discountExceedsSubtotal = Boolean(breakdown) && discountPaise > (breakdown?.subtotal ?? 0);
  const discountNeedsReason = discountPaise > 0 && discountReason.trim().length === 0;
  const finalTotal = breakdown ? Math.max(0, breakdown.subtotal - discountPaise) : 0;

  const closeDiscount = () => {
    setDiscountOpen(false);
    setDiscountRupees('');
    setDiscountReason('');
  };

  const startWash = async () => {
    if (!vehicleTypeId || !breakdown) return;
    const phoneDigits = normalizePhone(phone);
    const name = customerName.trim();
    const reg = normalizeReg(registration);
    if (phoneDigits.length < 10 || name.length === 0 || reg.length < 4) return;
    if (discountExceedsSubtotal || discountNeedsReason) return;

    setSubmitting(true);
    setError(null);
    try {
      const ensureRes = await api.customers.ensure.$post({
        json: {
          phone: phoneDigits,
          name,
          vehicle: { registrationNumber: reg, vehicleTypeId },
        },
      });
      if (!ensureRes.ok) throw new Error('Could not save customer / vehicle.');
      const ensured = await ensureRes.json();
      if (!('customer' in ensured) || !ensured.customer || !ensured.vehicle) {
        throw new Error('Could not save customer / vehicle.');
      }

      const jobRes = await api.jobs.$post({
        json: {
          customerId: ensured.customer.id,
          vehicleId: ensured.vehicle.id,
          vehicleTypeId,
          services: Array.from(selectedServiceIds).map((serviceId) => ({ serviceId, quantity: 1 })),
          discount: discountPaise,
          discountReason: discountPaise > 0 ? discountReason.trim() : undefined,
        },
      });
      if (!jobRes.ok) {
        const body = (await jobRes.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Could not start the wash.');
      }

      setPhone('');
      setCustomerName('');
      setRegistration('');
      setVehicleTypeId(null);
      setSelectedServiceIds(new Set());
      setServiceQuery('');
      setActiveGroup('All');
      closeDiscount();
      navigation.navigate('JobBoard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const phoneOk = normalizePhone(phone).length >= 10;
  const nameOk = customerName.trim().length > 0;
  const regOk = normalizeReg(registration).length >= 4;
  const canSubmit =
    Boolean(vehicleTypeId) &&
    selectedServiceIds.size > 0 &&
    phoneOk &&
    nameOk &&
    regOk &&
    Boolean(breakdown) &&
    !discountExceedsSubtotal &&
    !discountNeedsReason;

  const progressSteps = [
    phoneOk && nameOk && regOk,
    Boolean(vehicleTypeId),
    selectedServiceIds.size > 0,
  ];
  const progressDone = progressSteps.filter(Boolean).length;

  return (
    <ScreenContainer noPadding edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Soft brand header */}
        <LinearGradient
          colors={[gradients.hero[0], gradients.hero[1], colors.surface] as unknown as string[]}
          locations={[0, 0.65, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={[styles.hero, { paddingTop: insets.top + spacing.sm }]}
        >
          <View style={styles.heroTop}>
            <Pressable
              onPress={() => navigation.goBack()}
              style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <IconChevronLeft size={22} color={colors.white} />
            </Pressable>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>MANA</Text>
              <Text style={styles.heroTitle}>New Wash</Text>
            </View>
            <View style={styles.progressPill}>
              <Text style={styles.progressText}>{progressDone}/3</Text>
            </View>
          </View>
        </LinearGradient>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* 1 · Customer — edge list */}
          <Text style={styles.sectionLabel}>1 · Customer</Text>
          <View style={styles.edgeList}>
            <View style={[styles.fieldRow, styles.rowDivider]}>
              <Text style={styles.fieldLabel}>
                Customer name <Text style={styles.requiredMark}>*</Text>
              </Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="Full name"
                placeholderTextColor={colors.slate}
                value={customerName}
                onChangeText={setCustomerName}
                autoCapitalize="words"
                autoCorrect={false}
              />
            </View>
            <View style={[styles.fieldRow, styles.rowDivider]}>
              <Text style={styles.fieldLabel}>
                Mobile number <Text style={styles.requiredMark}>*</Text>
              </Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="98765 43210"
                placeholderTextColor={colors.slate}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoCorrect={false}
              />
            </View>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>
                Vehicle number <Text style={styles.requiredMark}>*</Text>
              </Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="KA01AB1234"
                placeholderTextColor={colors.slate}
                value={registration}
                onChangeText={(t) => setRegistration(t.toUpperCase())}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>
          </View>

          {/* 2 · Vehicle type — Cars / Bikes then cinematic gallery */}
          <View style={styles.sectionPad}>
            <View style={styles.sectionHeaderRow}>
              <View>
                <Text style={[styles.sectionLabel, styles.sectionLabelFlush]}>2 · Vehicle type</Text>
                <Text style={styles.hintLine}>
                  {selectedVehicleName
                    ? `${selectedVehicleName} selected · tap again to clear`
                    : 'Pick Cars or Bikes, then a size'}
                </Text>
              </View>
            </View>

            <View style={styles.familySegment}>
              {VEHICLE_FAMILIES.map((f) => {
                const on = vehicleFamily === f.id;
                const count = vehicleTypes.filter((vt) => vt.category === f.id).length;
                return (
                  <Pressable
                    key={f.id}
                    onPress={() => switchFamily(f.id)}
                    style={[styles.familyBtn, on && styles.familyBtnOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.familyBtnText, on && styles.familyBtnTextOn]}>{f.label}</Text>
                    <Text style={[styles.familyBtnMeta, on && styles.familyBtnMetaOn]}>{count}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {catalogLoading ? (
            <View style={styles.statusBand}>
              <Text style={styles.statusText}>Loading vehicle types…</Text>
            </View>
          ) : catalogError ? (
            <View style={styles.statusBand}>
              <Text style={styles.statusError}>{catalogError}</Text>
              <Pressable onPress={() => void loadCatalog()} style={styles.retryBtn}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </Pressable>
            </View>
          ) : typesInFamily.length === 0 ? (
            <View style={styles.statusBand}>
              <Text style={styles.statusText}>
                No {vehicleFamily === 'bike' ? 'bike' : 'car'} sizes yet. Add them in Settings →{' '}
                {vehicleFamily === 'bike' ? 'Bikes' : 'Cars'}.
              </Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.vehicleScroll}
              decelerationRate="fast"
              snapToInterval={184}
              snapToAlignment="start"
            >
              {typesInFamily.map((vt) => (
                <VehicleTypeCard
                  key={vt.id}
                  name={vt.name}
                  selected={vehicleTypeId === vt.id}
                  onPress={() => toggleVehicle(vt.id)}
                />
              ))}
            </ScrollView>
          )}

          {/* 3 · Services — only for the selected vehicle family */}
          <View style={styles.sectionPad}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.flex}>
                <Text style={[styles.sectionLabel, styles.sectionLabelFlush]}>3 · Services</Text>
                <Text style={styles.hintLine}>
                  {!vehicleTypeId
                    ? 'Select a vehicle to unlock matching services'
                    : vehicleFamily === 'bike'
                      ? 'Bike menu only — car washes stay hidden'
                      : 'Car menu only — bike services stay hidden'}
                </Text>
              </View>
              {selectedServiceIds.size > 0 ? (
                <View style={styles.countPill}>
                  <Text style={styles.countPillText}>{selectedServiceIds.size}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {!vehicleTypeId ? (
            <View style={styles.lockedBand}>
              <Text style={styles.lockedTitle}>Almost there</Text>
              <Text style={styles.lockedBody}>
                Choose a {vehicleFamily === 'bike' ? 'bike' : 'car'} size above — then pick services
                with live prices.
              </Text>
            </View>
          ) : (
            <>
              {selectedServices.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.selectedTray}
                >
                  {selectedServices.map((s) => (
                    <Pressable
                      key={s.id}
                      onPress={() => toggleService(s.id)}
                      style={styles.selectedChip}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${s.name}`}
                    >
                      <Text style={styles.selectedChipText} numberOfLines={1}>
                        {s.name}
                      </Text>
                      <Text style={styles.selectedChipX}>×</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}

              <View style={styles.searchBand}>
                <Text style={styles.searchGlyph}>⌕</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search services…"
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

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.groupRow}
              >
                {(['All', ...availableGroups] as const).map((group) => {
                  const on = activeGroup === group;
                  const tone = group === 'All' ? null : GROUP_TONE[group];
                  return (
                    <Pressable
                      key={group}
                      onPress={() => setActiveGroup(group)}
                      style={[
                        styles.groupChip,
                        on && styles.groupChipOn,
                        on && tone ? { backgroundColor: tone.accent, borderColor: tone.accent } : null,
                      ]}
                    >
                      <Text style={[styles.groupChipText, on && styles.groupChipTextOn]}>{group}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={styles.edgeList}>
                {filteredServices.length === 0 ? (
                  <Text style={styles.emptyServices}>
                    {serviceQuery
                      ? `No services match “${serviceQuery}”`
                      : servicesForVehicle.length === 0
                        ? `No ${vehicleFamily} services yet — add them in Settings`
                        : 'No services in this group'}
                  </Text>
                ) : (
                  filteredServices.map((s, index) => {
                    const group = groupForService(s.name);
                    const price = priceFor(s.id);
                    return (
                      <ServicePickRow
                        key={s.id}
                        name={s.name}
                        group={group}
                        priceLabel={price != null ? formatRupees(price) : 'Set in Settings'}
                        selected={selectedServiceIds.has(s.id)}
                        onPress={() => toggleService(s.id)}
                        showDivider={index < filteredServices.length - 1}
                      />
                    );
                  })
                )}
              </View>

              {breakdown ? (
                <>
                  <Text style={styles.sectionLabel}>4 · Discount</Text>
                  {!discountOpen ? (
                    <Pressable
                      onPress={() => setDiscountOpen(true)}
                      style={styles.discountToggle}
                      accessibilityRole="button"
                    >
                      <IconPlus size={16} color={colors.water} />
                      <Text style={styles.discountToggleText}>Add a discount</Text>
                    </Pressable>
                  ) : (
                    <View style={styles.edgeList}>
                      <View style={[styles.fieldRow, styles.rowDivider]}>
                        <View style={styles.discountHeader}>
                          <Text style={styles.fieldLabel}>Discount amount (₹)</Text>
                          <Pressable onPress={closeDiscount} hitSlop={8}>
                            <Text style={styles.discountRemove}>Remove</Text>
                          </Pressable>
                        </View>
                        <TextInput
                          style={styles.fieldInput}
                          placeholder="0"
                          placeholderTextColor={colors.slate}
                          value={discountRupees}
                          onChangeText={setDiscountRupees}
                          keyboardType="numeric"
                        />
                      </View>
                      <View style={styles.fieldRow}>
                        <Text style={styles.fieldLabel}>Reason</Text>
                        <TextInput
                          style={[styles.fieldInput, styles.fieldInputReason]}
                          placeholder="e.g. first wash, referral"
                          placeholderTextColor={colors.slate}
                          value={discountReason}
                          onChangeText={setDiscountReason}
                        />
                        {discountExceedsSubtotal ? (
                          <Text style={styles.discountError}>
                            Discount can’t be more than {formatRupees(breakdown.subtotal)}.
                          </Text>
                        ) : discountNeedsReason ? (
                          <Text style={styles.discountError}>
                            Add a reason so the discount can be tracked.
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  )}
                </>
              ) : null}
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.scrollSpacer} />
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <LinearGradient
            colors={['#E0F2FE', '#FFFFFF'] as unknown as string[]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.footerAccent}
          />
          <View style={styles.totalBlock}>
            <View>
              <Text style={styles.totalLabel}>Total</Text>
              {selectedServiceIds.size > 0 ? (
                <Text style={styles.totalMeta}>
                  {selectedServiceIds.size} service{selectedServiceIds.size === 1 ? '' : 's'}
                  {discountPaise > 0 && !discountExceedsSubtotal
                    ? ` · ${formatRupees(discountPaise)} off`
                    : ''}
                </Text>
              ) : (
                <Text style={styles.totalMeta}>Complete the steps above</Text>
              )}
            </View>
            <Text style={styles.totalValue}>
              {breakdown
                ? formatRupees(discountExceedsSubtotal ? breakdown.subtotal : finalTotal)
                : '₹0'}
            </Text>
          </View>
          <Button
            label={submitting ? 'Starting…' : 'Start Wash'}
            size="lg"
            onPress={() => void startWash()}
            loading={submitting}
            disabled={!canSubmit}
            icon={<IconDroplet size={16} color={colors.white} />}
          />
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: {
    paddingBottom: spacing.md,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: {
    flex: 1,
    gap: 2,
  },
  heroEyebrow: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 2,
  },
  heroTitle: {
    ...typography.heading,
    color: colors.white,
    fontSize: 22,
    letterSpacing: -0.3,
  },
  progressPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  progressText: {
    ...typography.label,
    color: colors.white,
    fontSize: 12,
  },
  content: {
    paddingBottom: spacing.lg,
    gap: 0,
  },
  sectionPad: {
    paddingHorizontal: spacing.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.slateDeep,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  sectionLabelFlush: {
    marginTop: 0,
    marginBottom: 2,
    paddingHorizontal: 0,
  },
  hintLine: {
    ...typography.caption,
    color: colors.slate,
    marginBottom: spacing.sm,
  },
  familySegment: {
    flexDirection: 'row',
    backgroundColor: colors.waterPale,
    borderRadius: radius.lg,
    padding: 4,
    gap: 4,
    marginBottom: spacing.sm,
  },
  familyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
  },
  familyBtnOn: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  familyBtnText: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 15,
  },
  familyBtnTextOn: {
    color: colors.waterDeep,
  },
  familyBtnMeta: {
    ...typography.caption,
    color: colors.slateDeep,
    backgroundColor: 'rgba(255,255,255,0.55)',
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: radius.pill,
    fontWeight: '700',
  },
  familyBtnMetaOn: {
    color: colors.water,
    backgroundColor: colors.waterPale,
  },
  edgeList: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  fieldRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 4,
    backgroundColor: colors.white,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fieldLabel: {
    ...typography.caption,
    color: colors.slateDeep,
    letterSpacing: 0.3,
  },
  requiredMark: {
    color: colors.danger,
    fontWeight: '700',
  },
  fieldInput: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.waterInk,
    letterSpacing: 0.4,
    paddingVertical: 2,
  },
  fieldInputReason: {
    fontSize: 16,
    fontWeight: '600',
  },
  vehicleScroll: {
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  statusBand: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  statusText: {
    ...typography.body,
    color: colors.slateDeep,
  },
  statusError: {
    ...typography.body,
    color: colors.danger,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.water,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryBtnText: {
    ...typography.label,
    color: colors.white,
  },
  countPill: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.water,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  countPillText: {
    ...typography.label,
    color: colors.white,
  },
  lockedBand: {
    backgroundColor: colors.waterPale,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    gap: 4,
  },
  lockedTitle: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 17,
  },
  lockedBody: {
    ...typography.body,
    color: colors.slateDeep,
    fontSize: 14,
  },
  selectedTray: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.waterInk,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: 220,
  },
  selectedChipText: {
    ...typography.label,
    color: colors.white,
    textTransform: 'none',
    flexShrink: 1,
  },
  selectedChipX: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 18,
  },
  searchBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  searchGlyph: {
    fontSize: 18,
    color: colors.slate,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: colors.waterInk,
    paddingVertical: spacing.md,
  },
  clearSearch: {
    ...typography.caption,
    color: colors.water,
    fontWeight: '700',
  },
  groupRow: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  groupChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  groupChipOn: {
    backgroundColor: colors.waterInk,
    borderColor: colors.waterInk,
  },
  groupChipText: {
    ...typography.label,
    color: colors.waterDeep,
    textTransform: 'none',
  },
  groupChipTextOn: {
    color: colors.white,
  },
  emptyServices: {
    ...typography.body,
    color: colors.slateDeep,
    padding: spacing.lg,
    textAlign: 'center',
  },
  discountToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  discountToggleText: {
    ...typography.bodyStrong,
    color: colors.water,
  },
  discountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  discountRemove: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
  },
  discountError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  scrollSpacer: {
    height: spacing.lg,
  },
  footer: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
    ...shadow('md'),
  },
  footerAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  totalBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalLabel: {
    ...typography.body,
    color: colors.slateDeep,
  },
  totalMeta: {
    ...typography.caption,
    color: colors.slate,
    marginTop: 2,
  },
  totalValue: {
    ...typography.title,
    color: colors.waterInk,
    fontSize: 30,
    letterSpacing: -0.5,
  },
  error: {
    color: colors.danger,
    ...typography.label,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
});
