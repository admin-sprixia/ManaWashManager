// HQ services end to end: where a service is done (shop, community, doorstep — any mix), its
// prices for every size saved with it, its time, kind, badge, app setting and checklist, all
// copied to branch menus; a doorstep wash refuses a community-only service, the customer app hides
// staff-only services and doesn't sell community-only ones at the door, community menus show only
// what's done at communities, plans can't use (or strand) a service not done there; and the
// vehicle size guide's sizes are open to everyone. Run against the local API:
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:services                      (in another)
import { API, apiFetch, d1Rows, d1Run, signIn as signInWith } from './lib/target.mjs';

const PIN = '258025';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 500)}`;

async function call(token, method, path, body) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await apiFetch(API + path, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const run = Date.now().toString(36);
const rand = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const BIZ = `biz_svc_${run}`;
const SHOP = `shop_svc_${run}`;
const phone = { owner: `91${rand(8)}`, staff: `91${rand(8)}` };

d1Run(
  `INSERT INTO businesses (id, name) VALUES ('${BIZ}', 'Services Check Co');` +
    `INSERT INTO shops (id, code, name, business_id, latitude, longitude, service_radius_km, in_customer_app) VALUES ('${SHOP}', '${rand(6)}', 'Services Hub', '${BIZ}', 14.51, 79.98, 10, 1);` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('user_svc_o_${run}', '${SHOP}', 'Owner', '${phone.owner}', 'owner'), ('user_svc_s_${run}', '${SHOP}', 'Staff', '${phone.staff}', 'staff');` +
    `INSERT INTO business_admins (business_id, phone) VALUES ('${BIZ}', '${phone.owner}');`,
);

const T = {};
for (const [who, p] of Object.entries(phone)) T[who] = (await signInWith(p, PIN)).body?.token;
check('HQ owner and staff sign in', Object.values(T).every(Boolean));
if (!Object.values(T).every(Boolean)) process.exit(1);

let r = await call(T.owner, 'GET', '/business/catalog');
const car = r.body?.classes?.find((c) => c.key === 'car');
const size = (key) => car?.sizes?.find((s) => s.key === key)?.id;
check('The catalog loads with car sizes', r.status === 200 && !!size('S') && !!size('XL'), show(r));
const ALL = { shop: true, community: true, doorstep: true };
const create = (body) => call(T.owner, 'POST', '/business/services', { classIds: [car.id], ...body });

// ─── Adding services ─────────────────────────────────────────────────────────

r = await create({
  name: 'Express Test',
  description: 'Quick outside wash',
  places: ALL,
  kind: 'wash',
  durationMin: 25,
  popular: true,
  showInApp: true,
  checklist: ['Foam wash', 'Tyre shine'],
  prices: [
    { sizeId: size('S'), price: 30000 },
    { sizeId: size('M'), price: 40000 },
  ],
});
const EXPRESS = r.body?.id;
check('A service is added with its places, time, kind, badge, checklist and prices in one go', r.status === 201 && !!EXPRESS, show(r));
r = await create({ name: 'Shop Polish', places: { shop: true, community: false, doorstep: false }, kind: 'addon', prices: [{ sizeId: size('S'), price: 20000 }] });
const POLISH = r.body?.id;
r = await create({ name: 'Community Care', places: { shop: false, community: true, doorstep: false }, prices: [{ sizeId: size('S'), price: 25000 }] });
const COMMUNITY = r.body?.id;
r = await create({ name: 'Home Detail', places: { shop: false, community: false, doorstep: true }, prices: [{ sizeId: size('S'), price: 50000 }] });
const HOME = r.body?.id;
r = await create({ name: 'Staff Special', places: ALL, showInApp: false, prices: [{ sizeId: size('S'), price: 10000 }] });
const STAFF_ONLY = r.body?.id;
check('…and four more: shop only, community only, doorstep only, staff-only', [POLISH, COMMUNITY, HOME, STAFF_ONLY].every(Boolean), show(r));

r = await create({ name: 'Nowhere', places: { shop: false, community: false, doorstep: false } });
check('A service has to be done somewhere', r.status === 400, show(r));
r = await create({ name: 'Too long', checklist: Array.from({ length: 13 }, (_, i) => `Step ${i}`) });
check('…the checklist has at most 12 lines', r.status === 400, show(r));
r = await create({ name: 'Wordy', checklist: ['x'.repeat(41)] });
check('…each under 40 letters', r.status === 400, show(r));
r = await create({ name: 'Instant', durationMin: 0 });
check('…and a time of at least a minute', r.status === 400, show(r));

r = await call(T.owner, 'GET', '/business/catalog');
const svc = (id) => r.body?.services?.find((s) => s.id === id);
const price = (id, sz) => r.body?.prices?.find((p) => p.serviceId === id && p.sizeId === size(sz));
check('HQ sees what was saved', svc(EXPRESS)?.durationMin === 25 && svc(EXPRESS)?.popular === true && svc(EXPRESS)?.kind === 'wash' && svc(EXPRESS)?.checklist?.join() === 'Foam wash,Tyre shine', JSON.stringify(svc(EXPRESS)));
check('…with its places as three ticks', JSON.stringify(svc(EXPRESS)?.places) === JSON.stringify(ALL) && svc(COMMUNITY)?.places?.doorstep === false && svc(COMMUNITY)?.places?.shop === false && svc(HOME)?.places?.community === false, JSON.stringify([svc(COMMUNITY)?.places, svc(HOME)?.places]));
check('…and its prices per size (S ₹300, M ₹400, L not offered; communities by the rule)', price(EXPRESS, 'S')?.price === 30000 && price(EXPRESS, 'S')?.doorstepPrice === null && price(EXPRESS, 'M')?.price === 40000 && !price(EXPRESS, 'L'), JSON.stringify(r.body?.prices?.filter((p) => p.serviceId === EXPRESS)));
r = await call(T.owner, 'PATCH', `/business/services/${EXPRESS}`, { prices: [{ sizeId: size('S'), price: 30000, doorstepPrice: 28000 }] });
check('A size can’t be given its own community price: communities follow the rule', r.status === 400, show(r));

r = await call(T.owner, 'PATCH', `/business/services/${EXPRESS}`, { prices: [{ sizeId: size('M'), price: null }], durationMin: 30, checklist: ['Foam wash'] });
const after = await call(T.owner, 'GET', '/business/catalog');
check('Editing switches a size off and changes the details', r.status === 200 && !after.body?.prices?.some((p) => p.serviceId === EXPRESS && p.sizeId === size('M')) && after.body?.services?.find((s) => s.id === EXPRESS)?.durationMin === 30, show(r));

// ─── Sizes ───────────────────────────────────────────────────────────────────

const bikeCls = (await call(T.owner, 'GET', '/business/catalog')).body?.classes?.find((c) => c.key === 'twoWheeler');
r = await create({
  name: 'Small Coat',
  places: ALL,
  sizeIds: [size('S'), size('M')],
  prices: [
    { sizeId: size('S'), price: 50000 },
    { sizeId: size('M'), price: 60000 },
    { sizeId: size('L'), price: 70000 },
  ],
});
const SMALL = r.body?.id;
let cat = (await call(T.owner, 'GET', '/business/catalog')).body;
check('A service can be for some sizes only (cars S and M)', r.status === 201 && cat?.services?.find((x) => x.id === SMALL)?.sizeIds?.sort().join() === [size('S'), size('M')].sort().join(), show(r));
check('…a service saved without sizes is for every size of its vehicles', cat?.services?.find((x) => x.id === EXPRESS)?.sizeIds?.length === car.sizes.length);
r = await create({ name: 'Wrong size', sizeIds: [bikeCls?.sizes?.[0]?.id] });
check('A size of a vehicle not picked is refused', r.status === 400, show(r));
r = await create({ name: 'No bike size', classIds: [car.id, bikeCls?.id], sizeIds: [size('S')] });
check('Every vehicle picked needs at least one size', r.status === 400 && /two-wheeler size/.test(r.body?.message ?? ''), show(r));
r = await call(T.owner, 'PATCH', `/business/services/${SMALL}`, { classIds: [car.id, bikeCls?.id] });
cat = (await call(T.owner, 'GET', '/business/catalog')).body;
const smallSizes = cat?.services?.find((x) => x.id === SMALL)?.sizeIds ?? [];
check('Adding a vehicle keeps the sizes it had and brings the new vehicle’s sizes', r.status === 200 && smallSizes.includes(size('S')) && !smallSizes.includes(size('L')) && bikeCls?.sizes?.every((z) => smallSizes.includes(z.id)), JSON.stringify(smallSizes));
await call(T.owner, 'PATCH', `/business/services/${SMALL}`, { classIds: [car.id], sizeIds: [size('S'), size('M')] });

// ─── Branch menus ────────────────────────────────────────────────────────────

r = await call(T.owner, 'PUT', '/branch/types', { hub: true, community: true, doorstep: true });
check('The branch runs all three', r.status === 200 && r.body?.services?.live?.doorstep === true, show(r));
r = await call(T.staff, 'GET', '/services');
check('New services reach no branch until HQ switches them on there', r.status === 200 && (r.body ?? []).length === 0, show(r));

r = await create({ name: 'Duo', places: ALL, includes: [EXPRESS, POLISH] });
const DUO = r.body?.id;
r = await call(T.owner, 'PUT', `/business/branches/${SHOP}/menu`, { serviceIds: [DUO] });
check('Switching a combo on brings the services it bundles', r.status === 200 && [DUO, EXPRESS, POLISH].every((id) => r.body?.menu?.includes(id)) && r.body?.menu?.length === 3, show(r));
r = await call(T.owner, 'PUT', `/business/branches/${SHOP}/menu`, { serviceIds: ['cs_nope'] });
check('An unknown service can’t be switched on', r.status === 404, show(r));
r = await call(T.staff, 'PUT', `/business/branches/${SHOP}/menu`, { serviceIds: [EXPRESS] });
check('Only HQ switches services on for a branch', r.status === 403, show(r));
r = await call(T.owner, 'PUT', `/business/branches/${SHOP}/menu`, { serviceIds: [SMALL] });
const vts = Object.fromEntries(((await call(T.staff, 'GET', '/services/vehicle-types')).body ?? []).map((v) => [v.name, v]));
const smallBranch = ((await call(T.staff, 'GET', '/services')).body ?? []).find((x) => x.name === 'Small Coat');
const branchPrices = (await call(T.staff, 'GET', '/services/prices')).body ?? [];
const smallPrice = (vt) => branchPrices.find((p) => p.serviceId === smallBranch?.id && p.vehicleTypeId === vts[vt]?.id && p.mode === 'hub')?.price;
check('A branch sells a service only for its sizes (Sedan yes, SUV no, though L has a price)', smallPrice('Hatchback') === 50000 && smallPrice('Sedan') === 60000 && smallPrice('SUV') == null, JSON.stringify(branchPrices.filter((p) => p.serviceId === smallBranch?.id)));
r = await call(T.owner, 'PUT', `/business/branches/${SHOP}/menu`, { serviceIds: [EXPRESS, POLISH, COMMUNITY, HOME, STAFF_ONLY] });
check('HQ switches five on at the branch', r.status === 200 && r.body?.menu?.length === 5, show(r));
r = await call(T.owner, 'GET', '/business/catalog');
check('…and the catalog shows which services each branch sells', r.body?.branches?.find((b) => b.id === SHOP)?.menu?.length === 5, JSON.stringify(r.body?.branches?.map((b) => b.menu)));
r = await call(T.staff, 'GET', '/services');
check('The branch sells exactly those (not the combo HQ left off)', (r.body ?? []).length === 5 && !(r.body ?? []).some((x) => x.name === 'Duo'), JSON.stringify((r.body ?? []).map((x) => x.name)));

await call(T.owner, 'PATCH', `/business/services/${STAFF_ONLY}`, { active: false });
r = await call(T.staff, 'GET', '/services');
check('Switching a service off at HQ takes it off the branch', !(r.body ?? []).some((x) => x.name === 'Staff Special'), JSON.stringify((r.body ?? []).map((x) => x.name)));
await call(T.owner, 'PATCH', `/business/services/${STAFF_ONLY}`, { active: true });
r = await call(T.staff, 'GET', '/services');
check('…and switching it back on returns it to the branches that had it', (r.body ?? []).some((x) => x.name === 'Staff Special'), JSON.stringify((r.body ?? []).map((x) => x.name)));
r = await call(T.owner, 'PUT', `/business/branches/${SHOP}/menu`, { serviceIds: [EXPRESS, STAFF_ONLY] });
await call(T.owner, 'PATCH', `/business/services/${STAFF_ONLY}`, { active: false });
r = await call(T.owner, 'PUT', `/business/branches/${SHOP}/menu`, { serviceIds: [STAFF_ONLY] });
check('A service switched off at HQ can’t be switched on at a branch', r.status === 400 && /switched off/.test(r.body?.message ?? ''), show(r));
await call(T.owner, 'PATCH', `/business/services/${STAFF_ONLY}`, { active: true });
await call(T.owner, 'PUT', `/business/branches/${SHOP}/menu`, { serviceIds: [EXPRESS, POLISH, COMMUNITY, HOME, STAFF_ONLY] });
r = await call(T.staff, 'GET', '/services');
const branch = Object.fromEntries((r.body ?? []).map((s) => [s.name, s]));
check('The branch menu carries the time, badge, kind and checklist', branch['Express Test']?.durationMin === 30 && branch['Express Test']?.popular === true && branch['Shop Polish']?.kind === 'addon' && branch['Express Test']?.checklist === '["Foam wash"]', JSON.stringify(branch['Express Test']));
check('…and where the team does each one', branch['Community Care']?.teamAt === 'community' && branch['Home Detail']?.teamAt === 'doorstep' && branch['Shop Polish']?.modes === 'hub', JSON.stringify([branch['Community Care'], branch['Home Detail']].map((s) => s && { modes: s.modes, teamAt: s.teamAt })));

const types = (await call(T.staff, 'GET', '/services/vehicle-types')).body ?? [];
const hatch = types.find((t) => t.name === 'Hatchback');
const doorstepJob = (serviceId) =>
  call(T.staff, 'POST', '/jobs/start', {
    id: `job_svc_${run}_${rand(6)}`,
    customer: { phone: `98${rand(8)}`, name: 'Home Customer' },
    registrationNumber: `AP39SV${rand(4)}`,
    vehicleTypeId: hatch?.id,
    services: [{ serviceId, quantity: 1 }],
    mode: 'doorstep',
    visitPoint: { latitude: 14.51, longitude: 79.98 },
  });
r = await doorstepJob(branch['Community Care']?.id);
check('A doorstep wash refuses a service done only at communities', r.status === 400 && r.body?.error === 'not_at_homes', show(r));
r = await doorstepJob(branch['Home Detail']?.id);
check('…and sells one done at homes: its price plus the visit charge (₹500 + ₹49)', r.status === 201 && r.body?.total === 54900, show(r));

// ─── Customer app and community menus ────────────────────────────────────────

r = await call(null, 'GET', '/c/branches');
const listed = (r.body?.branches ?? []).find((b) => b.id === SHOP);
const appSvc = (name) => listed?.services?.find((s) => s.name === name);
check('The customer app hides staff-only services', !!listed && !appSvc('Staff Special'), JSON.stringify(listed?.services?.map((s) => s.name)));
check('…doesn’t sell a community-only service at the door', !appSvc('Community Care'), JSON.stringify(appSvc('Community Care')));
check('…sells a doorstep-only service at the door', (appSvc('Home Detail')?.doorstepPrices?.length ?? 0) > 0, JSON.stringify(appSvc('Home Detail')));
check('…and shows the time, badge and checklist', appSvc('Express Test')?.durationMin === 30 && appSvc('Express Test')?.popular === true && appSvc('Express Test')?.checklist?.join() === 'Foam wash', JSON.stringify(appSvc('Express Test')));

r = await call(T.staff, 'GET', '/places/menu');
const menuNames = (r.body?.menu?.services ?? []).map((s) => s.name);
check('Community menus list only what’s done at communities', r.status === 200 && menuNames.includes('Community Care') && menuNames.includes('Express Test') && !menuNames.includes('Home Detail') && !menuNames.includes('Shop Polish'), show(r));

// ─── Plans ───────────────────────────────────────────────────────────────────

r = await call(T.owner, 'POST', '/business/plans', { name: 'Home Plan', washes: 4, months: 1, catalogServiceId: HOME });
check('A plan can’t use a service not done at communities', r.status === 400 && /communities/.test(r.body?.message ?? ''), show(r));
r = await call(T.owner, 'POST', '/business/plans', { name: 'Care Plan', washes: 4, months: 1, catalogServiceId: COMMUNITY });
check('…and can use one that is', r.status === 201, show(r));
r = await call(T.owner, 'PATCH', `/business/services/${COMMUNITY}`, { places: { shop: false, community: false, doorstep: true } });
check('A plan’s service can’t stop being done at communities', r.status === 409 && r.body?.error === 'in_use' && /Care Plan/.test(r.body?.message ?? ''), show(r));

// ─── Times and deleting ──────────────────────────────────────────────────────

r = await create({ name: 'Ceramic Coat', places: { shop: true, community: false, doorstep: false }, durationMin: 2 * 24 * 60 });
check('A service can take days (2 days)', r.status === 201 && (await call(T.owner, 'GET', '/business/catalog')).body?.services?.find((x) => x.id === r.body?.id)?.durationMin === 2880, show(r));
r = await create({ name: 'Too slow', durationMin: 31 * 24 * 60 });
check('…but not more than 30 days', r.status === 400, show(r));

r = await call(T.owner, 'DELETE', `/business/services/${COMMUNITY}`);
check('A service a wash plan uses can’t be deleted', r.status === 409 && /Care Plan/.test(r.body?.message ?? ''), show(r));
r = await call(T.owner, 'DELETE', `/business/services/${EXPRESS}`);
check('…nor one inside a combo', r.status === 409 && /Duo/.test(r.body?.message ?? ''), show(r));
r = await call(T.staff, 'DELETE', `/business/services/${HOME}`);
check('Only HQ deletes services', r.status === 403, show(r));
r = await call(T.owner, 'DELETE', `/business/services/${HOME}`);
const afterDelete = (await call(T.owner, 'GET', '/business/catalog')).body;
check('HQ deletes a service: it leaves the catalog and every branch’s menu', r.status === 200 && afterDelete?.services?.find((x) => x.id === HOME)?.active === false && !afterDelete?.branches?.some((b) => b.menu.includes(HOME)), show(r));
r = await call(T.staff, 'GET', '/services');
check('…and the branch no longer sells it', !(r.body ?? []).some((x) => x.name === 'Home Detail'), JSON.stringify((r.body ?? []).map((x) => x.name)));
r = await call(T.owner, 'DELETE', `/business/services/${HOME}`);
check('…and it can’t be deleted twice', r.status === 404, show(r));

// ─── Opening a branch with its services ──────────────────────────────────────

const KAVALI = { pincode: '524201', latitude: 14.9163, longitude: 79.9945 };
const plan = (await call(T.owner, 'POST', '/business/branches/preview', { town: null, ...KAVALI })).body?.plan;
r = await call(T.owner, 'POST', '/business/branches', {
  town: null,
  ...KAVALI,
  ownerName: 'Kavali Owner',
  ownerPhone: `90${rand(8)}`,
  confirmed: (plan?.checks ?? []).map((k) => k.kind),
  menu: ['cs_nope'],
});
check('A branch can’t open with a service that isn’t HQ’s', r.status === 404, show(r));
r = await call(T.owner, 'POST', '/business/branches', {
  town: null,
  ...KAVALI,
  ownerName: 'Kavali Owner',
  ownerPhone: `90${rand(8)}`,
  confirmed: (plan?.checks ?? []).map((k) => k.kind),
  menu: [EXPRESS],
});
const NEW_SHOP = r.body?.id;
const sold = NEW_SHOP ? d1Rows(`SELECT name FROM services WHERE shop_id = '${NEW_SHOP}' AND active = 1 AND catalog_service_id IS NOT NULL`) : [];
check('A new branch opens selling only the services picked for it', r.status === 201 && sold.length === 1 && sold[0].name === 'Express Test', `${show(r)} ${JSON.stringify(sold)}`);

// ─── Vehicle size guide ──────────────────────────────────────────────────────

r = await call(T.staff, 'GET', '/services/vehicle-sizes');
const hatchBody = r.body?.bodyTypes?.find((b) => b.key === 'hatch');
check('Any teammate can read which size each body type is priced as', r.status === 200 && hatchBody?.sizeKey === 'S' && hatchBody?.classKey === 'car' && r.body?.classes?.some((c) => c.key === 'car' && c.sizes.length === 4), show(r));

// ─── Clean up ────────────────────────────────────────────────────────────────

try {
  const shopTables = ['job_events', 'job_services', 'job_sellers', 'job_washers', 'jobs', 'vehicles', 'customers', 'service_prices', 'service_combo_items', 'branch_price_overrides', 'services', 'service_point_classes', 'service_points', 'vehicle_types', 'login_codes', 'users'];
  const bizTables = ['wash_plan_prices', 'wash_plans', 'price_book_entries', 'catalog_combo_items', 'catalog_service_classes', 'catalog_services', 'price_books', 'body_types', 'vehicle_sizes', 'vehicle_classes', 'business_settings', 'business_admins'];
  const existing = new Set(d1Rows("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name));
  d1Run(
    `PRAGMA foreign_keys = OFF; DELETE FROM branch_menu_services WHERE shop_id IN (SELECT id FROM shops WHERE business_id = '${BIZ}'); ${shopTables.filter((t) => existing.has(t)).map((t) => `DELETE FROM ${t} WHERE shop_id = '${SHOP}';`).join(' ')} DELETE FROM shops WHERE id = '${SHOP}'; ${bizTables.filter((t) => existing.has(t)).map((t) => `DELETE FROM ${t} WHERE business_id = '${BIZ}';`).join(' ')} DELETE FROM businesses WHERE id = '${BIZ}';`,
  );
} catch {
  // Left behind for the next db:reset:local.
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
