import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { colors, radius, spacing, typography } from '../theme';
import { api } from '../api/client';
import type { RootStackParamList } from '../navigation/RootNavigator';
import {
  calculatePrice,
  type Service,
  type ServicePrice,
  type VehicleType,
} from '@mana/domain';

type NewWashScreenProps = NativeStackScreenProps<RootStackParamList, 'NewWash'>;

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toFixed(0)}`;
}

export function NewWashScreen({ navigation }: NewWashScreenProps) {
  const [services, setServices] = useState<Service[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [prices, setPrices] = useState<ServicePrice[]>([]);

  const [phone, setPhone] = useState('');
  const [vehicleTypeId, setVehicleTypeId] = useState<string | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [servicesRes, vehicleTypesRes, pricesRes] = await Promise.all([
        api.services.$get(),
        api.services['vehicle-types'].$get(),
        api.services.prices.$get(),
      ]);
      setServices(await servicesRes.json());
      setVehicleTypes(await vehicleTypesRes.json());
      setPrices(await pricesRes.json());
    })();
  }, []);

  const toggleService = useCallback((serviceId: string) => {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev);
      next.has(serviceId) ? next.delete(serviceId) : next.add(serviceId);
      return next;
    });
  }, []);

  const breakdown = useMemo(() => {
    if (!vehicleTypeId || selectedServiceIds.size === 0) return null;
    try {
      return calculatePrice(
        Array.from(selectedServiceIds).map((serviceId) => ({ serviceId, quantity: 1 })),
        vehicleTypeId,
        prices,
      );
    } catch {
      return null; // a price is missing for this combination — owner needs to set it in Settings
    }
  }, [vehicleTypeId, selectedServiceIds, prices]);

  const startWash = async () => {
    if (!vehicleTypeId || !breakdown) return;
    setSubmitting(true);
    setError(null);
    try {
      const lookupRes = await api.customers.lookup.$get({ query: { phone } });
      const lookup = await lookupRes.json();

      let customerId: string;
      let vehicleId: string;

      if (lookup?.customer) {
        customerId = lookup.customer.id;
        vehicleId = lookup.vehicles?.[0]?.id ?? '';
      } else {
        const createRes = await api.customers.$post({
          json: {
            phone,
            vehicle: { registrationNumber: `WALK-IN-${Date.now()}`, vehicleTypeId },
          },
        });
        const created = await createRes.json();
        customerId = created.customer.id;
        vehicleId = created.vehicle.id;
      }

      const jobRes = await api.jobs.$post({
        json: {
          customerId,
          vehicleId,
          vehicleTypeId,
          services: Array.from(selectedServiceIds).map((serviceId) => ({ serviceId, quantity: 1 })),
          discount: 0,
        },
      });
      if (!jobRes.ok) throw new Error('Could not start the wash.');

      setPhone('');
      setSelectedServiceIds(new Set());
      navigation.navigate('JobBoard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>New Wash</Text>

        <Text style={styles.label}>Phone or registration number</Text>
        <TextInput
          style={styles.input}
          placeholder="98765 43210"
          placeholderTextColor={colors.waterLight}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />

        <Text style={styles.label}>Vehicle type</Text>
        <View style={styles.chipRow}>
          {vehicleTypes.map((vt) => (
            <Chip
              key={vt.id}
              label={vt.name}
              selected={vehicleTypeId === vt.id}
              onPress={() => setVehicleTypeId(vt.id)}
            />
          ))}
        </View>

        <Text style={styles.label}>Services</Text>
        <View style={styles.chipRow}>
          {services.map((s) => (
            <Chip
              key={s.id}
              label={s.name}
              selected={selectedServiceIds.has(s.id)}
              onPress={() => toggleService(s.id)}
            />
          ))}
        </View>

        {breakdown && (
          <View style={styles.priceBox}>
            <Text style={styles.priceLabel}>Total</Text>
            <Text style={styles.priceValue}>{formatRupees(breakdown.subtotal)}</Text>
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <Button
          label="Start Wash"
          onPress={startWash}
          loading={submitting}
          disabled={!vehicleTypeId || selectedServiceIds.size === 0 || phone.length < 10}
        />
      </ScrollView>
    </ScreenContainer>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Text
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
      suppressHighlighting
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.waterInk,
  },
  label: {
    ...typography.label,
    color: colors.waterInk,
    marginTop: spacing.sm,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 18,
    color: colors.waterInk,
    backgroundColor: colors.offWhite,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    ...typography.body,
    color: colors.water,
    borderWidth: 1.5,
    borderColor: colors.water,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    overflow: 'hidden',
  },
  chipSelected: {
    backgroundColor: colors.water,
    color: colors.white,
  },
  priceBox: {
    backgroundColor: colors.waterPale,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceLabel: {
    ...typography.heading,
    color: colors.waterInk,
  },
  priceValue: {
    ...typography.title,
    color: colors.waterDeep,
  },
  error: {
    color: colors.danger,
    ...typography.label,
  },
});
