import type { VehicleCategory } from './types';

/**
 * The service network's vehicle model: every vehicle has a body type (Sedan, Tractor…), each body
 * type sits in a class (Car, Farm & machines…) at a size (S, M, L, XL). Prices are set per class
 * and size, so one price table covers every body type and every branch.
 *
 * These are the defaults a business starts with; the business can rename them and move a body
 * type to another size. The keys never change: they link a branch's vehicle types, the photos
 * in @mana/ui and the make/model list in vehicleMakes.ts.
 */

export type VehicleClassKey = 'twoWheeler' | 'car' | 'threeWheeler' | 'commercial' | 'heavy' | 'farm';
export type VehicleSizeKey = 'S' | 'M' | 'L' | 'XL';

export const VEHICLE_SIZE_KEYS: readonly VehicleSizeKey[] = ['S', 'M', 'L', 'XL'];

export interface VehicleClassDef {
  key: VehicleClassKey;
  name: string;
  /** Cars and bikes keep separate menus in the apps; every class files under one of them. */
  category: VehicleCategory;
  sizes: readonly VehicleSizeKey[];
}

export const VEHICLE_CLASSES: readonly VehicleClassDef[] = [
  { key: 'twoWheeler', name: 'Two-wheeler', category: 'bike', sizes: ['S', 'M', 'L', 'XL'] },
  { key: 'car', name: 'Car', category: 'car', sizes: ['S', 'M', 'L', 'XL'] },
  { key: 'threeWheeler', name: 'Three-wheeler', category: 'car', sizes: ['M'] },
  { key: 'commercial', name: 'Commercial', category: 'car', sizes: ['M', 'L', 'XL'] },
  { key: 'heavy', name: 'Heavy', category: 'car', sizes: ['XL'] },
  { key: 'farm', name: 'Farm & machines', category: 'car', sizes: ['L', 'XL'] },
];

export const SIZE_NAMES: Readonly<Record<VehicleSizeKey, string>> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

export interface BodyTypeDef {
  key: string;
  label: string;
  /** One line under the label in pickers, e.g. well-known examples. */
  hint: string;
  group: string;
  classKey: VehicleClassKey;
  size: VehicleSizeKey;
  /** Recognises a hand-typed or renamed vehicle type ("Mini SUV", "Innova"). */
  match: RegExp;
}

export const BODY_TYPES: readonly BodyTypeDef[] = [
  // Cars
  { key: 'hatch', label: 'Hatchback', hint: 'Swift, i20, Alto', group: 'Cars', classKey: 'car', size: 'S', match: /hatch|small car/ },
  { key: 'sedan', label: 'Sedan', hint: 'City, Dzire, Verna', group: 'Cars', classKey: 'car', size: 'M', match: /sedan|saloon/ },
  { key: 'suvMini', label: 'Compact SUV', hint: 'Brezza, Nexon, Venue', group: 'Cars', classKey: 'car', size: 'M', match: /(mini|compact|small).*suv|suv.*(mini|compact|small)/ },
  { key: 'suvLarge', label: 'SUV', hint: 'Creta, XUV700, Fortuner', group: 'Cars', classKey: 'car', size: 'L', match: /suv|xuv/ },
  { key: 'muv', label: 'MUV / 7-seater', hint: 'Innova, Ertiga, Carens', group: 'Cars', classKey: 'car', size: 'L', match: /muv|mpv|7[- ]?seat|innova|ertiga/ },
  { key: 'jeep', label: 'Jeep / Off-roader', hint: 'Thar, Gurkha, Jimny', group: 'Cars', classKey: 'car', size: 'L', match: /jeep|thar|off[- ]?road|4x4|gypsy/ },
  { key: 'luxury', label: 'Luxury car', hint: 'Mercedes, BMW, Audi', group: 'Cars', classKey: 'car', size: 'XL', match: /luxury|premium|merc|bmw|audi/ },
  { key: 'sports', label: 'Sports car', hint: 'Coupe, supercar', group: 'Cars', classKey: 'car', size: 'XL', match: /sports? car|coupe|supercar/ },
  { key: 'pickup', label: 'Pickup', hint: 'Bolero Pickup, Hilux', group: 'Cars', classKey: 'commercial', size: 'M', match: /pick[- ]?up/ },

  // Vans & buses
  { key: 'van', label: 'Van', hint: 'Eeco, Omni', group: 'Vans & buses', classKey: 'car', size: 'M', match: /\bvan\b|eeco|omni/ },
  { key: 'shareVan', label: 'Passenger mini van', hint: 'Tata Magic, Winger', group: 'Vans & buses', classKey: 'commercial', size: 'M', match: /magic|winger|share|passenger/ },
  { key: 'tempoTraveller', label: 'Tempo Traveller', hint: '12–17 seater', group: 'Vans & buses', classKey: 'commercial', size: 'L', match: /tempo|traveller|traveler|mini ?bus/ },
  { key: 'bus', label: 'Bus', hint: 'School bus, coach', group: 'Vans & buses', classKey: 'commercial', size: 'XL', match: /bus|coach/ },

  // Three-wheelers
  { key: 'auto', label: 'Auto rickshaw', hint: 'Passenger auto', group: 'Three-wheelers', classKey: 'threeWheeler', size: 'M', match: /auto|rickshaw|three[- ]?wheel|3[- ]?wheel/ },
  { key: 'eRickshaw', label: 'E-rickshaw', hint: 'Battery rickshaw', group: 'Three-wheelers', classKey: 'threeWheeler', size: 'M', match: /e[- ]?rick|toto|battery/ },
  { key: 'cargoAuto', label: 'Goods auto', hint: 'Ape cargo, loading auto', group: 'Three-wheelers', classKey: 'threeWheeler', size: 'M', match: /goods auto|cargo auto|loading auto|\bape\b/ },

  // Trucks & lorries
  { key: 'miniTruck', label: 'Mini truck', hint: 'Tata Ace, Dost, Super Carry', group: 'Trucks & lorries', classKey: 'commercial', size: 'M', match: /mini ?truck|tata ace|chota|chhota|dost/ },
  { key: 'lightTruck', label: 'Light truck', hint: 'Tata 407, Eicher (4 wheels)', group: 'Trucks & lorries', classKey: 'commercial', size: 'L', match: /light truck|407|lcv|eicher|canter/ },
  { key: 'truck', label: 'Truck (6 wheels)', hint: 'Medium goods truck', group: 'Trucks & lorries', classKey: 'commercial', size: 'XL', match: /truck|6[- ]?wheel/ },
  { key: 'lorry', label: 'Lorry (10–12 wheels)', hint: 'Heavy goods lorry', group: 'Trucks & lorries', classKey: 'heavy', size: 'XL', match: /lorry|10[- ]?wheel|12[- ]?wheel|heavy/ },
  { key: 'tipper', label: 'Tipper', hint: 'Sand, stone, construction', group: 'Trucks & lorries', classKey: 'heavy', size: 'XL', match: /tipper|dumper|dump/ },
  { key: 'tanker', label: 'Tanker', hint: 'Water, milk, fuel', group: 'Trucks & lorries', classKey: 'heavy', size: 'XL', match: /tanker/ },
  { key: 'trailer', label: 'Trailer / Container', hint: 'Container truck, long trailer', group: 'Trucks & lorries', classKey: 'heavy', size: 'XL', match: /trailer|container|18[- ]?wheel/ },

  // Farm & machines
  { key: 'tractor', label: 'Tractor', hint: 'Farm tractor', group: 'Farm & machines', classKey: 'farm', size: 'L', match: /tractor/ },
  { key: 'earthmover', label: 'JCB / Earthmover', hint: 'Backhoe loader', group: 'Farm & machines', classKey: 'farm', size: 'XL', match: /jcb|earth|backhoe|excavat|loader|crane/ },

  // Two-wheelers
  { key: 'scooter', label: 'Scooter', hint: 'Activa, Jupiter, Access', group: 'Two-wheelers', classKey: 'twoWheeler', size: 'S', match: /scoot|activa|jupiter|access|step[- ]?through/ },
  { key: 'eScooter', label: 'Electric scooter', hint: 'Ola, Ather, iQube', group: 'Two-wheelers', classKey: 'twoWheeler', size: 'S', match: /electric|e[- ]?scoot|\bola\b|ather|\bev\b/ },
  { key: 'bike', label: 'Bike', hint: 'Splendor, Pulsar, Shine', group: 'Two-wheelers', classKey: 'twoWheeler', size: 'M', match: /bike|motorcycle|two[- ]?wheel/ },
  { key: 'sportsBike', label: 'Sports bike', hint: 'R15, KTM, Ninja', group: 'Two-wheelers', classKey: 'twoWheeler', size: 'L', match: /sports? bike|ktm|r15|ninja|superbike/ },
  { key: 'cruiser', label: 'Cruiser bike', hint: 'Royal Enfield, Jawa', group: 'Two-wheelers', classKey: 'twoWheeler', size: 'L', match: /cruiser|bullet|enfield|classic|jawa|harley/ },
  { key: 'moped', label: 'Moped', hint: 'TVS XL', group: 'Two-wheelers', classKey: 'twoWheeler', size: 'S', match: /moped|\bxl\b|luna/ },
  {
    key: 'premiumBike',
    label: 'Premium bike',
    hint: 'Harley, Ducati, Hayabusa, big BMW',
    group: 'Two-wheelers',
    classKey: 'twoWheeler',
    size: 'XL',
    match: /premium bike|luxury bike|superbike|big bike|harley|ducati|hayabusa|gold ?wing/,
  },
];

/**
 * Checked in this order so specific names win over broad ones ("Sports bike" before "Bike",
 * "Compact SUV" before "SUV", "E-rickshaw" before "Auto rickshaw", "Mini truck" before "Truck").
 */
const MATCH_ORDER = [
  'premiumBike', 'sportsBike', 'cruiser', 'eScooter', 'moped', 'scooter', 'bike',
  'eRickshaw', 'cargoAuto', 'auto',
  'miniTruck', 'lightTruck', 'tipper', 'tanker', 'trailer', 'lorry', 'pickup', 'truck',
  'shareVan', 'tempoTraveller', 'bus', 'van',
  'tractor', 'earthmover',
  'suvMini', 'muv', 'jeep', 'luxury', 'sports', 'suvLarge', 'sedan', 'hatch',
];

const BODY_BY_KEY = new Map(BODY_TYPES.map((b) => [b.key, b]));
const CLASS_BY_KEY = new Map(VEHICLE_CLASSES.map((c) => [c.key, c]));

export function bodyTypeDef(key: string | null | undefined): BodyTypeDef | null {
  return (key && BODY_BY_KEY.get(key)) || null;
}

export function vehicleClassDef(key: string | null | undefined): VehicleClassDef | null {
  return (key && CLASS_BY_KEY.get(key as VehicleClassKey)) || null;
}

/** The body type a vehicle-type name stands for: exact label first, then the keywords. */
export function bodyTypeForName(name: string): BodyTypeDef | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const exact = BODY_TYPES.find((b) => b.label.toLowerCase() === n);
  if (exact) return exact;
  for (const key of MATCH_ORDER) {
    const b = BODY_BY_KEY.get(key);
    if (b?.match.test(n)) return b;
  }
  return null;
}

/** Cars & more vs two-wheelers, for the apps' two menus. */
export function categoryForClass(classKey: string | null | undefined): VehicleCategory {
  return vehicleClassDef(classKey)?.category ?? 'car';
}

/**
 * The group a branch's vehicle type is in (Car, Three-wheeler, Farm & machines…): from the business
 * body type it's tied to (ids end in `_<bodyKey>`), else from its name, else its menu.
 */
export function vehicleClassOf(vt: { bodyTypeId: string | null; name: string; category: string }): VehicleClassKey {
  const linked = vt.bodyTypeId ? BODY_TYPES.find((b) => vt.bodyTypeId!.endsWith(`_${b.key}`)) : undefined;
  const body = linked ?? bodyTypeForName(vt.name);
  if (body) return body.classKey;
  return vt.category === 'bike' ? 'twoWheeler' : 'car';
}

export function isVehicleClassKey(key: string): key is VehicleClassKey {
  return CLASS_BY_KEY.has(key as VehicleClassKey);
}

export function isVehicleSizeKey(key: string): key is VehicleSizeKey {
  return (VEHICLE_SIZE_KEYS as readonly string[]).includes(key);
}

/**
 * Ids of a business's default catalog rows are derived from the business id and the keys, so
 * creating the defaults twice (two requests at once, a retried job) can never make duplicates.
 */
export const catalogIds = {
  vehicleClass: (businessId: string, classKey: string) => `vc_${businessId}_${classKey}`,
  vehicleSize: (businessId: string, classKey: string, size: string) => `vs_${businessId}_${classKey}_${size}`,
  bodyType: (businessId: string, bodyKey: string) => `bt_${businessId}_${bodyKey}`,
  defaultPriceBook: (businessId: string) => `pb_${businessId}_default`,
};
