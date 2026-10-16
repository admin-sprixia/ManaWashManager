// Proves who can fix and delete expenses. Run against the local API:
//   cd apps/api && npm run db:reset:local && npm run dev      (in one terminal)
//   cd apps/api && npm run test:expenses                      (in another)
// Staff log expenses but can't edit or delete any; the owner and managers can, with a reason.
// Edits are logged (and show in the staff report), stock follows a changed purchase, and a
// deleted expense can't be edited.
import { API, apiFetch, signIn } from './lib/target.mjs';

const PIN = '258025';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}
const show = (r) => JSON.stringify(r.body).slice(0, 300);

async function call(token, method, path, body) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
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

const newPhone = () => `6${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const id = (p) => `${p}${Math.random().toString(36).slice(2, 12)}`;
const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

async function addExpense(token, data) {
  const form = new FormData();
  form.append('data', JSON.stringify({ date: today, paymentMethod: 'cash', ...data }));
  form.append('billPhoto', jpeg, 'bill.jpg');
  form.append('itemPhoto', jpeg, 'item.jpg');
  return call(token, 'POST', '/expenses', form);
}

async function signInAs(phone) {
  const r = await signIn(phone, PIN);
  if (!r.body?.token) throw new Error(`Sign-in failed for ${phone}: ${show(r)}`);
  return r.body.token;
}

// ─── Setup: the owner, a manager and a staff member ──────────────────────

const owner = await signInAs('9100000000');
const managerPhone = newPhone();
const staffPhone = newPhone();
let r = await call(owner, 'POST', '/team', { name: 'Expense Manager', phone: managerPhone, role: 'manager' });
check('The owner adds a manager', r.status === 201, show(r));
r = await call(owner, 'POST', '/team', { name: 'Expense Staff', phone: staffPhone, role: 'staff' });
check('The owner adds a staff member', r.status === 201, show(r));
const manager = await signInAs(managerPhone);
const staff = await signInAs(staffPhone);

// ─── Staff log, but can't fix or delete ──────────────────────────────────

const staffExpense = id('exp');
r = await addExpense(staff, { id: staffExpense, category: 'chemicals', amount: 45000, itemName: 'Expense check foam', quantity: 2, unit: 'l', addToStock: true });
check('Staff log an expense into stock', r.status === 200 || r.status === 201, show(r));

r = await call(staff, 'PATCH', `/expenses/${staffExpense}`, { amount: 40000, reason: 'Wrong amount' });
check('Staff can’t edit an expense, even their own', r.status === 403, show(r));
r = await call(staff, 'POST', `/expenses/${staffExpense}/void`, { reason: 'Entered twice' });
check('Staff can’t delete an expense, even their own same-day one', r.status === 403, show(r));

r = await call(manager, 'GET', '/expenses?range=today');
check('A manager sees expenses others logged', r.status === 200 && r.body.items?.some((e) => e.id === staffExpense), show(r));
r = await call(staff, 'GET', '/expenses?range=today');
check('Staff see only their own', r.status === 200 && r.body.items?.every((e) => e.createdByUserId === r.body.items[0]?.createdByUserId), show(r));

// ─── A manager fixes it; stock follows ───────────────────────────────────

r = await call(manager, 'PATCH', `/expenses/${staffExpense}`, { amount: 40000 });
check('An edit needs a reason', r.status === 400, show(r));
r = await call(manager, 'PATCH', `/expenses/${staffExpense}`, { amount: 45000, reason: 'Wrong amount' });
check('An edit that changes nothing is refused', r.status === 400 && r.body?.error === 'no_changes', show(r));
r = await call(manager, 'PATCH', `/expenses/${staffExpense}`, { amount: 40000, quantity: 3, reason: 'Wrong amount' });
check('A manager edits the amount and quantity', r.status === 200 && r.body?.changes?.length === 2, show(r));

r = await call(owner, 'GET', '/stock');
const foam = r.body?.items?.find((i) => i.name === 'Expense check foam');
check('Stock follows the new quantity (2 L out, 3 L in)', foam != null && Math.abs(foam.balance - 3) < 0.001, show({ body: foam }));

r = await call(owner, 'GET', `/expenses/${staffExpense}/edits`);
check('The edit is logged with who, why and what', r.status === 200 && r.body.edits?.length === 1 && r.body.edits[0].reason === 'Wrong amount' && r.body.edits[0].editedBy?.name === 'Expense Manager', show(r));
r = await call(owner, 'GET', '/expenses?range=today');
check('The list marks it as edited', r.body.items?.find((e) => e.id === staffExpense)?.edited === true, show(r));
r = await call(owner, 'GET', '/reports/audit?range=today');
const auditEdit = r.body?.items?.find((x) => x.kind === 'expense_edit' && x.reason === 'Wrong amount');
check('The edit shows in the staff report', auditEdit != null && auditEdit.fromValue?.includes('₹450') && auditEdit.toValue?.includes('₹400'), show({ body: auditEdit }));

r = await call(manager, 'PATCH', `/expenses/${staffExpense}`, { date: '2099-01-01', reason: 'Wrong date' });
check('An edit can’t move it to the future', r.status === 400, show(r));

// ─── Delete ──────────────────────────────────────────────────────────────

r = await call(manager, 'POST', `/expenses/${staffExpense}/void`, { reason: 'Entered twice' });
check('A manager deletes it with a reason', r.status === 200, show(r));
r = await call(owner, 'GET', '/stock');
const foamAfter = r.body?.items?.find((i) => i.name === 'Expense check foam');
check('Deleting takes it back out of stock', foamAfter != null && Math.abs(foamAfter.balance) < 0.01, show({ body: foamAfter }));
r = await call(owner, 'PATCH', `/expenses/${staffExpense}`, { amount: 30000, reason: 'Wrong amount' });
check('A deleted expense can’t be edited', r.status === 409, show(r));

const ownerExpense = id('exp');
await addExpense(owner, { id: ownerExpense, category: 'other', amount: 9900, itemName: 'Expense check broom' });
r = await call(owner, 'PATCH', `/expenses/${ownerExpense}`, { itemName: 'Expense check mop', paymentMethod: 'upi', reason: 'Wrong item' });
check('The owner edits the item and payment', r.status === 200 && r.body?.changes?.length === 2, show(r));
r = await call(owner, 'POST', `/expenses/${ownerExpense}/void`, { reason: 'Not a shop expense' });
check('The owner deletes an expense', r.status === 200, show(r));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
