// Walks the MANA Car Wash app against the local API: prices and service area before signing in,
// a new number asking for service, the owner approving it, the customer signing in and seeing only
// their own cars, washes and photos, and signing out / deleting the account.
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:customer-app                  (in another)
// Uses fresh random numbers each run, so it can be re-run without a reset. Shop A is the seeded
// MANA shop (listed in the app); shop C ("Other Wash") is added here and starts unlisted.
import { API, apiFetch, d1Rows, d1Run } from './lib/target.mjs';

const DEV_CODE = process.env.DEV_CODE ?? '000000';
const PIN = '2580';
const KOVUR = { latitude: 14.5, longitude: 79.99 };
const HYDERABAD = { latitude: 17.385, longitude: 78.4867 };

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}

async function call(token, method, path, body) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await apiFetch(API + path, { method, headers, body: payload });
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, body: null, type, bytes };
  }
  return { status: res.status, body: await res.json(), type };
}

const show = (r) => `${r.status} ${JSON.stringify(r.body)?.slice(0, 300)}`;
const newPhone = () => `6${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const id = (p) => `${p}${Math.random().toString(36).slice(2, 12)}`;

/**
 * Asks for an app code, then moves it an hour back so the resend wait and the per-address hourly
 * cap (shared with the sign-up checks) don't trip on the next one. The code itself stays valid.
 */
async function sendCode(phone) {
  const sent = await call(null, 'POST', '/c/auth/code', { phone });
  d1Run(
    `UPDATE signup_codes SET created_at = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now', '-2 hours') WHERE phone = '${phone}';`,
  );
  return sent;
}

async function verify(phone) {
  const sent = await sendCode(phone);
  if (!sent.body?.sent) throw new Error(`code for ${phone}: ${show(sent)}`);
  return call(null, 'POST', '/c/auth/verify', { phone, code: DEV_CODE });
}

async function signInOwner(phone) {
  const byPin = await call(null, 'POST', '/auth/pin/login', { phone, pin: PIN });
  if (byPin.body?.token) return byPin.body;
  await call(null, 'POST', '/auth/code/request', { phone });
  const verified = await call(null, 'POST', '/auth/code/verify', { phone, code: DEV_CODE });
  if (!verified.body?.token) throw new Error(`Owner sign-in failed for ${phone}: ${show(verified)}`);
  const withPin = await call(verified.body.token, 'PUT', '/auth/pin', { pin: PIN });
  if (!withPin.body?.token) throw new Error(`Setting the PIN failed for ${phone}: ${show(withPin)}`);
  return withPin.body;
}

async function washFor(token, phone, plate, { vehicleTypeId, serviceId }) {
  const jobId = id('job');
  const started = await call(token, 'POST', '/jobs/start', {
    id: jobId,
    customer: { phone, name: 'Lakshmi' },
    registrationNumber: plate,
    vehicleTypeId,
    services: [{ serviceId, quantity: 1 }],
    discount: 0,
  });
  if (started.status !== 200 && started.status !== 201) throw new Error(`wash for ${phone}: ${show(started)}`);
  const photoId = id('pho');
  const form = new FormData();
  form.append('id', photoId);
  form.append('jobId', jobId);
  form.append('kind', 'after');
  form.append('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'p.jpg');
  const photo = await call(token, 'POST', '/photos', form);
  if (photo.status !== 200 && photo.status !== 201) throw new Error(`photo for ${jobId}: ${show(photo)}`);
  return { jobId, photoId };
}

// ─── Setup: shop C, unlisted, with its own owner and menu ─────────────────

d1Run(
  "INSERT OR IGNORE INTO shops (id, code, name, city, plan) VALUES ('shop_test_c', '900003', 'Other Wash', 'Nellore', 'trial');" +
    "UPDATE shops SET in_customer_app = 0, trial_ends_at = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now', '+14 days') WHERE id = 'shop_test_c';" +
    "INSERT OR IGNORE INTO users (id, shop_id, name, phone, role) VALUES ('user_c_owner', 'shop_test_c', 'C Owner', '9200000003', 'owner');" +
    "INSERT OR IGNORE INTO vehicle_types (id, shop_id, name, category, sort_order) VALUES ('vt_c_sedan', 'shop_test_c', 'Sedan', 'car', 0);" +
    "INSERT OR IGNORE INTO services (id, shop_id, name, applies_to, sort_order) VALUES ('svc_c_wash', 'shop_test_c', 'Basic Wash', 'car', 0);" +
    "INSERT OR IGNORE INTO service_prices (id, shop_id, service_id, vehicle_type_id, price) VALUES ('sp_c_wash_sedan', 'shop_test_c', 'svc_c_wash', 'vt_c_sedan', 30000);",
);
const A = (await signInOwner('9100000000')).token;
const C = (await signInOwner('9200000003')).token;
// Staff sign in with a PIN only; give the seeded staff the owner's.
d1Run("UPDATE users SET pin_hash = (SELECT pin_hash FROM users WHERE id = 'user_owner_seed') WHERE id = 'user_staff_seed';");
const staffLogin = await call(null, 'POST', '/auth/pin/login', { phone: '9100000001', pin: PIN });
if (!staffLogin.body?.token) throw new Error(`Staff sign-in failed: ${show(staffLogin)}`);
const staffA = staffLogin.body.token;
const A_MENU = { vehicleTypeId: 'vt_sedan', serviceId: 'svc_complete_wash' };
const C_MENU = { vehicleTypeId: 'vt_c_sedan', serviceId: 'svc_c_wash' };

// ─── Before signing in ────────────────────────────────────────────────────

let r = await call(null, 'GET', '/c/prices/from');
check(
  'Starting prices: a car and a bike price above zero',
  r.status === 200 && r.body?.car > 0 && r.body?.bike > 0,
  show(r),
);
r = await call(null, 'GET', '/c/service-areas');
const areaIds = (r.body?.areas ?? []).map((a) => a.id);
check('Areas list shows the listed branch’s areas', areaIds.includes('area_kovur'), show(r));
check('Unlisted shops’ areas aren’t shown', !(r.body?.areas ?? []).some((a) => a.branch?.name === 'Other Wash'));

r = await call(null, 'POST', '/c/service-area/check', { location: KOVUR });
check('Near the hub → served by radius', r.body?.served === true && r.body?.via === 'radius', show(r));
r = await call(null, 'POST', '/c/service-area/check', { areaId: 'area_nellore' });
check('Picked area → served by area', r.body?.served === true && r.body?.via === 'area', show(r));
r = await call(null, 'POST', '/c/service-area/check', { location: HYDERABAD });
check('Far away → not served yet', r.status === 200 && r.body?.served === false, show(r));
r = await call(null, 'POST', '/c/service-area/check', {});
check('Neither location nor area → 400', r.status === 400, show(r));

// ─── A new number asks for service ────────────────────────────────────────

const newcomer = newPhone();
await sendCode(newcomer);
r = await call(null, 'POST', '/c/auth/verify', { phone: newcomer, code: '111111' });
check('Wrong code → tries left', r.status === 401 && r.body?.attemptsLeft === 4, show(r));
r = await call(null, 'POST', '/c/auth/verify', { phone: newcomer, code: DEV_CODE });
check('Unknown number → may request service (ticket, no token)', r.body?.status === 'request' && !!r.body?.ticket && !r.body?.token, show(r));
const ticket = r.body?.ticket;
r = await call(null, 'POST', '/c/auth/verify', { phone: newcomer, code: DEV_CODE });
check('A code works only once', r.status === 410, show(r));

const requestBody = {
  ticket,
  name: 'Lakshmi',
  location: KOVUR,
  address: 'Flat 302, Sai Residency, Kovur',
  placeKind: 'apartment',
  placeName: 'Sai Residency',
  cars: 1,
  bikes: 1,
  preferredTime: 'early_morning',
};
r = await call(null, 'POST', '/c/service-requests', { ...requestBody, cars: 0, bikes: 0 });
check('No vehicles → 400', r.status === 400, show(r));
r = await call(null, 'POST', '/c/service-requests', { ...requestBody, ticket: 'not-a-ticket' });
check('Bad ticket → 401', r.status === 401, show(r));
r = await call(null, 'POST', '/c/service-requests', { ...requestBody, location: null, areaId: 'area_missing' });
check('Unknown area → 400', r.status === 400 && r.body?.error === 'area_not_found', show(r));

r = await call(null, 'POST', '/c/service-requests', requestBody);
check('In the area → request is pending at MANA', r.status === 201 && r.body?.request?.status === 'pending', show(r));
const firstRequestId = r.body?.request?.id;
r = await call(null, 'POST', '/c/service-requests', { ...requestBody, notes: 'Gate code 42' });
const requestId = r.body?.request?.id;
check('Asking again replaces the open request', r.status === 201 && requestId !== firstRequestId, show(r));
r = await call(null, 'POST', '/c/service-requests/mine', { ticket });
const mine = r.body?.requests ?? [];
check(
  'Only one open request; the first was cancelled',
  mine.filter((x) => x.status === 'pending').length === 1 &&
    mine.find((x) => x.id === firstRequestId)?.status === 'cancelled' &&
    r.body?.registered === false,
  show(r),
);

const faraway = newPhone();
const farTicket = (await verify(faraway)).body?.ticket;
r = await call(null, 'POST', '/c/service-requests', { ...requestBody, ticket: farTicket, location: HYDERABAD });
check('Out of area → saved as out_of_area (counts as demand)', r.status === 201 && r.body?.request?.status === 'out_of_area', show(r));
const farRequestId = r.body?.request?.id;
r = await call(null, 'POST', `/c/service-requests/${requestId}/cancel`, { ticket: farTicket });
check('Another number’s ticket can’t cancel my request', r.status === 409, show(r));
r = await call(null, 'POST', `/c/service-requests/${farRequestId}/cancel`, { ticket: farTicket });
check('Cancel my own request', r.status === 200, show(r));

// ─── The team sees it; only the owner decides ─────────────────────────────

r = await call(staffA, 'GET', '/service-requests');
check('Staff see open requests (to call them)', r.status === 200 && r.body?.requests?.some((x) => x.id === requestId), show(r));
r = await call(C, 'GET', '/service-requests');
check('Another shop doesn’t see MANA’s requests', r.status === 200 && !r.body?.requests?.some((x) => x.id === requestId), show(r));
r = await call(staffA, 'GET', '/service-requests/summary');
check('Summary: listed with open requests', r.status === 200 && r.body?.listed === true && r.body?.open >= 1, show(r));
r = await call(C, 'GET', '/service-requests/summary');
check('Summary: an unlisted shop sees not listed', r.status === 200 && r.body?.listed === false && r.body?.open === 0, show(r));
r = await call(staffA, 'POST', `/service-requests/${requestId}/approve`, {});
check('Staff can’t approve', r.status === 403, show(r));
r = await call(C, 'POST', `/service-requests/${requestId}/approve`, {});
check('Another shop can’t approve it', r.status === 404, show(r));
r = await call(A, 'POST', `/service-requests/${requestId}/approve`, {});
check('Owner approves → customer created', r.status === 200 && r.body?.request?.status === 'approved' && !!r.body?.request?.customerId, show(r));
r = await call(A, 'POST', `/service-requests/${requestId}/approve`, {});
check('Approving twice → already handled', r.status === 409, show(r));
r = await call(A, 'GET', '/service-requests?filter=handled');
check('Handled list shows it', r.body?.requests?.some((x) => x.id === requestId && x.status === 'approved'), show(r));

r = await call(null, 'POST', '/c/service-requests/mine', { ticket });
check('The waiting app learns the number is registered now', r.body?.registered === true, show(r));
r = await call(null, 'POST', '/c/service-requests', requestBody);
check('A customer can’t file a request', r.status === 409 && r.body?.error === 'already_customer', show(r));

// ─── The customer signs in ────────────────────────────────────────────────

r = await verify(newcomer);
check(
  'Registered number → signed in, branch listed',
  r.body?.status === 'signed_in' && !!r.body?.token && r.body?.account?.branches?.length === 1,
  show(r),
);
let T = r.body?.token;
r = await call(T, 'GET', '/c/me');
check('/c/me answers with my number and name', r.body?.phone === newcomer && r.body?.name === 'Lakshmi', show(r));

r = await call(T, 'GET', '/jobs/today');
check('A customer token opens no team route', r.status === 401, show(r));
r = await call(A, 'GET', '/c/me');
check('A team token opens no customer route', r.status === 401, show(r));
r = await call(ticket, 'GET', '/c/me');
check('A service-request ticket isn’t a sign-in', r.status === 401, show(r));

const plate = `AP39CA${Math.floor(1000 + Math.random() * 8999)}`;
const mana = await washFor(A, newcomer, plate, A_MENU);
// Same number, different shop that isn't in the app: none of it may show.
const other = await washFor(C, newcomer, `AP26OW${Math.floor(1000 + Math.random() * 8999)}`, C_MENU);
// Someone else's wash at MANA.
const stranger = await washFor(A, newPhone(), `AP39ST${Math.floor(1000 + Math.random() * 8999)}`, A_MENU);

r = await call(T, 'GET', '/c/vehicles');
const vehicles = r.body?.vehicles ?? [];
check('My vehicles: the car washed at MANA only', vehicles.length === 1 && vehicles[0].registrationNumber === plate, show(r));
r = await call(T, 'GET', '/c/washes');
const washes = r.body?.washes ?? [];
check('My washes: MANA’s only, with a photo', washes.length === 1 && washes[0].id === mana.jobId && washes[0].photoCount === 1, show(r));

r = await call(T, 'GET', `/c/washes/${mana.jobId}`);
check('Wash detail lists its photo', r.status === 200 && r.body?.wash?.photos?.[0]?.id === mana.photoId, show(r));
r = await call(T, 'GET', `/photos/${mana.photoId}`);
check('Team photo route refuses a customer token', r.status === 401, show(r));
r = await call(T, 'GET', `/c/photos/${mana.photoId}`);
check('My photo downloads', r.status === 200 && r.type.startsWith('image/') && r.bytes?.length === 4, `${r.status} ${r.type}`);
r = await call(null, 'GET', `/c/photos/${mana.photoId}`);
check('Photo needs signing in', r.status === 401, show(r));

for (const [label, job, photo] of [
  ['an unlisted shop', other.jobId, other.photoId],
  ['another customer', stranger.jobId, stranger.photoId],
]) {
  r = await call(T, 'GET', `/c/washes/${job}`);
  check(`Can’t open a wash from ${label}`, r.status === 404, show(r));
  r = await call(T, 'GET', `/c/photos/${photo}`);
  check(`Can’t download a photo from ${label}`, r.status === 404, show(r));
}

// ─── Branch page: contact, hours, price list ──────────────────────────────

r = await call(null, 'GET', '/c/branches');
const manaBranch = r.body?.branches?.find((b) => b.id === 'shop_mana');
check(
  'Branches: MANA with address, phone, hours and a price list',
  r.status === 200 && !!manaBranch?.address && manaBranch?.phone?.length === 10 && !!manaBranch?.hours?.opensAt &&
    manaBranch?.services?.length > 0 && manaBranch.services.every((s) => s.prices.length > 0),
  show(r),
);
check('Branches: unlisted shops aren’t shown', !r.body?.branches?.some((b) => b.id === 'shop_test_c'));
r = await call(staffA, 'PUT', '/service-area/contact', { address: null, phone: null, opensAt: null, closesAt: null, weeklyOff: null });
check('Staff can’t change the branch contact', r.status === 403, show(r));
r = await call(A, 'PUT', '/service-area/contact', { ...manaBranch?.hours, address: manaBranch?.address, phone: manaBranch?.phone, closesAt: '06:00' });
check('Closing before opening → 400', r.status === 400, show(r));
r = await call(A, 'PUT', '/service-area/contact', { ...manaBranch?.hours, address: manaBranch?.address, phone: manaBranch?.phone, weeklyOff: 1 });
check('Owner saves the contact and hours', r.status === 200 && r.body?.contact?.weeklyOff === 1, show(r));
await call(A, 'PUT', '/service-area/contact', { ...manaBranch?.hours, address: manaBranch?.address, phone: manaBranch?.phone });

// ─── Live status of today's wash ──────────────────────────────────────────

r = await call(T, 'GET', '/c/live');
let live = r.body?.washes ?? [];
check(
  'Live: my wash is in the queue, with a count ahead',
  live.length === 1 && live[0].id === mana.jobId && live[0].status === 'waiting' && typeof live[0].ahead === 'number',
  show(r),
);
await call(A, 'PATCH', `/jobs/${mana.jobId}/status`, { status: 'washing' });
await call(A, 'PATCH', `/jobs/${mana.jobId}/status`, { status: 'ready' });
r = await call(T, 'GET', '/c/live');
check('Live: ready for pickup', r.body?.washes?.[0]?.status === 'ready', show(r));

// ─── Rating a wash ────────────────────────────────────────────────────────

r = await call(T, 'PUT', `/c/washes/${mana.jobId}/rating`, { stars: 5 });
check('Can’t rate before paying', r.status === 409 && r.body?.error === 'not_rateable', show(r));
await call(A, 'POST', `/jobs/${mana.jobId}/pay`, { paymentMethod: 'cash' });
r = await call(T, 'GET', '/c/live');
check('Live: a paid wash leaves the live list', r.body?.washes?.length === 0, show(r));
r = await call(T, 'PUT', `/c/washes/${mana.jobId}/rating`, { stars: 0 });
check('Zero stars → 400', r.status === 400, show(r));
r = await call(T, 'PUT', `/c/washes/${mana.jobId}/rating`, { stars: 4, comment: 'Good, but slow' });
check('Rate my paid wash', r.status === 200 && r.body?.rating?.stars === 4, show(r));
r = await call(T, 'PUT', `/c/washes/${mana.jobId}/rating`, { stars: 5, comment: 'Spotless' });
check('Change my rating', r.status === 200 && r.body?.rating?.stars === 5, show(r));
r = await call(T, 'GET', `/c/washes/${mana.jobId}`);
check('Wash detail shows my rating', r.body?.wash?.rating?.stars === 5 && r.body?.wash?.canRate === true, show(r));
r = await call(T, 'PUT', `/c/washes/${stranger.jobId}/rating`, { stars: 1 });
check('Can’t rate another customer’s wash', r.status === 404, show(r));
r = await call(staffA, 'GET', '/app-feedback/ratings');
check(
  'The team sees the rating, with a 30-day average',
  r.body?.ratings?.some((x) => x.washId === mana.jobId && x.stars === 5) && r.body?.last30?.count >= 1,
  show(r),
);
r = await call(C, 'GET', '/app-feedback/ratings');
check('Another shop doesn’t see it', !r.body?.ratings?.some((x) => x.washId === mana.jobId), show(r));
d1Run(`UPDATE jobs SET completed_at = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now', '-20 days') WHERE id = '${mana.jobId}';`);
r = await call(T, 'PUT', `/c/washes/${mana.jobId}/rating`, { stars: 1 });
check('Too long after the wash → can’t change the rating', r.status === 409, show(r));
d1Run(`UPDATE jobs SET completed_at = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now') WHERE id = '${mana.jobId}';`);

// ─── Reporting a problem ──────────────────────────────────────────────────

r = await call(T, 'POST', '/c/problems', { washId: mana.jobId, kind: 'not_clean', details: 'Bad' });
check('Too short a report → 400', r.status === 400, show(r));
r = await call(T, 'POST', '/c/problems', { washId: mana.jobId, kind: 'not_clean', details: 'The mats were still dusty.' });
const problemId = r.body?.problem?.id;
check('Report a problem with my wash', r.status === 201 && r.body?.problem?.wash?.id === mana.jobId, show(r));
r = await call(T, 'POST', '/c/problems', { washId: stranger.jobId, kind: 'damage', details: 'Not my wash at all, really.' });
check('Can’t report on another customer’s wash', r.status === 404, show(r));
r = await call(T, 'POST', '/c/problems', { kind: 'other', details: 'Please open earlier on Sundays.' });
check('A general report goes to my only branch', r.status === 201 && r.body?.problem?.branch?.id === 'shop_mana', show(r));
r = await call(T, 'POST', '/c/problems', { branchId: 'shop_test_c', kind: 'other', details: 'Trying a branch I am not with.' });
check('Can’t report to a branch I’m not a customer of', r.status === 404, show(r));
r = await call(staffA, 'GET', '/service-requests/summary');
check('Summary counts open reports', r.body?.openProblems >= 2, show(r));
r = await call(staffA, 'GET', '/app-feedback/problems');
check('The team sees the report', r.body?.problems?.some((p) => p.id === problemId && p.customer?.phone === newcomer), show(r));
r = await call(C, 'GET', '/app-feedback/problems');
check('Another shop doesn’t', !r.body?.problems?.some((p) => p.id === problemId), show(r));
r = await call(C, 'POST', `/app-feedback/problems/${problemId}/resolve`, { resolution: 'Not ours' });
check('Another shop can’t resolve it', r.status === 404, show(r));
r = await call(staffA, 'POST', `/app-feedback/problems/${problemId}/resolve`, { resolution: 'Free re-clean of the mats.' });
check('Staff resolve it with a note', r.status === 200, show(r));
r = await call(staffA, 'POST', `/app-feedback/problems/${problemId}/resolve`, { resolution: 'Again' });
check('Resolving twice → already handled', r.status === 409, show(r));
r = await call(T, 'GET', '/c/problems');
check(
  'I see it resolved, with the note',
  r.body?.problems?.some((p) => p.id === problemId && p.status === 'resolved' && p.resolution === 'Free re-clean of the mats.'),
  show(r),
);

// ─── Vehicles: add, remove, restore ───────────────────────────────────────

const newPlate = `AP39NV${Math.floor(1000 + Math.random() * 8999)}`;
const vehicleBody = { branchId: 'shop_mana', registrationNumber: newPlate.toLowerCase(), vehicleTypeId: 'vt_sedan', make: 'Maruti' };
r = await call(T, 'POST', '/c/vehicles', { ...vehicleBody, registrationNumber: 'A/1' });
check('Bad plate → 400', r.status === 400, show(r));
r = await call(T, 'POST', '/c/vehicles', { ...vehicleBody, branchId: 'shop_test_c', vehicleTypeId: 'vt_c_sedan' });
check('Can’t add a vehicle at a branch I’m not with', r.status === 404, show(r));
r = await call(T, 'POST', '/c/vehicles', vehicleBody);
const vehicleRequestId = r.body?.id;
check('Ask to add a vehicle', r.status === 201 && r.body?.status === 'requested', show(r));
r = await call(T, 'POST', '/c/vehicles', vehicleBody);
check('Asking again for the same plate → already waiting', r.status === 409 && r.body?.error === 'already_requested', show(r));
r = await call(T, 'POST', '/c/vehicles', { ...vehicleBody, registrationNumber: plate });
check('My own vehicle → already in my list', r.status === 409 && r.body?.error === 'already_yours', show(r));
r = await call(T, 'GET', '/c/vehicles');
check('My vehicles list the pending request', r.body?.requests?.some((q) => q.id === vehicleRequestId && q.status === 'pending' && q.registrationNumber === newPlate), show(r));
r = await call(C, 'POST', `/app-feedback/vehicles/${vehicleRequestId}/approve`);
check('Another shop can’t approve it', r.status === 404, show(r));
r = await call(staffA, 'POST', `/app-feedback/vehicles/${vehicleRequestId}/approve`);
check('Staff approve it', r.status === 200, show(r));
r = await call(staffA, 'POST', `/app-feedback/vehicles/${vehicleRequestId}/approve`);
check('Approving twice → already handled', r.status === 409, show(r));
r = await call(T, 'GET', '/c/vehicles');
const added = r.body?.vehicles?.find((v) => v.registrationNumber === newPlate);
check('The new vehicle is in my list', !!added && added.type?.name === 'Sedan', show(r));

const declinedPlate = `AP39DC${Math.floor(1000 + Math.random() * 8999)}`;
r = await call(T, 'POST', '/c/vehicles', { ...vehicleBody, registrationNumber: declinedPlate });
const declineId = r.body?.id;
r = await call(staffA, 'POST', `/app-feedback/vehicles/${declineId}/reject`, { reason: 'Not seen this car yet' });
check('Staff decline one with a reason', r.status === 200, show(r));
r = await call(T, 'GET', '/c/vehicles');
check('I see the decline and why', r.body?.requests?.some((q) => q.id === declineId && q.status === 'rejected' && q.reason === 'Not seen this car yet'), show(r));

r = await call(T, 'POST', '/c/vehicles', { ...vehicleBody, registrationNumber: `AP39CN${Math.floor(1000 + Math.random() * 8999)}` });
const cancelId = r.body?.id;
r = await call(T, 'POST', `/c/vehicle-requests/${cancelId}/cancel`);
check('Cancel my own request', r.status === 200, show(r));
r = await call(T, 'POST', `/c/vehicle-requests/${cancelId}/cancel`);
check('Cancelling twice → 409', r.status === 409, show(r));

const strangerVehicle = d1Rows(`SELECT id, registration_number AS plate FROM vehicles WHERE id = (SELECT vehicle_id FROM jobs WHERE id = '${stranger.jobId}')`)[0];
r = await call(T, 'DELETE', `/c/vehicles/${strangerVehicle?.id}`);
check('Can’t remove another customer’s vehicle', r.status === 404, show(r));
r = await call(T, 'POST', '/c/vehicles', { ...vehicleBody, registrationNumber: strangerVehicle?.plate });
const claimId = r.body?.id;
r = await call(staffA, 'GET', '/app-feedback/vehicles');
const claim = r.body?.requests?.find((q) => q.id === claimId);
check('Asking for someone else’s plate warns the team who has it now', !!claim?.currentOwner && claim.currentOwner.phone !== newcomer, show(r));
await call(staffA, 'POST', `/app-feedback/vehicles/${claimId}/reject`, { reason: 'Belongs to someone else' });

r = await call(T, 'DELETE', `/c/vehicles/${added?.id}`);
check('Remove a vehicle from my list', r.status === 200, show(r));
r = await call(T, 'GET', '/c/vehicles');
check('It’s gone from my list', !r.body?.vehicles?.some((v) => v.id === added?.id), show(r));
const stillThere = d1Rows(`SELECT COUNT(*) AS n FROM vehicles WHERE id = '${added?.id}'`)[0]?.n === 1;
check('The car wash keeps the vehicle', stillThere);
r = await call(T, 'POST', '/c/vehicles', { ...vehicleBody, registrationNumber: newPlate });
check('Adding it again brings it straight back', r.status === 200 && r.body?.status === 'restored', show(r));

// ─── Profile and referrals ────────────────────────────────────────────────

r = await call(T, 'PATCH', '/c/me', { name: '  ' });
check('Blank name → 400', r.status === 400, show(r));
r = await call(T, 'PATCH', '/c/me', { name: 'Lakshmi Devi' });
check('Change my name', r.status === 200 && r.body?.name === 'Lakshmi Devi', show(r));
const renamed = d1Rows(`SELECT name FROM customers WHERE phone = '${newcomer}' AND shop_id = 'shop_mana'`)[0]?.name;
check('The car wash sees the new name', renamed === 'Lakshmi Devi');
r = await call(T, 'GET', '/c/referrals');
check('After a paid wash I can refer friends', r.status === 200 && r.body?.canRefer === true && Array.isArray(r.body?.referrals), show(r));

// Shop C joins the app: its washes for this number appear, still nobody else's.
d1Run("UPDATE shops SET in_customer_app = 1 WHERE id = 'shop_test_c';");
r = await call(T, 'GET', '/c/me');
check('Once listed, the second branch shows up', r.body?.branches?.length === 2, show(r));
r = await call(T, 'GET', '/c/washes?limit=1');
check('Washes page across branches', r.body?.washes?.length === 1 && !!r.body?.nextBefore, show(r));
const page2 = await call(T, 'GET', `/c/washes?limit=1&before=${encodeURIComponent(r.body?.nextBefore ?? '')}`);
const seen = [r.body?.washes?.[0]?.id, page2.body?.washes?.[0]?.id];
check('Page 2 has the other wash', new Set(seen).size === 2 && seen.includes(other.jobId) && seen.includes(mana.jobId), show(page2));
r = await call(T, 'GET', `/c/washes/${stranger.jobId}`);
check('Still can’t open another customer’s wash', r.status === 404, show(r));
d1Run("UPDATE shops SET in_customer_app = 0 WHERE id = 'shop_test_c';");

// A voided wash disappears.
await call(A, 'POST', `/jobs/${mana.jobId}/void`, { reason: 'Customer app check' });
const voided = d1Rows(`SELECT status FROM jobs WHERE id = '${mana.jobId}'`)[0]?.status === 'void';
if (voided) {
  r = await call(T, 'GET', `/c/washes/${mana.jobId}`);
  check('A voided wash is hidden', r.status === 404, show(r));
}

// ─── Signing out and deleting ─────────────────────────────────────────────

r = await call(T, 'POST', '/c/me/sign-out-everywhere');
check('Sign out everywhere', r.status === 200, show(r));
r = await call(T, 'GET', '/c/me');
check('Old token stops working', r.status === 401 && r.body?.error === 'session_revoked', show(r));

T = (await verify(newcomer)).body?.token;
r = await call(T, 'DELETE', '/c/me');
check('Delete my app account', r.status === 200, show(r));
r = await call(T, 'GET', '/c/me');
check('Deleted account’s token stops working', r.status === 401, show(r));
const stillCustomer = d1Rows(`SELECT COUNT(*) AS n FROM customers WHERE phone = '${newcomer}' AND shop_id = 'shop_mana'`)[0]?.n === 1;
check('The car wash keeps its customer record', stillCustomer);
r = await verify(newcomer);
check('Signing in again makes a fresh account', r.body?.status === 'signed_in' && !!r.body?.token, show(r));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
