import type { ChatBranch } from './whatsappChat';
import { bodyTypeForName } from './vehicleCatalog';

/**
 * The WhatsApp catalog of the business number: every hub wash and wash plan, once per kind of
 * vehicle, at the shop price (community prices aren't listed). Commerce Manager reads it as a
 * product feed (GET /whatsapp/catalog.csv), so it follows the menu by itself; each item's picture
 * is a styled card with its details (scripts/build-catalog-cards.mjs), not a photo.
 */

export interface CatalogSection {
  key: string;
  /** Shown as the catalog section (a product set filtered on custom_label_0). */
  label: string;
  category: 'car' | 'bike';
  /** Catalog body types in this section; the first one the branch has prices for sets them. */
  bodyKeys: string[];
}

export const CATALOG_SECTIONS: CatalogSection[] = [
  { key: 'hatch', label: 'Hatchbacks', category: 'car', bodyKeys: ['hatch'] },
  { key: 'sedan', label: 'Sedans & Compact SUVs', category: 'car', bodyKeys: ['sedan', 'suvMini'] },
  { key: 'suv', label: 'SUVs & 7-Seaters', category: 'car', bodyKeys: ['suvLarge', 'muv', 'jeep'] },
  { key: 'luxury', label: 'Luxury Cars', category: 'car', bodyKeys: ['luxury', 'sports'] },
  { key: 'scooter', label: 'Scooters', category: 'bike', bodyKeys: ['scooter', 'eScooter'] },
  { key: 'bike', label: 'Bikes', category: 'bike', bodyKeys: ['bike', 'sportsBike', 'cruiser', 'moped'] },
  { key: 'premium-bike', label: 'Premium Bikes', category: 'bike', bodyKeys: ['premiumBike'] },
];

export interface CatalogProduct {
  /** Stable while the service or plan keeps its name: "basic-wash--sedan". */
  id: string;
  section: CatalogSection;
  kind: 'service' | 'plan';
  title: string;
  /** Plain text, a line per detail. */
  description: string;
  /** Paise. */
  price: number;
  /** For the card: the lines under the title. */
  card: { subtitle: string | null; lines: string[]; footer: string | null; popular: boolean };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

/** Communities aren't offered yet: sentences about them stay out of the catalog. */
function withoutCommunity(text: string | null | undefined): string | null {
  const kept = (text ?? '')
    .split(/(?<=\.)\s+/)
    .filter((sentence) => !/communit/i.test(sentence))
    .join(' ')
    .trim();
  return kept || null;
}

function typeKey(t: ChatBranch['vehicleTypes'][number]): string | null {
  return t.bodyKey ?? bodyTypeForName(t.name)?.key ?? null;
}

/** "4 washes in a month". */
function planSpan(washes: number, months: number) {
  return `${washes} washes in ${months === 1 ? 'a month' : `${months} months`}`;
}

/** Every product of the branch's catalog, section by section, in menu order. */
export function catalogProducts(branch: ChatBranch): CatalogProduct[] {
  const out: CatalogProduct[] = [];
  for (const section of CATALOG_SECTIONS) {
    const types = section.bodyKeys.flatMap((k) => branch.vehicleTypes.filter((t) => t.category === section.category && typeKey(t) === k));
    const priced = (typeId: string) => branch.services.some((s) => s.prices.some((p) => p.vehicleTypeId === typeId && p.price > 0));
    const type = types.find((t) => priced(t.id));
    if (!type) continue;
    const vehicles = types.map((t) => t.name).filter((n, i, all) => all.indexOf(n) === i).join(', ');
    for (const s of branch.services) {
      const price = s.prices.find((p) => p.vehicleTypeId === type.id && p.price > 0)?.price;
      if (!price) continue;
      const checklist = (s.checklist ?? []).filter((c) => !/communit/i.test(c));
      const about = withoutCommunity(s.description);
      out.push({
        id: `${slug(s.name)}--${section.key}`,
        section,
        kind: 'service',
        title: s.name,
        description: [
          `For ${vehicles}.`,
          ...(about ? [about] : []),
          ...(checklist.length ? ['', "What's included:", ...checklist.map((c) => `✓ ${c}`)] : []),
          ...(s.durationMin ? ['', `Takes about ${s.durationMin} minutes.`] : []),
        ].join('\n'),
        price,
        card: { subtitle: about, lines: checklist, footer: s.durationMin ? `About ${s.durationMin} min` : null, popular: s.popular },
      });
    }
    for (const p of branch.plans) {
      const price = p.prices.find((x) => x.vehicleTypeId === type.id && x.total > 0);
      if (!price) continue;
      const saving = price.listTotal - price.total;
      const lines = [
        planSpan(p.washes, p.months),
        ...(p.serviceName ? [`${/^[AEIOU]/i.test(p.serviceName) ? 'An' : 'A'} ${p.serviceName} each time`] : []),
        ...(p.upgrade ? [`Every ${p.upgrade.every}th wash is ${/^[AEIOU]/i.test(p.upgrade.name) ? 'an' : 'a'} ${p.upgrade.name}`] : []),
        ...(p.washes > 1 ? [`Just ${rupees(Math.round(price.total / p.washes / 100) * 100)} a wash`] : []),
      ];
      out.push({
        id: `${slug(p.name)}--${section.key}`,
        section,
        kind: 'plan',
        title: p.name,
        description: [
          `Wash plan for ${vehicles}.`,
          ...lines.map((l) => `✓ ${l}`),
          ...(saving > 0 ? [`You save ${rupees(saving)}.`] : []),
          '',
          'Buy it at the counter on your next visit.',
        ].join('\n'),
        price: price.total,
        card: { subtitle: 'Wash plan', lines, footer: saving > 0 ? `Save ${rupees(saving)}` : null, popular: p.popular },
      });
    }
  }
  return out;
}

/** Commerce Manager's product feed (CSV; quoted cells keep the description's line breaks). */
export function catalogFeed(
  branch: ChatBranch,
  o: { brand: string; link: string; imageUrl: (id: string) => string },
): string {
  const cell = (v: string) => `"${v.replace(/\r/g, '').replace(/"/g, '""')}"`;
  const head = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand', 'custom_label_0', 'custom_label_1'];
  const rows = catalogProducts(branch).map((p) =>
    [
      p.id,
      `${p.title} · ${p.section.label}`.slice(0, 150),
      p.description.slice(0, 9999),
      'in stock',
      'new',
      `${(p.price / 100).toFixed(2)} INR`,
      o.link,
      o.imageUrl(p.id),
      o.brand,
      p.section.label,
      p.kind === 'plan' ? 'Wash plans' : 'Washes',
    ].map(cell),
  );
  return [head.join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
}
