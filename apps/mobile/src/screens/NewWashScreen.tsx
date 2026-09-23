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
import { ScreenHeader } from '../components/ScreenHeader';
import { Button } from '../components/Button';
import { VehicleTypeCard } from '../components/VehicleTypeIcon';
import { ServicePickRow, GROUP_TONE, type ServiceGroup } from '../components/ServicePickRow';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { api } from '../api/client';
import type { RootStackParamList } from '../navigation/RootNavigator';
import {
  calculatePrice,
  type Service,
  type ServicePrice,
  type VehicleType,
} from '@mana/domain';

type NewWashScreenProps = NativeStackScreenProps<RootStackParamList, 'NewWash'>;

const GROUP_ORDER: ServiceGroup[] = ['Wash', 'Interior', 'Protect', 'Add-ons', 'Other'];

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toFixed(0)}`;
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function normalizeReg(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function groupForService(name: string): ServiceGroup {
  const n = name.toLowerCase();
  if (n.includes('combo') || n.includes('wash') || n.includes('exterior') || n.includes('underbody')) return 'Wash';
  if (n.includes('interior') || n.includes('cabin') || n.includes('ac ') || n.startsWith('ac')) return 'Interior';
  if (n.includes('ceramic') || n.includes('coat') || n.includes('polish') || n.includes('wax')) return 'Protect';
  if (
    n.includes('tyre') ||
    n.includes('tire') ||
    n.includes('dashboard') ||
    n.includes('fragrance') ||
    n.includes('dressing')
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
  const [registration, setRegistration] = useState('');
  const [vehicleTypeId, setVehicleTypeId] = useState<string | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const [serviceQuery, setServiceQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<ServiceGroup | 'All'>('All');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const [servicesRes, vehicleTypesRes, pricesRes] = await Promise.all([
        api.services.$get(),
        api.services['vehicle-types'].$get(),
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
      setServices(Array.isArray(servicesJson) ? servicesJson : []);
      setVehicleTypes(vehicleTypesJson);
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

  const toggleVehicle = useCallback((id: string) => {
    setVehicleTypeId((prev) => {
      if (prev === id) {
        setSelectedServiceIds(new Set());
        return null;
      }
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
    const present = new Set(services.map((s) => groupForService(s.name)));
    return GROUP_ORDER.filter((g) => present.has(g));
  }, [services]);

  const filteredServices = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase();
    return services.filter((s) => {
      if (activeGroup !== 'All' && groupForService(s.name) !== activeGroup) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q);
    });
  }, [services, serviceQuery, activeGroup]);

  const selectedServices = useMemo(
    () => services.filter((s) => selectedServiceIds.has(s.id)),
    [services, selectedServiceIds],
  );

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

  const startWash = async () => {
    if (!vehicleTypeId || !breakdown) return;
    const phoneDigits = normalizePhone(phone);
    const reg = normalizeReg(registration);
    if (phoneDigits.length < 10 || reg.length < 4) return;

    setSubmitting(true);
    setError(null);
    try {
      const ensureRes = await api.customers.ensure.$post({
        json: {
          phone: phoneDigits,
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
          discount: 0,
        },
      });
      if (!jobRes.ok) throw new Error('Could not start the wash.');

      setPhone('');
      setRegistration('');
      setVehicleTypeId(null);
      setSelectedServiceIds(new Set());
      setServiceQuery('');
      setActiveGroup('All');
      navigation.navigate('JobBoard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const phoneOk = normalizePhone(phone).length >= 10;
  const regOk = normalizeReg(registration).length >= 4;
  const canSubmit = Boolean(vehicleTypeId) && selectedServiceIds.size > 0 && phoneOk && regOk && Boolean(breakdown);

  return (
    <ScreenContainer>
      <ScreenHeader title="New Wash" onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.stepHint}>1 · Customer</Text>
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Mobile number</Text>
            <TextInput
              style={styles.input}
              placeholder="98765 43210"
              placeholderTextColor={colors.slate}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoCorrect={false}
            />
            <View style={styles.fieldDivider} />
            <Text style={styles.fieldLabel}>Vehicle number</Text>
            <TextInput
              style={styles.input}
              placeholder="KA01AB1234"
              placeholderTextColor={colors.slate}
              value={registration}
              onChangeText={(t) => setRegistration(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>

          <Text style={styles.stepHint}>2 · Vehicle type</Text>
          <Text style={styles.hintLine}>Tap again to deselect</Text>
          {catalogLoading ? (
            <View style={styles.vehicleStatus}>
              <Text style={styles.vehicleStatusText}>Loading vehicle types…</Text>
            </View>
          ) : catalogError ? (
            <View style={styles.vehicleStatus}>
              <Text style={styles.vehicleStatusError}>{catalogError}</Text>
              <Pressable onPress={() => void loadCatalog()} style={styles.retryBtn}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </Pressable>
            </View>
          ) : vehicleTypes.length === 0 ? (
            <View style={styles.vehicleStatus}>
              <Text style={styles.vehicleStatusText}>No vehicle types yet. Add them in Settings.</Text>
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
              {vehicleTypes.map((vt) => (
                <VehicleTypeCard
                  key={vt.id}
                  name={vt.name}
                  selected={vehicleTypeId === vt.id}
                  onPress={() => toggleVehicle(vt.id)}
                />
              ))}
            </ScrollView>
          )}

          <View style={styles.servicesHeader}>
            <View>
              <Text style={[styles.stepHint, styles.stepHintInline]}>3 · Services</Text>
              <Text style={styles.hintLine}>
                {vehicleTypeId ? 'Tap a row to add or remove' : 'Select a vehicle to unlock prices'}
              </Text>
            </View>
            {selectedServiceIds.size > 0 ? (
              <View style={styles.countPill}>
                <Text style={styles.countPillText}>{selectedServiceIds.size}</Text>
              </View>
            ) : null}
          </View>

          {!vehicleTypeId ? (
            <View style={styles.lockedPanel}>
              <LinearGradient
                colors={[colors.waterPale, colors.white]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.lockedInner}
              >
                <Text style={styles.lockedTitle}>Almost there</Text>
                <Text style={styles.lockedBody}>
                  Choose a vehicle type above — then pick services with live prices.
                </Text>
              </LinearGradient>
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

              <View style={styles.searchBlock}>
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

              <View style={styles.serviceList}>
                {filteredServices.length === 0 ? (
                  <Text style={styles.emptyServices}>
                    {serviceQuery ? `No services match “${serviceQuery}”` : 'No services in this group'}
                  </Text>
                ) : (
                  filteredServices.map((s) => {
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
                      />
                    );
                  })
                )}
              </View>
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.scrollSpacer} />
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.totalBlock}>
            <View>
              <Text style={styles.totalLabel}>Total</Text>
              {selectedServiceIds.size > 0 ? (
                <Text style={styles.totalMeta}>{selectedServiceIds.size} service{selectedServiceIds.size === 1 ? '' : 's'}</Text>
              ) : null}
            </View>
            <Text style={styles.totalValue}>{breakdown ? formatRupees(breakdown.subtotal) : '₹0'}</Text>
          </View>
          <Button
            label={submitting ? 'Starting…' : 'Start Wash'}
            size="lg"
            onPress={startWash}
            loading={submitting}
            disabled={!canSubmit}
          />
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  stepHint: {
    ...typography.label,
    color: colors.slateDeep,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: 2,
  },
  stepHintInline: {
    marginTop: 0,
    marginBottom: 0,
  },
  hintLine: {
    ...typography.caption,
    color: colors.slate,
    marginBottom: spacing.xs,
  },
  fieldBlock: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  fieldLabel: {
    ...typography.caption,
    color: colors.slateDeep,
    marginTop: spacing.xs,
  },
  fieldDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  input: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.waterInk,
    letterSpacing: 0.5,
    paddingVertical: spacing.xs,
  },
  vehicleScroll: {
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingRight: spacing.lg,
  },
  vehicleStatus: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  vehicleStatusText: {
    ...typography.body,
    color: colors.slateDeep,
  },
  vehicleStatusError: {
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
  servicesHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginTop: spacing.md,
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
  selectedTray: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
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
  searchBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    ...shadow('sm'),
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
    paddingVertical: 2,
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
  lockedPanel: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  lockedInner: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  lockedTitle: {
    ...typography.heading,
    color: colors.waterInk,
  },
  lockedBody: {
    ...typography.body,
    color: colors.slateDeep,
  },
  serviceList: {
    gap: spacing.sm,
  },
  emptyServices: {
    ...typography.body,
    color: colors.slateDeep,
    padding: spacing.lg,
    textAlign: 'center',
  },
  scrollSpacer: {
    height: spacing.lg,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
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
    fontSize: 28,
  },
  error: {
    color: colors.danger,
    ...typography.label,
    marginTop: spacing.sm,
  },
});
