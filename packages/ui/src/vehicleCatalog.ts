import { BODY_TYPES, bodyTypeDef, bodyTypeForName, categoryForClass, type BodyTypeDef } from '@mana/domain';

/**
 * Every vehicle a shop can wash: the service network's body types (@mana/domain) with their
 * category. A branch's vehicle type links to its body type by key; types named by hand are
 * matched by their name (exact label first, then the keywords).
 * Two-wheelers live under 'bike'; everything with three or more wheels under 'car'.
 */
export interface CatalogVehicle extends BodyTypeDef {
  category: VehicleCategory;
}

/** Same as VehicleCategory in @mana/domain. */
type VehicleCategory = 'car' | 'bike';

export const VEHICLE_CATALOG: CatalogVehicle[] = BODY_TYPES.map((b) => ({
  ...b,
  category: categoryForClass(b.classKey),
}));

const BY_KEY = new Map(VEHICLE_CATALOG.map((v) => [v.key, v]));

/** The catalog entry for a body type key (what a linked vehicle type carries). */
export function catalogVehicleByKey(key: string | null | undefined): CatalogVehicle | null {
  const def = bodyTypeDef(key);
  return def ? BY_KEY.get(def.key) ?? null : null;
}

export function catalogVehicleFor(name: string): CatalogVehicle | null {
  const def = bodyTypeForName(name);
  return def ? BY_KEY.get(def.key) ?? null : null;
}

/** The catalog vehicle for a vehicle type: its linked body type, else whatever its name suggests. */
export function catalogVehicleForType(type: { bodyKey?: string | null; name: string }): CatalogVehicle | null {
  return catalogVehicleByKey(type.bodyKey) ?? catalogVehicleFor(type.name);
}

/** Groups in display order, each with its vehicles, for one tab. */
export function catalogGroups(category: VehicleCategory): { group: string; vehicles: CatalogVehicle[] }[] {
  const groups: { group: string; vehicles: CatalogVehicle[] }[] = [];
  for (const v of VEHICLE_CATALOG) {
    if (v.category !== category) continue;
    const g = groups.find((x) => x.group === v.group);
    if (g) g.vehicles.push(v);
    else groups.push({ group: v.group, vehicles: [v] });
  }
  return groups;
}
