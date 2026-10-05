import type { ImageSourcePropType } from 'react-native';
import type { VehicleCategory } from '@mana/domain';

/**
 * Every vehicle a shop can wash, with its photo. The owner picks from this list in Settings; the
 * picked label becomes the vehicle type's name, and the photo is found again from that name
 * (exact label first, then the keywords, so renamed or hand-typed types still get a picture).
 * Two-wheelers live under 'bike'; everything with three or more wheels under 'car'.
 */
export interface CatalogVehicle {
  key: string;
  label: string;
  /** One line under the label in the picker, e.g. well-known examples. */
  hint: string;
  category: VehicleCategory;
  group: string;
  image: ImageSourcePropType;
  match?: RegExp;
}

/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Metro resolves image requires to asset ids */
export const VEHICLE_CATALOG: CatalogVehicle[] = [
  // Cars
  { key: 'hatch', label: 'Hatchback', hint: 'Swift, i20, Alto', category: 'car', group: 'Cars', image: require('../assets/vehicles/vehicle-hatchback.jpg'), match: /hatch|small car/ },
  { key: 'sedan', label: 'Sedan', hint: 'City, Dzire, Verna', category: 'car', group: 'Cars', image: require('../assets/vehicles/vehicle-sedan.jpg'), match: /sedan|saloon/ },
  { key: 'suvMini', label: 'Compact SUV', hint: 'Brezza, Nexon, Venue', category: 'car', group: 'Cars', image: require('../assets/vehicles/vehicle-suv-mini.jpg'), match: /(mini|compact|small).*suv|suv.*(mini|compact|small)/ },
  { key: 'suvLarge', label: 'SUV', hint: 'Creta, XUV700, Fortuner', category: 'car', group: 'Cars', image: require('../assets/vehicles/vehicle-suv-large.jpg'), match: /suv|xuv/ },
  { key: 'muv', label: 'MUV / 7-seater', hint: 'Innova, Ertiga, Carens', category: 'car', group: 'Cars', image: require('../assets/vehicles/vehicle-muv.jpg'), match: /muv|mpv|7[- ]?seat|innova|ertiga/ },
  { key: 'jeep', label: 'Jeep / Off-roader', hint: 'Thar, Gurkha, Jimny', category: 'car', group: 'Cars', image: require('../assets/vehicles/vehicle-jeep.jpg'), match: /jeep|thar|off[- ]?road|4x4|gypsy/ },
  { key: 'luxury', label: 'Luxury car', hint: 'Mercedes, BMW, Audi', category: 'car', group: 'Cars', image: require('../assets/vehicles/vehicle-luxury.jpg'), match: /luxury|premium|merc|bmw|audi/ },
  { key: 'sports', label: 'Sports car', hint: 'Coupe, supercar', category: 'car', group: 'Cars', image: require('../assets/vehicles/vehicle-sports-car.jpg'), match: /sports? car|coupe|supercar/ },
  { key: 'pickup', label: 'Pickup', hint: 'Bolero Pickup, Hilux', category: 'car', group: 'Cars', image: require('../assets/vehicles/vehicle-pickup.jpg'), match: /pick[- ]?up/ },

  // Vans & buses
  { key: 'van', label: 'Van', hint: 'Eeco, Omni', category: 'car', group: 'Vans & buses', image: require('../assets/vehicles/vehicle-van.jpg'), match: /\bvan\b|eeco|omni/ },
  { key: 'shareVan', label: 'Passenger mini van', hint: 'Tata Magic, Winger', category: 'car', group: 'Vans & buses', image: require('../assets/vehicles/vehicle-share-van.jpg'), match: /magic|winger|share|passenger/ },
  { key: 'tempoTraveller', label: 'Tempo Traveller', hint: '12–17 seater', category: 'car', group: 'Vans & buses', image: require('../assets/vehicles/vehicle-tempo-traveller.jpg'), match: /tempo|traveller|traveler|mini ?bus/ },
  { key: 'bus', label: 'Bus', hint: 'School bus, coach', category: 'car', group: 'Vans & buses', image: require('../assets/vehicles/vehicle-bus.jpg'), match: /bus|coach/ },

  // Three-wheelers
  { key: 'auto', label: 'Auto rickshaw', hint: 'Passenger auto', category: 'car', group: 'Three-wheelers', image: require('../assets/vehicles/vehicle-auto.jpg'), match: /auto|rickshaw|three[- ]?wheel|3[- ]?wheel/ },
  { key: 'eRickshaw', label: 'E-rickshaw', hint: 'Battery rickshaw', category: 'car', group: 'Three-wheelers', image: require('../assets/vehicles/vehicle-e-rickshaw.jpg'), match: /e[- ]?rick|toto|battery/ },
  { key: 'cargoAuto', label: 'Goods auto', hint: 'Ape cargo, loading auto', category: 'car', group: 'Three-wheelers', image: require('../assets/vehicles/vehicle-cargo-auto.jpg'), match: /goods auto|cargo auto|loading auto|\bape\b/ },

  // Trucks & lorries
  { key: 'miniTruck', label: 'Mini truck', hint: 'Tata Ace, Dost, Super Carry', category: 'car', group: 'Trucks & lorries', image: require('../assets/vehicles/vehicle-mini-truck.jpg'), match: /mini ?truck|tata ace|chota|chhota|dost/ },
  { key: 'lightTruck', label: 'Light truck', hint: 'Tata 407, Eicher (4 wheels)', category: 'car', group: 'Trucks & lorries', image: require('../assets/vehicles/vehicle-light-truck.jpg'), match: /light truck|407|lcv|eicher|canter/ },
  { key: 'truck', label: 'Truck (6 wheels)', hint: 'Medium goods truck', category: 'car', group: 'Trucks & lorries', image: require('../assets/vehicles/vehicle-truck.jpg'), match: /truck|6[- ]?wheel/ },
  { key: 'lorry', label: 'Lorry (10–12 wheels)', hint: 'Heavy goods lorry', category: 'car', group: 'Trucks & lorries', image: require('../assets/vehicles/vehicle-lorry.jpg'), match: /lorry|10[- ]?wheel|12[- ]?wheel|heavy/ },
  { key: 'tipper', label: 'Tipper', hint: 'Sand, stone, construction', category: 'car', group: 'Trucks & lorries', image: require('../assets/vehicles/vehicle-tipper.jpg'), match: /tipper|dumper|dump/ },
  { key: 'tanker', label: 'Tanker', hint: 'Water, milk, fuel', category: 'car', group: 'Trucks & lorries', image: require('../assets/vehicles/vehicle-tanker.jpg'), match: /tanker/ },
  { key: 'trailer', label: 'Trailer / Container', hint: 'Container truck, long trailer', category: 'car', group: 'Trucks & lorries', image: require('../assets/vehicles/vehicle-trailer.jpg'), match: /trailer|container|18[- ]?wheel/ },

  // Farm & machines
  { key: 'tractor', label: 'Tractor', hint: 'Farm tractor', category: 'car', group: 'Farm & machines', image: require('../assets/vehicles/vehicle-tractor.jpg'), match: /tractor/ },
  { key: 'earthmover', label: 'JCB / Earthmover', hint: 'Backhoe loader', category: 'car', group: 'Farm & machines', image: require('../assets/vehicles/vehicle-earthmover.jpg'), match: /jcb|earth|backhoe|excavat|loader|crane/ },

  // Two-wheelers
  { key: 'scooter', label: 'Scooter', hint: 'Activa, Jupiter, Access', category: 'bike', group: 'Two-wheelers', image: require('../assets/vehicles/vehicle-scooter.jpg'), match: /scoot|activa|jupiter|access|step[- ]?through/ },
  { key: 'eScooter', label: 'Electric scooter', hint: 'Ola, Ather, iQube', category: 'bike', group: 'Two-wheelers', image: require('../assets/vehicles/vehicle-e-scooter.jpg'), match: /electric|e[- ]?scoot|\bola\b|ather|\bev\b/ },
  { key: 'bike', label: 'Bike', hint: 'Splendor, Pulsar, Shine', category: 'bike', group: 'Two-wheelers', image: require('../assets/vehicles/vehicle-bike.jpg'), match: /bike|motorcycle|two[- ]?wheel/ },
  { key: 'sportsBike', label: 'Sports bike', hint: 'R15, KTM, Ninja', category: 'bike', group: 'Two-wheelers', image: require('../assets/vehicles/vehicle-sports-bike.jpg'), match: /sports? bike|ktm|r15|ninja|superbike/ },
  { key: 'cruiser', label: 'Cruiser bike', hint: 'Royal Enfield, Jawa', category: 'bike', group: 'Two-wheelers', image: require('../assets/vehicles/vehicle-cruiser.jpg'), match: /cruiser|bullet|enfield|classic|jawa|harley/ },
  { key: 'moped', label: 'Moped', hint: 'TVS XL', category: 'bike', group: 'Two-wheelers', image: require('../assets/vehicles/vehicle-moped.jpg'), match: /moped|\bxl\b|luna/ },
];
/* eslint-enable @typescript-eslint/no-unsafe-assignment */

/**
 * Checked in this order so specific names win over broad ones ("Sports bike" before "Bike",
 * "Compact SUV" before "SUV", "E-rickshaw" before "Auto rickshaw", "Mini truck" before "Truck").
 */
const MATCH_ORDER = [
  'sportsBike', 'cruiser', 'eScooter', 'moped', 'scooter', 'bike',
  'eRickshaw', 'cargoAuto', 'auto',
  'miniTruck', 'lightTruck', 'tipper', 'tanker', 'trailer', 'lorry', 'pickup', 'truck',
  'shareVan', 'tempoTraveller', 'bus', 'van',
  'tractor', 'earthmover',
  'suvMini', 'muv', 'jeep', 'luxury', 'sports', 'suvLarge', 'sedan', 'hatch',
];

const BY_KEY = new Map(VEHICLE_CATALOG.map((v) => [v.key, v]));

export function catalogVehicleFor(name: string): CatalogVehicle | null {
  const n = name.trim().toLowerCase();
  const exact = VEHICLE_CATALOG.find((v) => v.label.toLowerCase() === n);
  if (exact) return exact;
  for (const key of MATCH_ORDER) {
    const v = BY_KEY.get(key);
    if (v?.match?.test(n)) return v;
  }
  return null;
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
