import type { PlaceMember } from '../shared';

type Vehicle = PlaceMember['vehicles'][number];
export type Order = NonNullable<Vehicle['orders'][number]>;

/** A vehicle with its current plan (or one-off wash), if it has one. */
export interface MemberVehicle {
  id: string;
  label: string;
  /** "Sedan", "Scooter"… */
  typeName: string;
  /** The number plate, once the washer noted it. */
  plate: string | null;
  category: 'car' | 'bike';
  order: Order | null;
}

/** What an order brings in a month: a plan's price spread over its months; a one-off wash isn't monthly. */
export const monthlyValue = (o: Order | null) => (o && o.kind === 'plan' ? Math.round(o.total / Math.max(1, o.months)) : 0);

const UNPAID = new Set(['awaiting_payment', 'payment_due', 'paused_unpaid']);

export const isUnpaid = (o: Order | null) => o != null && UNPAID.has(o.phase);

export function memberVehicles(m: PlaceMember): MemberVehicle[] {
  return m.vehicles.map((v) => ({
    id: v.id,
    label: v.vehicle?.registrationNumber ?? v.typeName,
    typeName: v.typeName,
    plate: v.vehicle?.registrationNumber ?? null,
    category: v.category === 'bike' ? 'bike' : 'car',
    order: v.orders[0] ?? null,
  }));
}

/** What a flat pays for its current plans, all vehicles together. */
export const flatTotal = (m: PlaceMember) => memberVehicles(m).reduce((n, v) => n + (v.order?.total ?? 0), 0);

/** Members by the flat they live in ("A · 204", the same text as the flats list). */
export function membersByUnit(members: readonly PlaceMember[]): Map<string, PlaceMember[]> {
  const map = new Map<string, PlaceMember[]>();
  for (const m of members) map.set(m.unit, [...(map.get(m.unit) ?? []), m]);
  return map;
}
