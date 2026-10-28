// The WhatsApp assistant end to end: Meta's webhook check, signed deliveries (unsigned ones
// refused), a customer saying hi, picking Car → company → model and getting that model's prices,
// typing a model, location, STOP/START, a repeated delivery answered once, and delivery reports.
// A stand-in Graph API on :8798 records what the server sends back. Only writes the whatsapp_*
// tables and rate_limits, so it can run against your local data. Run the API with:
//   npx wrangler dev --var DEV_MODE:true --var WHATSAPP_API_BASE:http://127.0.0.1:8798 \
//     --var WHATSAPP_API_TOKEN:standin --var WHATSAPP_PHONE_NUMBER_ID:standin-phone \
//     --var WHATSAPP_APP_SECRET:local-app-secret --var WHATSAPP_VERIFY_TOKEN:local-verify \
//     --var WHATSAPP_OTP_BYPASS:true --var WHATSAPP_BUSINESS_ID:<business id>
//   cd apps/api && npm run test:whatsapp
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { API, apiFetch, d1Rows } from './lib/target.mjs';

const APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? 'local-app-secret';
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? 'local-verify';
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? 'standin-phone';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}

// ─── Stand-in Graph API ──────────────────────────────────────────────────────
const sent = [];
let n = 0;
const graph = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  res.writeHead(200, { 'content-type': 'application/json' });
  if (body.status === 'read') return res.end(JSON.stringify({ success: true }));
  sent.push(body);
  res.end(JSON.stringify({ messages: [{ id: `wamid.standin.${Date.now().toString(36)}.${++n}` }] }));
});
await new Promise((resolve, reject) => {
  graph.once('error', reject);
  graph.listen(8798, '127.0.0.1', resolve);
});

// ─── Webhook deliveries ──────────────────────────────────────────────────────
const phone = `6${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const sign = (body) => `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
let msgN = 0;

async function deliver(value, { signature } = {}) {
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: PHONE_ID }, ...value } }] }],
  });
  const res = await apiFetch(`${API}/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature ?? sign(body) },
    body,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** A customer message; returns what the server sent back to them. */
async function say(message, { id } = {}) {
  const before = sent.length;
  const r = await deliver({
    contacts: [{ wa_id: `91${phone}`, profile: { name: 'Ravi Kumar' } }],
    messages: [{ from: `91${phone}`, id: id ?? `wamid.in.${phone}.${++msgN}`, timestamp: `${Math.floor(Date.now() / 1000)}`, ...message }],
  });
  if (r.status !== 200) throw new Error(`webhook ${r.status} ${JSON.stringify(r.body)}`);
  return sent.slice(before).filter((m) => m.to === `91${phone}`);
}
const text = (body) => say({ type: 'text', text: { body } });
const choose = (id, kind = 'button_reply') => say({ type: 'interactive', interactive: { type: kind, [kind]: { id, title: 'x' } } });
const bodyOf = (m) => m?.text?.body ?? m?.interactive?.body?.text ?? '';
const buttonsOf = (m) => m?.interactive?.action?.buttons?.map((b) => b.reply) ?? [];
const rowsOf = (m) => m?.interactive?.action?.sections?.[0]?.rows ?? [];

// ─── Meta's verification and signatures ──────────────────────────────────────
{
  const ok = await apiFetch(`${API}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`);
  check('Meta’s webhook check gets the challenge back', ok.status === 200 && (await ok.text()) === '12345');
  const bad = await apiFetch(`${API}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`);
  check('a wrong verify token is refused', bad.status === 403);
  const unsigned = await deliver({ messages: [] }, { signature: 'sha256=' + '0'.repeat(64) });
  check('a delivery with a bad signature is refused', unsigned.status === 401);
}

// ─── A conversation ──────────────────────────────────────────────────────────
check('a new number starts with no contact row', d1Rows(`SELECT COUNT(*) AS n FROM whatsapp_contacts WHERE phone = '${phone}'`)[0]?.n === 0);

const hi = await text('Hi');
check('“Hi” gets one reply', hi.length === 1, JSON.stringify(hi));
const welcome = hi[0];
const firstButtons = buttonsOf(welcome);
const multi = welcome?.interactive?.type === 'list';
let branch = null;
if (multi) {
  check('several branches: asked which one first', rowsOf(welcome).length > 0);
  branch = rowsOf(welcome)[0].id.split('|')[1];
} else {
  check('the welcome offers Car / Bike / Location', firstButtons.some((b) => b.id.startsWith('cat|')) && firstButtons.some((b) => b.id.startsWith('loc|')), JSON.stringify(firstButtons));
  branch = firstButtons[0]?.id.split('|')[1];
}

const contact = d1Rows(`SELECT profile_name, last_inbound_at FROM whatsapp_contacts WHERE phone = '${phone}'`)[0];
check('the customer is recorded with their WhatsApp name', contact?.profile_name === 'Ravi Kumar' && !!contact?.last_inbound_at);

const makes = await choose(`cat|${branch}|car`);
const makeRows = rowsOf(makes[0]);
check('Car lists companies (up to 10 rows)', makeRows.length > 0 && makeRows.length <= 10, JSON.stringify(makes[0]).slice(0, 300));
if (makeRows.length) {
  const models = await choose(makeRows[0].id, 'list_reply');
  const modelRows = rowsOf(models[0]);
  check(`${makeRows[0].title} lists its models`, modelRows.length > 0 && modelRows.length <= 10);
  if (modelRows.length) {
    const prices = await choose(modelRows[0].id, 'list_reply');
    const body = prices.map(bodyOf).join('\n');
    check(`${modelRows[0].title}: prices in rupees`, body.includes(modelRows[0].title.replace('…', '')) && body.includes('₹'), body.slice(0, 400));
    check('prices come with Location / Another vehicle / Talk to us', buttonsOf(prices.at(-1)).length === 3);
    console.log(`\n--- What the customer sees ---\n${body}\n------------------------------\n`);
  }
}

const typed = await text('swift');
check('typing “swift” jumps to its prices', typed.map(bodyOf).join('\n').includes('Swift'), bodyOf(typed[0]).slice(0, 300));

const loc = await choose(`loc|${branch}`);
check('Location sends the address card', loc.length >= 1 && loc.some((m) => m.type === 'location' || bodyOf(m).includes('📍')));

// ─── STOP / START ────────────────────────────────────────────────────────────
await text('STOP');
check('STOP turns offers off', !!d1Rows(`SELECT marketing_stopped_at FROM whatsapp_contacts WHERE phone = '${phone}'`)[0]?.marketing_stopped_at);
await text('START');
check('START turns them back on', d1Rows(`SELECT marketing_stopped_at IS NULL AS on_list FROM whatsapp_contacts WHERE phone = '${phone}'`)[0]?.on_list === 1);

// ─── A repeated delivery is answered once ────────────────────────────────────
const dupId = `wamid.in.${phone}.dup`;
const first = await say({ type: 'text', text: { body: 'hello' } }, { id: dupId });
const again = await say({ type: 'text', text: { body: 'hello' } }, { id: dupId });
check('Meta re-sending a message gets no second reply', first.length === 1 && again.length === 0);

// ─── Delivery reports ────────────────────────────────────────────────────────
const out = d1Rows(`SELECT id, status FROM whatsapp_messages WHERE phone = '${phone}' AND direction = 'out' ORDER BY created_at DESC LIMIT 1`)[0];
check('replies are logged as sent', out?.status === 'sent');
await deliver({ statuses: [{ id: out.id, status: 'read', recipient_id: `91${phone}` }] });
await deliver({ statuses: [{ id: out.id, status: 'delivered', recipient_id: `91${phone}` }] });
check('a late “delivered” never undoes “read”', d1Rows(`SELECT status FROM whatsapp_messages WHERE id = '${out.id}'`)[0]?.status === 'read');

// ─── Only the business number is answered ────────────────────────────────────
{
  const before = sent.length;
  await deliver({ metadata: { phone_number_id: 'meta-test-number' }, messages: [{ from: `91${phone}`, id: `wamid.other.${phone}`, type: 'text', text: { body: 'hi' } }] });
  check('messages to another number on the Meta app are ignored', sent.length === before);
}

graph.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
