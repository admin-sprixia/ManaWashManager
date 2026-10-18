// Inventory end to end: the owner sets up items (opening stock, alert level, one live item per
// name), everyone logs what they use in any matching unit (500 ml off a litre balance), only the
// owner adds stock without a bill or corrects a count, the shelf never goes below zero (the note
// keeps what was really meant), replays and parallel counts land once, removed items take no
// moves and free their name, and another branch sees none of it. Run against the local API:
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:stock                         (in another)
import { API, apiFetch, d1Run, signIn as signInWith } from './lib/target.mjs';

const PIN = '258025';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`;

async function call(token, method, path, body) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await apiFetch(API + path, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const run = Date.now().toString(36);
const rand = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const moveId = () => `mv_${run}_${rand(8)}`;

const SHOP = `shop_stk_${run}`;
const OTHER = `shop_stk2_${run}`;
const phone = { owner: `93${rand(8)}`, staff: `93${rand(8)}`, other: `93${rand(8)}` };
d1Run(
  `INSERT INTO shops (id, code, name, menu_version) VALUES ('${SHOP}', '${rand(6)}', 'Stock Check Wash', 1), ('${OTHER}', '${rand(6)}', 'Stock Other', 1);` +
    `INSERT INTO users (id, shop_id, name, phone, role) VALUES ('user_stk_o_${run}', '${SHOP}', 'Stock Owner', '${phone.owner}', 'owner'), ('user_stk_s_${run}', '${SHOP}', 'Stock Staff', '${phone.staff}', 'staff'), ('user_stk_x_${run}', '${OTHER}', 'Other Owner', '${phone.other}', 'owner');`,
);

const T = {};
for (const [who, p] of Object.entries(phone)) T[who] = (await signInWith(p, PIN)).body?.token;
check('Owner, staff and another branch’s owner sign in', Object.values(T).every(Boolean));
if (!Object.values(T).every(Boolean)) process.exit(1);

const move = (token, body) => call(token, 'POST', '/stock/moves', { id: moveId(), ...body });
const list = async (token = T.owner) => (await call(token, 'GET', '/stock')).body;
const itemOf = async (id, token = T.owner) => (await list(token))?.items?.find((i) => i.id === id);

// ─── Setting up ──────────────────────────────────────────────────────────────

let r = await call(T.owner, 'POST', '/stock', { name: 'Foam  shampoo', unit: 'l', lowAt: 2, opening: 5 });
const FOAM = r.body?.id;
check('The owner adds foam shampoo with 5 L on the shelf and an alert at 2 L', r.status === 201 && r.body?.name === 'Foam shampoo' && r.body?.balance === 5 && r.body?.level === 'ok', show(r));
r = await call(T.owner, 'POST', '/stock', { name: ' FOAM shampoo ', unit: 'l' });
check('The same name again (any case or spacing) is refused', r.status === 409 && r.body?.error === 'duplicate', show(r));
r = await call(T.staff, 'POST', '/stock', { name: 'Car wax', unit: 'l' });
check('Staff can’t set up items', r.status === 403, show(r));
r = await call(T.owner, 'POST', '/stock', { name: 'Big', unit: 'l', opening: 100001 });
check('A number with extra zeros is refused', r.status === 400, show(r));

// ─── Using ───────────────────────────────────────────────────────────────────

const useId = moveId();
r = await call(T.staff, 'POST', '/stock/moves', { id: useId, itemId: FOAM, kind: 'use', quantity: 500, unit: 'ml' });
check('Staff log 500 ml used: 4.5 L left', r.status === 201 && r.body?.item?.balance === 4.5, show(r));
r = await call(T.staff, 'POST', '/stock/moves', { id: useId, itemId: FOAM, kind: 'use', quantity: 500, unit: 'ml' });
check('…sent again (offline replay), it counts once', r.status === 200 && r.body?.id === useId && (await itemOf(FOAM))?.balance === 4.5, show(r));
check('…and shows as used this week', (await itemOf(FOAM))?.usedWeek === 0.5);
r = await move(T.staff, { itemId: FOAM, kind: 'use', quantity: 1, unit: 'kg' });
check('A unit that doesn’t fit the item is refused', r.status === 400 && r.body?.error === 'wrong_unit', show(r));
r = await move(T.staff, { itemId: FOAM, kind: 'use', quantity: 0, unit: 'l' });
check('Using nothing is refused', r.status === 400, show(r));

// ─── Adding and counting ─────────────────────────────────────────────────────

r = await move(T.staff, { itemId: FOAM, kind: 'in', quantity: 2, unit: 'l' });
check('Staff can’t add stock without a bill', r.status === 403 && r.body?.error === 'owner_only', show(r));
r = await move(T.staff, { itemId: FOAM, kind: 'count', quantity: 9, unit: 'l' });
check('…nor correct a count', r.status === 403 && r.body?.error === 'owner_only', show(r));
r = await move(T.owner, { itemId: FOAM, kind: 'in', quantity: 2, unit: 'l' });
check('The owner adds 2 L: 6.5 L', r.status === 201 && r.body?.item?.balance === 6.5, show(r));
r = await move(T.owner, { itemId: FOAM, kind: 'count', quantity: 1500, unit: 'ml', note: 'Shelf count' });
check('A shelf count of 1.5 L sets the balance to what’s really there', r.status === 201 && r.body?.item?.balance === 1.5, show(r));
check('…and it’s now low (at or under 2 L)', r.body?.item?.level === 'low' && (await list())?.low >= 1, show(r));
r = await call(T.owner, 'GET', `/stock/${FOAM}/moves`);
const counted = r.body?.moves?.[0];
check('History shows the count as −5 L, with who did it', counted?.kind === 'count' && counted?.quantity === -5 && counted?.balanceAfter === 1.5 && counted?.createdBy?.name === 'Stock Owner', JSON.stringify(counted));

r = await move(T.staff, { itemId: FOAM, kind: 'use', quantity: 2, unit: 'l', note: 'Busy day' });
check('Using 2 L when the books say 1.5 L empties it, never below zero', r.status === 201 && r.body?.item?.balance === 0 && r.body?.item?.level === 'out', show(r));
r = await call(T.owner, 'GET', `/stock/${FOAM}/moves`);
check('…and the note keeps what was really meant', /2 L meant, only 1\.5 L on the books/.test(r.body?.moves?.[0]?.note ?? ''), JSON.stringify(r.body?.moves?.[0]));

r = await call(T.owner, 'POST', '/stock', { name: 'Glass cleaner', unit: 'l' });
const GLASS = r.body?.id;
for (let i = 0; i < 3; i++) await move(T.owner, { itemId: GLASS, kind: 'in', quantity: 100, unit: 'ml' });
check('Three 100 ml adds make exactly 0.3 L, no float dust', (await itemOf(GLASS))?.balance === 0.3, String((await itemOf(GLASS))?.balance));

const [c1, c2] = await Promise.all([
  move(T.owner, { itemId: GLASS, kind: 'count', quantity: 2, unit: 'l' }),
  move(T.owner, { itemId: GLASS, kind: 'count', quantity: 3, unit: 'l' }),
]);
const after = (await itemOf(GLASS))?.balance;
check('Two counts at once both land, one after the other: the shelf ends at one of them', c1.status === 201 && c2.status === 201 && [2, 3].includes(after), `${show(c1)} | ${show(c2)} | ${after}`);

// ─── Renaming and removing ───────────────────────────────────────────────────

r = await call(T.owner, 'PATCH', `/stock/${GLASS}`, { name: 'foam shampoo' });
check('Renaming to another item’s name is refused', r.status === 409 && r.body?.error === 'duplicate', show(r));
r = await call(T.owner, 'PATCH', `/stock/${GLASS}`, { name: 'Glass cleaner (blue)', lowAt: 1 });
check('…a new name and alert level are saved', r.status === 200 && r.body?.name === 'Glass cleaner (blue)' && r.body?.lowAt === 1, show(r));
r = await call(T.staff, 'DELETE', `/stock/${FOAM}`);
check('Staff can’t remove an item', r.status === 403, show(r));
r = await call(T.owner, 'DELETE', `/stock/${FOAM}`);
check('The owner removes foam shampoo: it leaves the list', r.status === 200 && !(await list())?.items?.some((i) => i.id === FOAM), show(r));
r = await move(T.staff, { itemId: FOAM, kind: 'use', quantity: 1, unit: 'l' });
check('…takes no more moves', r.status === 404, show(r));
r = await call(T.owner, 'POST', '/stock', { name: 'Foam shampoo', unit: 'l' });
check('…and its name is free for a new item', r.status === 201 && r.body?.id !== FOAM, show(r));

// ─── Another branch ──────────────────────────────────────────────────────────

const theirs = await list(T.other);
check('Another branch sees none of these items', theirs?.items?.length === 0, JSON.stringify(theirs));
r = await move(T.other, { itemId: GLASS, kind: 'use', quantity: 1, unit: 'l' });
check('…and can’t take from them', r.status === 404, show(r));
r = await call(T.other, 'GET', `/stock/${GLASS}/moves`);
check('…or read their history', r.status === 404, show(r));

// ─── Clean up ────────────────────────────────────────────────────────────────

try {
  d1Run(
    `PRAGMA foreign_keys = OFF; ${[SHOP, OTHER].map((s) => `DELETE FROM stock_moves WHERE shop_id = '${s}'; DELETE FROM stock_items WHERE shop_id = '${s}'; DELETE FROM login_codes WHERE shop_id = '${s}'; DELETE FROM users WHERE shop_id = '${s}'; DELETE FROM shops WHERE id = '${s}';`).join(' ')}`,
  );
} catch {
  // Left behind for the next db:reset:local.
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
