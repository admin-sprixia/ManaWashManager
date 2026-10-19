import { listPrice, washPlanPrice, type PlacePriceMode } from '@mana/domain';
import type { Catalog } from './shared';

export type PlanMode = 'hub' | 'doorstep';

export const nth = (n: number) => (n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
export const priceKey = (sizeId: string, mode: PlanMode) => `${sizeId}|${mode}`;

/** A service's list price for one size and way, at the default price book. */
export function servicePrice(catalog: Catalog, serviceId: string, classKey: string, sizeId: string, mode: PlanMode): number | null {
  const book = catalog.priceBooks.find((b) => b.isDefault);
  const entry = book && catalog.prices.find((p) => p.priceBookId === book.id && p.serviceId === serviceId && p.sizeId === sizeId);
  if (!entry || entry.price <= 0) return null;
  const classKeyOf = new Map(catalog.classes.map((c) => [c.id, c.key]));
  const adjustments = catalog.adjustments.map((a) => ({ ...a, classKey: a.classId ? (classKeyOf.get(a.classId) ?? null) : null }));
  return listPrice({
    base: entry.price,
    mode,
    classKey,
    adjustments,
    zonePercentBp: 0,
    roundToPaise: catalog.policy.roundToPaise,
    doorstepBase: entry.doorstepPrice,
  }).price;
}

/** The sizes a plan's wash is priced for, by class. */
export function planSizes(catalog: Catalog, serviceId: string) {
  const service = catalog.services.find((s) => s.id === serviceId);
  if (!service) return [];
  return catalog.classes
    .filter((c) => service.classIds.includes(c.id))
    .flatMap((cls) =>
      cls.sizes
        .filter((size) => servicePrice(catalog, serviceId, cls.key, size.id, 'hub') != null)
        .map((size) => ({ id: size.id, classKey: cls.key, name: cls.sizes.length > 1 ? `${cls.name} ${size.key}` : cls.name, short: size.key })),
    );
}

/**
 * What one vehicle of each size pays for the plan: its own price when set, otherwise the
 * washes one by one (every Nth the better wash) less the discount, at the default price book.
 */
export function planPreview(
  catalog: Catalog,
  plan: { serviceId: string; upgradeId: string | null; every: number; washes: number; discountBp: number; fixed: Map<string, number> | null },
  priceMode: PlacePriceMode,
) {
  return planSizes(catalog, plan.serviceId).flatMap((size) => {
    const perWash = servicePrice(catalog, plan.serviceId, size.classKey, size.id, priceMode);
    if (perWash == null) return [];
    const better = plan.upgradeId ? servicePrice(catalog, plan.upgradeId, size.classKey, size.id, priceMode) : null;
    const ups = plan.upgradeId && better != null ? Math.floor(plan.washes / plan.every) : 0;
    const listTotal = perWash * (plan.washes - ups) + (better ?? 0) * ups;
    const own = plan.fixed?.get(priceKey(size.id, priceMode));
    const total = own ?? washPlanPrice(listTotal / plan.washes, plan.washes, plan.discountBp);
    return [{ key: size.id, name: size.name, total, save: Math.max(0, listTotal - total) }];
  });
}
