import type { VehicleCategory } from './types';

/**
 * The sizes customers see prices by: three for cars, one for every two-wheeler. Cars go by size,
 * imported brands included (a BMW 3 Series is a mid-size car, an X5 a large one), because a
 * bigger car takes more time, water and care. Each size covers some catalog body types; the
 * first one a branch has stands for the size's prices.
 */
export type PriceSizeKey = 'small' | 'mid' | 'large' | 'bike';

export interface PriceSize {
  key: PriceSizeKey;
  category: VehicleCategory;
  emoji: string;
  /** "Mid-size car". */
  name: string;
  /** "Mid-size", for buttons. */
  short: string;
  te: { name: string; short: string };
  /** Catalog body type keys it covers, the one that stands for its prices first. */
  bodyKeys: readonly string[];
  /** Well-known models, short enough for a list row. */
  examples: string;
  /** One more example, an imported one where it helps ("BMW X5"). */
  alsoExample: string | null;
}

export const PRICE_SIZES: readonly PriceSize[] = [
  {
    key: 'small',
    category: 'car',
    emoji: '🚗',
    name: 'Small car',
    short: 'Small car',
    te: { name: 'చిన్న కార్', short: 'చిన్న కార్' },
    bodyKeys: ['hatch'],
    examples: 'Swift, i20, Baleno, Kwid',
    alsoExample: 'Mini Cooper',
  },
  {
    key: 'mid',
    category: 'car',
    emoji: '🚘',
    name: 'Mid-size car',
    short: 'Mid-size',
    te: { name: 'మీడియం కార్', short: 'మీడియం కార్' },
    bodyKeys: ['sedan', 'suvMini', 'sports'],
    examples: 'Dzire, City, Nexon, Brezza',
    alsoExample: 'BMW 3 Series',
  },
  {
    key: 'large',
    category: 'car',
    emoji: '🚙',
    name: 'Large / 7-seater',
    short: 'Large car',
    te: { name: 'పెద్ద కార్ / 7-సీటర్', short: 'పెద్ద కార్' },
    // A branch's "Luxury car" type, if it still has one, pays the big-car price.
    bodyKeys: ['suvLarge', 'muv', 'jeep', 'luxury'],
    examples: 'Creta, XUV700, Innova, Fortuner',
    alsoExample: 'BMW X5',
  },
  {
    key: 'bike',
    category: 'bike',
    emoji: '🏍️',
    name: 'Bike / Scooter',
    short: 'Bike',
    te: { name: 'బైక్ / స్కూటర్', short: 'బైక్' },
    // Every two-wheeler pays the same, from a scooter to a Harley.
    bodyKeys: ['bike', 'scooter', 'eScooter', 'moped', 'sportsBike', 'cruiser', 'premiumBike'],
    examples: 'Activa, Splendor, Pulsar, Royal Enfield',
    alsoExample: 'Harley',
  },
];

export function priceSize(key: string | null | undefined): PriceSize | null {
  return PRICE_SIZES.find((s) => s.key === key) ?? null;
}

/** The size a catalog body type is priced as ("suvMini" → Mid-size car), or null (vans, trucks…). */
export function priceSizeOfBody(bodyKey: string | null | undefined): PriceSize | null {
  return (bodyKey && PRICE_SIZES.find((s) => s.bodyKeys.includes(bodyKey))) || null;
}
