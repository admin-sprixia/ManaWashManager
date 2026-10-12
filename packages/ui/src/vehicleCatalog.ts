import type { ImageSourcePropType } from 'react-native';
import { BODY_TYPES, bodyTypeDef, bodyTypeForName, categoryForClass, type BodyTypeDef } from '@mana/domain';

/**
 * Every vehicle a shop can wash, with its photo: the service network's body types (@mana/domain)
 * plus a picture each. A branch's vehicle type links to its body type by key; types named by hand
 * still find a photo from their name (exact label first, then the keywords).
 * Two-wheelers live under 'bike'; everything with three or more wheels under 'car'.
 */
export interface CatalogVehicle extends BodyTypeDef {
  category: VehicleCategory;
  image: ImageSourcePropType;
}

/** Same as VehicleCategory in @mana/domain. */
type VehicleCategory = 'car' | 'bike';

/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Metro resolves image requires to asset ids */
const IMAGES: Partial<Record<string, ImageSourcePropType>> = {
  hatch: require('./assets/vehicles/vehicle-hatchback.jpg'),
  sedan: require('./assets/vehicles/vehicle-sedan.jpg'),
  suvMini: require('./assets/vehicles/vehicle-suv-mini.jpg'),
  suvLarge: require('./assets/vehicles/vehicle-suv-large.jpg'),
  muv: require('./assets/vehicles/vehicle-muv.jpg'),
  jeep: require('./assets/vehicles/vehicle-jeep.jpg'),
  luxury: require('./assets/vehicles/vehicle-luxury.jpg'),
  sports: require('./assets/vehicles/vehicle-sports-car.jpg'),
  pickup: require('./assets/vehicles/vehicle-pickup.jpg'),
  van: require('./assets/vehicles/vehicle-van.jpg'),
  shareVan: require('./assets/vehicles/vehicle-share-van.jpg'),
  tempoTraveller: require('./assets/vehicles/vehicle-tempo-traveller.jpg'),
  bus: require('./assets/vehicles/vehicle-bus.jpg'),
  auto: require('./assets/vehicles/vehicle-auto.jpg'),
  eRickshaw: require('./assets/vehicles/vehicle-e-rickshaw.jpg'),
  cargoAuto: require('./assets/vehicles/vehicle-cargo-auto.jpg'),
  miniTruck: require('./assets/vehicles/vehicle-mini-truck.jpg'),
  lightTruck: require('./assets/vehicles/vehicle-light-truck.jpg'),
  truck: require('./assets/vehicles/vehicle-truck.jpg'),
  lorry: require('./assets/vehicles/vehicle-lorry.jpg'),
  tipper: require('./assets/vehicles/vehicle-tipper.jpg'),
  tanker: require('./assets/vehicles/vehicle-tanker.jpg'),
  trailer: require('./assets/vehicles/vehicle-trailer.jpg'),
  tractor: require('./assets/vehicles/vehicle-tractor.jpg'),
  earthmover: require('./assets/vehicles/vehicle-earthmover.jpg'),
  scooter: require('./assets/vehicles/vehicle-scooter.jpg'),
  eScooter: require('./assets/vehicles/vehicle-e-scooter.jpg'),
  bike: require('./assets/vehicles/vehicle-bike.jpg'),
  sportsBike: require('./assets/vehicles/vehicle-sports-bike.jpg'),
  cruiser: require('./assets/vehicles/vehicle-cruiser.jpg'),
  moped: require('./assets/vehicles/vehicle-moped.jpg'),
};
const FALLBACK_IMAGE: ImageSourcePropType = IMAGES.sedan as ImageSourcePropType;
/* eslint-enable @typescript-eslint/no-unsafe-assignment */

function imageFor(key: string): ImageSourcePropType {
  const image = IMAGES[key];
  return image ?? FALLBACK_IMAGE;
}

export const VEHICLE_CATALOG: CatalogVehicle[] = BODY_TYPES.map((b) => ({
  ...b,
  category: categoryForClass(b.classKey),
  image: imageFor(b.key),
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

/** Best photo for a vehicle type: its linked body type, else whatever its name suggests. */
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
