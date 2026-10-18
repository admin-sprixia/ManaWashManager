import type { Catalog, CatalogService } from './shared';

/** A kind of vehicle is "on" while any of its body types is switched on in Vehicles we wash. */
export function classesOn(catalog: Catalog): Set<string> {
  return new Set(catalog.bodyTypes.filter((b) => b.active).map((b) => b.classId));
}

export interface ServiceGroup {
  key: string;
  title: string;
  rank: number;
  items: CatalogService[];
}

/** Services grouped by the vehicles they're for ("Car", "Two-wheeler"…), in menu order. */
export function groupServices(catalog: Catalog, services: CatalogService[]): ServiceGroup[] {
  const order = new Map(catalog.classes.map((c, i) => [c.id, i]));
  const name = new Map(catalog.classes.map((c) => [c.id, c.name]));
  const groups = new Map<string, ServiceGroup>();
  for (const s of services) {
    const ids = [...s.classIds].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
    const key = ids.join('+') || 'none';
    const group = groups.get(key) ?? {
      key,
      title: ids.length ? ids.map((id) => name.get(id) ?? 'Vehicles').join(' & ') : 'No vehicles',
      rank: Math.min(...ids.map((id) => order.get(id) ?? 99)) * 10 + ids.length,
      items: [],
    };
    group.items.push(s);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.rank - b.rank);
}

/** The default price book's prices for one service, by size id. */
export function servicePrices(catalog: Catalog, serviceId: string) {
  const book = catalog.priceBooks.find((b) => b.isDefault)?.id;
  return new Map(
    catalog.prices.filter((p) => p.priceBookId === book && p.serviceId === serviceId).map((p) => [p.sizeId, p] as const),
  );
}

/** The lowest price a customer pays for it (shop price, or the team's when not at the shop); null if unpriced. */
export function startingPrice(catalog: Catalog, service: CatalogService): number | null {
  const sizes = new Set(service.sizeIds);
  const prices = [...servicePrices(catalog, service.id).values()]
    .filter((p) => sizes.has(p.sizeId))
    .map((p) => (service.places.shop ? p.price : (p.doorstepPrice ?? p.price)));
  return prices.length ? Math.min(...prices) : null;
}

/** The menu order after moving `serviceId` one place up or down within its group (null = can't move). */
export function orderAfterMove(catalog: Catalog, serviceId: string, by: -1 | 1): string[] | null {
  const active = catalog.services.filter((s) => s.active);
  const group = groupServices(catalog, active).find((g) => g.items.some((s) => s.id === serviceId));
  if (!group) return null;
  const at = group.items.findIndex((s) => s.id === serviceId);
  const neighbour = group.items[at + by];
  if (!neighbour) return null;
  const ids = active.map((s) => s.id);
  const a = ids.indexOf(serviceId);
  const b = ids.indexOf(neighbour.id);
  [ids[a], ids[b]] = [ids[b]!, ids[a]!];
  return [...ids, ...catalog.services.filter((s) => !s.active).map((s) => s.id)];
}
