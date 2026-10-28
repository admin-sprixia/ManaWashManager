// The .jpg import below is typed in ../assets.d.ts, which apps importing these routes don't otherwise see.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../assets.d.ts" />
import { Hono, type Context } from 'hono';
import { createPlatformDb, customerAppRepo, shopPlanRepo, vehicleModelRepo } from '@mana/db';
import { catalogFeed, catalogProducts, chatFlowChoice, chatFlowReply, chatReply, type ChatBranch, type ChatContext, type ChatFlowRequest, type ChatInput } from '@mana/domain';
import banner from '../assets/whatsapp-banner.jpg';
import makeLogos from '../assets/make-logos.json';
import { reportError } from '../lib/alerts';
import { countHit } from '../lib/rateLimit';
import { decryptFlowRequest, type EncryptedFlowRequest } from '../lib/whatsappFlowCrypto';
import {
  chatPerson,
  logIncoming,
  logStatus,
  markReadTyping,
  phoneFromWaId,
  sendChat,
  setChatContext,
  setLanguage,
  setMarketing,
  verifyMetaSignature,
  whatsappConfigured,
} from '../lib/whatsapp';
import type { Env } from '../types';

/**
 * Meta's webhook for the business number: customers' messages (answered by the assistant in
 * @mana/domain's whatsappChat) and delivery reports for what we sent. Subscribe it in the Meta
 * app (WhatsApp → Configuration) with WHATSAPP_VERIFY_TOKEN; every delivery is signed with
 * WHATSAPP_APP_SECRET and refused without a valid signature.
 */

/** Replies to one number per 10 minutes; past that, someone is hammering the assistant. */
const REPLIES_PER_WINDOW = 40;
const WINDOW_SECONDS = 10 * 60;

/** Each catalog item's "website" (Meta requires one). */
const CATALOG_LINK = 'https://srimanawash.com/';

/** WhatsApp caches the welcome's picture by its link: bump this whenever the banner changes. */
const BANNER_VERSION = 4;

interface WaMessage {
  from: string;
  id: string;
  type: string;
  text?: { body?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
    /** The finished Services & Prices Flow. */
    nfm_reply?: { response_json?: string };
  };
  /** A quick-reply button on a template (the bill's "Rate us"). */
  button?: { payload?: string; text?: string };
}
interface WaStatus {
  id: string;
  status: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}
interface WaWebhook {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: WaMessage[];
        statuses?: WaStatus[];
      };
    }[];
  }[];
}

/** What the customer sent, as the assistant reads it. */
function inputOf(m: WaMessage): { input: ChatInput; body: string | null } {
  const choice = m.interactive?.button_reply ?? m.interactive?.list_reply;
  if (choice?.id) return { input: { kind: 'choice', id: choice.id }, body: choice.id };
  const flowChoice = m.interactive?.nfm_reply?.response_json ? chatFlowChoice(m.interactive.nfm_reply.response_json) : null;
  if (flowChoice) return { input: { kind: 'choice', id: flowChoice }, body: flowChoice };
  if (m.button?.payload) return { input: { kind: 'choice', id: m.button.payload }, body: m.button.payload };
  const text = m.text?.body ?? m.button?.text ?? '';
  // A photo, voice note or sticker gets the welcome, like "hi".
  return { input: { kind: 'text', text }, body: text || `[${m.type}]` };
}

/** The business's branches as the assistant needs them: hub prices, plans, hours, location. */
async function chatContext(env: Env, origin: string): Promise<ChatContext> {
  const pdb = createPlatformDb(env.DB);
  const businessId = env.WHATSAPP_BUSINESS_ID?.trim() || null;
  const [branches, business, edits] = await Promise.all([
    customerAppRepo.branches(pdb, { id: businessId }),
    businessId ? pdb.business.findUnique({ where: { id: businessId }, select: { name: true } }) : null,
    businessId ? vehicleModelRepo.list(pdb, businessId) : [],
  ]);
  const hubs = branches.filter((b) => b.modes.includes('hub'));
  const plans = await Promise.all(hubs.map((b) => shopPlanRepo.menu(env.DB, b.id).catch(() => [])));
  return {
    businessName: business?.name ?? hubs[0]?.name ?? 'our car wash',
    edits,
    bannerUrl: `${origin}/whatsapp/banner.jpg?v=${BANNER_VERSION}`,
    flows: !!env.WHATSAPP_FLOW_ID?.trim() && !!env.WHATSAPP_FLOW_PRIVATE_KEY?.trim(),
    branches: hubs.map(
      (b, i): ChatBranch => ({
        id: b.id,
        name: b.name,
        city: b.city,
        address: b.address,
        phone: b.phone,
        location: b.location,
        hours: b.hours,
        reviewUrl: b.reviewUrl,
        vehicleTypes: b.vehicleTypes,
        services: b.services.map((s) => ({
          id: s.id,
          name: s.name,
          popular: s.popular,
          description: s.description,
          checklist: s.checklist,
          durationMin: s.durationMin,
          prices: s.prices,
        })),
        plans: (plans[i] ?? []).map((p) => ({
          name: p.name,
          washes: p.washes,
          months: p.months,
          popular: p.popular,
          serviceName: p.serviceName,
          upgrade: p.upgrade ? { every: p.upgrade.every, name: p.upgrade.name } : null,
          prices: p.prices.map((x) => ({ vehicleTypeId: x.vehicleTypeId, total: x.total, listTotal: x.listTotal })),
        })),
      }),
    ),
  };
}

async function handleMessage(env: Env, m: WaMessage, profileName: string | null, getContext: () => Promise<ChatContext>) {
  const phone = phoneFromWaId(m.from);
  if (!phone) return; // Indian numbers only.
  const { input, body } = inputOf(m);
  // Who they are is read before their message is logged, so a first "Hi" isn't a returning one.
  const person = await chatPerson(env, phone, env.WHATSAPP_BUSINESS_ID?.trim() || null, profileName);
  if (!(await logIncoming(env, { id: m.id, phone, kind: m.type, body, profileName }))) return;
  const { count } = await countHit(env, `wa:${phone}`, WINDOW_SECONDS);
  if (count > REPLIES_PER_WINDOW) return;
  await markReadTyping(env, m.id);
  const result = chatReply(input, { ...(await getContext()), person });
  if (result.marketing) await setMarketing(env, phone, result.marketing === 'start');
  if (result.lang) await setLanguage(env, phone, result.lang);
  if (result.context) await setChatContext(env, phone, result.context);
  await sendChat(env, phone, result.messages);
}

async function handleWebhook(env: Env, event: WaWebhook, origin: string) {
  let context: Promise<ChatContext> | null = null;
  const getContext = () => (context ??= chatContext(env, origin));
  for (const entry of event.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (change.field !== 'messages' || !value) continue;
      // The same Meta app also has the test number; only the business number is ours to answer.
      if (value.metadata?.phone_number_id !== env.WHATSAPP_PHONE_NUMBER_ID?.trim()) continue;
      for (const s of value.statuses ?? []) {
        const e = s.errors?.[0];
        await logStatus(env, {
          id: s.id,
          status: s.status,
          error: e ? [e.title ?? e.message, e.error_data?.details, e.code ? `(${e.code})` : null].filter(Boolean).join(' ') : null,
        });
      }
      for (const m of value.messages ?? []) {
        const name = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
        await handleMessage(env, m, name, getContext);
      }
    }
  }
}

/**
 * Runs after the response (Meta wants a 200 within seconds). Local dev (DEV_MODE) finishes first,
 * so the test script sees the replies as soon as its delivery is answered.
 */
function inBackground(c: Context<{ Bindings: Env }>, work: Promise<unknown>) {
  const guarded = work.catch((err: unknown) =>
    reportError(c.env, {
      source: 'api',
      message: err instanceof Error ? err.message : 'WhatsApp webhook failed',
      stack: err instanceof Error ? err.stack : undefined,
      context: 'POST /whatsapp/webhook',
      shopId: null,
    }),
  );
  if (c.env.DEV_MODE === 'true') return guarded;
  try {
    c.executionCtx.waitUntil(guarded);
    return Promise.resolve();
  } catch {
    // No execution context (tests calling app.request): finish before answering.
    return guarded;
  }
}

export const whatsappRoutes = new Hono<{ Bindings: Env }>()
  /** The picture on top of the welcome message; WhatsApp fetches it by link. */
  .get('/banner.jpg', (c) => {
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(banner, 200, { 'Content-Type': 'image/jpeg' });
  })
  /** Meta checks the callback URL once when the webhook is saved. */
  .get('/webhook', (c) => {
    const token = c.env.WHATSAPP_VERIFY_TOKEN?.trim();
    if (c.req.query('hub.mode') === 'subscribe' && token && c.req.query('hub.verify_token') === token) {
      return c.text(c.req.query('hub.challenge') ?? '');
    }
    return c.json({ error: 'forbidden' as const }, 403);
  })
  /**
   * The WhatsApp catalog as a product feed, read by Commerce Manager on a schedule: the first hub
   * branch's washes and plans per kind of vehicle, at shop prices.
   */
  .get('/catalog.csv', async (c) => {
    const origin = new URL(c.req.url).origin;
    const ctx = await chatContext(c.env, origin);
    const branch = ctx.branches[0];
    if (!branch) return c.text('', 404);
    c.header('Cache-Control', 'public, max-age=900');
    return c.body(
      catalogFeed(branch, { brand: ctx.businessName, link: CATALOG_LINK, imageUrl: (id) => `${origin}/whatsapp/catalog/${id}.jpg` }),
      200,
      { 'Content-Type': 'text/csv; charset=utf-8' },
    );
  })
  /** The same products with their card text, for scripts/build-catalog-cards.mjs. */
  .get('/catalog.json', async (c) => {
    const ctx = await chatContext(c.env, new URL(c.req.url).origin);
    const branch = ctx.branches[0];
    const products = branch ? catalogProducts(branch) : [];
    return c.json({
      businessName: ctx.businessName,
      city: branch?.city ?? null,
      products: products.map((p) => ({ id: p.id, kind: p.kind, title: p.title, section: p.section.label, card: p.card })),
    });
  })
  /** A product's card picture (uploaded by scripts/build-catalog-cards.mjs). */
  .get('/catalog/:file{[a-z0-9-]+\\.jpg}', async (c) => {
    const object = await c.env.PHOTOS.get(`catalog/${c.req.param('file')}`);
    if (!object) return c.text('Not found', 404);
    return c.body(object.body, 200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
  })
  /**
   * The Services & Prices Flow's screens. WhatsApp signs and encrypts every request; a request we
   * can't decrypt gets 421, which makes WhatsApp fetch our public key again and retry.
   */
  .post('/flow', async (c) => {
    const pem = c.env.WHATSAPP_FLOW_PRIVATE_KEY?.trim();
    const secret = c.env.WHATSAPP_APP_SECRET?.trim();
    const body = await c.req.text();
    if (!pem || !secret) return c.json({ error: 'not_configured' as const }, 503);
    if (!(await verifyMetaSignature(body, c.req.header('x-hub-signature-256'), secret))) {
      return c.json({ error: 'bad_signature' as const }, 401);
    }
    let decrypted: Awaited<ReturnType<typeof decryptFlowRequest>>;
    try {
      decrypted = await decryptFlowRequest(JSON.parse(body) as EncryptedFlowRequest, pem);
    } catch {
      return c.body(null, 421);
    }
    const request = decrypted.request as ChatFlowRequest;
    const reply = chatFlowReply(request, await chatContext(c.env, new URL(c.req.url).origin), makeLogos as Record<string, string>);
    return c.text(await decrypted.encryptReply(reply));
  })
  .post('/webhook', async (c) => {
    const secret = c.env.WHATSAPP_APP_SECRET?.trim();
    const body = await c.req.text();
    if (!secret || !(await verifyMetaSignature(body, c.req.header('x-hub-signature-256'), secret))) {
      return c.json({ error: 'bad_signature' as const }, 401);
    }
    let event: WaWebhook;
    try {
      event = JSON.parse(body) as WaWebhook;
    } catch {
      return c.json({ error: 'bad_request' as const }, 400);
    }
    if (event.object === 'whatsapp_business_account' && whatsappConfigured(c.env)) {
      await inBackground(c, handleWebhook(c.env, event, new URL(c.req.url).origin));
    }
    return c.json({ ok: true as const });
  });
