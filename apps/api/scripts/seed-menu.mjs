#!/usr/bin/env node
// Puts the Mana Wash price menu (the printed hub / community menu) into the business catalog:
// every wash with its hub and community price per car size, the monthly, 3-month and
// 12-month plans, bike prices, and ₹1 rounding. Services and plans that aren't on the menu are
// switched off (orders already sold keep working). Safe to run again: it finds things by name.
//
//   cd apps/api && npm run dev            (in one terminal)
//   cd apps/api && npm run db:seed:menu   (in another)
//
// Luxury cars (XL: Mercedes, BMW, Audi…) aren't on the printed menu; they pay 35% more than a
// big SUV / MUV (premium liquids), rounded to a price ending in 9. Premium bikes (XL) pay about
// 50% more than a sports bike. Autos, vans, pickups, trucks, tractors and JCBs get the main
// washes too, for branches that take them.
import { API, apiFetch, signIn } from './lib/target.mjs';

/** Who signs in to load it: a business admin (HQ) of the business. Defaults to the demo shop's owner. */
const PIN = process.env.MENU_ADMIN_PIN ?? '258025';
const OWNER_PHONE = process.env.MENU_ADMIN_PHONE ?? '9888626111';

async function call(token, method, path, body) {
  const headers = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await apiFetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}

const LUXURY = 1.35;
/** Nearest rupee price ending in 9. */
const end9 = (rupees) => Math.round((rupees - 9) / 10) * 10 + 9;
const luxury = (rupees) => end9(rupees * LUXURY);

/**
 * Car prices in rupees: [hatchback S, sedan & compact SUV M, big SUV & MUV L] at the hub and at
 * a community. A single number is the same for every size. XL is worked out unless given.
 */
const car = (hub, community, { xl = true } = {}) => {
  const three = (v) => (Array.isArray(v) ? v : [v, v, v]);
  const [h, c] = [three(hub), three(community)];
  return {
    car: {
      S: [h[0], c[0]],
      M: [h[1], c[1]],
      L: [h[2], c[2]],
      XL: xl === true ? [luxury(h[2]), luxury(c[2])] : xl === false ? [h[2], c[2]] : xl,
    },
  };
};
/**
 * Two-wheeler prices [regular, premium] at the hub and at a community. Two prices only: every
 * scooter, moped and bike is Regular; Harley, Ducati, big BMW… are Premium (XL). Scooters (S)
 * are Regular too, kept apart only so chain care isn't offered for them (no chain). L is unused.
 */
const bike = (hub, community, { scooters = true } = {}) => ({
  twoWheeler: {
    ...(scooters ? { S: [hub[0], community[0]] } : {}),
    M: [hub[0], community[0]],
    XL: [hub[1], community[1]],
  },
});
const BIKE_SIZES = { scooter: 'S', eScooter: 'S', moped: 'M', bike: 'M', sportsBike: 'M', cruiser: 'M', premiumBike: 'XL' };
const BIKE_SIZE_NAMES = { S: 'Regular · scooter', M: 'Regular', L: 'Large (not used)', XL: 'Premium' };

/**
 * The main washes for vehicles the printed menu doesn't list (only offered at branches whose
 * service points take them): autos, vans, pickups and trucks, lorries, tractors and JCBs.
 * [hub, community] per class and size; heavy and farm vehicles get no Premium Wash.
 */
const OTHER_VEHICLES = {
  'Express Wash': {
    threeWheeler: { M: [199, 179] },
    commercial: { M: [399, 359], L: [599, 539], XL: [999, 899] },
    heavy: { XL: [1499, 1349] },
    farm: { L: [599, 539], XL: [999, 899] },
  },
  'Basic Wash': {
    threeWheeler: { M: [349, 319] },
    commercial: { M: [699, 629], L: [999, 899], XL: [1699, 1529] },
    heavy: { XL: [2499, 2249] },
    farm: { L: [899, 809], XL: [1499, 1349] },
  },
  'Premium Wash': {
    threeWheeler: { M: [599, 549] },
    commercial: { M: [1199, 1079], L: [1699, 1529], XL: [2799, 2519] },
  },
};

const CAR = 'car';
const BIKE = 'twoWheeler';

/** The menu, top to bottom. `id` reuses a service already in the catalog (its history carries on). */
const SERVICES = [
  {
    name: 'Express Wash',
    description: 'A quick, careful outside wash.',
    durationMin: 25,
    checklist: ['Wheels & tyres', 'Snow foam', 'Two-bucket hand wash', 'Towel dry & door edges', 'Outside glass', 'Tyre shine', 'Rubber mats'],
    prices: car([299, 349, 419], [269, 319, 379]),
  },
  {
    name: 'Basic Wash',
    description: 'Outside and inside: our most popular wash.',
    durationMin: 45,
    popular: true,
    checklist: ['Everything in Express', 'Inside glass', 'Full vacuum', 'Dashboard & door panel shine'],
    prices: car([499, 599, 799], [449, 549, 729]),
  },
  {
    name: 'Premium Wash',
    description: 'The full treatment, inside and out.',
    durationMin: 75,
    checklist: ['Everything in Basic', 'Spray wax', 'Inside deep clean', 'Rain repellent on the windscreen'],
    prices: car([899, 1099, 1399], [819, 999, 1279]),
  },
  {
    name: 'Anti-Rust Protection',
    description: 'Done at the shop. Community customers get free pick-up and drop.',
    kind: 'protection',
    checklist: ['Underbody wash', 'Anti-rust coating under the car'],
    prices: car(4500, 4050),
  },
  // Bikes: Express / Basic / Premium like the cars. A bike wash goes for about ₹150 locally, so
  // Basic stays at that; community is a little less, like the cars. Premium bikes (Harley,
  // Ducati, Hayabusa, big BMW…) pay about double: careful hand work and premium liquids.
  {
    id: 'cs_bike_exterior',
    name: 'Bike Express Wash',
    description: 'A quick foam wash.',
    durationMin: 15,
    checklist: ['Foam wash', 'Rinse', 'Towel dry'],
    prices: bike([99, 199], [89, 179]),
  },
  {
    id: 'cs_bike_complete',
    name: 'Bike Basic Wash',
    description: 'Our most popular bike wash.',
    durationMin: 25,
    popular: true,
    checklist: ['Everything in Express', 'Wheels & rims', 'Chain area cleaned', 'Tyre shine', 'Seat & meter wiped'],
    prices: bike([149, 299], [129, 269]),
  },
  {
    name: 'Bike Premium Wash',
    description: 'The full treatment for your bike.',
    durationMin: 40,
    checklist: ['Everything in Basic', 'Body polish', 'Chain clean & lube (bikes with a chain)', 'Engine degrease', 'Seat protect'],
    prices: bike([249, 499], [229, 449]),
  },
];
for (const s of SERVICES) Object.assign(s.prices, OTHER_VEHICLES[s.name] ?? {});


/** Monthly plan prices [S, M, L] at the hub and at a community; 3 months = ×3 (13 washes), 12 months = ×12 (13 months). */
const PLAN_FAMILIES = [
  { name: 'Express Plan', wash: 'Express Wash', hub: [1099, 1299, 1549], community: [999, 1179, 1399] },
  { name: 'Basic Plan', wash: 'Basic Wash', hub: [1849, 2199, 2949], community: [1649, 1999, 2699], popular: true },
  { name: 'Shine Plan', wash: 'Basic Wash', upgrade: 'Premium Wash', hub: [2199, 2699, 3499], community: [1999, 2449, 3199] },
];
const TERMS = [
  { suffix: '', washes: 4, months: 1, times: 1, parts: false },
  { suffix: ' · 3 months', washes: 13, months: 3, times: 3, parts: true },
  { suffix: ' · 12 months', washes: 52, months: 13, times: 12, parts: true },
];
/** Monthly only. Prices [regular, premium bike]; `was` is the plan's old name (it keeps its orders). */
const BIKE_PLANS = [
  { name: 'Bike Express Plan', wash: 'Bike Express Wash', hub: [359, 729], community: [319, 649] },
  { name: 'Bike Basic Plan', was: 'Bike Monthly', wash: 'Bike Basic Wash', hub: [549, 1099], community: [479, 989] },
  { name: 'Bike Shine Plan', wash: 'Bike Basic Wash', upgrade: 'Bike Premium Wash', hub: [649, 1249], community: [569, 1129] },
];

const owner = (await signIn(OWNER_PHONE, PIN)).body?.token;
if (!owner) throw new Error('Couldn’t sign in as the owner. Run `npm run db:seed:demo` first (PIN 258025).');

let catalog = await call(owner, 'GET', '/business/catalog');
const classOf = (key) => catalog.classes.find((c) => c.key === key) ?? (() => { throw new Error(`No ${key} class`); })();
const sizeId = (classKey, size) => classOf(classKey).sizes.find((s) => s.key === size)?.id;
const book = catalog.priceBooks.find((b) => b.isDefault);

/** The menu's columns: hatchback S; sedan & compact SUV M; big SUV & MUV L; luxury XL. */
const MENU_SIZES = { hatch: 'S', sedan: 'M', suvMini: 'M', van: 'M', suvLarge: 'L', muv: 'L', jeep: 'L', luxury: 'XL', sports: 'XL' };
console.log('Vehicle sizes as on the menu');
for (const [key, size] of Object.entries(MENU_SIZES)) {
  const body = catalog.bodyTypes.find((b) => b.key === key);
  const want = sizeId(CAR, size);
  if (body && body.sizeId !== want) {
    await call(owner, 'PATCH', `/business/body-types/${body.id}`, { sizeId: want });
    console.log(`  ${body.name} → ${size}`);
  }
}
for (const [key, size] of Object.entries(BIKE_SIZES)) {
  const body = catalog.bodyTypes.find((b) => b.key === key);
  const want = sizeId(BIKE, size);
  if (body && want && body.sizeId !== want) {
    await call(owner, 'PATCH', `/business/body-types/${body.id}`, { sizeId: want });
    console.log(`  ${body.name} → ${BIKE_SIZE_NAMES[size]}`);
  }
}
for (const z of classOf(BIKE).sizes) {
  const name = BIKE_SIZE_NAMES[z.key];
  if (name && z.name !== name) await call(owner, 'PATCH', `/business/sizes/${z.id}`, { name });
}

/** A branch set up for the first time washes cars and two-wheelers (more from its page later). */
const CLASSES_ON = new Set([CAR, BIKE]);
const startingVehicles = catalog.bodyTypes
  .filter((b) => CLASSES_ON.has(catalog.classes.find((c) => c.id === b.classId)?.key))
  .map((b) => b.id);

// A community never pays less than the hub (the API refuses it): its rule adds nothing for now.
console.log('Every community price is the hub price');
for (const a of catalog.adjustments.filter((x) => x.mode === 'doorstep' && x.classId != null)) {
  await call(owner, 'DELETE', '/business/adjustments', { mode: 'doorstep', classId: a.classId });
}
await call(owner, 'PUT', '/business/adjustments', { mode: 'doorstep', classId: null, percentBp: 0, fixedPaise: 0, minExtraPaise: 0 });

console.log('Services');
const keep = [];
for (const s of SERVICES) {
  const classIds = Object.keys(s.prices).map((key) => classOf(key).id);
  // The sizes it's for: the ones the menu prices (bikes have no "Large").
  const sizeIds = Object.entries(s.prices).flatMap(([classKey, sizes]) => Object.keys(sizes).map((k) => sizeId(classKey, k)));
  const fields = {
    name: s.name,
    description: s.description ?? null,
    places: { shop: true, community: true, doorstep: true },
    classIds,
    sizeIds,
    includes: [],
    kind: s.kind ?? 'wash',
    durationMin: s.durationMin ?? null,
    popular: !!s.popular,
    showInApp: true,
    checklist: s.checklist ?? [],
  };
  const existing = catalog.services.find((x) => (s.id && x.id === s.id) || x.name.toLowerCase() === s.name.toLowerCase());
  let id;
  if (existing) {
    id = existing.id;
    const { description, ...rest } = fields;
    await call(owner, 'PATCH', `/business/services/${id}`, { ...rest, ...(s.description ? { description } : {}), active: true });
  } else {
    id = (await call(owner, 'POST', '/business/services', fields)).id;
  }
  keep.push(id);
  // Sizes of a priced class that aren't listed stop being offered (no chain care for scooters).
  const entries = Object.entries(s.prices).flatMap(([classKey, sizes]) =>
    classOf(classKey).sizes.map((z) => {
      const given = sizes[z.key];
      return {
        serviceId: id,
        sizeId: z.id,
        price: given ? given[0] * 100 : null,
        // Community prices follow the rule: none is typed.
        doorstepPrice: null,
      };
    }),
  );
  await call(owner, 'PUT', '/business/prices', { priceBookId: book.id, entries });
  console.log(`  ${existing ? 'updated' : 'added  '} ${s.name}`);
}

catalog = await call(owner, 'GET', '/business/catalog');
const retired = catalog.services.filter((s) => s.active && !keep.includes(s.id));
for (const s of retired) {
  await call(owner, 'PATCH', `/business/services/${s.id}`, { active: false });
  console.log(`  switched off ${s.name}`);
}
const order = [...keep, ...catalog.services.map((s) => s.id).filter((id) => !keep.includes(id))];
await call(owner, 'PUT', '/business/services/order', { ids: order });

console.log('Plans');
const serviceId = (name) => catalog.services.find((s) => s.name === name)?.id ?? (() => { throw new Error(`No service ${name}`); })();
/** Plan prices per size; an XL not given is the luxury mark-up on L. */
const planPrices = (classKey, hub, community, times = 1) => {
  const [h, c] = [[...hub], [...community]];
  if (h.length === 3) h.push(luxury(h[2]));
  if (c.length === 3) c.push(luxury(c[2]));
  return ['S', 'M', 'L', 'XL'].flatMap((size, i) => [
    { sizeId: sizeId(classKey, size), mode: 'hub', price: h[i] * times * 100 },
    { sizeId: sizeId(classKey, size), mode: 'doorstep', price: c[i] * times * 100 },
  ]);
};

const { plans: existingPlans } = await call(owner, 'GET', '/business/plans');
const wanted = [];
for (const f of PLAN_FAMILIES) {
  for (const t of TERMS) {
    wanted.push({
      name: `${f.name}${t.suffix}`,
      washes: t.washes,
      months: t.months,
      catalogServiceId: serviceId(f.wash),
      discountBp: 0,
      allowParts: t.parts,
      popular: !!f.popular && t.times === 1,
      upgradeServiceId: f.upgrade ? serviceId(f.upgrade) : null,
      upgradeEvery: f.upgrade ? 4 : null,
      prices: planPrices(CAR, f.hub, f.community, t.times),
    });
  }
}
for (const f of BIKE_PLANS) {
  wanted.push({
    name: f.name,
    was: f.was,
    washes: 4,
    months: 1,
    catalogServiceId: serviceId(f.wash),
    discountBp: 0,
    allowParts: false,
    popular: false,
    upgradeServiceId: f.upgrade ? serviceId(f.upgrade) : null,
    upgradeEvery: f.upgrade ? 4 : null,
    prices: Object.entries({ S: 0, M: 0, XL: 1 }).flatMap(([size, i]) => [
      { sizeId: sizeId(BIKE, size), mode: 'hub', price: f.hub[i] * 100 },
      { sizeId: sizeId(BIKE, size), mode: 'doorstep', price: f.community[i] * 100 },
    ]),
  });
}

const keptPlans = [];
// Every plan is sold at the shop counter and to communities (the printed menu is for both).
for (const [i, { was, ...plan }] of wanted.entries()) {
  const p = { ...plan, soldAt: 'both' };
  const existing =
    existingPlans.find((x) => x.name.toLowerCase() === p.name.toLowerCase()) ??
    (was ? existingPlans.find((x) => x.name.toLowerCase() === was.toLowerCase()) : undefined);
  if (existing) {
    await call(owner, 'PATCH', `/business/plans/${existing.id}`, { ...p, active: true, sortOrder: i });
    keptPlans.push(existing.id);
    console.log(`  updated ${p.name}`);
  } else {
    const { id } = await call(owner, 'POST', '/business/plans', p);
    await call(owner, 'PATCH', `/business/plans/${id}`, { sortOrder: i });
    keptPlans.push(id);
    console.log(`  added   ${p.name}`);
  }
}
for (const p of existingPlans.filter((x) => x.active && !keptPlans.includes(x.id))) {
  await call(owner, 'PATCH', `/business/plans/${p.id}`, { active: false, popular: false, sortOrder: 100 + p.sortOrder });
  console.log(`  switched off ${p.name}`);
}

// A first setup: branches selling nothing yet start with the whole menu. Branches HQ has already
// picked services for are left exactly as they are.
console.log('Branch menus');
catalog = await call(owner, 'GET', '/business/catalog');
for (const b of catalog.branches.filter((x) => x.menu.length === 0 && x.status !== 'closed')) {
  await call(owner, 'PUT', `/business/branches/${b.id}/menu`, { serviceIds: keep });
  await call(owner, 'PUT', `/business/branches/${b.id}/vehicles`, { bodyTypeIds: startingVehicles });
  console.log(`  ${b.name}: every service switched on; washes cars and two-wheelers`);
}

console.log('Rebuilding every branch menu');
const r = await call(owner, 'POST', '/business/publish');
console.log(`Done. ${Array.isArray(r.branches) ? r.branches.length : ''} branch menu(s) rebuilt.`);
