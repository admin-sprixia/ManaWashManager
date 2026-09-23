import React, { useCallback, useMemo, useState } from 'react';
import { LayoutAnimation, Platform, Pressable, ScrollView, StyleSheet, Text, UIManager, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { ScreenHeader } from '../components/ScreenHeader';
import { PromptModal } from '../components/PromptModal';
import { colors, radius, spacing, typography } from '../theme';
import { api } from '../api/client';
import type { Service, ServicePrice, VehicleType } from '@mana/domain';
import type { RootStackParamList } from '../navigation/RootNavigator';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toFixed(0)}`;
}

function animate() {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
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

export function SettingsScreen({ navigation }: SettingsScreenProps) {
  const [services, setServices] = useState<Service[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [prices, setPrices] = useState<ServicePrice[]>([]);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vehiclesOpen, setVehiclesOpen] = useState(false);
  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [servicesRes, vehicleTypesRes, pricesRes] = await Promise.all([
      api.services.$get(),
      api.services['vehicle-types'].$get(),
      api.services.prices.$get({ query: {} }),
    ]);
    setServices(await servicesRes.json());
    setVehicleTypes(await vehicleTypesRes.json());
    setPrices(await pricesRes.json());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const priceFor = useCallback(
    (serviceId: string, vehicleTypeId: string): number | null => {
      const match = prices.find((p) => p.serviceId === serviceId && p.vehicleTypeId === vehicleTypeId);
      return match ? match.price : null;
    },
    [prices],
  );

  const coverage = useMemo(() => {
    const map = new Map<string, { set: number; total: number }>();
    for (const service of services) {
      let set = 0;
      for (const vt of vehicleTypes) {
        if (priceFor(service.id, vt.id) != null) set += 1;
      }
      map.set(service.id, { set, total: vehicleTypes.length });
    }
    return map;
  }, [services, vehicleTypes, priceFor]);

  const closePrompt = () => setPrompt(null);

  const submitPrompt = async (value: string) => {
    setError(null);
    try {
      if (prompt?.kind === 'addService') {
        const res = await api.services.$post({ json: { name: value.trim() } });
        if (!res.ok) throw new Error('Could not add service.');
      } else if (prompt?.kind === 'addVehicleType') {
        const res = await api.services['vehicle-types'].$post({ json: { name: value.trim() } });
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

  const toggleVehicles = () => {
    animate();
    setVehiclesOpen((open) => !open);
  };

  const toggleService = (serviceId: string) => {
    animate();
    setExpandedServiceId((current) => (current === serviceId ? null : serviceId));
  };

  return (
    <ScreenContainer>
      <ScreenHeader title="Settings" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>Catalog & pricing — tap a service to edit its prices</Text>

        {/* Vehicle types — collapsed by default */}
        <Text style={styles.sectionLabel}>Vehicle types</Text>
        <View style={styles.block}>
          <Pressable
            onPress={toggleVehicles}
            style={styles.accordionHeader}
            accessibilityRole="button"
            accessibilityState={{ expanded: vehiclesOpen }}
          >
            <View style={styles.accordionCopy}>
              <Text style={styles.accordionTitle}>
                {vehicleTypes.length} type{vehicleTypes.length === 1 ? '' : 's'}
              </Text>
              <Text style={styles.accordionMeta} numberOfLines={1}>
                {vehicleTypes.length === 0
                  ? 'None yet'
                  : vehiclesOpen
                    ? 'Tap to collapse'
                    : vehicleTypes.map((v) => v.name).join(' · ')}
              </Text>
            </View>
            <Text style={styles.chevron}>{vehiclesOpen ? '▾' : '▸'}</Text>
          </Pressable>

          {vehiclesOpen && (
            <View style={styles.accordionBody}>
              {vehicleTypes.map((vt, index) => (
                <View
                  key={vt.id}
                  style={[styles.simpleRow, index < vehicleTypes.length - 1 && styles.rowDivider]}
                >
                  <View style={styles.dot} />
                  <Text style={styles.simpleRowText}>{vt.name}</Text>
                </View>
              ))}
              <Pressable
                onPress={() => setPrompt({ kind: 'addVehicleType' })}
                style={styles.addRow}
                accessibilityRole="button"
              >
                <Text style={styles.addRowText}>+ Add vehicle type</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Services — one expandable at a time */}
        <View style={styles.servicesHeader}>
          <Text style={[styles.sectionLabel, styles.sectionLabelInline]}>Services</Text>
          <Text style={styles.countBadge}>{services.length}</Text>
        </View>

        <View style={styles.block}>
          {services.map((service, index) => {
            const expanded = expandedServiceId === service.id;
            const cov = coverage.get(service.id) ?? { set: 0, total: vehicleTypes.length };
            const complete = cov.total > 0 && cov.set === cov.total;
            const missing = cov.total - cov.set;

            return (
              <View key={service.id}>
                <Pressable
                  onPress={() => toggleService(service.id)}
                  style={[
                    styles.serviceHeader,
                    index < services.length - 1 && !expanded && styles.rowDivider,
                    expanded && styles.serviceHeaderOpen,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                >
                  <View style={styles.accordionCopy}>
                    <Text style={styles.serviceName}>{service.name}</Text>
                    <Text style={[styles.coverage, complete ? styles.coverageOk : styles.coverageWarn]}>
                      {complete
                        ? 'All prices set'
                        : missing === cov.total
                          ? 'No prices set'
                          : `${missing} price${missing === 1 ? '' : 's'} missing`}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
                </Pressable>

                {expanded && (
                  <View style={[styles.priceList, index < services.length - 1 && styles.rowDivider]}>
                    {vehicleTypes.length === 0 ? (
                      <Text style={styles.emptyHint}>Add a vehicle type first.</Text>
                    ) : (
                      vehicleTypes.map((vt, vtIndex) => {
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
                              vtIndex < vehicleTypes.length - 1 && styles.priceRowDivider,
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
          })}

          <Pressable
            onPress={() => setPrompt({ kind: 'addService' })}
            style={[styles.addRow, services.length > 0 && styles.addRowBorder]}
            accessibilityRole="button"
          >
            <Text style={styles.addRowText}>+ Add service</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.bottomPad} />
      </ScrollView>

      <PromptModal
        visible={prompt?.kind === 'addService'}
        title="Add service"
        label="Service name (e.g. Ceramic Coating)"
        onCancel={closePrompt}
        onSubmit={submitPrompt}
      />
      <PromptModal
        visible={prompt?.kind === 'addVehicleType'}
        title="Add vehicle type"
        label="Vehicle type name (e.g. Bike)"
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
  subtitle: {
    ...typography.body,
    color: colors.slateDeep,
    marginBottom: spacing.md,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.slateDeep,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  sectionLabelInline: {
    marginTop: 0,
    marginBottom: 0,
  },
  servicesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  countBadge: {
    ...typography.caption,
    color: colors.slateDeep,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  block: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 64,
  },
  accordionCopy: {
    flex: 1,
    gap: 2,
  },
  accordionTitle: {
    ...typography.bodyStrong,
    color: colors.waterInk,
    fontSize: 17,
  },
  accordionMeta: {
    ...typography.caption,
    color: colors.slateDeep,
  },
  chevron: {
    fontSize: 16,
    color: colors.slate,
    width: 18,
    textAlign: 'center',
  },
  accordionBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  simpleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
  },
  simpleRowText: {
    ...typography.body,
    color: colors.waterInk,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.water,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  serviceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 68,
    backgroundColor: colors.white,
  },
  serviceHeaderOpen: {
    backgroundColor: colors.waterPale,
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
    marginLeft: spacing.sm,
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
  addRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
  },
  addRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  addRowText: {
    ...typography.bodyStrong,
    color: colors.water,
  },
  bottomPad: {
    height: spacing.xl,
  },
  error: {
    color: colors.danger,
    ...typography.label,
    marginTop: spacing.md,
  },
});
