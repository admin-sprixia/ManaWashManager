// What each branch offers, end to end against the local API: head office sets what a branch's
// agreement allows (when opening it, and later); the owner switches those on and off, never
// more; the branch's hub and community team follow; Doorstep needs the community team; a branch
// keeps the hub or communities; Community can't be taken away while community plans run.
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:branch-services               (in another)
// Run after `npm run test:places` to also check the running-plans rule on the seed branch.
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
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`;
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
const s = (hub, community, doorstep) => ({ hub, community, doorstep });
const points = (shopId) => d1Rows(`SELECT kind, active FROM service_points WHERE shop_id = '${shopId}' ORDER BY kind`);

const hq = (await signIn(HQ, PIN)).body?.token;
if (!hq) throw new Error('Couldn’t sign in as HQ (9100000000). Run `npm run db:reset:local` first.');

// ─── Opening a branch with its agreement ──────────────────────────────────

const KAVALI = { pincode: '524201', latitude: 14.9163, longitude: 79.9945, town: null };
const ownerPhone = newPhone();
let r = await call(hq, 'POST', '/business/branches/preview', KAVALI);
const confirmed = (r.body?.plan?.checks ?? []).map((k) => k.kind);
r = await call(hq, 'POST', '/business/branches', { ...KAVALI, ownerName: 'Venkat', ownerPhone, confirmed, services: s(true, false, true) });
check('Doorstep without Community can’t be in an agreement', r.status === 400, show(r));
r = await call(hq, 'POST', '/business/branches', { ...KAVALI, ownerName: 'Venkat', ownerPhone, confirmed, services: s(false, false, false) });
check('An agreement needs the hub or communities', r.status === 400, show(r));
r = await call(hq, 'POST', '/business/branches', { ...KAVALI, ownerName: 'Venkat', ownerPhone, confirmed, services: s(true, true, false), vehicles: ['bt_nope'] });
check('A branch can’t be opened with a kind of vehicle that doesn’t exist', r.status === 404, show(r));
r = await call(hq, 'POST', '/business/branches', { ...KAVALI, ownerName: 'Venkat', ownerPhone, confirmed, services: s(true, true, false) });
check('HQ opens Kavali with Hub and Community only', r.status === 201, show(r));
const kavali = r.body.id;
r = await call(hq, 'GET', '/business/catalog');
{
  const start = new Set(r.body?.classes?.filter((c) => c.key === 'car' || c.key === 'twoWheeler').map((c) => c.id));
  const want = r.body?.bodyTypes?.filter((b) => start.has(b.classId)).map((b) => b.id).sort();
  const got = [...(r.body?.branches?.find((b) => b.id === kavali)?.vehicles ?? [])].sort();
  check('A new branch washes cars and two-wheelers to start with', want?.length > 0 && JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
}
const owner = (await signIn(ownerPhone, PIN)).body?.token;

r = await call(owner, 'GET', '/services/network');
check(
  'The branch opens with what its agreement allows switched on',
  JSON.stringify(r.body?.services?.allowed) === JSON.stringify(s(true, true, false)) && r.body?.lanes?.hub && r.body?.lanes?.community && !r.body?.lanes?.doorstep,
  show(r),
);
check('…and its hub and community team are made', JSON.stringify(points(kavali)) === JSON.stringify([{ kind: 'doorstep', active: 1 }, { kind: 'hub', active: 1 }]), JSON.stringify(points(kavali)));

// ─── The owner's switches, inside the agreement ───────────────────────────

r = await call(owner, 'PUT', '/branch/types', s(true, true, true));
check('The owner can’t switch on Doorstep (not in the agreement)', r.status === 403 && r.body?.error === 'not_allowed', show(r));
r = await call(owner, 'PUT', '/branch/types', s(false, false, false));
check('…nor switch everything off', r.status === 400, show(r));
r = await call(owner, 'PUT', '/branch/types', s(true, false, false));
check('The owner switches Community off', r.status === 200 && r.body?.services?.live?.community === false, show(r));
check('…and the team is paused, not deleted', JSON.stringify(points(kavali)) === JSON.stringify([{ kind: 'doorstep', active: 0 }, { kind: 'hub', active: 1 }]), JSON.stringify(points(kavali)));
r = await call(owner, 'GET', '/services/network');
check('…the home screen loses its Communities tab', r.body?.lanes?.community === false, show(r));
r = await call(owner, 'PUT', '/branch/types', s(true, true, false));
check('Switching it back on brings the same team back', r.status === 200 && points(kavali).filter((p) => p.kind === 'doorstep').length === 1 && points(kavali).every((p) => p.active === 1), JSON.stringify(points(kavali)));
const team = (await call(owner, 'GET', '/branch/points')).body.points.find((p) => p.kind === 'doorstep');
r = await call(owner, 'PATCH', `/branch/points/${team.id}`, { active: false });
check('Pausing the team on How this branch washes switches Community off too', r.status === 200 && (await call(owner, 'GET', '/services/network')).body?.services?.offered?.community === false, show(r));
await call(owner, 'PUT', '/branch/types', s(true, true, false));

// ─── Head office changes the agreement ────────────────────────────────────

r = await call(hq, 'PUT', `/business/branches/${kavali}/services`, s(true, true, true));
check('HQ adds Doorstep to Kavali’s agreement', r.status === 200 && r.body?.services?.allowed?.doorstep === true && r.body.services.live.doorstep === false, show(r));
r = await call(owner, 'PUT', '/branch/types', s(true, true, true));
check('…and now the owner can switch it on', r.status === 200 && r.body?.services?.live?.doorstep === true, show(r));
r = await call(hq, 'PUT', `/business/branches/${kavali}/services`, s(false, true, true));
check('HQ takes the hub away: it’s paused and the rest keeps running', r.status === 200 && r.body?.services?.live?.hub === false && r.body.services.live.community === true, show(r));
check('…the hub is paused at the branch', points(kavali).find((p) => p.kind === 'hub')?.active === 0, JSON.stringify(points(kavali)));
r = await call(owner, 'PUT', '/branch/types', s(true, true, true));
check('…and the owner can’t switch it back on', r.status === 403, show(r));
r = await call(hq, 'PUT', `/business/branches/${kavali}/services`, s(false, false, false));
check('An agreement with nothing is refused', r.status === 400, show(r));
r = await call(hq, 'PUT', `/business/branches/${kavali}/services`, s(true, false, false));
check('Taking Community away (no plans running) leaves the hub on', r.status === 200 && JSON.stringify(r.body?.services?.live) === JSON.stringify(s(true, false, false)), show(r));
r = await call(owner, 'GET', '/business/catalog');
check('A branch owner can’t change agreements', (await call(owner, 'PUT', `/business/branches/${kavali}/services`, s(true, true, true))).status === 403, show(r));

// ─── Community stays while plans run ──────────────────────────────────────

// A branch with community plans running (the places check leaves one), and its owner, who is HQ there.
const busy = d1Rows(`SELECT o.shop_id AS shopId, u.phone AS phone FROM place_orders o
  JOIN users u ON u.shop_id = o.shop_id AND u.role = 'owner' AND u.removed_at IS NULL
  JOIN shops sh ON sh.id = o.shop_id
  JOIN business_admins a ON a.business_id = sh.business_id AND a.phone = u.phone
  WHERE o.status IN ('waitlist', 'awaiting_payment', 'active') LIMIT 1`)[0];
if (busy) {
  const boss = (await signIn(busy.phone, PIN)).body?.token;
  r = await call(boss, 'PUT', `/business/branches/${busy.shopId}/services`, s(true, false, false));
  check('HQ can’t take Community away while community plans run', r.status === 409 && r.body?.error === 'plans_running', show(r));
  r = await call(boss, 'PUT', '/branch/types', s(true, false, false));
  check('…nor can the owner switch it off', r.status === 409 && r.body?.error === 'plans_running', show(r));
  r = await call(boss, 'GET', '/services/network');
  check('…and Community is still on', r.body?.lanes?.community === true, show(r));
} else {
  console.log('(No community plans running anywhere: run `npm run test:places` first to check the running-plans rule.)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
