import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { PromptModal } from '../components/PromptModal';
import { colors, radius, spacing, typography } from '../theme';
import { api } from '../api/client';
import type { Service, ServicePrice, VehicleType } from '@mana/domain';

function formatRupees(paise: number): string {
  return `₹${(paise / 100).toFixed(0)}`;
}

type Prompt =
  | { kind: 'addService' }
  | { kind: 'addVehicleType' }
  | { kind: 'editPrice'; serviceId: string; serviceName: string; vehicleTypeId: string; vehicleTypeName: string; price: number | null };

export function SettingsScreen() {
  const [services, setServices] = useState<Service[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [prices, setPrices] = useState<ServicePrice[]>([]);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [servicesRes, vehicleTypesRes, pricesRes] = await Promise.all([
      api.services.$get(),
      api.services['vehicle-types'].$get(),
      api.services.prices.$get(),
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

  const priceFor = (serviceId: string, vehicleTypeId: string): number | null => {
    const match = prices.find((p) => p.serviceId === serviceId && p.vehicleTypeId === vehicleTypeId);
    return match ? match.price : null;
  };

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

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Vehicle types</Text>
        <View style={styles.chipRow}>
          {vehicleTypes.map((vt) => (
            <Text key={vt.id} style={styles.vehicleTypeChip}>
              {vt.name}
            </Text>
          ))}
        </View>
        <Button label="+ Add vehicle type" variant="secondary" onPress={() => setPrompt({ kind: 'addVehicleType' })} />

        <Text style={styles.sectionTitle}>Services & prices</Text>
        <Text style={styles.hint}>Tap a price to change it. A blank cell means no price is set yet.</Text>

        {services.map((service) => (
          <View key={service.id} style={styles.serviceCard}>
            <Text style={styles.serviceName}>{service.name}</Text>
            <View style={styles.priceGrid}>
              {vehicleTypes.map((vt) => {
                const price = priceFor(service.id, vt.id);
                return (
                  <Text
                    key={vt.id}
                    style={[styles.priceCell, price === null && styles.priceCellEmpty]}
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
                    suppressHighlighting
                  >
                    {vt.name}{'\n'}
                    {price === null ? 'Set price' : formatRupees(price)}
                  </Text>
                );
              })}
            </View>
          </View>
        ))}

        <Button label="+ Add service" onPress={() => setPrompt({ kind: 'addService' })} />

        {error && <Text style={styles.error}>{error}</Text>}
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
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.waterInk,
    marginTop: spacing.sm,
  },
  hint: {
    ...typography.label,
    color: colors.waterInk,
    opacity: 0.7,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  vehicleTypeChip: {
    ...typography.body,
    color: colors.waterDeep,
    backgroundColor: colors.waterPale,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
  serviceCard: {
    backgroundColor: colors.offWhite,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  serviceName: {
    ...typography.heading,
    color: colors.waterInk,
  },
  priceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  priceCell: {
    ...typography.label,
    color: colors.white,
    backgroundColor: colors.water,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    textAlign: 'center',
    overflow: 'hidden',
    minWidth: 92,
  },
  priceCellEmpty: {
    backgroundColor: colors.white,
    color: colors.water,
    borderWidth: 1.5,
    borderColor: colors.water,
  },
  error: {
    color: colors.danger,
    ...typography.label,
  },
});
