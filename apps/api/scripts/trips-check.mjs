// Counts how many database round trips each screen's request makes, one after another.
// Locally the database answers instantly, so start the API with a fixed delay on every
// database call and time each request against it:
//   cd apps/api && npm run db:reset:local && npm run dev    (then, in another terminal)
//   npm run db:seed:demo                                     (a realistic shop to read)
//   stop dev, then: npx wrangler dev --var DEV_DB_DELAY_MS:100
//   npm run perf:trips
// On the real servers each trip costs what the database is away (about 150 ms from India
// to Cloudflare's Asia-Pacific database), so fewer trips is what makes a screen faster.
const API = process.env.API_URL ?? 'http://localhost:8787';
const DELAY = Number(process.env.DEV_DB_DELAY_MS ?? 100);
const PHONE = process.env.PHONE ?? '9888626111';
const PIN = process.env.PIN ?? '2580';

async function call(token, path) {
  const started = performance.now();
  const res = await fetch(API + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, ms: performance.now() - started };
}

const login = await fetch(`${API}/auth/pin/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ phone: PHONE, pin: PIN }),
}).then((r) => r.json());
const token = login.token;
if (!token) {
  console.error('Sign-in failed — run npm run db:seed:demo first.', login);
  process.exit(1);
}

const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const jobs = await call(token, '/jobs/today');
const someJob = jobs.body?.jobs?.[0]?.id ?? jobs.body?.[0]?.id;
const dir = await call(token, '/customers/directory');
const someCustomer = dir.body?.entries?.[0]?.customerId;
const somePlate = dir.body?.entries?.find((e) => e.registrationNumber)?.registrationNumber;

const paths = [
  '/auth/me',
  '/auth/shops',
  '/billing/plan',
  '/jobs/today',
  someJob && `/jobs/${someJob}`,
  '/jobs/stats?range=week',
  '/services',
  '/services/vehicle-types',
  '/services/prices',
  '/services/commissions',
  '/customers/directory',
  someCustomer && `/customers/${someCustomer}`,
  `/cash/day?date=${today}`,
  '/cash/history?range=week',
  '/expenses',
  '/stock',
  '/reminders',
  '/team',
  '/team/requests',
  `/attendance?date=${today}`,
  '/shop/roster',
  '/shop/settings',
  '/shop/info',
  '/reports/staff?range=week',
  '/rewards/settings',
  somePlate && `/rewards/vehicle?registrationNumber=${somePlate}`,
  someCustomer && `/rewards/customer/${someCustomer}`,
  '/rewards/gifts/owed',
  '/rewards/report?range=week',
].filter(Boolean);

console.log(`Each database trip is delayed ${DELAY} ms.\n`);
let total = 0;
for (const path of paths) {
  await call(token, path);
  const r = await call(token, path);
  const trips = Math.round(r.ms / DELAY);
  total += trips;
  console.log(`${String(trips).padStart(3)} trips  ${String(Math.round(r.ms)).padStart(5)} ms  ${r.status}  ${path}`);
}
console.log(`\n${total} trips across ${paths.length} requests`);
