// Walks the whole "new number" flow against the local API: no self-serve shops, HQ opening a
// branch and managing its owners, asking to join with the branch ID (approve, reject, cancel),
// and removing a teammate so their number is free.
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:signup                        (in another)
// Uses fresh random numbers each run, so it can be re-run without a reset.
import { API, apiFetch, DEV_CODE, signIn } from './lib/target.mjs';

const PIN = '258025';
const MANA_CODE = '482193';
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

async function verifiedTicket(phone, purpose) {
  const sent = await call(null, 'POST', '/signup/code', { phone, purpose });
  if (!sent.body?.sent) throw new Error(`code for ${phone}: ${show(sent)}`);
  const verified = await call(null, 'POST', '/signup/verify', { phone, purpose, code: DEV_CODE });
  if (!verified.body?.ticket) throw new Error(`verify for ${phone}: ${show(verified)}`);
  return verified.body.ticket;
}

async function signInOwner(phone) {
  const r = await signIn(phone, PIN);
  if (!r.body?.token) throw new Error(`Owner sign-in failed for ${phone}: ${show(r)}`);
  return r.body;
}

async function askToJoin(phone, shopCode, name) {
  const ticket = await verifiedTicket(phone, 'join');
  const res = await call(null, 'POST', '/signup/join', { ticket, shopCode, name });
  if (!res.body?.requestToken) throw new Error(`join for ${phone}: ${show(res)}`);
  return res.body.requestToken;
}

async function requestIdFor(ownerToken, phone) {
  const list = await call(ownerToken, 'GET', '/team/requests');
  return Array.isArray(list.body) ? list.body.find((r) => r.phone === phone)?.id : undefined;
}

// ─── No self-serve shops ──────────────────────────────────────────────────

const ownerPhone = newPhone();
const start = await call(null, 'POST', '/auth/start', { phone: ownerPhone });
check('Unknown number → "new" (join a branch)', start.body?.next === 'new', show(start));
const signupCode = await call(null, 'POST', '/signup/code', { phone: ownerPhone, purpose: 'signup' });
check('No code to start a shop: only joining is offered', signupCode.status === 400, show(signupCode));
const shopRoute = await call(null, 'POST', '/signup/shop', { ticket: 'x', pin: PIN, name: 'Arun', shopName: 'Bubble Wash' });
check('The start-a-shop route is gone', shopRoute.status === 404, show(shopRoute));

// ─── Codes and tickets ────────────────────────────────────────────────────

const taken = await call(null, 'POST', '/signup/code', { phone: MANA_OWNER, purpose: 'join' });
check('Join code refused for a number that already has an account', taken.status === 409, show(taken));

const joiner = newPhone();
const sent = await call(null, 'POST', '/signup/code', { phone: joiner, purpose: 'join' });
check('Join code sent', sent.body?.sent === true, show(sent));
const again = await call(null, 'POST', '/signup/code', { phone: joiner, purpose: 'join' });
check('Asking again at once → wait before resending', again.status === 429 && again.body?.error === 'too_soon', show(again));
const wrong = await call(null, 'POST', '/signup/verify', { phone: joiner, purpose: 'join', code: '111111' });
check('Wrong code → tries left', wrong.status === 401 && wrong.body?.attemptsLeft === 4, show(wrong));
const verified = await call(null, 'POST', '/signup/verify', { phone: joiner, purpose: 'join', code: DEV_CODE });
check('Right code → join ticket', typeof verified.body?.ticket === 'string', show(verified));
const ticket = verified.body.ticket;
const reused = await call(null, 'POST', '/signup/verify', { phone: joiner, purpose: 'join', code: DEV_CODE });
check('The same code can’t be used twice', reused.status === 410, show(reused));
const forged = await call(null, 'POST', '/signup/join', { ticket: `${ticket}x`, shopCode: MANA_CODE, name: 'Arun' });
check('Tampered ticket refused', forged.status === 401, show(forged));
const ticketAsSession = await call(ticket, 'GET', '/auth/me');
check('A join ticket is not a session', ticketAsSession.status === 401, show(ticketAsSession));

// ─── HQ opens a branch ────────────────────────────────────────────────────

const manaOwner = (await signInOwner(MANA_OWNER)).token;
const opened = await call(manaOwner, 'POST', '/business/branches', {
  name: 'Bubble Wash',
  city: 'Vijayawada',
  ownerName: 'Arun',
  ownerPhone,
});
check('HQ opens a branch with its owner', opened.status === 201 && /^[1-9]\d{5}$/.test(opened.body?.code ?? ''), show(opened));
const bCode = opened.body.code;
const bShopId = opened.body.id;

const startAgain = await call(null, 'POST', '/auth/start', { phone: ownerPhone });
check('The new owner’s number is now known', startAgain.body?.next !== 'new', show(startAgain));
const bOwnerSession = await signInOwner(ownerPhone);
const bOwner = bOwnerSession.token;
check('New owner signs in with a WhatsApp code and sets a PIN', bOwnerSession.user?.shopId === bShopId, JSON.stringify(bOwnerSession));

const info = await call(bOwner, 'GET', '/shop/info');
check('Branch info: name, city and branch ID', info.body?.name === 'Bubble Wash' && info.body?.city === 'Vijayawada' && info.body?.code === bCode, show(info));
const bTeam = await call(bOwner, 'GET', '/team');
check('New branch’s team is just its owner', Array.isArray(bTeam.body) && bTeam.body.length === 1 && bTeam.body[0].role === 'owner', show(bTeam));
const bServices = await call(bOwner, 'GET', '/services');
const bList = bServices.body?.services ?? bServices.body;
check('New branch gets HQ’s menu', Array.isArray(bList) && bList.length > 0, show(bServices));

const notHq = await call(bOwner, 'POST', '/business/branches', { name: 'Side Shop', ownerName: 'X', ownerPhone: newPhone() });
check('A branch owner can’t open branches', notHq.status === 403, show(notHq));
const oldRoute = await call(bOwner, 'POST', '/auth/shops', { shopName: 'Side Shop' });
check('The owner’s open-another-shop route is gone', oldRoute.status === 404, show(oldRoute));
const ownerByTeam = await call(bOwner, 'POST', '/team', { name: 'Partner', phone: newPhone(), role: 'owner' });
check('A branch owner can’t add owners', ownerByTeam.status === 403 && ownerByTeam.body?.error === 'hq_only', show(ownerByTeam));
const sessionAsTicket = await call(null, 'POST', '/signup/join', { ticket: bOwner, shopCode: MANA_CODE, name: 'X' });
check('A session is not a join ticket', sessionAsTicket.status === 401, show(sessionAsTicket));

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

// ─── Join a shop ──────────────────────────────────────────────────────────

const noShop = await call(null, 'GET', '/signup/shops/000000');
check('Unknown shop ID → not found', noShop.status === 404, show(noShop));
const mana = await call(null, 'GET', `/signup/shops/${MANA_CODE}`);
check(
  'Shop ID shows the shop’s name before joining',
  mana.body?.name === 'Mana Wash' && mana.body?.city === 'Hyderabad',
  show(mana),
);

const ravi = newPhone();
const joinTicket = await call(null, 'POST', '/signup/verify', {
  phone: ravi,
  purpose: 'join',
  code: DEV_CODE,
});
check('No live join code yet → must ask for one', joinTicket.status === 410, show(joinTicket));

const raviToken = await askToJoin(ravi, MANA_CODE, 'Ravi');
check('Join request sent', typeof raviToken === 'string');

const status = await call(null, 'POST', '/signup/join/status', { requestToken: raviToken });
check(
  'Request is waiting for the owner',
  status.body?.status === 'pending' && status.body?.shop?.name === 'Mana Wash',
  show(status),
);
const early = await call(null, 'POST', '/signup/join/complete', {
  requestToken: raviToken,
  pin: PIN,
});
check(
  'Can’t set a PIN before approval',
  early.status === 409 && early.body?.error === 'not_approved',
  show(early),
);

const raviRequest = await requestIdFor(manaOwner, ravi);
check('MANA’s owner sees the request', Boolean(raviRequest));
check('Another shop’s owner doesn’t see it', !(await requestIdFor(bOwner, ravi)));
const crossApprove = await call(bOwner, 'POST', `/team/requests/${raviRequest}/approve`);
check('Another shop’s owner can’t approve it', crossApprove.status === 404, show(crossApprove));

const approve = await call(manaOwner, 'POST', `/team/requests/${raviRequest}/approve`);
check('MANA’s owner approves', approve.status === 200, show(approve));
const approvedStatus = await call(null, 'POST', '/signup/join/status', { requestToken: raviToken });
check(
  'Request now shows approved',
  approvedStatus.body?.status === 'approved',
  show(approvedStatus),
);
const approveTwice = await call(manaOwner, 'POST', `/team/requests/${raviRequest}/approve`);
check('Approving twice does nothing', approveTwice.status === 404, show(approveTwice));

const weakJoin = await call(null, 'POST', '/signup/join/complete', {
  requestToken: raviToken,
  pin: '0000',
});
check('Easy PIN refused for the new teammate', weakJoin.status === 400, show(weakJoin));
const done = await call(null, 'POST', '/signup/join/complete', {
  requestToken: raviToken,
  pin: PIN,
});
check(
  'Ravi picks a PIN and is signed in as MANA staff',
  done.body?.user?.role === 'staff' &&
    done.body?.user?.shopId === 'shop_mana' &&
    done.body?.user?.hasPin,
  show(done),
);
const raviSession = done.body.token;
const raviId = done.body.user.id;
const doneAgain = await call(null, 'POST', '/signup/join/complete', {
  requestToken: raviToken,
  pin: '4826',
});
check('The request can’t set a PIN a second time', doneAgain.status === 409, show(doneAgain));
const raviPin = await call(null, 'POST', '/auth/pin/login', { phone: ravi, pin: PIN });
check('Ravi signs in with his PIN next time (joining trusted this phone)', raviPin.body?.user?.id === raviId, show(raviPin));

// Reject and cancel
const sita = newPhone();
const sitaToken = await askToJoin(sita, MANA_CODE, 'Sita');
await call(manaOwner, 'POST', `/team/requests/${await requestIdFor(manaOwner, sita)}/reject`);
const rejected = await call(null, 'POST', '/signup/join/status', { requestToken: sitaToken });
check('Rejected request shows rejected', rejected.body?.status === 'rejected', show(rejected));

const kiran = newPhone();
const kiranToken = await askToJoin(kiran, MANA_CODE, 'Kiran');
await call(null, 'POST', '/signup/join/cancel', { requestToken: kiranToken });
const cancelled = await call(null, 'POST', '/signup/join/status', { requestToken: kiranToken });
check('Cancelled request shows cancelled', cancelled.body?.status === 'cancelled', show(cancelled));
check('Cancelled request leaves the owner’s list', !(await requestIdFor(manaOwner, kiran)));

// One open request per number
const mohan = newPhone();
const mohanFirst = await askToJoin(mohan, MANA_CODE, 'Mohan');
await new Promise((r) => setTimeout(r, 31_000));
await askToJoin(mohan, bCode, 'Mohan');
const firstNow = await call(null, 'POST', '/signup/join/status', { requestToken: mohanFirst });
check(
  'Asking another shop closes the first request',
  firstNow.body?.status === 'cancelled',
  show(firstNow),
);
check(
  'Only the second shop sees Mohan',
  !(await requestIdFor(manaOwner, mohan)) && Boolean(await requestIdFor(bOwner, mohan)),
);

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
check('Ravi’s number is free again', raviStart.body?.next === 'new', show(raviStart));

const raviToB = await askToJoin(ravi, bCode, 'Ravi');
await call(bOwner, 'POST', `/team/requests/${await requestIdFor(bOwner, ravi)}/approve`);
const raviInB = await call(null, 'POST', '/signup/join/complete', {
  requestToken: raviToB,
  pin: PIN,
});
check(
  'Ravi joins the other shop with the same number',
  raviInB.body?.user?.shopId === bShopId,
  show(raviInB),
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
