import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gradient, IconBike, IconCar, IconTrash, brandGradients, colors, formatRelativeDate, typography } from '@mana/ui';
import type { Vehicle } from '../api/types';
import { EdgeGroup } from './CardList';
import { FreeWashCard } from './FreeWashCard';
import { GiftTicket, OfferTicket } from './OfferTicket';

function giftLine(g: Vehicle['giftsOwed'][number]): string {
  if (g.unit === 'pcs') return g.quantity === 1 ? g.itemName : `${g.itemName} × ${g.quantity}`;
  return `${g.itemName} · ${g.quantity} ${g.unit}`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** A vehicle: a card with its plate and visits, then its free-wash cards, offers and gifts as their own cards. */
export function VehicleCard({ vehicle, now, onRemove }: { vehicle: Vehicle; now: Date; onRemove?: () => void }) {
  const isBike = vehicle.type.category === 'bike';
  const model = [vehicle.make, vehicle.model].filter(Boolean).join(' ');
  const cards = vehicle.cards.filter((c) => c.stamps > 0 || c.free > 0);
  const visits =
    vehicle.washes === 0
      ? 'No washes yet'
      : `${vehicle.washes} ${vehicle.washes === 1 ? 'wash' : 'washes'}${
          vehicle.lastWashAt ? ` · last ${formatRelativeDate(vehicle.lastWashAt).toLowerCase()}` : ''
        }`;
  return (
    <View>
      <EdgeGroup>
        <View style={styles.head}>
          <Gradient spec={brandGradients.tile} style={styles.icon}>
            {isBike ? <IconBike size={24} color={colors.indigo} /> : <IconCar size={24} color={colors.indigo} />}
          </Gradient>
          <View style={styles.headCopy}>
            <View style={styles.plate}>
              <Text style={styles.plateText}>{vehicle.registrationNumber}</Text>
            </View>
            <Text style={styles.meta} numberOfLines={1}>
              {[model || vehicle.type.name, visits].join(' · ')}
            </Text>
          </View>
          {onRemove ? (
            <Pressable
              onPress={onRemove}
              hitSlop={8}
              style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${vehicle.registrationNumber} from the app`}
            >
              <IconTrash size={18} color={colors.slate} />
            </Pressable>
          ) : null}
        </View>
      </EdgeGroup>
      {cards.map((c) => (
        <View key={c.serviceName} style={styles.gap}>
          <FreeWashCard card={c} now={now} />
        </View>
      ))}
      {vehicle.offers.map((o) => (
        <View key={o.code} style={styles.gap}>
          <OfferTicket percent={o.percent} plate={vehicle.registrationNumber} code={o.code} till={shortDate(o.expiresAt)} />
        </View>
      ))}
      {vehicle.giftsOwed.length > 0 ? (
        <View style={styles.gap}>
          <GiftTicket plate={vehicle.registrationNumber} item={vehicle.giftsOwed.map(giftLine).join(', ')} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.white },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(84,104,212,0.14)',
  },
  headCopy: { flex: 1, gap: 4 },
  remove: { padding: 4, borderRadius: 999 },
  pressed: { opacity: 0.5 },
  gap: { marginTop: 12 },
  plate: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: colors.white,
  },
  plateText: { ...typography.bodyStrong, color: colors.ink, letterSpacing: 1.6, fontWeight: '800' },
  meta: { ...typography.caption, color: colors.slateDeep, letterSpacing: 0, fontSize: 13 },
});
