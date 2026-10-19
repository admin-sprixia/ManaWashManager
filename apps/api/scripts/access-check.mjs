// Who can do what, proved against the local API: HQ opening, pausing and closing branches; the
// owner, manager and staff roles; PIN resets (owner → team, HQ → owners); trusted phones; and the
// 6-digit PIN for owners and managers.
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:access                        (in another)
// HQ is the seeded MANA owner. Each run opens a fresh branch with new numbers, so it can be re-run
// without a reset.
import { randomBytes, webcrypto } from 'node:crypto';
import { API, apiFetch, d1Rows, d1Run, DEV_CODE, requestCode, signIn } from './lib/target.mjs';

const PIN = '258025';
const HQ_PHONE = '9100000000';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}

/** `device` is the phone's key; 'none' sends none, which the API refuses for anything that signs in. */
async function call(token, method, path, body, device) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (device) headers['x-device-key'] = device;
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

const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
const newPhone = () => `6${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const newDevice = () => `phone_${randomBytes(20).toString('hex')}`;
const id = (p) => `${p}${Math.random().toString(36).slice(2, 12)}`;
const plate = () => `AP39${Math.random().toString(36).slice(2, 4).toUpperCase()}${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`;

/** Same format as the API's lib/pin.ts. */
async function hashPin(pin) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
  return `100000$${Buffer.from(salt).toString('base64')}$${Buffer.from(bits).toString('base64')}`;
}

async function session(phone) {
  const r = await signIn(phone, PIN);
  if (!r.body?.token) throw new Error(`Sign-in failed for ${phone}: ${show(r)}`);
  return r.body;
}

/** A wash the branch can price: its first vehicle size with a hub price. */
async function startWash(token) {
  const types = await call(token, 'GET', '/services/vehicle-types');
  for (const vt of types.body ?? []) {
    const prices = await call(token, 'GET', `/services/prices?vehicleTypeId=${vt.id}&mode=hub`);
    const p = (prices.body ?? []).find((x) => x.price > 0);
    if (!p) continue;
    return call(token, 'POST', '/jobs/start', {
      id: id('job'),
      customer: { phone: newPhone(), name: 'Access Check' },
      registrationNumber: plate(),
      vehicleTypeId: vt.id,
      services: [{ serviceId: p.serviceId, quantity: 1 }],
      discount: 0,
    });
  }
  throw new Error('The new branch has no priced service');
}

// ─── Setup: HQ opens a branch ─────────────────────────────────────────────

const hq = (await session(HQ_PHONE)).token;
const ownerPhone = newPhone();
const ongole = { pincode: '523001', latitude: 15.5057, longitude: 80.0499, town: null };
const plan = (await call(hq, 'POST', '/business/branches/preview', ongole)).body?.plan;
// HQ picks the services it sells while opening it: here, all of HQ's.
const hqMenu = ((await call(hq, 'GET', '/business/catalog')).body?.services ?? []).filter((s) => s.active).map((s) => s.id);
const opened = await call(hq, 'POST', '/business/branches', { ...ongole, ownerName: 'Lakshmi', ownerPhone, confirmed: (plan?.checks ?? []).map((k) => k.kind), menu: hqMenu });
check('HQ opens a branch', opened.status === 201, show(opened));
const branchId = opened.body.id;
const branchCode = opened.body.code;

// ─── 6-digit PINs and the WhatsApp code for owners ────────────────────────

let r = await call(null, 'POST', '/auth/start', { phone: ownerPhone });
check('A new owner is asked for the WhatsApp code', r.body?.next === 'code', show(r));
await requestCode(ownerPhone);
r = await call(null, 'POST', '/auth/code/verify', { phone: ownerPhone, code: DEV_CODE });
check('…which signs them in to choose a PIN', !!r.body?.token && r.body.user?.hasPin === false, show(r));
const firstToken = r.body.token;
r = await call(firstToken, 'PUT', '/auth/pin', { pin: '2580' });
check('An owner can’t choose a 4-digit PIN', r.status === 400 && /6-digit/.test(r.body?.message ?? ''), show(r));
r = await call(firstToken, 'PUT', '/auth/pin', { pin: PIN });
check('…but can choose a 6-digit one', !!r.body?.token, show(r));
let owner = r.body.token;
const ownerId = r.body.user.id;

// ─── Roles ────────────────────────────────────────────────────────────────

const managerPhone = newPhone();
const staffPhone = newPhone();
r = await call(owner, 'POST', '/team', { name: 'Mahesh', phone: managerPhone, role: 'manager' });
check('The owner adds a manager', r.status === 201, show(r));
const managerId = r.body?.id;
r = await call(owner, 'POST', '/team', { name: 'Partner', phone: newPhone(), role: 'owner' });
check('The owner can’t add an owner (HQ only)', r.status === 403 && r.body?.error === 'hq_only', show(r));

r = await call(null, 'POST', '/auth/start', { phone: managerPhone });
check('The new manager confirms with a WhatsApp code too', r.body?.next === 'code', show(r));
await requestCode(managerPhone);
r = await call(null, 'POST', '/auth/code/verify', { phone: managerPhone, code: DEV_CODE });
const managerFirst = r.body?.token;
r = await call(managerFirst, 'PUT', '/auth/pin', { pin: '1593' });
check('A manager can’t choose a 4-digit PIN', r.status === 400, show(r));
r = await call(managerFirst, 'PUT', '/auth/pin', { pin: PIN });
let manager = r.body?.token;
check('The manager signs in with 6 digits', !!manager, show(r));

r = await call(manager, 'GET', '/team');
check('The manager sees the team', r.status === 200 && Array.isArray(r.body), show(r));
r = await call(manager, 'POST', '/team', { name: 'Suresh', phone: staffPhone, role: 'staff' });
check('The manager adds staff', r.status === 201, show(r));
const staffId = r.body?.id;
r = await call(manager, 'POST', '/team', { name: 'Another', phone: newPhone(), role: 'manager' });
check('The manager can’t add managers', r.status === 403, show(r));
r = await call(manager, 'PATCH', `/team/${staffId}`, { role: 'manager' });
check('The manager can’t promote staff to manager', r.status === 403, show(r));
r = await call(manager, 'PATCH', `/team/${ownerId}`, { active: false });
check('The manager can’t turn the owner off', r.status === 403, show(r));
r = await call(manager, 'PATCH', `/team/${managerId}`, { active: false });
check('The manager can’t change their own access', r.status === 403 || r.status === 400, show(r));
r = await call(manager, 'GET', '/team');
check('The manager sees the team', r.status === 200 && Array.isArray(r.body), show(r));
r = await call(manager, 'GET', '/reports/audit');
check('The manager can’t open reports (owner only)', r.status === 403 || r.status === 404, show(r));

const staff = (await session(staffPhone)).token;
r = await call(staff, 'GET', '/team');
check('Staff can’t open the team', r.status === 403, show(r));

// Money fixes stay with the owner.
const wash = await startWash(manager);
check('The manager starts a wash', wash.status === 201 || wash.status === 200, show(wash));
const jobId = wash.body?.id ?? wash.body?.job?.id;
await call(manager, 'PATCH', `/jobs/${jobId}/status`, { status: 'washing' });
await call(manager, 'PATCH', `/jobs/${jobId}/status`, { status: 'ready' });
r = await call(manager, 'POST', `/jobs/${jobId}/pay`, { paymentMethod: 'cash' });
check('…and takes payment', r.status === 200, show(r));
r = await call(manager, 'POST', `/jobs/${jobId}/void`, { reason: 'Testing money fixes' });
check('The manager can’t void a paid wash', r.status === 403, show(r));
r = await call(manager, 'PATCH', `/jobs/${jobId}/payment-method`, { paymentMethod: 'upi', reason: 'Testing money fixes' });
check('The manager can’t change how it was paid', r.status === 403, show(r));

// ─── Attendance ───────────────────────────────────────────────────────────

const istDay = (daysAgo) => new Date(Date.now() + 5.5 * 3600_000 - daysAgo * 86_400_000).toISOString().slice(0, 10);
const [todayIst, yesterdayIst, threeDaysAgo, tomorrowIst] = [istDay(0), istDay(1), istDay(3), istDay(-1)];
r = await call(manager, 'PUT', '/attendance', { userId: staffId, date: todayIst, status: 'present' });
check('The manager marks staff for today', r.status === 200, show(r));
r = await call(manager, 'PUT', '/attendance', { userId: staffId, date: yesterdayIst, status: 'half' });
check('…and for a forgotten yesterday', r.status === 200, show(r));
r = await call(manager, 'PUT', '/attendance', { userId: staffId, date: threeDaysAgo, status: 'present' });
check('…but not older days (owner only)', r.status === 400 && r.body?.error === 'date_not_allowed', show(r));
r = await call(manager, 'PUT', '/attendance', { userId: managerId, date: todayIst, status: 'present' });
check('The manager can’t mark their own day', r.status === 403, show(r));
r = await call(manager, 'PUT', '/attendance', { userId: ownerId, date: todayIst, status: 'present' });
check('…nor the owner’s', r.status === 403, show(r));
r = await call(owner, 'PUT', '/attendance', { userId: managerId, date: threeDaysAgo, status: 'absent' });
check('The owner marks the manager, even an older day', r.status === 200, show(r));
r = await call(owner, 'PUT', '/attendance', { userId: ownerId, date: todayIst, status: 'present' });
check('The owner marks their own day (nobody above them does)', r.status === 200, show(r));
await call(owner, 'PUT', '/attendance', { userId: ownerId, date: todayIst, status: null });
r = await call(owner, 'PUT', '/attendance', { userId: staffId, date: tomorrowIst, status: 'present' });
check('Nobody marks a future day', r.status === 400 && r.body?.error === 'future_date', show(r));
r = await call(staff, 'PUT', '/attendance', { userId: staffId, date: todayIst, status: 'present' });
check('Staff can’t mark attendance', r.status === 403, show(r));
r = await call(staff, 'GET', `/attendance?date=${todayIst}`);
check('…or open the sheet', r.status === 403, show(r));
r = await call(manager, 'GET', `/attendance?date=${todayIst}`);
const managerSheet = r.body?.rows ?? [];
check(
  'The manager’s sheet says whom they can mark (staff yes, the owner no) and leaves out their own day',
  r.status === 200 &&
    managerSheet.find((x) => x.userId === staffId)?.canMark === true &&
    managerSheet.find((x) => x.userId === ownerId)?.canMark === false &&
    !managerSheet.some((x) => x.userId === managerId),
  show(r),
);
r = await call(manager, 'GET', `/attendance?date=${threeDaysAgo}`);
check('An older day is locked for the manager, with the reason', r.status === 200 && typeof r.body?.locked === 'string' && r.body.rows.every((x) => !x.canMark), show(r));
r = await call(owner, 'GET', `/attendance/summary?month=${todayIst.slice(0, 7)}`);
const staffMonth = r.body?.people?.find((p) => p.userId === staffId);
const sameMonth = yesterdayIst.slice(0, 7) === todayIst.slice(0, 7);
check(
  'The month summary counts each person’s days (a half day is 0.5) and spots absences',
  r.status === 200 && staffMonth?.present === 1 && (sameMonth ? staffMonth?.half === 1 && staffMonth?.daysWorked === 1.5 && staffMonth?.noAbsences === false : staffMonth?.noAbsences === true),
  show(r),
);
r = await call(owner, 'PUT', '/attendance', { userId: staffId, date: todayIst, status: null });
check('Clearing a day', r.status === 200, show(r));

// ─── PIN resets ───────────────────────────────────────────────────────────

r = await call(manager, 'POST', `/team/${ownerId}/reset-pin`);
check('The manager can’t reset the owner’s PIN', r.status === 403, show(r));
r = await call(manager, 'POST', `/team/${staffId}/reset-pin`);
check('The manager resets staff’s PIN', r.status === 200, show(r));
r = await call(staff, 'GET', '/auth/me');
check('…which signs the staff member out', r.status === 401, show(r));
r = await call(null, 'POST', '/auth/start', { phone: staffPhone });
check('…and they confirm with a WhatsApp code, not a PIN', r.body?.next === 'code', show(r));

r = await call(owner, 'POST', `/team/${managerId}/reset-pin`);
check('The owner resets the manager’s PIN', r.status === 200, show(r));
r = await call(null, 'POST', '/auth/pin/login', { phone: managerPhone, pin: PIN });
check('…the old PIN no longer works', r.status !== 200, show(r));
r = await call(null, 'POST', '/auth/start', { phone: managerPhone });
check('…the phone isn’t trusted any more either', r.body?.next === 'code', show(r));
await requestCode(managerPhone);
r = await call(null, 'POST', '/auth/code/verify', { phone: managerPhone, code: DEV_CODE });
check('…and after the code they’re told who reset it', r.body?.resetBy?.by === 'Lakshmi (Owner)', show(r));
r = await call(r.body?.token, 'PUT', '/auth/pin', { pin: PIN });
manager = r.body?.token;
check('…then choose a new PIN', !!manager, show(r));
const logged = d1Rows(`SELECT by_label, shop_id FROM pin_resets WHERE phone = '${managerPhone}'`);
check('Every reset is logged with who did it', logged.length === 1 && logged[0].shop_id === branchId, JSON.stringify(logged));

r = await call(owner, 'POST', `/team/${ownerId}/reset-pin`);
check('Nobody resets their own PIN from Team', r.status === 400, show(r));
r = await call(hq, 'POST', `/business/branches/${branchId}/team/${ownerId}/reset-pin`);
check('HQ resets the owner’s PIN', r.status === 200, show(r));
r = await call(owner, 'GET', '/auth/me');
check('…which signs the owner out', r.status === 401, show(r));
await requestCode(ownerPhone);
r = await call(null, 'POST', '/auth/code/verify', { phone: ownerPhone, code: DEV_CODE });
check('…and tells them HQ did it', /Mana Wash HQ/.test(r.body?.resetBy?.by ?? ''), show(r));
owner = (await call(r.body?.token, 'PUT', '/auth/pin', { pin: PIN })).body?.token;

r = await call(hq, 'GET', `/business/branches/${branchId}/team`);
const hqTeam = r.body?.team ?? [];
check(
  'HQ sees the branch’s managers and staff (not owners) to reset them',
  r.status === 200 && hqTeam.some((m) => m.id === staffId && m.role === 'staff') && hqTeam.some((m) => m.id === managerId) && !hqTeam.some((m) => m.id === ownerId),
  show(r),
);
r = await call(owner, 'GET', `/business/branches/${branchId}/team`);
check('…an owner who isn’t HQ can’t', r.status === 403, show(r));

// ─── Trusted phones ───────────────────────────────────────────────────────

const newPhoneKey = newDevice();
r = await call(null, 'POST', '/auth/start', { phone: managerPhone }, newPhoneKey);
check('On a new phone, the PIN alone isn’t enough', r.body?.next === 'verify_device', show(r));
const before = d1Rows(`SELECT pin_failed_attempts FROM users WHERE id = '${managerId}'`)[0];
r = await call(null, 'POST', '/auth/pin/login', { phone: managerPhone, pin: '000000' }, newPhoneKey);
check('A PIN from an unknown phone is refused before it’s checked', r.status === 403 && r.body?.error === 'device_not_trusted', show(r));
const after = d1Rows(`SELECT pin_failed_attempts FROM users WHERE id = '${managerId}'`)[0];
check('…so it uses up no tries', after?.pin_failed_attempts === before?.pin_failed_attempts, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
r = await call(null, 'POST', '/auth/pin/login', { phone: managerPhone, pin: PIN }, 'none');
check('An app that sends no phone key can’t use the PIN', r.status === 403, show(r));
r = await call(null, 'POST', '/auth/code/verify', { phone: managerPhone, code: DEV_CODE, purpose: 'reset' }, 'none');
check('…nor a WhatsApp code: every session is tied to a phone', r.status === 400 && r.body?.error === 'device_key_required', show(r));
await requestCode(managerPhone);
r = await call(null, 'POST', '/auth/code/verify', { phone: managerPhone, code: DEV_CODE, purpose: 'device' }, newPhoneKey);
check('The WhatsApp code trusts the new phone (and keeps the PIN)', r.body?.next === 'pin', show(r));
r = await call(null, 'POST', '/auth/pin/login', { phone: managerPhone, pin: PIN }, newPhoneKey);
check('…then the PIN works on it', !!r.body?.token, show(r));
const onNewPhone = r.body?.token;
r = await call(null, 'POST', '/auth/start', { phone: managerPhone }, newPhoneKey);
check('…and next time it goes straight to the PIN', r.body?.next === 'pin', show(r));
r = await call(onNewPhone, 'POST', '/auth/signout', undefined, newPhoneKey);
check('Signing out', r.status === 200, show(r));
r = await call(null, 'POST', '/auth/start', { phone: managerPhone }, newPhoneKey);
check('…stops trusting that phone', r.body?.next === 'verify_device', show(r));

// ─── Forgot PIN: owners, managers and HQ need a phone they've used ────────

/** A WhatsApp code from `device`, waiting out the resend timer if an earlier one was too recent. */
async function codeFrom(phone, purpose, device) {
  let res = await call(null, 'POST', '/auth/code/request', { phone, purpose }, device);
  if (res.body?.error === 'too_soon') {
    await new Promise((done) => setTimeout(done, (res.body.retryAfter + 1) * 1000));
    res = await call(null, 'POST', '/auth/code/request', { phone, purpose }, device);
  }
  return res;
}

const strangerPhone = newDevice();
r = await codeFrom(managerPhone, 'reset', strangerPhone);
check(
  'A manager can’t reset their own PIN by WhatsApp on a phone they’ve never used (no code is even sent)',
  r.status === 403 && r.body?.error === 'reset_needs_known_phone',
  show(r),
);
r = await codeFrom(HQ_PHONE, 'reset', strangerPhone);
check('…nor can HQ', r.status === 403 && r.body?.error === 'reset_needs_known_phone', show(r));
await codeFrom(managerPhone, 'device', strangerPhone);
r = await call(null, 'POST', '/auth/code/verify', { phone: managerPhone, code: DEV_CODE, purpose: 'device' }, strangerPhone);
check('A SIM swap can confirm the number on a new phone…', r.body?.next === 'pin', show(r));
r = await codeFrom(managerPhone, 'reset', strangerPhone);
check('…but that alone still can’t reset the PIN there', r.status === 403 && r.body?.error === 'reset_needs_known_phone', show(r));
r = await call(null, 'POST', '/auth/code/verify', { phone: managerPhone, code: DEV_CODE, purpose: 'reset' }, strangerPhone);
check('…not even straight at the verify step', r.status === 403 && r.body?.error === 'reset_needs_known_phone', show(r));
r = await codeFrom(managerPhone, 'reset');
check('On a phone where their PIN has been used, the manager can get a reset code', r.status === 200 && r.body?.sent === true, show(r));

const STAFF_PIN = '1593';
const STAFF_PIN_2 = '8264';
r = await signIn(staffPhone, STAFF_PIN);
check('Staff choose a 4-digit PIN', !!r.body?.token, show(r));
const staffPhoneA = newDevice();
r = await codeFrom(staffPhone, 'reset', staffPhoneA);
check('Staff can reset their own PIN by WhatsApp on any phone', r.status === 200, show(r));
r = await call(null, 'POST', '/auth/code/verify', { phone: staffPhone, code: DEV_CODE, purpose: 'reset' }, staffPhoneA);
r = await call(r.body?.token, 'PUT', '/auth/pin', { pin: STAFF_PIN_2 }, staffPhoneA);
let staffOnA = r.body?.token;
check('…and choose a new one', !!staffOnA, show(r));

// ─── Sessions belong to a phone; Your phones ──────────────────────────────

r = await call(staffOnA, 'GET', '/auth/me');
check('A session copied to another phone (without its key) doesn’t work', r.status === 401, show(r));
r = await call(staffOnA, 'GET', '/auth/me', undefined, staffPhoneA);
check('…it only works from the phone it was issued to', r.status === 200, show(r));

r = await call(null, 'POST', '/auth/pin/login', { phone: staffPhone, pin: STAFF_PIN_2 });
const staffOnScript = r.body?.token;
check('The same person signs in on a second phone', !!staffOnScript, show(r));
r = await call(staffOnA, 'GET', '/auth/devices', undefined, staffPhoneA);
const listed = r.body?.devices ?? [];
check(
  'Your phones lists both, marking this one',
  r.status === 200 && listed.length === 2 && listed.filter((d) => d.current).length === 1,
  show(r),
);
const other = listed.find((d) => !d.current);
r = await call(staffOnA, 'DELETE', `/auth/devices/${listed.find((d) => d.current)?.id}`, undefined, staffPhoneA);
check('This phone isn’t removed from the list (that’s Sign out)', r.status === 400 && r.body?.error === 'this_phone', show(r));
r = await call(staffOnA, 'DELETE', `/auth/devices/${other?.id}`, undefined, staffPhoneA);
check('Signing out the other phone from Your phones', r.status === 200, show(r));
r = await call(staffOnScript, 'GET', '/jobs/today');
check('…ends its session at once', r.status === 401 && r.body?.error === 'session_revoked', show(r));
r = await call(null, 'POST', '/auth/start', { phone: staffPhone });
check('…and it needs a WhatsApp code to come back', r.body?.next === 'verify_device', show(r));

r = await signIn(staffPhone, STAFF_PIN_2);
const staffBack = r.body?.token;
check('Back on the second phone with a code and the PIN', !!staffBack, show(r));
r = await call(staffOnA, 'POST', '/auth/devices/sign-out-others', undefined, staffPhoneA);
const staffStays = r.body?.token;
check('Sign out all other phones keeps this one signed in', !!staffStays, show(r));
r = await call(staffBack, 'GET', '/jobs/today');
check('…signs the others out', r.status === 401, show(r));
r = await call(staffStays, 'GET', '/auth/devices', undefined, staffPhoneA);
check('…and forgets them', r.body?.devices?.length === 1 && r.body.devices[0].current === true, show(r));
staffOnA = staffStays;

// ─── Each lock lasts longer ───────────────────────────────────────────────

async function lockOut() {
  let res;
  for (let i = 0; i < 5; i++) res = await call(null, 'POST', '/auth/pin/login', { phone: staffPhone, pin: '9999' }, staffPhoneA);
  return res;
}
const minutesLeft = (res) => Math.round((new Date(res.body?.lockedUntil ?? 0).getTime() - Date.now()) / 60_000);
r = await lockOut();
check('5 wrong PINs lock it for 15 minutes', r.status === 423 && Math.abs(minutesLeft(r) - 15) <= 1, show(r));
d1Run(`UPDATE users SET pin_locked_until = '2000-01-01T00:00:00.000+00:00' WHERE phone = '${staffPhone}'`);
r = await lockOut();
check('…locked again straight after: 1 hour', r.status === 423 && Math.abs(minutesLeft(r) - 60) <= 1, show(r));
d1Run(`UPDATE users SET pin_locked_until = '2000-01-01T00:00:00.000+00:00' WHERE phone = '${staffPhone}'`);
r = await lockOut();
check('…and then a day', r.status === 423 && Math.abs(minutesLeft(r) - 24 * 60) <= 1, show(r));
d1Run(`UPDATE users SET pin_locked_until = '2000-01-01T00:00:00.000+00:00' WHERE phone = '${staffPhone}'`);
r = await call(null, 'POST', '/auth/pin/login', { phone: staffPhone, pin: STAFF_PIN_2 }, staffPhoneA);
const lockCount = d1Rows(`SELECT pin_lock_count FROM users WHERE phone = '${staffPhone}'`)[0]?.pin_lock_count;
check('The right PIN starts the count again', !!r.body?.token && lockCount === 0, `${show(r)} count=${lockCount}`);

// ─── Owners on an old short PIN ───────────────────────────────────────────

const legacyPhone = newPhone();
r = await call(hq, 'POST', `/business/branches/${branchId}/owners`, { name: 'Old PIN Owner', phone: legacyPhone });
check('HQ adds a second owner', r.status === 201, show(r));
await signIn(legacyPhone, '135790');
// As if their PIN were set before 6 digits were required.
const LEGACY_PIN = '1357';
d1Run(`UPDATE users SET pin_hash = '${await hashPin(LEGACY_PIN)}', pin_digits = 4 WHERE phone = '${legacyPhone}'`);
r = await call(null, 'POST', '/auth/pin/login', { phone: legacyPhone, pin: LEGACY_PIN });
check('An owner on a 4-digit PIN can still sign in', !!r.body?.token, show(r));
check('…and is told to choose 6 digits', r.body?.user?.pinUpgradeRequired === true, show(r));
const legacy = r.body?.token;
r = await call(legacy, 'GET', '/jobs/today');
check('…before they can do anything else', r.status === 403 && r.body?.error === 'pin_upgrade_required', show(r));
r = await call(legacy, 'PUT', '/auth/pin', { pin: '2468', currentPin: LEGACY_PIN });
check('…and not another short one', r.status === 400, show(r));
r = await call(legacy, 'PUT', '/auth/pin', { pin: '246813', currentPin: LEGACY_PIN });
check('Choosing a 6-digit PIN', !!r.body?.token && r.body.user?.pinUpgradeRequired === false, show(r));
r = await call(r.body?.token, 'GET', '/jobs/today');
check('…lets them work again', r.status === 200, show(r));

// ─── Branch status ────────────────────────────────────────────────────────

r = await call(owner, 'PATCH', `/business/branches/${branchId}/status`, { status: 'paused', reason: 'Owner tried' });
check('A branch owner can’t pause branches', r.status === 403, show(r));
r = await call(hq, 'PATCH', `/business/branches/${branchId}/status`, { status: 'paused' });
check('HQ must say why it pauses a branch', r.status === 400, show(r));

const openWash = await startWash(owner);
const openJobId = openWash.body?.id ?? openWash.body?.job?.id;
r = await call(hq, 'PATCH', `/business/branches/${branchId}/status`, { status: 'paused', reason: 'Royalty overdue' });
check('HQ pauses the branch', r.status === 200 && r.body?.changed === true, show(r));
r = await startWash(owner);
check('Paused: no new washes', r.status === 403 && r.body?.error === 'branch_paused' && /Royalty overdue/.test(r.body?.message ?? ''), show(r));
r = await call(owner, 'GET', '/jobs/today');
check('Paused: the team can still see everything', r.status === 200, show(r));
r = await call(owner, 'GET', '/shop/info');
check('Paused: the team’s phones are told why', r.body?.status === 'paused' && r.body?.statusReason === 'Royalty overdue', show(r));
await call(owner, 'PATCH', `/jobs/${openJobId}/status`, { status: 'washing' });
await call(owner, 'PATCH', `/jobs/${openJobId}/status`, { status: 'ready' });
r = await call(owner, 'POST', `/jobs/${openJobId}/pay`, { paymentMethod: 'cash' });
check('Paused: a wash already open can be finished and paid', r.status === 200, show(r));
r = await call(null, 'POST', '/auth/start', { phone: staffPhone });
check('Paused: the team can still sign in', r.body?.next !== undefined, show(r));
r = await call(owner, 'POST', '/team', { name: 'New Washer', phone: newPhone() });
check('Paused: nobody new is added to the team', r.status === 403 && r.body?.error === 'branch_paused', show(r));

r = await call(hq, 'PATCH', `/business/branches/${branchId}/status`, { status: 'active' });
check('HQ reopens it', r.status === 200 && r.body?.changed === true, show(r));
r = await startWash(owner);
check('Active again: new washes work', r.status === 200 || r.status === 201, show(r));

r = await call(hq, 'PATCH', '/business/branches/shop_mana/status', { status: 'closed', reason: 'Testing' });
check('HQ can’t close the branch it’s signed in to', r.status === 400 && r.body?.error === 'cannot_close_own', show(r));
r = await call(hq, 'PATCH', `/business/branches/${branchId}/status`, { status: 'closed', reason: 'Franchise ended' });
check('HQ closes the branch', r.status === 200, show(r));
r = await call(owner, 'GET', '/jobs/today');
check('Closed: signed-in phones stop working', r.status === 403 && r.body?.error === 'branch_closed', show(r));
r = await call(null, 'POST', '/auth/start', { phone: ownerPhone });
check('Closed: nobody can sign in', r.status === 403 && r.body?.error === 'branch_closed', show(r));

r = await call(hq, 'GET', `/business/branches/${branchId}/status`);
check(
  'Every change is kept, newest first, with who and why',
  r.body?.history?.map((h) => h.status).join(',') === 'closed,active,paused' && r.body.history[2].reason === 'Royalty overdue' && r.body.history[0].changedByPhone === HQ_PHONE,
  show(r),
);
r = await call(hq, 'GET', '/business/overview');
const row = r.body?.branches?.find((b) => b.id === branchId);
check('HQ’s overview lists every branch with its status and numbers', row?.status === 'closed' && row.today?.washes >= 2, show(r));
r = await call(owner, 'GET', '/business/overview');
check('A branch owner can’t open the HQ overview', r.status === 403 || r.status === 401, show(r));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
