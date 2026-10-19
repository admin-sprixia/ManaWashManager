// Places and plans end to end: a branch sets up places (wash days, flats, photo, QR), business
// plans and rules; people find a place and join (at the place, from far away, by the team), pay
// online (Razorpay payment links, or the local test checkout), get GST receipts; washers work the
// wash-day list; customers skip, pause, cancel and renew; a full place pushes new members to a
// later day; "Call me back" requests group into demand and get invited when a place starts.
// Run against the local API:
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:places                        (in another)
// With Razorpay test keys pointed at the stand-in below (as CI runs), payments go through
// payment links; without keys, through the test checkout page.
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { API, apiFetch, d1Rows, d1Run, DEV_CODE, signIn as signInWith } from './lib/target.mjs';

const PIN = '258025';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? 'standin';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}
const show = (r) => `${r.status} ${typeof r.body === 'string' ? r.body.slice(0, 300) : JSON.stringify(r.body).slice(0, 500)}`;

async function call(token, method, path, body, extraHeaders = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders };
  let payload;
  if (body instanceof FormData || body instanceof URLSearchParams) payload = body;
  else if (typeof body === 'string') payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await apiFetch(API + path, { method, headers, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}

// ─── Stand-in Razorpay (payment links and refunds) ───────────────────────────
// Ids carry the run, like Razorpay's never repeat (the database keeps earlier runs' links).
const standin = { links: new Map(), refunds: [], n: 0, run: Date.now().toString(36) };
const standinServer = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const send = (status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const url = req.url ?? '';
  let m;
  if (req.method === 'POST' && url === '/v1/payment_links') {
    const id = `plink_${standin.run}${++standin.n}`;
    const link = { id, short_url: `https://rzp.io/standin/${id}`, status: 'created', amount: body.amount, reference_id: body.reference_id, payments: null };
    standin.links.set(id, link);
    return send(200, link);
  }
  if ((m = url.match(/^\/v1\/payment_links\/([^/]+)(\/cancel)?$/))) {
    const link = standin.links.get(decodeURIComponent(m[1]));
    if (!link) return send(400, { error: { description: 'The id provided does not exist' } });
    if (m[2]) link.status = 'cancelled';
    return send(200, link);
  }
  if (req.method === 'POST' && (m = url.match(/^\/v1\/payments\/([^/]+)\/refund$/))) {
    standin.refunds.push({ paymentId: decodeURIComponent(m[1]), amount: body.amount });
    return send(200, { id: `rfnd_${standin.run}${++standin.n}` });
  }
  return send(404, { error: { description: 'not handled by the stand-in' } });
});
await new Promise((resolve) => {
  standinServer.once('error', () => resolve()); // port taken: another check's stand-in is fine too
  standinServer.listen(8799, '127.0.0.1', resolve);
});

// ─── Days (IST) ──────────────────────────────────────────────────────────────
const IST = 330 * 60 * 1000;
const today = new Date(Date.now() + IST).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();

// ─── A business, a branch listed in the app, its team ────────────────────────
const run = Date.now().toString(36);
const rand = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const BIZ = `biz_pl_${run}`;
const A = `shop_pla_${run}`;
const B = `shop_plb_${run}`;
const SHOP_CODE = rand(6);
const ownerPhone = `94${rand(8)}`;
const staffPhone = `94${rand(8)}`;
const ownerBPhone = `94${rand(8)}`;
const OWNER = `user_plo_${run}`;
const STAFF = `user_pls_${run}`;
// Far from every other check's data, so "nearby" only finds these places.
const LAT = 21.1 + Math.random() / 10;
const LNG = 72.6 + Math.random() / 10;

d1Run(
  `INSERT INTO businesses (id, name) VALUES ('${BIZ}', 'Places Check Co');` +
    `INSERT INTO shops (id, code, name, business_id, in_customer_app, latitude, longitude, service_radius_km)
       VALUES ('${A}', '${SHOP_CODE}', 'Places Branch', '${BIZ}', 1, ${LAT}, ${LNG}, 10);` +
    `INSERT INTO shops (id, code, name, business_id) VALUES ('${B}', '${rand(6)}', 'Other Branch', '${BIZ}');` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('${OWNER}', '${A}', 'Places Owner', '${ownerPhone}', 'owner');` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('${STAFF}', '${A}', 'Places Staff', '${staffPhone}', 'staff');` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('user_plb_${run}', '${B}', 'Other Owner', '${ownerBPhone}', 'owner');` +
    `INSERT INTO business_admins (business_id, phone) VALUES ('${BIZ}', '${ownerPhone}');`,
);

async function staffSignIn(phone) {
  const p = await signInWith(phone, PIN);
  return p.body?.token;
}
const OWN = await staffSignIn(ownerPhone);
const OWNB = await staffSignIn(ownerBPhone);
d1Run(`UPDATE users SET pin_hash = (SELECT pin_hash FROM users WHERE id = '${OWNER}') WHERE id = '${STAFF}';`);
const STF = (await signInWith(staffPhone, PIN)).body?.token;
check('Owner, staff and another branch’s owner sign in', !!OWN && !!STF && !!OWNB);
if (!OWN || !STF || !OWNB) process.exit(1);

/**
 * A number new to MANA: verified, holding a service-request ticket. Each code is moved back two
 * hours so the per-address hourly cap (shared with the other checks) doesn't trip; it stays valid.
 */
async function newCustomer() {
  const phone = `93${rand(8)}`;
  const sent = await call(null, 'POST', '/c/auth/code', { phone });
  d1Run(`UPDATE signup_codes SET created_at = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now', '-2 hours') WHERE phone = '${phone}';`);
  const r = await call(null, 'POST', '/c/auth/verify', { phone, code: DEV_CODE });
  if (!r.body?.ticket) {
    console.log(`FAIL  A new number gets a ticket\n      code ${show(sent)}\n      verify ${show(r)}`);
    process.exit(1);
  }
  return { phone, ticket: r.body.ticket };
}

// ─── Catalog, doorstep team, plans, rules ────────────────────────────────────
let r = await call(OWN, 'GET', '/business/catalog');
const cls = Object.fromEntries((r.body?.classes ?? []).map((c) => [c.key, c]));
const size = (classKey, key) => cls[classKey].sizes.find((s) => s.key === key).id;
const book = r.body?.priceBooks?.find((b) => b.isDefault)?.id;
const WASH = (await call(OWN, 'POST', '/business/services', { name: 'Complete Wash', classIds: [cls.car.id, cls.twoWheeler.id] })).body?.id;
const POLISH = (await call(OWN, 'POST', '/business/services', { name: 'Tyre Polish', classIds: [cls.car.id] })).body?.id;
await call(OWN, 'PUT', '/business/prices', {
  priceBookId: book,
  entries: [
    { serviceId: WASH, sizeId: size('car', 'S'), price: 40000 },
    { serviceId: WASH, sizeId: size('twoWheeler', 'S'), price: 15000 },
    { serviceId: POLISH, sizeId: size('car', 'S'), price: 10000 },
  ],
});
// HQ switches them on for branch A (nothing reaches a branch by itself).
await call(OWN, 'PUT', `/business/branches/${A}/menu`, { serviceIds: [WASH, POLISH] });
await call(OWN, 'GET', '/services');
r = await call(OWN, 'POST', '/branch/points', { kind: 'doorstep', name: 'Places Van', latitude: LAT, longitude: LNG, radiusKm: 10, classIds: [cls.car.id, cls.twoWheeler.id] });
check('Setup: catalog services, prices and a doorstep team for cars and bikes', !!WASH && !!POLISH && r.status === 201, show(r));

r = await call(OWN, 'POST', '/business/plans', { name: 'Monthly', washes: 4, months: 1, catalogServiceId: WASH });
const MONTHLY = r.body?.id;
check('Admin adds a Monthly plan (4 washes of Complete Wash)', r.status === 201 && !!MONTHLY, show(r));
r = await call(OWN, 'POST', '/business/plans', { name: 'Quarterly', washes: 12, months: 3, catalogServiceId: WASH, discountBp: 500, allowParts: true, popular: true });
const QUARTERLY = r.body?.id;
check('…and a Quarterly plan, 5% off, payable in parts, most popular', r.status === 201 && !!QUARTERLY, show(r));
r = await call(OWN, 'POST', '/business/plans', { name: 'Bad', washes: 0, months: 1, catalogServiceId: WASH });
check('A plan needs at least one wash', r.status === 400, show(r));
r = await call(OWN, 'POST', '/business/plans', { name: 'Ghost', washes: 4, months: 1, catalogServiceId: 'cs_nope' });
check('…and a real catalog service', r.status === 400 && r.body?.error === 'invalid', show(r));
await call(OWN, 'PATCH', `/business/plans/${MONTHLY}`, { popular: true });
r = await call(OWN, 'GET', '/business/plans');
check('Only one plan is “Most popular” at a time', r.body?.plans?.filter((p) => p.popular).map((p) => p.name).join() === 'Monthly', show(r));
await call(OWN, 'PATCH', `/business/plans/${QUARTERLY}`, { popular: true });
r = await call(STF, 'GET', '/business/plans');
check('Staff can’t manage plans', r.status === 403, show(r));
r = await call(OWN, 'PATCH', '/business/plan-rules', { gstin: 'BADGSTIN' });
check('A wrong GSTIN is refused', r.status === 400, show(r));
r = await call(OWN, 'PATCH', '/business/plan-rules', { gstin: '36abcde1234f1z5', legalName: 'Mana Wash Pvt Ltd', skipsPerMonth: 1, pauseDaysPerMonth: 7 });
check('Admin sets GST details and skip/pause rules', r.status === 200 && r.body?.rules?.gstin === '36ABCDE1234F1Z5' && r.body?.rules?.partsFirstPct === 20, show(r));

// ─── Communities: the team inspects, the owner approves ──────────────────────
const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], { type: 'image/jpeg' });
const photoForm = (kind, blob = jpeg()) => {
  const f = new FormData();
  f.append('kind', kind);
  f.append('file', blob, 'photo.jpg');
  return f;
};
const setup = {
  type: 'building',
  name: 'Sai Residency',
  label: 'Opp. Ganesh temple',
  latitude: LAT,
  longitude: LNG,
  notes: 'Watchman opens the gate at 6',
  contactName: 'Secretary',
  inspection: { water: 'yes', parking: 'basement', permission: 'yes', cars: 12, bikes: 4 },
  slots: [{ days: [weekday], time: '07:00' }, { days: [(weekday + 3) % 7], time: '06:30' }],
};
r = await call(STF, 'POST', '/places', { ...setup, slots: [{ days: [], time: '07:00' }] });
check('A proposed wash slot needs a day', r.status === 400, show(r));
r = await call(STF, 'POST', '/places', setup);
const P1 = r.body?.id;
const CODE = r.body?.code;
check('Staff save a community after visiting it: a draft with a poster code', r.status === 201 && /^[2-9A-HJKMNP-Z]{7}$/.test(CODE ?? ''), show(r));
r = await call(null, 'GET', `/c/places/near?lat=${LAT}&lng=${LNG}`);
check('A draft isn’t shown to customers nearby', r.status === 200 && !(r.body?.places ?? []).some((p) => p.id === P1), show(r));
r = await call(null, 'GET', `/c/places/by-code/${CODE}`);
check('…or by its code', r.status === 404, show(r));
r = await call(null, 'GET', `/c/places/${P1}`);
check('…or by its id', r.status === 404, show(r));

r = await call(STF, 'POST', `/places/${P1}/submit`);
check('It can’t go for approval without a photo and the secretary’s number', r.status === 400 && /photo/i.test(r.body?.message ?? '') && /number/i.test(r.body?.message ?? ''), show(r));
r = await call(STF, 'POST', `/places/${P1}/photos`, photoForm('gate', new Blob([new Uint8Array([1, 2, 3])], { type: 'text/plain' })));
check('Only photos can be added', r.status === 400, show(r));
r = await call(STF, 'POST', `/places/${P1}/photos`, photoForm('gate'));
const gatePhoto = r.body?.id;
check('Staff add a photo of the gate', r.status === 201 && !!gatePhoto, show(r));
await call(STF, 'POST', `/places/${P1}/photos`, photoForm('parking'));
r = await call(STF, 'PATCH', `/places/${P1}/setup`, { contactPhone: '9440000001' });
check('…and the secretary’s number', r.status === 200, show(r));
r = await call(STF, 'GET', `/places/${P1}`);
check('The draft shows what the visit found and nothing missing', r.body?.place?.stage === 'draft' && r.body?.place?.setup?.missing?.length === 0 && r.body?.place?.photos?.length === 2 && r.body?.place?.setup?.slots?.length === 2, show(r));
r = await call(STF, 'POST', `/places/${P1}/submit`);
check('Staff send it for approval', r.status === 200, show(r));
r = await call(STF, 'PATCH', `/places/${P1}/setup`, { notes: 'Changed my mind' });
check('…after which only the owner can change it', r.status === 403, show(r));
r = await call(STF, 'POST', `/places/${P1}/go-live`, { washDays: [weekday], washTime: '07:00' });
check('Staff can’t make a community live', r.status === 403, show(r));
r = await call(OWN, 'POST', `/places/${P1}/send-back`, { note: 'Add a photo of the water point' });
check('The owner sends it back with a note', r.status === 200, show(r));
r = await call(STF, 'GET', `/places/${P1}`);
check('…which the teammate sees on the draft', r.body?.place?.stage === 'draft' && r.body?.place?.setup?.reviewNote === 'Add a photo of the water point', show(r));
await call(STF, 'POST', `/places/${P1}/photos`, photoForm('water'));
await call(STF, 'POST', `/places/${P1}/submit`);
r = await call(OWN, 'GET', '/places/overview?days=1');
check('The hub lists it as waiting for approval', r.status === 200 && r.body?.review === 1, show(r));
r = await call(OWN, 'POST', `/places/${P1}/go-live`, { washDays: [], washTime: '07:00' });
check('Going live needs a wash day', r.status === 400, show(r));
r = await call(OWN, 'POST', `/places/${P1}/go-live`, { washDays: [weekday], washTime: '07:00', teamUserIds: [STAFF] });
check('The owner sets the day, time and team, and it goes live', r.status === 200, show(r));
r = await call(STF, 'GET', `/places/${P1}`);
check('…live, with its team', r.body?.place?.stage === 'live' && r.body?.place?.setup?.team?.[0]?.id === STAFF, show(r));
r = await call(STF, 'PATCH', `/places/${P1}/setup`, { label: 'Somewhere else' });
check('On a live community staff can’t change the details', r.status === 403, show(r));
r = await call(STF, 'PATCH', `/places/${P1}/setup`, { notes: 'Gate opens at 6:15 now' });
check('…but can add notes', r.status === 200, show(r));

r = await call(OWN, 'POST', '/places', { type: 'colony', label: 'Green Meadows gate', latitude: LAT + 0.01, longitude: LNG });
const P2 = r.body?.id;
r = await call(OWN, 'POST', `/places/${P2}/go-live`, { washDays: [weekday], washTime: '08:00', capacity: 1 });
check('The owner can start a colony that takes one vehicle per wash day', r.status === 200, show(r));

r = await call(OWN, 'POST', `/places/${P1}/units`, { numbers: '101-104, G1' });
check('Owner adds flats from a range', r.status === 200 && r.body?.added === 5 && r.body?.units?.length === 5, show(r));
r = await call(OWN, 'POST', `/places/${P1}/units`, { numbers: '103-105' });
check('…adding again keeps what’s there (only 105 is new)', r.body?.added === 1, show(r));
r = await call(OWN, 'POST', `/places/${P1}/units`, { numbers: 'a@b' });
check('…and refuses what it can’t read', r.status === 400, show(r));
const units = Object.fromEntries(((await call(OWN, 'GET', `/places/${P1}`)).body?.units ?? []).map((u) => [u.number, u.id]));

r = await call(null, 'GET', `/c/places/${P1}/photo`);
check('The first photo is the cover the app shows people choosing their place', r.status === 200 && r.headers.get('content-type') === 'image/jpeg', `${r.status}`);
r = await call(STF, 'GET', `/places/${P1}/photos/${gatePhoto}`);
check('The team can open each inspection photo', r.status === 200, `${r.status}`);

r = await call(OWNB, 'GET', `/places/${P1}`);
check('Another branch can’t see the place', r.status === 404, show(r));
r = await call(STF, 'GET', '/places');
check('The team sees its places', r.status === 200 && r.body?.places?.length === 2, show(r));

// ─── Finding a place ─────────────────────────────────────────────────────────
r = await call(null, 'GET', `/c/places/near?lat=${LAT + 0.0005}&lng=${LNG}`);
const near = r.body?.places ?? [];
check('Nearby places, nearest first, with distance and photo', near[0]?.id === P1 && near[0]?.distanceM > 30 && near[0]?.distanceM < 80 && near[0]?.hasPhoto === true, show(r));
r = await call(null, 'GET', `/c/places/by-code/${CODE.toLowerCase()}`);
check('A QR code finds its place', r.status === 200 && r.body?.place?.id === P1 && r.body?.place?.branchName === 'Places Branch', show(r));
r = await call(null, 'GET', '/c/places/by-code/ABCDEFG');
check('…an unknown code doesn’t', r.status === 404, show(r));
r = await call(null, 'GET', `/c/places/${P1}`);
const info = r.body;
const hatch = info?.menu?.vehicleTypes?.find((t) => t.name === 'Hatchback');
const scooter = info?.menu?.vehicleTypes?.find((t) => t.name === 'Scooter');
const monthly = info?.menu?.plans?.find((p) => p.id === MONTHLY);
const quarterly = info?.menu?.plans?.find((p) => p.id === QUARTERLY);
const doorHatch = info?.menu?.services?.find((s) => s.id && s.name === 'Complete Wash')?.prices?.find((p) => p.vehicleTypeId === hatch?.id)?.price;
check('The place’s menu has its flats, vehicle types and plans', info?.units?.length === 6 && !!hatch && !!scooter && !!monthly && !!quarterly, show(r));
// A plan always saves at least 5% on its washes one by one (whole rupees, down): a plan with no
// discount is lowered to that.
const planCap = (listTotal) => Math.floor((listTotal * 0.95) / 100) * 100;
check('Plan prices come from the doorstep price × washes, less the discount, always saving at least 5%', monthly?.prices?.find((p) => p.vehicleTypeId === hatch?.id)?.total === planCap(doorHatch * 4) && quarterly?.prices?.find((p) => p.vehicleTypeId === hatch?.id)?.total === Math.min(Math.round((doorHatch * 12 * 0.95) / 100) * 100, planCap(doorHatch * 12)), `${doorHatch} ${JSON.stringify(monthly?.prices)}`);
check('…and the first wash is the next wash day (a week out)', info?.firstWash?.['1']?.day === addDays(today, 7), JSON.stringify(info?.firstWash));

// ─── Flow A from far away: the team confirms ─────────────────────────────────
const c1 = await newCustomer();
const joinC1 = {
  ticket: c1.ticket,
  placeId: P1,
  name: 'Ravi',
  unit: { unitId: units['101'] },
  location: { latitude: LAT + 0.015, longitude: LNG },
  via: 'qr',
  vehicles: [{ vehicleTypeId: hatch.id, choice: { kind: 'plan', planId: MONTHLY, payMode: 'full' } }],
};
r = await call(null, 'POST', '/c/join', { ...joinC1, via: 'staff' });
check('The app can’t claim the team added them', r.status === 400, show(r));
r = await call(null, 'POST', '/c/join', joinC1);
const C1 = r.body?.session?.token;
const order1 = r.body?.orders?.[0];
check('Joining from 1.6 km away waits for the team', r.status === 201 && r.body?.memberStatus === 'pending' && r.body?.checks?.includes('far_away'), show(r));
check('…and signs them in as a new customer', !!C1 && r.body?.newCustomer === true);
check('…with the plan for their hatchback, first wash next week, unpaid', order1?.status === 'awaiting_payment' && order1?.firstWashOn === addDays(today, 7) && order1?.total === planCap(doorHatch * 4) && !!order1?.payBy, JSON.stringify(order1));
r = await call(C1, 'POST', `/c/orders/${order1.id}/pay`);
check('Payment opens only after the team confirms', r.status === 403 && r.body?.error === 'not_allowed', show(r));

r = await call(STF, 'GET', `/places/${P1}/members`);
const m1 = r.body?.members?.find((m) => m.customer.phone === c1.phone);
check('The team sees the new member waiting, with why', m1?.status === 'pending' && m1?.checks?.includes('far_away') && m1?.unit === '101', show(r));
r = await call(STF, 'POST', `/places/members/${m1.id}/approve`);
check('Staff confirm them', r.status === 200, show(r));
r = await call(STF, 'POST', `/places/members/${m1.id}/approve`);
check('…once', r.status === 409, show(r));

// ─── Paying ──────────────────────────────────────────────────────────────────
/** Pays a started payment the way the configured provider does. */
async function pay(payment, token) {
  if (payment.url.includes('/pay/test/')) {
    const path = new URL(payment.url).pathname;
    const page = await call(null, 'GET', path);
    const done = await call(null, 'POST', path, new URLSearchParams({ action: 'pay' }));
    return page.status === 200 && done.status === 303;
  }
  const link = [...standin.links.values()].find((l) => payment.url.endsWith(l.id));
  if (!link) return false;
  link.status = 'paid';
  link.payments = [{ payment_id: `pay_${standin.run}${++standin.n}`, amount: link.amount, method: 'upi', status: 'captured' }];
  return (await call(token, 'GET', `/c/payments/${payment.id}`)).body?.payment?.status === 'paid';
}

r = await call(C1, 'POST', `/c/orders/${order1.id}/pay`);
const pay1 = r.body?.payment;
check('Pay now opens a checkout for the whole plan', r.status === 200 && pay1?.amount === order1.total && !!pay1?.url, show(r));
r = await call(C1, 'POST', `/c/orders/${order1.id}/pay`);
check('…tapping again reuses the same checkout', r.body?.payment?.id === pay1?.id, show(r));
check('The customer pays', await pay(pay1, C1));
r = await call(C1, 'GET', `/c/payments/${pay1.id}`);
check('The payment is confirmed with a numbered receipt', r.body?.payment?.status === 'paid' && new RegExp(`^MW-${SHOP_CODE}/\\d{2}-\\d{2}/00001$`).test(r.body?.payment?.receiptNo ?? ''), show(r));
r = await call(C1, 'GET', `/c/receipts/${pay1.id}`);
const rc = r.body?.receipt;
check('The receipt shows GST (18% inside the price) and the seller’s GSTIN', rc?.gst?.taxable + rc?.gst?.cgst + rc?.gst?.sgst === pay1.amount && rc?.gst?.rateBp === 1800 && rc?.seller?.gstin === '36ABCDE1234F1Z5', show(r));
r = await call(C1, 'GET', `/c/orders/${order1.id}`);
check('The plan is running: paid, first wash next week', r.body?.order?.status === 'active' && r.body?.order?.paid === order1.total && r.body?.order?.nextWashes?.[0] === addDays(today, 7), show(r));
r = await call(C1, 'POST', `/c/orders/${order1.id}/pay`);
check('Nothing more to pay', r.status === 403, show(r));

// ─── The wash day ────────────────────────────────────────────────────────────
r = await call(STF, 'GET', `/places/${P1}/day/${addDays(today, 7)}`);
const row1 = r.body?.rows?.find((x) => x.orderId === order1.id);
check('Next week’s wash-day list shows the hatchback as paid, first wash', row1?.paid === true && row1?.firstWash === true && row1?.unit === '101', show(r));
r = await call(STF, 'POST', `/places/${P1}/visits`, { orderId: order1.id, date: addDays(today, 7), outcome: 'done' });
check('A wash can’t be recorded for a future day', r.status === 400, show(r));
d1Run(`UPDATE place_orders SET first_wash_on = '${today}' WHERE id = '${order1.id}'`);
r = await call(STF, 'GET', `/places/${P1}/day/${today}`);
check('Today’s list has it once its first wash is today', r.body?.rows?.some((x) => x.orderId === order1.id && x.paid), show(r));
const plate = `AP39P${rand(5)}`;
r = await call(STF, 'POST', `/places/${P1}/visits`, {
  orderId: order1.id,
  date: today,
  outcome: 'done',
  plate: { registrationNumber: plate, make: 'Maruti Suzuki', model: 'Swift' },
  at: { latitude: LAT + 0.01, longitude: LNG },
});
check('The washer records the wash and the plate at the first wash', r.status === 201 && r.body?.ended === false, show(r));
check('…with how far their phone was from the community', r.body?.distanceM > 1000 && r.body?.distanceM < 1200, show(r));
r = await call(STF, 'POST', `/places/${P1}/visits`, { orderId: order1.id, date: today, outcome: 'done' });
check('…once per day', r.status === 409, show(r));
const veh = d1Rows(`SELECT v.registration_number AS reg, v.customer_id AS cid FROM member_vehicles mv JOIN vehicles v ON v.id = mv.vehicle_id JOIN place_orders o ON o.member_vehicle_id = mv.id WHERE o.id = '${order1.id}'`);
check('…which adds the vehicle to the customer at the branch', veh[0]?.reg === plate, JSON.stringify(veh));
let day = (await call(STF, 'GET', `/places/${P1}/day/${today}`)).body;
const visitId = day?.rows?.find((x) => x.orderId === order1.id)?.visit?.id;
r = await call(STF, 'DELETE', `/places/${P1}/visits/${visitId}`);
let o1 = (await call(C1, 'GET', `/c/orders/${order1.id}`)).body?.order;
check('A record made by mistake can be undone', r.status === 200 && o1?.washesUsed === 0, show(r));
r = await call(STF, 'POST', `/places/${P1}/visits`, { orderId: order1.id, date: today, outcome: 'done', at: { latitude: LAT + 0.0003, longitude: LNG } });
const doneVisit = r.body?.visitId;
o1 = (await call(C1, 'GET', `/c/orders/${order1.id}`)).body?.order;
check('Recorded again: 1 of 4 washes used, next one next week', o1?.washesUsed === 1 && o1?.nextWashes?.[0] === addDays(today, 7), JSON.stringify(o1));
const afterForm = new FormData();
afterForm.append('file', jpeg(), 'after.jpg');
r = await call(STF, 'POST', `/places/${P1}/visits/${doneVisit}/photo`, afterForm);
check('The washer adds an after photo', r.status === 200, show(r));
day = (await call(STF, 'GET', `/places/${P1}/day/${today}`)).body;
const shown = day?.rows?.find((x) => x.orderId === order1.id)?.visit;
check('The wash-day list shows who washed it, when, the photo, and that they were there', shown?.by === 'Places Staff' && !!shown?.at && shown?.hasPhoto === true && shown?.far === false && day?.atPlaceMeters === 200, JSON.stringify(shown));
r = await call(OWN, 'GET', `/places/overview?days=1`);
const todayCard = r.body?.days?.[0]?.places?.find((p) => p.id === P1);
check('The hub shows today’s progress at the community', todayCard?.done >= 1 && todayCard?.washers?.includes('Places Staff'), JSON.stringify(r.body).slice(0, 400));
r = await call(OWN, 'GET', '/reports/staff?range=today');
const staffRow = r.body?.rows?.find((x) => x.userId === STAFF);
check('The staff report counts community washes', r.status === 200 && staffRow?.communityWashes === 1, show(r));

// ─── A plan member comes to the shop ─────────────────────────────────────────
r = await call(STF, 'GET', `/places/shop-plans?phone=${c1.phone}`);
let shopPlan = r.body?.plans?.find((p) => p.orderId === order1.id);
check('New Wash finds the customer’s plan by phone, with the covered service', r.status === 200 && shopPlan?.washesUsed === 1 && shopPlan?.washesTotal === 4 && !!shopPlan?.service?.id && shopPlan?.unit === '101' && shopPlan?.vehicle?.registrationNumber === plate, show(r));
check('…but not twice in one day: today’s wash is already done', /today/i.test(shopPlan?.problem ?? ''), JSON.stringify(shopPlan));
r = await call(STF, 'GET', `/places/shop-plans?phone=9${rand(9)}`);
check('A stranger has no plans', r.status === 200 && r.body?.plans?.length === 0, show(r));
const planWash = (extra = {}) => ({
  id: `job_plw_${run}_${rand(6)}`,
  customer: { phone: c1.phone, name: 'Ravi' },
  registrationNumber: plate,
  vehicleTypeId: shopPlan?.vehicle?.typeId,
  services: [{ serviceId: shopPlan?.service?.id, quantity: 1 }],
  discount: 0,
  planOrderId: order1.id,
  ...extra,
});
r = await call(STF, 'POST', '/jobs/start', planWash());
check('The shop can’t use a second plan wash on the same day', r.status === 409 && r.body?.error === 'plan_wash_invalid', show(r));
d1Run(`UPDATE place_visits SET date = '${addDays(today, -1)}' WHERE id = '${doneVisit}'`);
shopPlan = (await call(STF, 'GET', `/places/shop-plans?phone=${c1.phone}`)).body?.plans?.find((p) => p.orderId === order1.id);
check('With yesterday’s community wash done, today’s can be at the shop', shopPlan?.problem === null, JSON.stringify(shopPlan));
r = await call(STF, 'POST', '/jobs/start', planWash({ discount: 5000, discountReason: 'regular' }));
check('A plan wash can’t carry another discount too', r.status === 400, show(r));
const planJob = planWash();
r = await call(STF, 'POST', '/jobs/start', planJob);
check('The plan pays for the wash: nothing to collect', r.status === 201 && r.body?.total === 0 && r.body?.discount === r.body?.subtotal && /Plan wash/.test(r.body?.discountReason ?? ''), show(r));
check('…and the wash records the service the plan paid for (it earns no loyalty stamp)', d1Rows(`SELECT plan_service_id AS s FROM jobs WHERE id = '${planJob.id}'`)[0]?.s === shopPlan?.service?.id);
r = await call(OWN, 'GET', '/jobs/stats?range=today');
check('Reports count the community wash once, and the plan wash at the shop as a shop wash', r.status === 200 && r.body?.communityWashes === 1, show(r));
r = await call(OWN, 'GET', '/reports/staff?range=today');
check('…and the staff report doesn’t count the shop plan wash as a community wash', r.body?.rows?.find((x) => x.userId === STAFF)?.communityWashes === 1, show(r));
o1 = (await call(C1, 'GET', `/c/orders/${order1.id}`)).body?.order;
check('…and it uses one plan wash (2 of 4)', o1?.washesUsed === 2, JSON.stringify(o1));
r = await call(STF, 'POST', '/jobs/start', planJob);
check('A retried request returns the same wash without using another', r.status === 200 && r.body?.id === planJob.id && (await call(C1, 'GET', `/c/orders/${order1.id}`)).body?.order?.washesUsed === 2, show(r));
r = await call(STF, 'POST', '/jobs/start', planWash());
check('A second shop wash the same day isn’t covered', r.status === 409, show(r));
r = await call(OWN, 'POST', `/jobs/${planJob.id}/void`, { reason: 'Entered by mistake' });
o1 = (await call(C1, 'GET', `/c/orders/${order1.id}`)).body?.order;
check('Voiding the shop wash gives the plan wash back', r.status === 200 && o1?.washesUsed === 1, `${show(r)} ${JSON.stringify(o1)}`);
d1Run(`UPDATE place_visits SET date = '${today}' WHERE id = '${doneVisit}'`);

r = await call(OWN, 'PUT', '/shop/settings', { upiId: 'not a upi id' });
check('A wrong UPI ID is refused', r.status === 400, show(r));
r = await call(STF, 'PUT', '/shop/settings', { upiId: 'shop@okaxis' });
check('Staff can’t change the UPI ID', r.status === 403, show(r));
r = await call(OWN, 'PUT', '/shop/settings', { upiId: 'ManaWash@OKAXIS' });
const kept = await call(STF, 'GET', '/shop/settings');
check('The owner sets the UPI ID for the payment QR; the review link is untouched', r.status === 200 && r.body?.upiId === 'manawash@okaxis' && kept.body?.upiId === 'manawash@okaxis' && 'googleReviewUrl' in (kept.body ?? {}), show(kept));
r = await call(OWN, 'PUT', '/shop/settings', { upiId: '' });
check('…and can remove it', r.status === 200 && r.body?.upiId === null, show(r));
await call(OWN, 'PUT', '/shop/settings', { upiId: 'manawash@okaxis' });
r = await call(OWN, 'PUT', '/shop/settings', { upiId: null });
check('…also the way the app removes it (no UPI ID at all)', r.status === 200 && r.body?.upiId === null, show(r));

r = await call(OWN, 'PUT', '/shop/settings', { googleReviewUrl: 'https://google.evil.com/review' });
check('A review link that isn’t Google’s is refused (it goes to customers)', r.status === 400, show(r));
r = await call(OWN, 'PUT', '/shop/settings', { googleReviewUrl: 'https://maps.app.goo.gl/AbC1' });
check('A Google review link is saved', r.status === 200 && r.body?.googleReviewUrl === 'https://maps.app.goo.gl/AbC1', show(r));
r = await call(OWN, 'PUT', '/shop/settings', { googleReviewUrl: null });
check('…and removed', r.status === 200 && r.body?.googleReviewUrl === null, show(r));

const errorStatuses = [];
for (let i = 0; i < 31; i++) {
  errorStatuses.push((await call(STF, 'POST', '/shop/errors', { message: `check crash ${i}`, appVersion: 'check' })).status);
}
check('One person can send 30 error reports an hour; the 31st waits', errorStatuses.slice(0, 30).every((s) => s === 201) && errorStatuses[30] === 429, errorStatuses.join(','));

const c1Id = d1Rows(`SELECT id FROM customers WHERE shop_id = '${A}' AND phone = '${c1.phone}'`)[0]?.id;
r = await call(STF, 'GET', `/customers/${c1Id}`);
const community = r.body?.communities?.[0];
check('The customer’s profile shows their community, flat, plan and payment', community?.place?.id === P1 && community?.unit === '101' && community?.orders?.[0]?.id === order1.id && community?.orders?.[0]?.receipts?.[0]?.amount === order1.total, JSON.stringify(r.body?.communities).slice(0, 400));
check('…and how they came to us', r.body?.customer?.source === 'community_app', r.body?.customer?.source);
r = await call(OWN, 'GET', '/jobs/stats?range=today');
check('Reports count the plan payment in the money that came in', r.status === 200 && r.body?.planIncome >= order1.total && r.body?.net === r.body?.revenue + r.body?.planIncome - r.body?.expenses, show(r));

// ─── Skip and pause ──────────────────────────────────────────────────────────
r = await call(C1, 'POST', `/c/orders/${order1.id}/skip`, { day: addDays(today, 7) });
check('The customer skips next week (counts as a postpone, nothing is lost)', r.status === 200 && r.body?.order?.nextWashes?.[0] === addDays(today, 14) && r.body?.order?.skipsLeft === 0, show(r));
r = await call(C1, 'POST', `/c/orders/${order1.id}/skip`, { day: addDays(today, 14) });
check('…but only once a month on this plan', r.status === 403, show(r));
r = await call(C1, 'POST', `/c/orders/${order1.id}/skip`, { day: addDays(today, 8) });
check('…and only on their wash days', r.status === 400, show(r));
r = await call(C1, 'POST', `/c/orders/${order1.id}/unskip`, { day: addDays(today, 7) });
check('Changing their mind brings the wash back', r.body?.order?.nextWashes?.[0] === addDays(today, 7), show(r));
r = await call(C1, 'POST', `/c/orders/${order1.id}/pauses`, { fromOn: addDays(today, 6), toOn: addDays(today, 9) });
const pauseId = r.body?.order?.pauses?.[0]?.id;
check('A holiday pause moves the wash after it', r.status === 200 && r.body?.order?.nextWashes?.[0] === addDays(today, 14) && r.body?.order?.pauseDaysLeft === 3, show(r));
r = await call(C1, 'POST', `/c/orders/${order1.id}/pauses`, { fromOn: addDays(today, 8), toOn: addDays(today, 10) });
check('Pauses can’t overlap', r.status === 409 || r.status === 403, show(r));
r = await call(C1, 'POST', `/c/orders/${order1.id}/pauses`, { fromOn: addDays(today, 20), toOn: addDays(today, 40) });
check('…or go beyond the pause days left', r.status === 403, show(r));
r = await call(C1, 'DELETE', `/c/orders/${order1.id}/pauses/${pauseId}`);
check('A pause not started yet can be dropped', r.body?.order?.pauses?.length === 0 && r.body?.order?.nextWashes?.[0] === addDays(today, 7), show(r));

// ─── At the place, same flat; one wash; a scooter on a plan ──────────────────
const c2 = await newCustomer();
r = await call(null, 'POST', '/c/join', {
  ticket: c2.ticket,
  placeId: P1,
  unit: { unitId: units['101'] },
  location: { latitude: LAT + 0.0003, longitude: LNG },
  vehicles: [
    { vehicleTypeId: hatch.id, choice: { kind: 'single', serviceIds: [info.menu.services.find((s) => s.name === 'Complete Wash').id, info.menu.services.find((s) => s.name === 'Tyre Polish').id] } },
    { vehicleTypeId: scooter.id, choice: { kind: 'plan', planId: MONTHLY, payMode: 'parts' } },
  ],
});
const C2 = r.body?.session?.token;
const single = r.body?.orders?.find((o) => o.kind === 'single');
const scooterPlan = r.body?.orders?.find((o) => o.kind === 'plan');
check('Joining at the place is in at once, but a flat already used gets a “please check” note', r.status === 201 && r.body?.memberStatus === 'active' && r.body?.checks?.join() === 'unit_taken', show(r));
check('A one-time wash (with an extra) is on the next wash day', single?.firstWashOn === addDays(today, 7) && single?.title === 'Complete Wash + Tyre Polish', JSON.stringify(single));
r = await call(C2, 'GET', `/c/orders/${scooterPlan?.id}`);
check('A plan that doesn’t allow parts is paid in full', r.body?.order?.payMode === 'full' && r.body?.order?.installments?.length === 1, show(r));
r = await call(C1, 'GET', `/c/orders/${single?.id}`);
check('One customer can’t see another’s order', r.status === 404, show(r));
r = await call(null, 'POST', '/c/join', {
  ticket: (await newCustomer()).ticket,
  placeId: P1,
  unit: { text: '301' },
  location: { latitude: LAT, longitude: LNG },
  vehicles: [{ vehicleTypeId: hatch.id, choice: { kind: 'plan', planId: 'nope', payMode: 'full' } }],
});
check('An unknown plan is refused', r.status === 400, show(r));

// A second car in the same home: the dearer plan is full price, the other 10% off.
{
  const monthlyFor = (typeId) => info.menu.plans.find((p) => p.id === MONTHLY)?.prices.find((p) => p.vehicleTypeId === typeId)?.total;
  const hatchFull = monthlyFor(hatch.id);
  const scooterFull = monthlyFor(scooter.id);
  r = await call(null, 'POST', '/c/join', {
    ticket: (await newCustomer()).ticket,
    placeId: P1,
    unit: { text: '302' },
    location: { latitude: LAT, longitude: LNG },
    vehicles: [
      { vehicleTypeId: scooter.id, choice: { kind: 'plan', planId: MONTHLY, payMode: 'full' } },
      { vehicleTypeId: hatch.id, choice: { kind: 'plan', planId: MONTHLY, payMode: 'full' } },
    ],
  });
  const [scooterOrder, hatchOrder] = r.body?.orders ?? [];
  const dearerIsHatch = hatchFull >= scooterFull;
  const tenOff = (x) => Math.round((x * 0.9) / 100) * 100;
  check(
    'Two cars in one home on plans: the dearer one is full price, the second 10% off',
    r.status === 201 &&
      hatchOrder?.total === (dearerIsHatch ? hatchFull : tenOff(hatchFull)) &&
      scooterOrder?.total === (dearerIsHatch ? tenOff(scooterFull) : scooterFull) &&
      /second car 10% off/.test((dearerIsHatch ? scooterOrder : hatchOrder)?.title ?? ''),
    `${hatchFull} ${scooterFull} ${JSON.stringify(r.body?.orders)}`,
  );
}

// ─── Parts and renewal ───────────────────────────────────────────────────────
const c6 = await newCustomer();
r = await call(null, 'POST', '/c/join', {
  ticket: c6.ticket,
  placeId: P1,
  unit: { unitId: units['104'] },
  location: { latitude: LAT, longitude: LNG },
  vehicles: [{ vehicleTypeId: hatch.id, choice: { kind: 'plan', planId: QUARTERLY, payMode: 'parts' } }],
});
const C6 = r.body?.session?.token;
const qOrder = r.body?.orders?.[0];
let q = (await call(C6, 'GET', `/c/orders/${qOrder?.id}`)).body?.order;
check('Quarterly in parts: 20% first, then 4 equal parts', q?.installments?.length === 5 && q?.installments?.[0]?.amount === Math.round((q.total * 0.2) / 100) * 100 && q?.installments?.reduce((n, i) => n + i.amount, 0) === q.total, JSON.stringify(q?.installments));
r = await call(C6, 'POST', `/c/orders/${qOrder.id}/pay`);
check('The first payment is the first part', r.body?.payment?.amount === q.installments[0].amount, show(r));
await pay(r.body.payment, C6);
q = (await call(C6, 'GET', `/c/orders/${qOrder.id}`)).body?.order;
check('…after it the plan runs, with the next part due later', q?.status === 'active' && q?.due?.seq === 2 && q?.due?.dueOn > today, JSON.stringify(q?.due));
r = await call(C6, 'POST', `/c/orders/${qOrder.id}/renew`, { payMode: 'full' });
const renewal = r.body?.order;
check('Renewing makes the next plan, starting after this one’s last wash', r.status === 201 && renewal?.renewalOf === qOrder.id && renewal?.status === 'awaiting_payment' && renewal?.firstWashOn > q.nextWashes[0], show(r));
r = await call(C6, 'POST', `/c/orders/${qOrder.id}/renew`, { payMode: 'full' });
check('…once', r.status === 409, show(r));

// ─── Flow E: the team adds someone without a smartphone ──────────────────────
const c3phone = `93${rand(8)}`;
r = await call(STF, 'POST', `/places/${P1}/members/code`, { phone: c3phone });
check('The team sends a code to the person’s phone', r.status === 200 && r.body?.sent === true, show(r));
r = await call(STF, 'POST', `/places/${P1}/members`, { phone: c3phone, code: '999999', unit: { text: '204' }, vehicles: [{ vehicleTypeId: hatch.id, choice: { kind: 'plan', planId: MONTHLY } }] });
check('…a wrong code is refused', r.status === 401, show(r));
r = await call(STF, 'POST', `/places/${P1}/members`, { phone: c3phone, code: DEV_CODE, name: 'Lakshmi garu', unit: { text: '204' }, vehicles: [{ vehicleTypeId: hatch.id, choice: { kind: 'plan', planId: MONTHLY } }] });
const eOrder = r.body?.orders?.[0];
check('…with the code read out, they join at once (the team is at the place)', r.status === 201 && r.body?.memberStatus === 'active', show(r));
r = await call(STF, 'POST', `/places/orders/${eOrder?.id}/payment-link`);
check('The team gets a payment link and a WhatsApp message to send', r.status === 200 && r.body?.message?.includes(r.body?.payment?.url) && r.body?.phone === c3phone, show(r));

// ─── A full place pushes the next member a week ──────────────────────────────
const p2info = (await call(null, 'GET', `/c/places/${P2}`)).body;
const washP2 = p2info?.menu?.services?.find((s) => s.name === 'Complete Wash')?.id;
const joinP2 = async (cust) =>
  call(null, 'POST', '/c/join', {
    ticket: cust.ticket,
    placeId: P2,
    unit: { text: `H-${rand(3)}` },
    location: { latitude: LAT + 0.01, longitude: LNG },
    vehicles: [{ vehicleTypeId: hatch.id, choice: { kind: 'single', serviceIds: [washP2] } }],
  });
const c4 = await newCustomer();
const c5 = await newCustomer();
const j4 = await joinP2(c4);
const j5 = await joinP2(c5);
check('The first at a one-vehicle place gets next week', j4.body?.orders?.[0]?.firstWashOn === addDays(today, 7), show(j4));
check('…the next one the week after', j5.body?.orders?.[0]?.firstWashOn === addDays(today, 14), show(j5));

// ─── Cancelling and removing ─────────────────────────────────────────────────
r = await call(C1, 'POST', `/c/orders/${order1.id}/cancel`, { reason: 'Selling the car' });
const expectedRefund = order1.total - doorHatch;
check('Cancelling a running plan refunds all but the wash given (at the one-wash price)', r.status === 200 && r.body?.refund === expectedRefund && r.body?.order?.status === 'cancelled', show(r));
r = await call(OWN, 'GET', `/places/orders/${order1.id}`);
check('…the refund went through and is on the payment', r.body?.refunds?.[0]?.status === 'processed' && r.body?.refunds?.[0]?.amount === expectedRefund && r.body?.payments?.find((p) => p.status === 'paid')?.refunded === expectedRefund, show(r));
r = await call(C1, 'POST', `/c/orders/${order1.id}/cancel`, {});
check('…once', r.status === 409, show(r));

const m2 = (await call(STF, 'GET', `/places/${P1}/members`)).body?.members?.find((m) => m.customer.phone === c2.phone);
r = await call(STF, 'POST', `/places/members/${m2.id}/remove`, { reason: 'Not at this building' });
check('The team removes a member; their unpaid orders close', r.status === 200 && r.body?.refunded === 0, show(r));
r = await call(C2, 'GET', `/c/orders/${single.id}`);
check('…the customer sees it cancelled', r.body?.order?.status === 'cancelled', show(r));

// Removing someone with a paid plan refunds it: the owner's call, not the team's.
const cPaid = await newCustomer();
const jPaid = await joinP2(cPaid);
d1Run(`UPDATE place_orders SET status = 'active' WHERE id = '${jPaid.body?.orders?.[0]?.id}';`);
const mPaid = (await call(OWN, 'GET', `/places/${P2}/members`)).body?.members?.find((m) => m.customer.phone === cPaid.phone);
r = await call(STF, 'POST', `/places/members/${mPaid?.id}/remove`, { reason: 'Test' });
check('Staff can’t remove a member with a paid plan', r.status === 403, show(r));
r = await call(OWN, 'POST', `/places/members/${mPaid?.id}/remove`, { reason: 'Test' });
check('…the owner can', r.status === 200, show(r));

const C4 = j4.body?.session?.token;
const m4 = (await call(C4, 'GET', '/c/home/places')).body?.memberships?.[0];
check('My place shows the membership and its vehicle', m4?.place?.id === P2 && m4?.vehicles?.[0]?.orders?.[0]?.status === 'awaiting_payment', JSON.stringify(m4).slice(0, 300));
r = await call(C4, 'POST', `/c/members/${m4.id}/leave`, { reason: 'Moving' });
check('Moving out ends the membership and closes the order', r.status === 200 && (await call(C4, 'GET', '/c/home/places')).body?.memberships?.length === 0, show(r));

// ─── The nightly job (needs `wrangler dev --test-scheduled`) ─────────────────
const order5 = j5.body?.orders?.[0];
d1Run(
  `UPDATE place_orders SET first_wash_on = '${today}' WHERE id = '${order5?.id}';` +
    `UPDATE place_orders SET created_at = '${new Date(Date.now() - 40 * 86400000).toISOString()}' WHERE id = '${renewal?.id}';`,
);
r = await call(null, 'GET', `/__scheduled?cron=${encodeURIComponent('30 21 * * *')}`);
if (r.status === 200) {
  // The job keeps running after /__scheduled answers.
  const C5 = j5.body?.session?.token;
  let o5;
  for (let i = 0; i < 40; i++) {
    o5 = (await call(C5, 'GET', `/c/orders/${order5.id}`)).body?.order;
    if (o5?.firstWashOn !== today) break;
    await new Promise((res) => setTimeout(res, 250));
  }
  check('Nightly: an unpaid first wash whose pay-by time passed moves to the next free day', o5?.status === 'awaiting_payment' && o5?.firstWashOn === addDays(today, 7), JSON.stringify(o5 && { status: o5.status, firstWashOn: o5.firstWashOn }));
  const old = (await call(C6, 'GET', `/c/orders/${renewal.id}`)).body?.order;
  check('Nightly: an order left unpaid too long is closed', old?.status === 'cancelled' && old?.cancelReason === 'not_paid', JSON.stringify(old && { status: old.status, reason: old.cancelReason }));
} else {
  console.log('SKIP  Nightly job (start the API with `npm run dev`, which allows test runs of it)');
}

// ─── Demand and invites; the shorter "Call me back" ──────────────────────────
const NEW_LAT = LAT + 0.05;
const r1 = await newCustomer();
const r2 = await newCustomer();
r = await call(null, 'POST', '/c/service-requests', { ticket: r1.ticket, location: { latitude: NEW_LAT, longitude: LNG }, cars: 1, bikes: 0 });
check('“Call me back” needs only the location and the vehicles', r.status === 201, show(r));
await call(null, 'POST', '/c/service-requests', { ticket: r2.ticket, location: { latitude: NEW_LAT + 0.0005, longitude: LNG }, address: 'Street 3', cars: 0, bikes: 1 });
r = await call(STF, 'GET', '/places/demand');
const cluster = r.body?.clusters?.find((g) => Math.abs(g.center.latitude - NEW_LAT) < 0.001);
check('Requests close together show as one place’s demand', cluster?.requests === 2 && cluster?.cars === 1 && cluster?.bikes === 1, show(r));
r = await call(STF, 'POST', '/places', { type: 'street', label: 'Street 3 houses', latitude: NEW_LAT, longitude: LNG });
const streetPlace = r.body?.id;
r = await call(null, 'POST', '/c/service-requests/mine', { ticket: r1.ticket });
check('A draft there doesn’t invite anyone yet', !r.body?.requests?.[0]?.invitedPlaceId, show(r));
r = await call(OWN, 'POST', `/places/${streetPlace}/go-live`, { washDays: [weekday], washTime: '07:00' });
check('Going live there invites both', r.status === 200 && r.body?.invited === 2, show(r));
r = await call(null, 'POST', '/c/service-requests/mine', { ticket: r1.ticket });
check('…the requester sees the invite', !!streetPlace && r.body?.requests?.[0]?.invitedPlaceId === streetPlace, show(r));

// ─── Public pages ────────────────────────────────────────────────────────────
r = await call(null, 'GET', `/p/${CODE}`);
check('The invite link opens a page that opens the app on the place', r.status === 200 && r.body.includes(`manawash://place/${CODE}`) && r.body.includes('Sai Residency'), `${r.status}`);
r = await call(null, 'GET', `/p/${CODE}/poster`);
check('The poster has a QR and the code', r.status === 200 && r.body.includes('<svg') && r.body.includes(CODE), `${r.status}`);
r = await call(null, 'GET', '/p/ZZZZZZZ');
check('An unknown code shows a friendly page', r.status === 404 && r.body.includes('isn’t on Mana Wash'), `${r.status}`);

// ─── Webhook (Razorpay mode only) ────────────────────────────────────────────
r = await call(STF, 'POST', `/places/orders/${eOrder.id}/payment-link`);
const eLink = r.body?.payment;
if (!eLink?.url?.includes('/pay/test/') && WEBHOOK_SECRET) {
  const link = [...standin.links.values()].find((l) => eLink.url.endsWith(l.id));
  const event = JSON.stringify({
    event: 'payment_link.paid',
    payload: { payment_link: { entity: { ...link, status: 'paid' } }, payment: { entity: { id: `pay_wh_${standin.run}`, method: 'upi', status: 'captured', amount: link.amount } } },
  });
  const sig = createHmac('sha256', WEBHOOK_SECRET).update(event).digest('hex');
  r = await call(null, 'POST', '/pay/webhook', event, { 'content-type': 'application/json', 'x-razorpay-signature': sig });
  await call(null, 'POST', '/pay/webhook', event, { 'content-type': 'application/json', 'x-razorpay-signature': sig });
  const paidRows = d1Rows(`SELECT count(*) AS n FROM customer_payments WHERE order_id = '${eOrder.id}' AND status = 'paid'`);
  check('A signed webhook confirms the link payment (twice changes nothing)', r.status === 200 && paidRows[0]?.n === 1, show(r));
  r = await call(null, 'POST', '/pay/webhook', event, { 'content-type': 'application/json', 'x-razorpay-signature': 'bad' });
  check('…a forged one is refused', r.status === 400, show(r));
} else if (eLink?.url?.includes('/pay/test/')) {
  const path = new URL(eLink.url).pathname;
  r = await call(null, 'POST', path, new URLSearchParams({ action: 'fail' }));
  const failedRow = d1Rows(`SELECT status FROM customer_payments WHERE id = '${eLink.id}'`);
  check('A failed test payment changes nothing (the link can be made again)', r.status === 303 && failedRow[0]?.status === 'failed', show(r));
} else {
  console.log('SKIP  Signed webhook (set RAZORPAY_WEBHOOK_SECRET in this shell to include it)');
}
void KEY_SECRET;

standinServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
