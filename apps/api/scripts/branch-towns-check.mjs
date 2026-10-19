// Opening branches from a pincode and a pin, end to end against the local API: the town comes
// from India Post's offices, each town keeps one code (big cities their known one), branches are
// numbered KVR-001, KVR-002, names never clash, and the checks (a branch next door, a pin far
// from its pincode, a new state) must be confirmed. Two branches opened at once get two numbers.
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:branch-towns                  (in another)
// Uses the pincodes in seed.sql (Kovur, Kavali, Nellore, Vijayawada, Ongole, Kukatpally).
import { API, apiFetch, d1Rows, signIn } from './lib/target.mjs';

const PIN = '258025';
const HQ = '9100000000';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 500)}`;
const newPhone = () => `7${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

async function call(token, method, path, body) {
  const headers = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await apiFetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const hq = (await signIn(HQ, PIN)).body?.token;
if (!hq) throw new Error('Couldn’t sign in as HQ (9100000000). Run `npm run db:reset:local` first.');

const KOVUR = { pincode: '524137', latitude: 14.514614, longitude: 79.987589 };
const KAVALI = { pincode: '524201', latitude: 14.9163, longitude: 79.9945 };
const NELLORE = { pincode: '524001', latitude: 14.4426, longitude: 79.9865 };
const KUKATPALLY = { pincode: '500072', latitude: 17.4928, longitude: 78.3966 };
const preview = (place) => call(hq, 'POST', '/business/branches/preview', { town: null, ...place });
const open = async (place, extra = {}) => {
  const plan = (await preview(place)).body?.plan;
  return call(hq, 'POST', '/business/branches', {
    town: null,
    ...place,
    ownerName: 'Owner',
    ownerPhone: newPhone(),
    confirmed: (plan?.checks ?? []).map((k) => k.kind),
    ...extra,
  });
};
const towns = () => d1Rows('SELECT code, name, district, state FROM branch_towns ORDER BY created_at');

// ─── Looking up a pincode ─────────────────────────────────────────────────

let r = await call(hq, 'GET', '/business/pincodes/524137');
check('A pincode gives its district and state', r.status === 200 && r.body.district === 'SPSR Nellore' && r.body.state === 'Andhra Pradesh', show(r));
r = await call(hq, 'GET', '/business/pincodes/524 137');
check('…typed with a space too', r.status === 200, show(r));
r = await call(hq, 'GET', '/business/pincodes/999999');
check('A pincode India Post doesn’t have is “unknown”', r.status === 404 && r.body.error === 'unknown_pincode', show(r));
r = await call(hq, 'GET', '/business/pincodes/12345');
check('Five digits is not a pincode', r.status === 400, show(r));

// ─── A branch opened before towns existed keeps its code ──────────────────

r = await preview(NELLORE);
check(
  'Nellore is a big city with its known code; the old NLR-01 branch counts, so the next is NLR-002',
  r.body?.plan?.town?.name === 'Nellore' && r.body.plan.town.code === 'NLR' && r.body.plan.code === 'NLR-002',
  show(r),
);
check('The preview writes nothing', towns().length === 0, JSON.stringify(towns()));

// ─── A new town ───────────────────────────────────────────────────────────

r = await preview(KOVUR);
const kovurPlan = r.body?.plan;
check('Kovur’s town comes from its post office, not one of its areas', kovurPlan?.town?.name === 'Kovur' && kovurPlan.town.existingId === null, show(r));
check('Kovur gets KVR and the branch KVR-001, named Kovur', kovurPlan?.town?.code === 'KVR' && kovurPlan.code === 'KVR-001' && kovurPlan.name === 'Kovur', show(r));
check('A first branch in a town has no area by default', kovurPlan?.area === null && kovurPlan.choices.areas.includes('Kovur Cutchery'), show(r));
r = await open(KOVUR);
check('HQ opens it', r.status === 201 && r.body.code === 'KVR-001', show(r));
check('…with the new owner’s name and no PIN yet, for the WhatsApp invite', typeof r.body?.owner?.name === 'string' && r.body.owner.hasPin === false, show(r));
const kovurTown = towns().find((t) => t.code === 'KVR');
check('The town is saved with its district and state', kovurTown?.district === 'SPSR Nellore' && kovurTown?.state === 'Andhra Pradesh', JSON.stringify(towns()));

// ─── A second branch in the same town ─────────────────────────────────────

const kovurAcross = { ...KOVUR, latitude: 14.5091944, longitude: 79.9856944 };
r = await preview(kovurAcross);
check(
  'A second Kovur branch keeps KVR, is KVR-002, and is named by its area',
  r.body?.plan?.town?.code === 'KVR' && r.body.plan.code === 'KVR-002' && r.body.plan.name === 'Kovur Cutchery',
  show(r),
);
check('…with no “next door” check when it’s 600 m away', !(r.body?.plan?.checks ?? []).some((k) => k.kind === 'near_branch'), show(r));
r = await preview({ ...kovurAcross, area: null });
check('With no area the name is numbered instead', r.body?.plan?.name === 'Kovur 2', show(r));
r = await preview({ ...kovurAcross, area: 'Nowhere' });
check('An area must be one of the choices', r.status === 400 && r.body.error === 'bad_choice', show(r));

// ─── Checks ───────────────────────────────────────────────────────────────

r = await preview(KOVUR);
check('A pin on top of a branch must be confirmed (“is this really new?”)', (r.body?.plan?.checks ?? []).some((k) => k.kind === 'near_branch'), show(r));
r = await call(hq, 'POST', '/business/branches', { town: null, ...KOVUR, ownerName: 'X', ownerPhone: newPhone() });
check('…and opening without confirming is refused, saying why', r.status === 409 && r.body.error === 'needs_confirmation' && r.body.checks[0].kind === 'near_branch', show(r));
r = await preview({ ...KOVUR, latitude: 15.5057, longitude: 80.0499 });
check('A pin 110 km from its pincode must be confirmed', (r.body?.plan?.checks ?? []).some((k) => k.kind === 'far_from_pincode'), show(r));
r = await preview(KUKATPALLY);
const hyd = r.body?.plan;
check(
  'In Hyderabad the town is the city (HYD) and the branch is named by its area',
  hyd?.town?.name === 'Hyderabad' && hyd.town.code === 'HYD' && hyd.code === 'HYD-001' && hyd.name === 'Hyderabad Kukatpally',
  show(r),
);
check('The first branch in a new state must be confirmed', (hyd?.checks ?? []).some((k) => k.kind === 'new_state' && k.message.includes('Telangana')), show(r));
r = await preview({ ...KUKATPALLY, town: 'Kukatpally' });
check('HQ can still choose the area as its own town (a code of its own)', r.body?.plan?.town?.name === 'Kukatpally' && r.body.plan.town.code !== 'HYD', show(r));
r = await preview({ ...KUKATPALLY, town: 'Secunderabad' });
check('A town that isn’t one of the choices is refused', r.status === 400 && r.body.error === 'bad_choice', show(r));
r = await preview({ ...KOVUR, latitude: 0, longitude: 0 });
check('A pin at 0, 0 is refused', r.status === 400 && r.body.error === 'outside_india', show(r));

// ─── Two branches opened at the same moment ───────────────────────────────

const [a, b] = await Promise.all([open(KAVALI), open({ ...KAVALI, latitude: 14.93, longitude: 80.01 })]);
const codes = [a.body?.code, b.body?.code].sort();
const kavaliTowns = towns().filter((t) => t.name === 'Kavali');
check(
  'Two Kavali branches at once: one town (KVL), KVL-001 and KVL-002',
  (a.status === 201 || a.status === 409) && (b.status === 201 || b.status === 409) && kavaliTowns.length === 1 && kavaliTowns[0].code === 'KVL',
  `${show(a)} | ${show(b)} | ${JSON.stringify(kavaliTowns)}`,
);
check(
  '…never the same code (a busy answer is fine; trying again gets the next)',
  codes[0] !== codes[1] && codes.filter(Boolean).every((c) => /^KVL-00[12]$/.test(c)),
  JSON.stringify(codes),
);

// ─── The rest ─────────────────────────────────────────────────────────────

r = await open(NELLORE);
const nellore = d1Rows("SELECT code, town_id, pincode FROM shops WHERE code IN ('NLR-01', 'NLR-002') ORDER BY code");
check('Opening in Nellore links the old NLR-01 branch to the town', nellore.length === 2 && nellore.every((s) => s.town_id && s.town_id !== 'null'), JSON.stringify(nellore));
const allCodes = towns().map((t) => t.code);
check('No two towns share a code', new Set(allCodes).size === allCodes.length, JSON.stringify(allCodes));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
