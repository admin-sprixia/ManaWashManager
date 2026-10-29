// The WhatsApp assistant end to end: Meta's webhook check, signed deliveries (unsigned ones
// refused), the banner, a customer saying hi, Services & Prices → Car →
// company → model and that model's prices, typing a model, directions, Telugu (remembered for the
// number), STOP/START, a repeated delivery answered once, delivery reports, and the Ready and
// bill templates a wash sends by itself (once each), and the inbox (a question waits for the team,
// a teammate replies, the assistant stays quiet, Mark done), and the 10:00 follow-ups. Adds a throwaway owner to a branch of the
// business for that last part.
// A stand-in Graph API on :8798 records what the server sends back. Only writes the whatsapp_*
// tables and rate_limits, so it can run against your local data. Run the API with:
//   npx wrangler dev --var DEV_MODE:true --var WHATSAPP_API_BASE:http://127.0.0.1:8798 \
//     --var WHATSAPP_API_TOKEN:standin --var WHATSAPP_PHONE_NUMBER_ID:standin-phone \
//     --var WHATSAPP_APP_SECRET:local-app-secret --var WHATSAPP_VERIFY_TOKEN:local-verify \
//     --var WHATSAPP_OTP_BYPASS:true --var WHATSAPP_BUSINESS_ID:<business id> \
//     --var WHATSAPP_FLOW_ID:standin-flow
// (WHATSAPP_FLOW_PRIVATE_KEY comes from .dev.vars; its public half is .wrangler/flow-keys/local-public.pem.)
//   cd apps/api && npm run test:whatsapp
import { constants, createCipheriv, createDecipheriv, createHmac, publicEncrypt, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createServer } from 'node:http';
import { API, apiFetch, d1Rows, d1Run, signIn } from './lib/target.mjs';

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
const uploads = [];
let n = 0;
const graph = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  res.writeHead(200, { 'content-type': 'application/json' });
  // A file upload (the PDF bill): keep it, answer with a media id.
  if ((req.headers['content-type'] ?? '').startsWith('multipart/form-data')) {
    uploads.push(raw);
    return res.end(JSON.stringify({ id: `media.standin.${uploads.length}` }));
  }
  const body = raw.length ? JSON.parse(raw.toString()) : {};
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
const contactRow = () => d1Rows(`SELECT profile_name, last_inbound_at, language FROM whatsapp_contacts WHERE phone = '${phone}'`)[0];
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
  const pic = await apiFetch(`${API}/whatsapp/banner.jpg`);
  check('the banner is served as a JPEG', pic.status === 200 && pic.headers.get('content-type') === 'image/jpeg' && (await pic.arrayBuffer()).byteLength > 10_000);
}

// ─── A conversation ──────────────────────────────────────────────────────────
check('a new number starts with no contact row', d1Rows(`SELECT COUNT(*) AS n FROM whatsapp_contacts WHERE phone = '${phone}'`)[0]?.n === 0);

const hi = await text('Hi');
const welcome = hi[0];
const firstButtons = buttonsOf(welcome);
const multi = welcome?.interactive?.type === 'list';
let branch = null;
if (multi) {
  check('several branches: asked which one first', rowsOf(welcome).length > 0);
  branch = rowsOf(welcome)[0].id.split('|')[1];
} else {
  check('“Hi” gets one welcome message', hi.length === 1, JSON.stringify(hi).slice(0, 300));
  check(
    'the welcome has the banner, a greeting by name and Services / Directions / Telugu',
    welcome?.interactive?.header?.image?.link?.includes('/whatsapp/banner.jpg') &&
      bodyOf(welcome).includes('Ravi! 👋') &&
      firstButtons.map((b) => b.id.split('|')[0]).join() === 'svc,loc,lang',
    JSON.stringify(welcome).slice(0, 400),
  );
  branch = firstButtons[0]?.id.split('|')[1];
}

const contact = contactRow();
check('the customer is recorded with their WhatsApp name', contact?.profile_name === 'Ravi Kumar' && !!contact?.last_inbound_at);
check('a second Hi welcomes them back', bodyOf((await text('hello'))[0]).includes('Welcome back, Ravi'));

const services = await choose(`svc|${branch}`);
check('Services & Prices asks which vehicle (or lists companies)', services.length === 1 && (buttonsOf(services[0]).length > 0 || rowsOf(services[0]).length > 0));

// The plain company list (what Car shows when no Flow is published).
const makes = await choose(`mk|${branch}|car|0`);
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
check('the price list is numbered', /1️⃣ .+: \*₹/.test(typed.map(bodyOf).join('\n')));
const one = await text('1');
check('replying 1 shows what that wash includes', bodyOf(one[0]).startsWith('1️⃣ *') && buttonsOf(one[0])[0]?.id.startsWith('pr|'), bodyOf(one[0]).slice(0, 300));

const loc = await choose(`loc|${branch}`);
const maps = loc.find((m) => m.interactive?.type === 'cta_url');
check('Get Directions sends a Google Maps button', maps?.interactive?.action?.parameters?.url?.startsWith('https://www.google.com/maps/'), JSON.stringify(loc).slice(0, 400));

// ─── Telugu ──────────────────────────────────────────────────────────────────
const telugu = await choose(`lang|${branch}|te`);
check('తెలుగు answers in Telugu', bodyOf(telugu[0]).includes('గారు') && buttonsOf(telugu[0]).some((b) => b.title === '🌐 English'), bodyOf(telugu[0]).slice(0, 200));
check('the language is remembered for the number', contactRow()?.language === 'te');
check('the next Hi comes in Telugu', bodyOf((await text('Hi'))[0]).includes('మళ్ళీ స్వాగతం'));
await choose(`lang|${branch}|en`);
check('English switches back', contactRow()?.language === 'en');

// ─── STOP / START ────────────────────────────────────────────────────────────
await text('STOP');
check('STOP turns offers off', !!d1Rows(`SELECT marketing_stopped_at FROM whatsapp_contacts WHERE phone = '${phone}'`)[0]?.marketing_stopped_at);
await text('START');
check('START turns them back on', d1Rows(`SELECT marketing_stopped_at IS NULL AS on_list FROM whatsapp_contacts WHERE phone = '${phone}'`)[0]?.on_list === 1);

// ─── A repeated delivery is answered once ────────────────────────────────────
const dupId = `wamid.in.${phone}.dup`;
const first = await say({ type: 'text', text: { body: 'hello' } }, { id: dupId });
const again = await say({ type: 'text', text: { body: 'hello' } }, { id: dupId });
check('Meta re-sending a message gets no second reply', first.length > 0 && again.length === 0);

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

// ─── The Services & Prices Flow ──────────────────────────────────────────────
{
  const publicKey = readFileSync(new URL('../.wrangler/flow-keys/local-public.pem', import.meta.url), 'utf8');
  const rawPost = (url, headers, body) =>
    new Promise((resolve, reject) => {
      const req = (url.startsWith('https') ? https : http).request(url, { method: 'POST', headers }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end(body);
    });
  /** Calls our Flow endpoint the way WhatsApp does: AES-GCM body, its key wrapped with our RSA key, signed. */
  async function flow(request, { tamper = false } = {}) {
    const key = randomBytes(16);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-128-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(request)), cipher.final(), cipher.getAuthTag()]);
    const wrapped = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
    const body = JSON.stringify({
      encrypted_flow_data: data.toString('base64'),
      encrypted_aes_key: (tamper ? randomBytes(wrapped.length) : wrapped).toString('base64'),
      initial_vector: iv.toString('base64'),
    });
    const headers = { 'content-type': 'application/json', 'x-hub-signature-256': sign(body) };
    // Node's fetch retries a 421 by itself (and then fails), so that one goes over plain http.
    if (tamper) return { status: await rawPost(`${API}/whatsapp/flow`, headers, body) };
    const res = await apiFetch(`${API}/whatsapp/flow`, { method: 'POST', headers, body });
    if (res.status !== 200) return { status: res.status };
    const sealed = Buffer.from(await res.text(), 'base64');
    const flipped = Buffer.from(iv.map((b) => b ^ 0xff));
    const decipher = createDecipheriv('aes-128-gcm', key, flipped);
    decipher.setAuthTag(sealed.subarray(-16));
    return { status: 200, reply: JSON.parse(Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]).toString()) };
  }
  const ping = await flow({ version: '3.0', action: 'ping' });
  check('the Flow endpoint answers WhatsApp’s health check', ping.reply?.data?.status === 'active', JSON.stringify(ping));
  check('a request that can’t be decrypted gets 421', (await flow({ action: 'ping' }, { tamper: true })).status === 421);
  const token = `flow|${branch}|car|en`;
  const open = await flow({ version: '3.0', action: 'INIT', flow_token: token });
  const companies = open.reply?.data?.companies ?? [];
  check('opening the Flow lists companies, with logos', open.reply?.screen === 'COMPANY' && companies.length > 0 && companies.some((c) => c.image), JSON.stringify(open).slice(0, 200));
  const models = await flow({ version: '3.0', action: 'data_exchange', screen: 'COMPANY', data: { step: 'company', company: companies[0]?.id }, flow_token: token });
  const firstModel = models.reply?.data?.models?.[0]?.id;
  check(`${companies[0]?.id} lists its models`, models.reply?.screen === 'MODEL' && !!firstModel, JSON.stringify(models).slice(0, 200));
  const priced = await flow({ version: '3.0', action: 'data_exchange', screen: 'MODEL', data: { step: 'model', company: companies[0]?.id, model: firstModel }, flow_token: token });
  check('picking a model shows its prices', priced.reply?.screen === 'PRICES' && priced.reply.data.prices.includes('₹'), JSON.stringify(priced).slice(0, 300));
  const done = await say({ type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', response_json: JSON.stringify({ company: companies[0]?.id, model: firstModel, flow_token: token }) } } });
  check('finishing the Flow sends the numbered price list in the chat', /1️⃣/.test(done.map(bodyOf).join('\n')), bodyOf(done[0]).slice(0, 200));
  const opener = await choose(`cat|${branch}|car`);
  check('Car opens the Flow', opener[0]?.interactive?.type === 'flow' && opener[0].interactive.action.parameters.flow_token === token, JSON.stringify(opener).slice(0, 300));
}

// ─── Ready and the bill go out by themselves ─────────────────────────────────
{
  const BUSINESS = process.env.WHATSAPP_BUSINESS_ID ?? 'biz_mana';
  const priced = d1Rows(
    `SELECT p.shop_id, p.service_id, p.vehicle_type_id FROM service_prices p JOIN services v ON v.id = p.service_id JOIN shops s ON s.id = p.shop_id
     WHERE s.business_id = '${BUSINESS}' AND p.mode = 'hub' AND p.price > 0 AND v.active = 1 LIMIT 1`,
  )[0];
  const ownerPhone = `93${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  d1Run(`INSERT INTO users (id, shop_id, name, phone, role) VALUES ('user_wa_${ownerPhone}', '${priced.shop_id}', 'WhatsApp Check', '${ownerPhone}', 'owner')`);
  const token = (await signIn(ownerPhone, '258025')).body?.token;
  const call = async (method, path, body) => {
    const res = await apiFetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const templates = (name) => sent.filter((m) => m.type === 'template' && m.to === `91${phone}` && m.template?.name === name);
  const jobId = `job_wa_${phone}`;
  const started = await call('POST', '/jobs/start', {
    id: jobId,
    customer: { phone, name: 'Ravi Kumar' },
    registrationNumber: `AP39WA${phone.slice(-4)}`,
    make: 'Maruti Suzuki',
    model: 'Swift',
    vehicleTypeId: priced.vehicle_type_id,
    services: [{ serviceId: priced.service_id, quantity: 1 }],
  });
  check('a wash starts for the WhatsApp customer', started.status === 201, JSON.stringify(started.body).slice(0, 300));
  await call('PATCH', `/jobs/${jobId}/status`, { status: 'washing' });
  check('nothing is sent while it’s washing', templates('wash_ready').length === 0);
  await call('PATCH', `/jobs/${jobId}/status`, { status: 'ready' });
  const ready = templates('wash_ready');
  const readyParams = ready[0]?.template?.components?.[0]?.parameters?.map((x) => x.text) ?? [];
  check(
    'Ready sends the wash_ready template, with the car and Get Directions',
    ready.length === 1 && readyParams[0] === 'Ravi' && readyParams[1]?.startsWith('Maruti Suzuki Swift (AP39WA') &&
      ready[0].template.components[1]?.parameters?.[0]?.payload === `loc|${priced.shop_id}`,
    JSON.stringify(ready).slice(0, 400),
  );
  const paid = await call('POST', `/jobs/${jobId}/pay`, { paymentMethod: 'upi' });
  check('the wash is paid', paid.status === 200, JSON.stringify(paid.body).slice(0, 200));
  const bill = templates('wash_invoice');
  const header = bill[0]?.template?.components?.[0];
  const billParams = bill[0]?.template?.components?.[1]?.parameters?.map((x) => x.text) ?? [];
  check(
    'Paid sends the wash_invoice template with the PDF bill, the amount, UPI and Rate us',
    bill.length === 1 && header?.type === 'header' && header.parameters?.[0]?.document?.id?.startsWith('media.standin') &&
      header.parameters[0].document.filename?.endsWith('.pdf') && billParams[4]?.startsWith('₹') && billParams[5] === 'UPI' &&
      bill[0].template.components[2]?.parameters?.[0]?.payload === `rate|${priced.shop_id}`,
    JSON.stringify(bill).slice(0, 400),
  );
  const pdf = uploads.at(-1)?.toString('latin1') ?? '';
  check('the uploaded bill is a real PDF', pdf.includes('%PDF-') && pdf.includes('application/pdf'));
  await call('POST', `/jobs/${jobId}/pay`, { paymentMethod: 'upi' });
  check('paying again (a retry) sends no second bill', templates('wash_invoice').length === 1 && templates('wash_bill').length === 0);
  const appBill = await apiFetch(`${API}/jobs/${jobId}/bill`, { headers: { authorization: `Bearer ${token}` } });
  check('the app can open the same bill as a PDF', appBill.status === 200 && appBill.headers.get('content-type') === 'application/pdf' && (await appBill.arrayBuffer()).byteLength > 1000);
  const logged = d1Rows(`SELECT purpose FROM whatsapp_messages WHERE job_id = '${jobId}' ORDER BY created_at`).map((r) => r.purpose).join(',');
  check('both are logged with the wash', logged.startsWith('ready,bill'), logged);

  // ─── The inbox ─────────────────────────────────────────────────────────────
  d1Run(`UPDATE whatsapp_contacts SET awaiting_reply_at = NULL, bot_paused_until = NULL WHERE phone = '${phone}'`);
  const asked = await text('Do you wash tractors?');
  check('a question the assistant can’t answer says the team will reply', bodyOf(asked[0]).includes('Our team will reply'), bodyOf(asked[0]));
  const photo = await say({ type: 'image', image: { id: 'media1', caption: 'this scratch?' } });
  check('a photo goes to the team too', bodyOf(photo[0]).includes('Our team will reply'));
  const waiting = await call('GET', '/whatsapp/inbox?waiting=1');
  const convo = waiting.body?.conversations?.find((cv) => cv.phone === phone);
  check('the customer waits in the inbox, with their name and last message', convo?.name === 'Ravi Kumar' && convo.canReply && convo.last?.text?.includes('this scratch'), JSON.stringify(waiting.body).slice(0, 300));
  const count = await call('GET', '/whatsapp/inbox/count');
  check('the board badge counts them', count.body?.waiting >= 1);
  const before = sent.length;
  const replied = await call('POST', `/whatsapp/inbox/${phone}/reply`, { text: 'Yes we do, ₹999 for a tractor wash.' });
  const outgoing = sent.slice(before).find((m) => m.type === 'text' && m.to === `91${phone}`);
  check('a teammate’s reply goes out from the business number', replied.status === 201 && outgoing?.text?.body === 'Yes we do, ₹999 for a tractor wash.', JSON.stringify(replied.body));
  const thread = await call('GET', `/whatsapp/inbox/${phone}`);
  const mine = thread.body?.messages?.at(-1);
  check('the chat shows the reply and who sent it, and it’s off the waiting list', mine?.by === 'WhatsApp Check' && !thread.body.awaitingSince, JSON.stringify(mine));
  const quiet = await text('ok I will come at 5');
  check('the assistant stays quiet while a teammate is talking', quiet.length === 0);
  check('…and the message waits for the teammate', d1Rows(`SELECT awaiting_reply_at IS NOT NULL AS waiting FROM whatsapp_contacts WHERE phone = '${phone}'`)[0]?.waiting === 1);
  await call('POST', `/whatsapp/inbox/${phone}/done`);
  check('Mark done takes it off the list', d1Rows(`SELECT awaiting_reply_at IS NULL AS cleared FROM whatsapp_contacts WHERE phone = '${phone}'`)[0]?.cleared === 1);
  // (This run has sent dozens of messages from one number; clear the flood guard first.)
  d1Run(`DELETE FROM rate_limits WHERE key = 'wa:${phone}'`);
  const awake = await text('Hi');
  check('…and wakes the assistant', awake.length === 1, JSON.stringify(awake).slice(0, 200));
  d1Run(`UPDATE whatsapp_contacts SET last_inbound_at = '2020-01-01T00:00:00.000+00:00' WHERE phone = '${phone}'`);
  const late = await call('POST', `/whatsapp/inbox/${phone}/reply`, { text: 'hello?' });
  check('after 24 hours a reply is refused (WhatsApp’s rule)', late.status === 409 && late.body?.error === 'window_closed');

  // ─── The 10:00 follow-ups ──────────────────────────────────────────────────
  const offToday = d1Rows(`SELECT weekly_off_days AS off FROM shops WHERE id = '${priced.shop_id}'`)[0]?.off ?? '';
  const istDay = new Date(Date.now() + 330 * 60_000).getUTCDay();
  if (String(offToday).split(',').includes(String(istDay))) {
    console.log('(skipping the follow-up checks: today is this branch’s day off)');
  } else {
    // The morning run for this number only, waiting for it (the cron itself runs every branch in the background).
    const morning = () => apiFetch(`${API}/whatsapp/dev/follow-ups?phone=${phone}`, { method: 'POST' });
    const backdate = (days) => {
      const at = new Date(Date.now() - days * 86_400_000).toISOString().replace('Z', '+00:00');
      d1Run(`UPDATE jobs SET created_at = '${at}' WHERE vehicle_id = (SELECT vehicle_id FROM jobs WHERE id = '${jobId}')`);
    };
    const followUps = (name) => sent.filter((m) => m.type === 'template' && m.to === `91${phone}` && m.template?.name === name);
    backdate(12);
    await morning();
    const reminder = followUps('wash_reminder');
    const rParams = reminder[0]?.template?.components?.[0]?.parameters?.map((x) => x.text) ?? [];
    check(
      '12 days after a wash, the morning run sends “time for a wash” with See prices and Stop offers',
      reminder.length === 1 && rParams[1] === '12' && reminder[0].template.components[2]?.parameters?.[0]?.payload === 'STOP',
      JSON.stringify(reminder).slice(0, 300),
    );
    await morning();
    check('…only once for that visit', followUps('wash_reminder').length === 1);
    backdate(35);
    await morning();
    const comeback = followUps('comeback_offer');
    const code = comeback[0]?.template?.components?.[0]?.parameters?.[4]?.text;
    check('35 days on, a comeback offer goes out with a fresh coupon code', comeback.length === 1 && /^MANA-/.test(code ?? ''), JSON.stringify(comeback).slice(0, 300));
    check('…and the coupon is recorded as sent', d1Rows(`SELECT notified_at IS NOT NULL AS sent FROM coupons WHERE code = '${code}'`)[0]?.sent === 1);
    // Stop offers: nothing more after STOP.
    d1Run(`UPDATE coupons SET status = 'cancelled' WHERE code = '${code}'`);
    d1Run(`UPDATE vehicle_reminders SET reminded_at = NULL WHERE vehicle_id = (SELECT vehicle_id FROM jobs WHERE id = '${jobId}')`);
    await choose('STOP');
    await morning();
    check('after Stop offers, no more offers', followUps('comeback_offer').length === 1 && followUps('wash_reminder').length === 1);
  }
}

graph.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
