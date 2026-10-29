// The WhatsApp templates the business number sends by itself (packages/domain/src/whatsappTemplates.ts):
// lists their approval status at Meta, or submits any that aren't there yet.
//   npm run whatsapp:templates                 → status of each template
//   npm run whatsapp:templates -- submit       → submit the missing ones for review
// Reads WHATSAPP_API_TOKEN from .dev.vars and the WhatsApp Business Account id from
// WHATSAPP_BUSINESS_ACCOUNT_ID (environment or .dev.vars); a document template (the PDF bill) also
// needs WHATSAPP_APP_ID, to upload a sample bill for Meta's review.
import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { WA_TEMPLATES } from '../../../packages/domain/src/whatsappTemplates.ts';

const vars = Object.fromEntries(
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^"|"$/g, '')]),
);
const token = process.env.WHATSAPP_API_TOKEN ?? vars.WHATSAPP_API_TOKEN;
const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? vars.WHATSAPP_BUSINESS_ACCOUNT_ID;
if (!token || !waba) throw new Error('Needs WHATSAPP_API_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID (.dev.vars or environment).');
const appId = process.env.WHATSAPP_APP_ID ?? vars.WHATSAPP_APP_ID;
const GRAPH = `https://graph.facebook.com/v25.0/${waba}/message_templates`;

/** A document template needs a sample file for Meta's review: a one-page bill, uploaded once. */
let sampleHandle = null;
async function sampleDocumentHandle() {
  if (sampleHandle) return sampleHandle;
  if (!appId) throw new Error('Needs WHATSAPP_APP_ID (.dev.vars) to upload the sample bill.');
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawText('Sri Mana Wash - Bill (sample)', { x: 60, y: 760, size: 20, font });
  const bytes = await doc.save();
  const session = await fetch(`https://graph.facebook.com/v25.0/${appId}/uploads?file_name=sample-bill.pdf&file_length=${bytes.length}&file_type=application/pdf`, {
    method: 'POST',
    headers: auth,
  }).then((r) => r.json());
  if (!session.id) throw new Error(`Upload session refused: ${JSON.stringify(session.error ?? session)}`);
  const up = await fetch(`https://graph.facebook.com/v25.0/${session.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, file_offset: '0' },
    body: bytes,
  }).then((r) => r.json());
  if (!up.h) throw new Error(`Sample upload refused: ${JSON.stringify(up.error ?? up)}`);
  sampleHandle = up.h;
  return sampleHandle;
}
const auth = { Authorization: `Bearer ${token}` };

const res = await fetch(`${GRAPH}?fields=name,language,status,category,rejected_reason&limit=200`, { headers: auth });
const existing = (await res.json()).data ?? [];
const find = (t) => existing.find((e) => e.name === t.name && e.language === t.language);

if (process.argv[2] !== 'submit') {
  for (const t of WA_TEMPLATES) {
    const e = find(t);
    console.log(`${t.name.padEnd(12)} ${t.language}  ${e ? `${e.status}${e.category !== t.category ? ` (Meta made it ${e.category})` : ''}${e.rejected_reason && e.rejected_reason !== 'NONE' ? ` — ${e.rejected_reason}` : ''}` : 'not submitted'}`);
  }
  process.exit(0);
}

for (const t of WA_TEMPLATES) {
  if (find(t)) {
    console.log(`${t.name} ${t.language}: already there (${find(t).status})`);
    continue;
  }
  const body = {
    name: t.name,
    language: t.language,
    category: t.category,
    components: [
      ...(t.header === 'DOCUMENT' ? [{ type: 'HEADER', format: 'DOCUMENT', example: { header_handle: [await sampleDocumentHandle()] } }] : []),
      { type: 'BODY', text: t.body, example: { body_text: [t.example] } },
      { type: 'BUTTONS', buttons: t.buttons.map((text) => ({ type: 'QUICK_REPLY', text })) },
    ],
  };
  const r = await fetch(GRAPH, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await r.json();
  console.log(`${t.name} ${t.language}: ${r.ok ? `submitted (${out.status ?? 'PENDING'})` : `refused — ${out.error?.error_user_msg ?? out.error?.message}`}`);
}
