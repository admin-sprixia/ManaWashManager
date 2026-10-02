// Walks the whole "new number" flow against the local API: starting a new shop, asking to join
// one with its shop ID (approve, reject, cancel), and removing a teammate so their number is free.
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:signup                        (in another)
// Uses fresh random numbers each run, so it can be re-run without a reset.
const API = process.env.API_URL ?? 'http://localhost:8787';
const DEV_CODE = process.env.DEV_CODE ?? '000000';
const PIN = '2580';
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
  const res = await fetch(API + path, {
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
  const byPin = await call(null, 'POST', '/auth/pin/login', { phone, pin: PIN });
  if (byPin.body?.token) return byPin.body;
  await call(null, 'POST', '/auth/code/request', { phone });
  const verified = await call(null, 'POST', '/auth/code/verify', { phone, code: DEV_CODE });
  if (!verified.body?.token)
    throw new Error(`Owner sign-in failed for ${phone}: ${show(verified)}`);
  // Setting a PIN signs out older sessions; carry on with the fresh one it returns.
  const withPin = await call(verified.body.token, 'PUT', '/auth/pin', { pin: PIN });
  if (!withPin.body?.token) throw new Error(`Setting the PIN failed for ${phone}: ${show(withPin)}`);
  return withPin.body;
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

// ─── New shop ─────────────────────────────────────────────────────────────

const ownerPhone = newPhone();
const start = await call(null, 'POST', '/auth/start', { phone: ownerPhone });
check('Unknown number → "new" (start or join a shop)', start.body?.next === 'new', show(start));

const taken = await call(null, 'POST', '/signup/code', { phone: MANA_OWNER, purpose: 'signup' });
check(
  'Sign-up code refused for a number that already has an account',
  taken.status === 409,
  show(taken),
);

const sent = await call(null, 'POST', '/signup/code', { phone: ownerPhone, purpose: 'signup' });
check('Sign-up code sent', sent.body?.sent === true, show(sent));
const again = await call(null, 'POST', '/signup/code', { phone: ownerPhone, purpose: 'signup' });
check(
  'Asking again at once → wait before resending',
  again.status === 429 && again.body?.error === 'too_soon',
  show(again),
);

const wrong = await call(null, 'POST', '/signup/verify', {
  phone: ownerPhone,
  purpose: 'signup',
  code: '111111',
});
check(
  'Wrong code → tries left',
  wrong.status === 401 && wrong.body?.attemptsLeft === 4,
  show(wrong),
);
const wrongPurpose = await call(null, 'POST', '/signup/verify', {
  phone: ownerPhone,
  purpose: 'join',
  code: DEV_CODE,
});
check(
  'A sign-up code can’t be used to join a shop',
  wrongPurpose.status === 410,
  show(wrongPurpose),
);
const verified = await call(null, 'POST', '/signup/verify', {
  phone: ownerPhone,
  purpose: 'signup',
  code: DEV_CODE,
});
check('Right code → sign-up ticket', typeof verified.body?.ticket === 'string', show(verified));
const ticket = verified.body.ticket;
const reused = await call(null, 'POST', '/signup/verify', {
  phone: ownerPhone,
  purpose: 'signup',
  code: DEV_CODE,
});
check('The same code can’t be used twice', reused.status === 410, show(reused));

const weak = await call(null, 'POST', '/signup/shop', {
  ticket,
  pin: '1234',
  name: 'Arun',
  shopName: 'Bubble Wash',
});
check('Easy PIN refused', weak.status === 400 && weak.body?.error === 'weak_pin', show(weak));
const forged = await call(null, 'POST', '/signup/shop', {
  ticket: `${ticket}x`,
  pin: PIN,
  name: 'Arun',
  shopName: 'Bubble Wash',
});
check('Tampered ticket refused', forged.status === 401, show(forged));

const created = await call(null, 'POST', '/signup/shop', {
  ticket,
  pin: PIN,
  name: 'Arun',
  shopName: 'Bubble Wash',
  city: 'Vijayawada',
});
check(
  'Shop created: owner signed in with a PIN, in a new shop',
  created.status === 201 &&
    created.body?.user?.role === 'owner' &&
    created.body?.user?.hasPin &&
    created.body?.user?.shopId !== 'shop_mana',
  show(created),
);
const bOwner = created.body.token;
const bShopId = created.body.user.shopId;

const replay = await call(null, 'POST', '/signup/shop', {
  ticket,
  pin: PIN,
  name: 'Arun',
  shopName: 'Second Shop',
});
check('Same ticket can’t make a second shop', replay.status === 409, show(replay));

const ticketAsSession = await call(ticket, 'GET', '/auth/me');
check('A sign-up ticket is not a session', ticketAsSession.status === 401, show(ticketAsSession));
const sessionAsTicket = await call(null, 'POST', '/signup/shop', {
  ticket: bOwner,
  pin: PIN,
  name: 'X',
  shopName: 'Fake',
});
check('A session is not a sign-up ticket', sessionAsTicket.status === 401, show(sessionAsTicket));

const startAgain = await call(null, 'POST', '/auth/start', { phone: ownerPhone });
check(
  'New owner’s number now goes to the PIN pad',
  startAgain.body?.next === 'pin',
  show(startAgain),
);
const pinLogin = await call(null, 'POST', '/auth/pin/login', { phone: ownerPhone, pin: PIN });
check('New owner signs in with the PIN', pinLogin.body?.user?.shopId === bShopId, show(pinLogin));

const info = await call(bOwner, 'GET', '/shop/info');
check(
  'Shop info: name, city and a 6-digit shop ID',
  info.body?.name === 'Bubble Wash' &&
    info.body?.city === 'Vijayawada' &&
    /^[1-9]\d{5}$/.test(info.body?.code ?? ''),
  show(info),
);
const bCode = info.body.code;
const bTeam = await call(bOwner, 'GET', '/team');
check(
  'New shop’s team is just its owner',
  Array.isArray(bTeam.body) && bTeam.body.length === 1,
  show(bTeam),
);
const bServices = await call(bOwner, 'GET', '/services');
check(
  'New shop sees none of MANA’s services',
  Array.isArray(bServices.body?.services ?? bServices.body) &&
    (bServices.body?.services ?? bServices.body).length === 0,
  show(bServices),
);

// ─── Join a shop ──────────────────────────────────────────────────────────

const manaOwner = (await signInOwner(MANA_OWNER)).token;

const noShop = await call(null, 'GET', '/signup/shops/000000');
check('Unknown shop ID → not found', noShop.status === 404, show(noShop));
const mana = await call(null, 'GET', `/signup/shops/${MANA_CODE}`);
check(
  'Shop ID shows the shop’s name before joining',
  mana.body?.name === 'MANA Car Wash' && mana.body?.city === 'Hyderabad',
  show(mana),
);

const ravi = newPhone();
const signupTicket = await verifiedTicket(ravi, 'signup');
const joinWithSignup = await call(null, 'POST', '/signup/join', {
  ticket: signupTicket,
  shopCode: MANA_CODE,
  name: 'Ravi',
});
check(
  'A sign-up ticket can’t be used to join',
  joinWithSignup.status === 401,
  show(joinWithSignup),
);

const joinTicket = await call(null, 'POST', '/signup/verify', {
  phone: ravi,
  purpose: 'join',
  code: DEV_CODE,
});
check('No live join code yet → must ask for one', joinTicket.status === 410, show(joinTicket));

await new Promise((r) => setTimeout(r, 31_000)); // resend wait for the same number
const raviToken = await askToJoin(ravi, MANA_CODE, 'Ravi');
check('Join request sent', typeof raviToken === 'string');

const status = await call(null, 'POST', '/signup/join/status', { requestToken: raviToken });
check(
  'Request is waiting for the owner',
  status.body?.status === 'pending' && status.body?.shop?.name === 'MANA Car Wash',
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
check('Ravi signs in with his PIN next time', raviPin.body?.user?.id === raviId, show(raviPin));

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
check('MANA can’t add him back while he’s in another shop', reAdd.status === 409, show(reAdd));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
