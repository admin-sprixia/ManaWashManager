// Walks how people get onto a team against the local API: nobody signs themselves up, HQ opens a
// branch and manages its owners, owners add their team from Team, and a removed teammate's
// number is free to be added again (at the same or another branch, with one PIN).
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:team                          (in another)
// Uses fresh random numbers each run, so it can be re-run without a reset.
import { API, apiFetch, signIn } from './lib/target.mjs';

const PIN = '258025';
const MANA_OWNER = '9100000000';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}

async function call(token, method, path, body) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await apiFetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const show = (r) => `${r.status} ${JSON.stringify(r.body)}`;
const newPhone = () => `7${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

/** Signs in with the PIN, or (first time) a WhatsApp code and then choosing the PIN. */
async function signInAs(phone) {
  const r = await signIn(phone, PIN);
  if (!r.body?.token) throw new Error(`Sign-in failed for ${phone}: ${show(r)}`);
  return r.body;
}
const signInOwner = signInAs;

// ─── Nobody signs themselves up ─────────────────────────────────────────

const ownerPhone = newPhone();
const start = await call(null, 'POST', '/auth/start', { phone: ownerPhone });
check(
  'A number on no team is told to ask the owner or manager',
  start.status === 404 && start.body?.error === 'no_account' && /add you from Team/.test(start.body?.message ?? ''),
  show(start),
);
const signupCode = await call(null, 'POST', '/signup/code', { phone: ownerPhone, purpose: 'join' });
check('There is no sign-up code to ask for', signupCode.status === 404, show(signupCode));
const joinRoute = await call(null, 'POST', '/signup/join', { ticket: 'x', shopCode: '482193', name: 'Arun' });
check('There is no join-a-branch route', joinRoute.status === 404, show(joinRoute));
const code = await call(null, 'POST', '/auth/code/request', { phone: ownerPhone });
check('…and no sign-in code for a number on no team', code.status === 404 && code.body?.error === 'no_account', show(code));

// ─── HQ opens a branch ────────────────────────────────────────────────────

const manaOwner = (await signInOwner(MANA_OWNER)).token;
const opened = await call(manaOwner, 'POST', '/business/branches', {
  town: 'Vijayawada',
  townCode: 'vja',
  ownerName: 'Arun',
  ownerPhone,
});
check('HQ opens a branch with its owner, coded by town (VJA-01, VJA-02…)', opened.status === 201 && /^VJA-\d{2}$/.test(opened.body?.code ?? ''), show(opened));
const badTown = await call(manaOwner, 'POST', '/business/branches', { town: 'Vijayawada', townCode: 'VJ1', ownerName: 'X', ownerPhone: newPhone() });
check('A town code must be 3 letters', badTown.status === 400, show(badTown));
const bCode = opened.body.code;
const bShopId = opened.body.id;

const startAgain = await call(null, 'POST', '/auth/start', { phone: ownerPhone });
check('The new owner’s number is now known', startAgain.status === 200 && startAgain.body?.next === 'code', show(startAgain));
const bOwnerSession = await signInOwner(ownerPhone);
const bOwner = bOwnerSession.token;
check('New owner signs in with a WhatsApp code and sets a PIN', bOwnerSession.user?.shopId === bShopId, JSON.stringify(bOwnerSession));

const info = await call(bOwner, 'GET', '/shop/info');
check('Branch info: name, city and branch ID', info.body?.name === 'Vijayawada' && info.body?.city === 'Vijayawada' && info.body?.code === bCode, show(info));
const bTeam = await call(bOwner, 'GET', '/team');
check('New branch’s team is just its owner', Array.isArray(bTeam.body) && bTeam.body.length === 1 && bTeam.body[0].role === 'owner', show(bTeam));
const bServices = await call(bOwner, 'GET', '/services');
const bList = bServices.body?.services ?? bServices.body;
check('New branch gets HQ’s menu', Array.isArray(bList) && bList.length > 0, show(bServices));

const notHq = await call(bOwner, 'POST', '/business/branches', { town: 'Side Town', townCode: 'SDT', ownerName: 'X', ownerPhone: newPhone() });
check('A branch owner can’t open branches', notHq.status === 403, show(notHq));
const oldRoute = await call(bOwner, 'POST', '/auth/shops', { shopName: 'Side Shop' });
check('The owner’s open-another-shop route is gone', oldRoute.status === 404, show(oldRoute));
const ownerByTeam = await call(bOwner, 'POST', '/team', { name: 'Partner', phone: newPhone(), role: 'owner' });
check('A branch owner can’t add owners', ownerByTeam.status === 403 && ownerByTeam.body?.error === 'hq_only', show(ownerByTeam));

// HQ adds and removes a second owner.
const partnerPhone = newPhone();
const partner = await call(manaOwner, 'POST', `/business/branches/${bShopId}/owners`, { name: 'Partner', phone: partnerPhone });
check('HQ adds a second owner', partner.status === 201 || partner.status === 200, show(partner));
const bTeam2 = await call(bOwner, 'GET', '/team');
const partnerRow = Array.isArray(bTeam2.body) ? bTeam2.body.find((m) => m.phone === partnerPhone) : undefined;
check('The partner shows as an owner in the branch team', partnerRow?.role === 'owner', show(bTeam2));
if (partnerRow) {
  const offByOwner = await call(bOwner, 'PATCH', `/team/${partnerRow.id}`, { active: false });
  check('A branch owner can’t turn another owner off', offByOwner.status === 403, show(offByOwner));
  const removeByOwner = await call(bOwner, 'DELETE', `/team/${partnerRow.id}`);
  check('A branch owner can’t remove another owner', removeByOwner.status === 403, show(removeByOwner));
  const removeByHq = await call(manaOwner, 'DELETE', `/business/branches/${bShopId}/owners/${partnerRow.id}`);
  check('HQ removes the partner', removeByHq.status === 200, show(removeByHq));
}
const bOwnerRow = Array.isArray(bTeam.body) ? bTeam.body[0] : undefined;
if (bOwnerRow) {
  const lastOwner = await call(manaOwner, 'DELETE', `/business/branches/${bShopId}/owners/${bOwnerRow.id}`);
  check('HQ can’t remove a branch’s last owner', lastOwner.status === 400, show(lastOwner));
}

// ─── Added from Team ────────────────────────────────────────────────────

const requests = await call(manaOwner, 'GET', '/team/requests');
check('There is no join-requests list', requests.status === 404, show(requests));

const ravi = newPhone();
const added = await call(manaOwner, 'POST', '/team', { name: 'Ravi', phone: ravi });
check('The owner adds Ravi from Team (as staff)', added.status === 201, show(added));
const raviKnown = await call(null, 'POST', '/auth/start', { phone: ravi });
check('Ravi’s number is now known: a WhatsApp code first', raviKnown.status === 200 && raviKnown.body?.next === 'code', show(raviKnown));
const raviFirst = await signInAs(ravi);
const raviSession = raviFirst.token;
const raviId = raviFirst.user?.id;
check('Ravi signs in with the code and chooses his own PIN', raviFirst.user?.shopId === 'shop_mana' && raviFirst.user?.role === 'staff', JSON.stringify(raviFirst));
const raviPin = await call(null, 'POST', '/auth/pin/login', { phone: ravi, pin: PIN });
check('Next time the PIN is enough on this phone', raviPin.body?.user?.id === raviId, show(raviPin));
const addTwice = await call(manaOwner, 'POST', '/team', { name: 'Ravi', phone: ravi });
check('He can’t be added twice to the same branch', addTwice.status === 409, show(addTwice));
const otherBranchTeam = await call(bOwner, 'GET', '/team');
check('Another branch’s owner doesn’t see him', Array.isArray(otherBranchTeam.body) && !otherBranchTeam.body.some((m) => m.phone === ravi), show(otherBranchTeam));

// ─── Remove from team ─────────────────────────────────────────────────────

const removeSelf = await call(
  manaOwner,
  'DELETE',
  `/team/${(await call(manaOwner, 'GET', '/auth/me')).body.id}`,
);
check('Owner can’t remove themselves', removeSelf.status === 400, show(removeSelf));
const crossRemove = await call(bOwner, 'DELETE', `/team/${raviId}`);
check('Another shop can’t remove MANA’s staff', crossRemove.status === 404, show(crossRemove));

const removed = await call(manaOwner, 'DELETE', `/team/${raviId}`);
check('MANA’s owner removes Ravi', removed.status === 200, show(removed));
const oldSession = await call(raviSession, 'GET', '/auth/me');
check(
  'Ravi’s old session stops working',
  oldSession.status === 401 || oldSession.status === 403,
  show(oldSession),
);
const manaTeam = await call(manaOwner, 'GET', '/team');
check(
  'Ravi is gone from MANA’s team list',
  Array.isArray(manaTeam.body) && !manaTeam.body.some((m) => m.id === raviId),
  show(manaTeam),
);
const raviStart = await call(null, 'POST', '/auth/start', { phone: ravi });
check('Ravi’s number is free again (on no team)', raviStart.status === 404 && raviStart.body?.error === 'no_account', show(raviStart));

const addedToB = await call(bOwner, 'POST', '/team', { name: 'Ravi', phone: ravi });
check('The other branch’s owner adds him', addedToB.status === 201, show(addedToB));
const raviInB = { body: await signInAs(ravi) };
check(
  'Ravi signs in at the other branch with the same number',
  raviInB.body?.user?.shopId === bShopId,
  JSON.stringify(raviInB.body),
);

const reAdd = await call(manaOwner, 'POST', '/team', { name: 'Ravi', phone: ravi });
check('MANA can add him back while he works at the other branch too', reAdd.status === 201, show(reAdd));
const reAddAgain = await call(manaOwner, 'POST', '/team', { name: 'Ravi', phone: ravi });
check('…but not twice in the same branch', reAddAgain.status === 409, show(reAddAgain));
const raviShops = await call(raviInB.body.token, 'GET', '/auth/shops');
check(
  'Ravi sees both branches to switch between, with one PIN',
  raviShops.body?.shops?.length === 2 && raviShops.body.shops.every((x) => x.role === 'staff'),
  show(raviShops),
);
const raviSwitch = await call(raviInB.body.token, 'POST', '/auth/switch', { shopId: 'shop_mana' });
check('…and switches to MANA without the PIN again', raviSwitch.body?.user?.shopId === 'shop_mana', show(raviSwitch));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
