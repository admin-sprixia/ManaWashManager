#!/usr/bin/env node
// Adds flats and residents on plans to the demo communities, on top of what's already there
// (unlike seed-demo, it wipes nothing). Safe to run again: flats already taken are skipped. The
// residents are on the price menu's plans, so run `npm run db:seed:menu` first.
//
//   cd apps/api && npm run dev            (in one terminal)
//   cd apps/api && npm run db:seed:flats  (in another)
//
// Needs the demo data from `npm run db:seed:demo` (the communities and the owner / Ravi logins).
import { API, apiFetch, d1Rows, d1Run, DEV_CODE, signIn } from './lib/target.mjs';

const PIN = '258025';
const OWNER_PHONE = '9888626111';
const RAVI_PHONE = '9300000011';

async function call(token, method, path, body) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
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

const plan = (planId, payMode = 'full') => ({ kind: 'plan', planId, payMode });
/** Residents to add: flat (block-number), name, phone, vehicles [type, plan, pay mode], whether they pay now. */
const TOWER_RESIDENTS = [
  ['A-102', 'Kavitha Reddy', '9440012001', [['Sedan', 'Basic Plan']], true],
  ['A-103', 'Deepika Rao', '9440012031', [['Sedan', 'Shine Plan']], true],
  ['A-104', 'Mahesh Babu', '9440012002', [['Mini SUV', 'Shine Plan'], ['Bike', 'Bike Basic Plan']], true],
  ['A-201', 'Lakshmi Prasanna', '9440012003', [['Hatchback', 'Express Plan']], true],
  ['A-302', 'Ravi Teja', '9440012004', [['Large SUV / XUV', 'Basic Plan · 3 months', 'parts']], true],
  ['A-401', 'Sunitha Devi', '9440012005', [['Hatchback', 'Basic Plan'], ['Scooter', 'Bike Basic Plan']], true],
  ['A-403', 'Venkatesh K', '9440012006', [['Sedan', 'Express Plan']], false],
  ['B-101', 'Harika S', '9440012007', [['Scooter', 'Bike Express Plan']], true],
  ['B-104', 'Arjun Varma', '9440012032', [['Hatchback', 'Express Plan · 3 months']], true],
  ['B-203', 'Naresh Kumar', '9440012008', [['Mini SUV', 'Basic Plan']], true],
  ['B-302', 'Padma Latha', '9440012009', [['Sedan', 'Shine Plan · 3 months']], true],
  ['C-101', 'Srikanth Rao', '9440012010', [['Hatchback', 'Express Plan'], ['Bike', 'Bike Basic Plan']], true],
  ['C-104', 'Anjali M', '9440012011', [['Sedan', 'Basic Plan']], false],
  ['C-202', 'Gopal Krishna', '9440012012', [['Large SUV / XUV', 'Express Plan · 12 months', 'parts']], true],
];

const COLONY_RESIDENTS = [
  ['3', 'Suresh Babu', '9440012021', [['Hatchback', 'Express Plan']], true],
  ['7', 'Rama Devi', '9440012022', [['Sedan', 'Basic Plan'], ['Scooter', 'Bike Basic Plan']], true],
  ['11', 'Chandra Sekhar', '9440012023', [['Mini SUV', 'Basic Plan']], false],
  ['14', 'Bhavani P', '9440012024', [['Bike', 'Bike Shine Plan']], true],
];

/**
 * Green Park is waiting for the owner's approval: these are the people who signed up, on the new
 * menu's plans, so the review's Plans tab has something to show. Vehicles and plans by name.
 */
const GREEN_PARK_RESIDENTS = [
  ['A-101', 'Srinivas Rao', '9440012041', [['Sedan', 'Basic Plan'], ['Scooter', 'Bike Basic Plan']], true],
  ['A-102', 'Lavanya K', '9440012042', [['Hatchback', 'Express Plan']], true],
  ['A-104', 'Prakash Reddy', '9440012043', [['Luxury car', 'Shine Plan']], true],
  ['A-105', 'Divya Teja', '9440012044', [['Mini SUV', 'Basic Plan · 3 months', 'parts']], true],
  ['A-201', 'Naveen Kumar', '9440012045', [['Bike', 'Bike Express Plan']], true],
  ['A-203', 'Swathi M', '9440012046', [['Large SUV / XUV', 'Shine Plan'], ['Scooter', 'Bike Basic Plan']], false],
  ['A-206', 'Raghu Varma', '9440012047', [['Sedan', 'Express Plan · 12 months', 'parts']], true],
  ['A-302', 'Keerthi S', '9440012048', [['Premium bike', 'Bike Shine Plan']], true],
  ['A-303', 'Mohan Babu', '9440012049', [['MUV / 7-seater', 'Basic Plan'], ['Bike', 'Bike Basic Plan']], true],
  ['A-305', 'Harini P', '9440012050', [['Hatchback', 'Basic Plan']], false],
  ['A-306', 'Vamsi Krishna', '9440012051', [['Sedan', 'Shine Plan · 3 months']], true],
];

/** Turns [type name, plan name, pay mode] into the ids the join takes. */
async function byName(owner, residents) {
  const types = new Map((await call(owner, 'GET', '/services/vehicle-types')).map((t) => [t.name, t.id]));
  const plans = new Map((await call(owner, 'GET', '/business/plans')).plans.filter((p) => p.active).map((p) => [p.name, p.id]));
  return residents.map(([flat, name, phone, vehicles, pays]) => [
    flat,
    name,
    phone,
    vehicles.map(([type, planName, payMode = 'full']) => {
      if (!types.has(type)) throw new Error(`No vehicle type “${type}”`);
      if (!plans.has(planName)) throw new Error(`No plan “${planName}”. Run \`npm run db:seed:menu\` first.`);
      return [types.get(type), plan(plans.get(planName), payMode)];
    }),
    pays,
  ]);
}

const placeByName = (name) => d1Rows(`SELECT id, stage FROM places WHERE shop_id = 'shop_mana' AND name = '${name.replace(/'/g, "''")}'`)[0];

async function payOnTestCheckout(payment) {
  if (!payment?.url?.includes('/pay/test/')) return false;
  const res = await apiFetch(API + new URL(payment.url).pathname, {
    method: 'POST',
    body: new URLSearchParams({ action: 'pay' }),
    redirect: 'manual',
  });
  return res.status === 303;
}

/** Adds flats; the API skips ones already on the list. */
async function addUnits(token, placeId, groups) {
  for (const [block, numbers] of groups) {
    const r = await call(token, 'POST', `/places/${placeId}/units`, { block, numbers });
    console.log(`  ${block ? `Block ${block}` : 'Houses'} ${numbers}: ${r.added} new`);
  }
}

/** Adds residents to free flats the way the team does at the gate, then pays the ones who pay now. */
async function addResidents(owner, staff, placeId, residents) {
  const { units } = await call(owner, 'GET', `/places/${placeId}`);
  const unitId = new Map(units.map((u) => [u.block ? `${u.block}-${u.number}` : u.number, u.id]));
  const { members } = await call(owner, 'GET', `/places/${placeId}/members?filter=live`);
  const taken = new Set(members.map((m) => m.unit));
  const phones = new Set(members.map((m) => m.customer.phone));
  let added = 0;
  let paid = 0;
  let unpaid = 0;
  for (const [flat, name, phone, vehicles, pays] of residents) {
    const id = unitId.get(flat);
    const label = flat.includes('-') ? flat.replace('-', ' · ') : flat;
    if (!id) {
      console.log(`  skip ${flat}: not on the flats list`);
      continue;
    }
    if (taken.has(label) || phones.has(phone)) continue;
    await call(staff, 'POST', `/places/${placeId}/members/code`, { phone });
    const joined = await call(staff, 'POST', `/places/${placeId}/members`, {
      phone,
      code: DEV_CODE,
      name,
      unit: { unitId: id },
      vehicles: vehicles.map(([vehicleTypeId, choice]) => ({ vehicleTypeId, choice })),
    });
    added++;
    for (const order of joined.orders ?? []) {
      if (!pays) {
        unpaid++;
        continue;
      }
      const link = await call(staff, 'POST', `/places/orders/${order.id}/payment-link`);
      if (await payOnTestCheckout(link.payment)) paid++;
      else unpaid++;
    }
  }
  console.log(`  ${added} residents added · ${paid} plans paid · ${unpaid} not paid`);
}

const owner = (await signIn(OWNER_PHONE, PIN)).body?.token;
const ravi = (await signIn(RAVI_PHONE, PIN)).body?.token;
if (!owner || !ravi) throw new Error('Couldn’t sign in. Run `npm run db:seed:demo` first (PIN 258025).');

const towers = placeByName('Lakshmi Towers');
const colony = placeByName('Sri Ram Nagar');
const greenPark = placeByName('Green Park Residency');

if (towers) {
  console.log('Lakshmi Towers');
  await addUnits(owner, towers.id, [
    ['A', '101-104, 201-204, 301-304, 401-404'],
    ['B', '101-104, 201-204, 301-304'],
    ['C', '101-104, 201-204'],
  ]);
  await addResidents(owner, ravi, towers.id, await byName(owner, TOWER_RESIDENTS));
}
if (colony) {
  console.log('Sri Ram Nagar');
  await addUnits(owner, colony.id, [[null, '1-16']]);
  await addResidents(owner, ravi, colony.id, await byName(owner, COLONY_RESIDENTS));
}
if (greenPark) {
  console.log('Green Park Residency (waiting for approval)');
  await addUnits(owner, greenPark.id, [['A', '101-106, 201-206, 301-306']]);
  const residents = await byName(owner, GREEN_PARK_RESIDENTS);
  // Joining needs a live community: open it for the sign-ups, then put it back to review.
  const stage = greenPark.stage;
  if (stage !== 'live') d1Run(`UPDATE places SET stage = 'live' WHERE id = '${greenPark.id}'`);
  try {
    await addResidents(owner, ravi, greenPark.id, residents);
  } finally {
    if (stage !== 'live') d1Run(`UPDATE places SET stage = '${stage}' WHERE id = '${greenPark.id}'`);
  }
}
console.log('Done.');
