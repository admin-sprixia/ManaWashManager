// Writes docs/PRICE_LIST.md: every company and model customers can pick, with the size it is
// priced at and its hub and community prices, read from the live business catalog (so it always
// matches what the apps charge). Plans are listed by size at the top.
//
//   cd apps/api && npm run dev              (in one terminal)
//   cd apps/api && npm run docs:price-list  (in another)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import domain, { type BodyStyle } from '@mana/domain';
import { API, API_DIR, apiFetch, signIn } from './lib/target.mjs';

// @mana/domain is CommonJS to Node, so its exports come through the default import.
const { BODY_TYPES, VEHICLE_MAKES, WEEKDAY_SHORT, formatInr, listPrice, visitCharge } = domain;

const OWNER_PHONE = process.env.MENU_ADMIN_PHONE ?? '9888626111';
const PIN = '258025';

type Mode = 'hub' | 'doorstep';
interface Catalog {
  policy: { roundToPaise: number };
  classes: { id: string; key: string; name: string; sizes: { id: string; key: string; name: string }[] }[];
  bodyTypes: { id: string; key: string; name: string; classId: string; sizeId: string; active: boolean }[];
  services: { id: string; name: string; modes: 'hub' | 'doorstep' | 'both'; active: boolean; classIds: string[] }[];
  priceBooks: { id: string; isDefault: boolean }[];
  prices: { priceBookId: string; serviceId: string; sizeId: string; price: number; doorstepPrice: number | null }[];
  adjustments: { mode: Mode; classId: string | null; percentBp: number; fixedPaise: number; minExtraPaise: number }[];
  away: {
    doorstep: {
      visitFeePaise: number;
      freeKm: number;
      perKmPaise: number;
      maxKm: number;
      roundTo9: boolean;
      busy: { days: number[]; from: string; to: string; extraPaise: number }[];
    };
    communityTiers: { minCars: number; discountBp: number }[];
  };
}
interface Plan {
  name: string;
  washes: number;
  months: number;
  active: boolean;
  serviceName: string | null;
  upgradeServiceName: string | null;
  upgradeEvery: number | null;
  prices: { sizeId: string; mode: Mode; price: number }[];
}

async function get<T>(token: string, path: string): Promise<T> {
  const res = await apiFetch(API + path, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

const token = (await signIn(OWNER_PHONE, PIN)).body?.token as string | undefined;
if (!token) throw new Error('Couldn’t sign in as the owner. Is `npm run dev` running?');
const catalog = await get<Catalog>(token, '/business/catalog');
const { plans } = await get<{ plans: Plan[] }>(token, '/business/plans');

const book = catalog.priceBooks.find((b) => b.isDefault)!;
const classById = new Map(catalog.classes.map((c) => [c.id, c]));
const sizeById = new Map(catalog.classes.flatMap((c) => c.sizes.map((s) => [s.id, { ...s, classKey: c.key }] as const)));
const bodyByKey = new Map(catalog.bodyTypes.map((b) => [b.key, b]));
const serviceByName = new Map(catalog.services.filter((s) => s.active).map((s) => [s.name, s]));

/** "₹299 / ₹269" (hub / community), "₹399 · hub only", or "—". */
function priceCell(serviceName: string, sizeId: string): string {
  const s = serviceByName.get(serviceName);
  const size = sizeById.get(sizeId);
  const entry = s && catalog.prices.find((p) => p.priceBookId === book.id && p.serviceId === s.id && p.sizeId === sizeId);
  if (!s || !size || !entry || !s.classIds.some((id) => classById.get(id)?.key === size.classKey)) return '—';
  const adjustments = catalog.adjustments.map((a) => ({ ...a, classKey: a.classId ? (classById.get(a.classId)?.key ?? null) : null }));
  const at = (mode: Mode) =>
    listPrice({
      base: entry.price,
      mode,
      classKey: size.classKey,
      adjustments,
      zonePercentBp: 0,
      roundToPaise: catalog.policy.roundToPaise,
      doorstepBase: entry.doorstepPrice,
    }).price;
  if (s.modes === 'hub') return `${formatInr(at('hub'))} · hub only`;
  return `${formatInr(at('hub'))} / ${formatInr(at('doorstep'))}`;
}

/** "L · Large" for cars and two-wheelers; "Commercial M · Medium" for the other classes. */
const sizeLabel = (sizeId: string, withClass = false) => {
  const s = sizeById.get(sizeId);
  if (!s) return '—';
  const cls = catalog.classes.find((c) => c.key === s.classKey);
  const own = s.classKey === 'car' || s.classKey === 'twoWheeler';
  return `${withClass || !own ? `${cls?.name ?? ''} ` : ''}${s.key} · ${s.name}`;
};

const CAR_WASHES = ['Express Wash', 'Basic Wash', 'Premium Wash'];
const BIKE_WASHES = ['Bike Express Wash', 'Bike Basic Wash', 'Bike Premium Wash'];
const PASSENGER = new Set<BodyStyle>(['hatch', 'sedan', 'suvMini', 'suvLarge', 'muv', 'jeep']);

/** The body type a model is priced as: luxury marques' passenger cars are "Luxury car". */
const bodyKeyFor = (luxury: boolean, body: BodyStyle) => (luxury && PASSENGER.has(body) ? 'luxury' : body);

const out: string[] = [];
const line = (s = '') => out.push(s);
const row = (cells: (string | number)[]) => line(`| ${cells.join(' | ')} |`);
const head = (cells: string[]) => {
  row(cells);
  row(cells.map(() => '---'));
};

const makes = [...VEHICLE_MAKES].sort((a, b) => (a.category === b.category ? a.name.localeCompare(b.name) : a.category === 'car' ? -1 : 1));
const COMPANIES = new Set(makes.map((m) => m.name)).size;
const MODELS = makes.reduce((n, m) => n + m.models.length, 0);

const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
/** A class's sizes that some vehicle type is priced at (an empty bike size is left out). */
const used = (cls: Catalog['classes'][number]) => cls.sizes.filter((z) => catalog.bodyTypes.some((b) => b.active && b.sizeId === z.id));
const carClass = catalog.classes.find((c) => c.key === 'car')!;
const bikeClass = catalog.classes.find((c) => c.key === 'twoWheeler')!;

line('# Mana Wash price list — every company and model');
line();
line(`Built from the live Mana HQ catalog on ${today} (\`npm run docs:price-list\` in apps/api). Prices are`);
line('**hub / community**, GST included, at a branch with no price zone. Each model is priced by its **size**: the body type decides the size, and HQ decides');
line('which size each body type is. Luxury brands (BMW, Mercedes-Benz, Audi…) are priced as **Luxury car (XL)**,');
line('35% above a big SUV, for the premium liquids. Two-wheelers have **two prices**: every scooter, moped');
line('and bike is **Regular**; premium bikes (Harley-Davidson, Ducati, Hayabusa, big BMW, Triumph and');
line('Kawasaki) are **Premium**, about double. Scooters are listed apart only because they get no chain care.');
line();
line(`**${COMPANIES} companies · ${MODELS} models.** Jump to: [Sizes](#sizes) · [Washes by size](#washes-by-size) ·`);
line('[Plans by size](#plans-by-size) · [At home and at communities](#at-home-and-at-communities) ·');
line('[Autos, vans, trucks and machines](#autos-vans-trucks-and-machines) ·');
line('[Cars](#cars-vans-and-commercial-vehicles) · [Two-wheelers](#two-wheelers)');
line();

line('## Sizes');
line();
head(['Size', 'Body types priced at this size']);
for (const cls of catalog.classes) {
  for (const z of cls.sizes) {
    const bodies = catalog.bodyTypes.filter((b) => b.active && b.sizeId === z.id).map((b) => b.name);
    if (bodies.length) row([`${cls.name} ${z.key} · ${z.name}`, bodies.join(', ')]);
  }
}
line();

line('## Washes by size');
line();
head(['Service', ...used(carClass).map((z) => z.key)]);
for (const s of catalog.services.filter((x) => x.active && x.classIds.includes(carClass.id))) {
  row([s.name, ...used(carClass).map((z) => priceCell(s.name, z.id))]);
}
line();
head(['Two-wheeler service', ...used(bikeClass).map((z) => z.name)]);
for (const s of catalog.services.filter((x) => x.active && x.classIds.includes(bikeClass.id))) {
  row([s.name, ...used(bikeClass).map((z) => priceCell(s.name, z.id))]);
}
line();

line('## Plans by size');
line();
line('One car, at most one wash a week. Prices are hub / community.');
line();
for (const cls of [carClass, bikeClass]) {
  const clsPlans = plans.filter((p) => p.active && p.prices.some((x) => sizeById.get(x.sizeId)?.classKey === cls.key));
  if (!clsPlans.length) continue;
  head(['Plan', 'Washes', ...used(cls).map((z) => (cls.key === 'twoWheeler' ? z.name : z.key))]);
  for (const p of clsPlans) {
    const washes = p.upgradeServiceName && p.upgradeEvery
      ? `${p.washes} ${p.serviceName ?? ''}, every ${p.upgradeEvery}th ${p.upgradeServiceName}`
      : `${p.washes} ${p.serviceName ?? ''}`.trim();
    row([
      p.name,
      `${washes} · ${p.months === 1 ? '1 month' : `${p.months} months`}`,
      ...used(cls).map((z) => {
        const hub = p.prices.find((x) => x.sizeId === z.id && x.mode === 'hub');
        const away = p.prices.find((x) => x.sizeId === z.id && x.mode === 'doorstep');
        return hub || away ? `${hub ? formatInr(hub.price) : '—'} / ${away ? formatInr(away.price) : '—'}` : '—';
      }),
    ]);
  }
  line();
}

const visit = catalog.away.doorstep;
const km = (d: number) => `${Number.isInteger(d) ? d : d.toFixed(1)} km`;
const calm = { ...visit, busy: [] };
const charge = (d: number) => visitCharge(d, calm, new Date()).total;
const allRule = catalog.adjustments.find((a) => a.mode === 'doorstep' && a.classId == null);

line('## At home and at communities');
line();
line('Three ways to buy a wash, three ways to price it:');
line();
line('- **Hub** — the customer comes to the shop. The prices above; every other price starts from them.');
line(
  `- **Community** — the team washes many cars at one place on a wash day, so the trip is shared and each car pays less: the community price above${
    allRule?.percentBp ? ` (a size without its own community price is the hub price ${Math.abs(allRule.percentBp) / 100}% ${allRule.percentBp < 0 ? 'less' : 'more'})` : ''
  }.`,
);
line(`- **Doorstep** — a wash at the customer’s home: the **hub price + one visit charge per visit**. Two cars at one home pay it once.`);
line();
line('### Visit charge');
line();
line(
  `${formatInr(visit.visitFeePaise)} a visit${visit.perKmPaise ? `, then ${formatInr(visit.perKmPaise)} for every km (or part of one) after ${km(visit.freeKm)}` : ''}, measured from the branch${
    visit.roundTo9 ? ', rounded up to end in 9' : ''
  }. The team goes up to ${km(visit.maxKm)}.`,
);
line();
const distances = [...new Set([visit.freeKm, 5, 8, 10, 12, visit.maxKm])].filter((d) => d >= visit.freeKm && d <= visit.maxKm).sort((a, b) => a - b);
head(['Home is', 'Visit charge', 'Basic Wash S at home', 'Basic Wash L at home']);
const basicS = serviceByName.get('Basic Wash') ? catalog.prices.find((p) => p.priceBookId === book.id && p.serviceId === serviceByName.get('Basic Wash')!.id && sizeById.get(p.sizeId)?.classKey === 'car' && sizeById.get(p.sizeId)?.key === 'S')?.price : undefined;
const basicL = serviceByName.get('Basic Wash') ? catalog.prices.find((p) => p.priceBookId === book.id && p.serviceId === serviceByName.get('Basic Wash')!.id && sizeById.get(p.sizeId)?.classKey === 'car' && sizeById.get(p.sizeId)?.key === 'L')?.price : undefined;
for (const [i, d] of distances.entries()) {
  const c = charge(d);
  row([
    i === 0 ? `Up to ${km(d)}` : km(d),
    formatInr(c),
    basicS != null ? `${formatInr(basicS)} + ${formatInr(c)} = **${formatInr(basicS + c)}**` : '—',
    basicL != null ? `${formatInr(basicL)} + ${formatInr(c)} = **${formatInr(basicL + c)}**` : '—',
  ]);
}
row([`Over ${km(visit.maxKm)}`, 'Not served', '—', '—']);
line();
if (visit.busy.length) {
  line('Busy times add to the visit charge:');
  line();
  for (const b of visit.busy) line(`- ${b.days.map((d) => WEEKDAY_SHORT[d]).join(', ')} ${b.from}–${b.to}: +${formatInr(b.extraPaise)}`);
} else {
  line('No busy-time extras yet (HQ › Base prices › Doorstep can add one, like +₹30 on Sunday mornings).');
}
line();
line('### Bigger communities');
line();
if (catalog.away.communityTiers.length) {
  line('A community with more cars on its list pays less, on every wash and plan there:');
  line();
  for (const t of catalog.away.communityTiers) line(`- ${t.minCars}+ cars: ${t.discountBp / 100}% off`);
} else {
  line('No volume discount yet (HQ › Base prices › Community can add steps, like 10+ cars → 10% off).');
}
line();

line('## Autos, vans, trucks and machines');
line();
line('Every vehicle type outside cars and two-wheelers, with or without models in the list. Only branches');
line('whose hub or doorstep team takes these vehicles offer them.');
line();
head(['Vehicle type', 'Example', 'Class · size', ...CAR_WASHES]);
for (const def of BODY_TYPES.filter((b) => b.classKey !== 'car' && b.classKey !== 'twoWheeler')) {
  const body = bodyByKey.get(def.key);
  if (!body) continue;
  row([`${body.name}${body.active ? '' : ' (off)'}`, def.hint, sizeLabel(body.sizeId, true), ...CAR_WASHES.map((w) => priceCell(w, body.sizeId))]);
}
line();

const counted = { models: 0, companies: new Set<string>() };

for (const category of ['car', 'bike'] as const) {
  const washes = category === 'car' ? CAR_WASHES : BIKE_WASHES;
  line(category === 'car' ? '## Cars, vans and commercial vehicles' : '## Two-wheelers');
  line();
  for (const m of makes.filter((x) => x.category === category)) {
    counted.companies.add(m.name);
    line(`### ${m.name}${m.luxury ? ' (luxury)' : ''}`);
    line();
    head(['Model', 'Body type', 'Size', ...washes]);
    const rows = (Object.entries(m.bodies) as [BodyStyle, readonly string[]][])
      .flatMap(([body, models]) => models.map((model) => ({ model, key: bodyKeyFor(!!m.luxury, body) })))
      .sort((a, b) => a.model.localeCompare(b.model, 'en', { sensitivity: 'base' }));
    for (const r of rows) {
      counted.models++;
      const body = bodyByKey.get(r.key);
      const def = BODY_TYPES.find((b) => b.key === r.key);
      if (!body) {
        row([r.model, def?.label ?? r.key, '—', ...washes.map(() => 'Not on the menu')]);
        continue;
      }
      const priced = washes.map((w) => priceCell(w, body.sizeId));
      const none = priced.every((p) => p === '—');
      row([r.model, `${body.name}${body.active ? '' : ' (off)'}`, none ? '—' : sizeLabel(body.sizeId), ...(none ? washes.map(() => 'Not on the menu') : priced)]);
    }
    line();
  }
}

line('## Notes');
line();
line('- Community price is for 2 or more cars at the same visit; one car alone pays the hub price.');
line('- A model not in this list (typed by the customer) is priced by the vehicle type they pick.');
line('- “—” means that wash isn’t offered for that vehicle (no Premium Wash for lorries, tractors and JCBs).');
line('- “(off)”: head office has switched that kind of vehicle off (HQ › Vehicles we wash); no branch takes it.');
line('  Its prices are kept for when it’s switched on.');
line('- Plans are for cars and two-wheelers. There are no add-ons on the menu.');
line('- Very muddy vehicles: ₹100–200 extra. Second car on a plan: 10% off the plan.');

const file = join(API_DIR, '..', '..', 'docs', 'PRICE_LIST.md');
writeFileSync(file, `${out.join('\n')}\n`);
console.log(`Wrote ${file}: ${counted.companies.size} companies, ${counted.models} models.`);
