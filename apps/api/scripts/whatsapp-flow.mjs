// Creates or updates the Services & Prices WhatsApp Flow (packages/domain/src/whatsappFlow.ts) in the
// business's WhatsApp account, points it at our endpoint, and publishes it. Prints Meta's
// validation errors if the layout is refused. Put the id it prints in WHATSAPP_FLOW_ID.
//   npm run whatsapp:flow -- https://api-staging.manawashmanager.com            → create/update as a draft
//   npm run whatsapp:flow -- https://api-staging.manawashmanager.com publish    → …and publish it
// Before the first publish: register the business number's public key (README → WhatsApp Flow).
// A published Flow can't change; a later run makes a new draft copy instead (a new id).
import { readFileSync } from 'node:fs';
import { WA_FLOW_JSON, WA_FLOW_NAME } from '../../../packages/domain/src/whatsappFlow.ts';

const vars = Object.fromEntries(
  readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
    .split('\n')
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^"|"$/g, '')]),
);
const token = process.env.WHATSAPP_API_TOKEN ?? vars.WHATSAPP_API_TOKEN;
const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? vars.WHATSAPP_BUSINESS_ACCOUNT_ID;
const [apiBase, publish] = process.argv.slice(2);
if (!token || !waba || !apiBase?.startsWith('https://')) {
  throw new Error('Usage: npm run whatsapp:flow -- https://<api host> [publish]  (needs WHATSAPP_API_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID)');
}
const GRAPH = 'https://graph.facebook.com/v25.0';
const auth = { Authorization: `Bearer ${token}` };
const endpoint = `${apiBase.replace(/\/$/, '')}/whatsapp/flow`;

async function graph(method, path, body) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method,
    headers: body instanceof FormData ? auth : { ...auth, 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : body && JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${json.error?.error_user_msg ?? json.error?.message ?? res.status}`);
  return json;
}

const showErrors = (errors) => {
  for (const e of errors ?? []) console.log(`  ✗ ${e.error_type ?? e.error}: ${e.message ?? e.error_message ?? JSON.stringify(e)}`);
};

const flows = (await graph('GET', `${waba}/flows?fields=id,name,status&limit=100`)).data ?? [];
let flow = flows.find((f) => f.name === WA_FLOW_NAME && f.status === 'DRAFT');
if (!flow) {
  flow = await graph('POST', `${waba}/flows`, { name: WA_FLOW_NAME, categories: ['OTHER'], endpoint_uri: endpoint });
  console.log(`created draft ${flow.id}`);
} else {
  await graph('POST', flow.id, { endpoint_uri: endpoint });
  console.log(`updating draft ${flow.id}`);
}
const form = new FormData();
form.append('name', 'flow.json');
form.append('asset_type', 'FLOW_JSON');
form.append('file', new Blob([JSON.stringify(WA_FLOW_JSON)], { type: 'application/json' }), 'flow.json');
const uploaded = await graph('POST', `${flow.id}/assets`, form);
if (uploaded.validation_errors?.length) {
  console.log('Meta refused the layout:');
  showErrors(uploaded.validation_errors);
  process.exit(1);
}
console.log(`layout uploaded; endpoint ${endpoint}`);
if (publish === 'publish') {
  await graph('POST', `${flow.id}/publish`);
  console.log(`published ✓  WHATSAPP_FLOW_ID=${flow.id}`);
} else {
  const health = await graph('GET', `${flow.id}?fields=health_status,validation_errors,preview.invalidate(false)`);
  showErrors(health.validation_errors);
  console.log(`draft ready: WHATSAPP_FLOW_ID=${flow.id}`);
  console.log(`preview: ${health.preview?.preview_url ?? '(none)'}`);
  console.log(`endpoint health: ${JSON.stringify(health.health_status?.can_send_message ?? health.health_status ?? 'unknown')}`);
}
