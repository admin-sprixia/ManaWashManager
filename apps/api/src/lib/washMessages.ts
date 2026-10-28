import { createPlatformDb, createShopDb, jobRepo } from '@mana/db';
import { rateChoiceId, washTemplateMessage, type ChatLang, type PaymentMethod, type WashTemplateKind } from '@mana/domain';
import type { Env } from '../types';
import { graphSend, logOutgoing, waId, whatsappConfigured } from './whatsapp';

/**
 * The messages the business number sends by itself, from the approved templates: "ready for
 * pickup" when a hub wash moves to Ready, and the bill with a thank-you when a wash is paid. Each
 * goes once per wash (a retried or replayed request doesn't send it again), in the customer's
 * language, and is logged with the wash. Never throws: a message that can't go out is only logged.
 */

/** A Ready that reaches us this late (it waited offline) is old news: the car may be gone. */
const READY_STALE_MS = 30 * 60_000;
/** Nor is a bill worth sending a day after the wash. */
const BILL_STALE_MS = 24 * 60 * 60_000;

interface D1Row {
  prepare(query: string): { bind(...v: unknown[]): { first<T>(): Promise<T | null> } };
}
const d1 = (env: Env) => env.DB as unknown as D1Row;

const purposeOf = (kind: WashTemplateKind) => (kind === 'ready' ? 'ready' : 'bill');

async function alreadySent(env: Env, jobId: string, kind: WashTemplateKind): Promise<boolean> {
  const row = await d1(env)
    .prepare(`SELECT 1 AS sent FROM whatsapp_messages WHERE job_id = ?1 AND purpose = ?2 AND direction = 'out' AND status != 'failed' LIMIT 1`)
    .bind(jobId, purposeOf(kind))
    .first<{ sent: number }>();
  return !!row;
}

async function languageOf(env: Env, phone: string): Promise<ChatLang> {
  const row = await d1(env)
    .prepare('SELECT language FROM whatsapp_contacts WHERE phone = ?1')
    .bind(phone)
    .first<{ language: string | null }>();
  return row?.language === 'te' ? 'te' : 'en';
}

/** Sends one wash's "ready" or bill message, if it's due and hasn't gone yet. */
export async function sendWashMessage(env: Env, shopId: string, jobId: string, kind: WashTemplateKind, at: Date): Promise<void> {
  try {
    if (!whatsappConfigured(env)) return;
    if (Date.now() - at.getTime() > (kind === 'ready' ? READY_STALE_MS : BILL_STALE_MS)) return;
    const job = await jobRepo.findBoardRow(createShopDb(env.DB, shopId), jobId);
    if (!job) return;
    if (kind === 'ready' && (job.status !== 'ready' || job.deliveryMode !== 'hub')) return;
    if (kind === 'bill' && job.status !== 'paid') return;
    const phone = job.customer.phone;
    if (!/^\d{10}$/.test(phone) || (await alreadySent(env, jobId, kind))) return;

    const pdb = createPlatformDb(env.DB);
    const shop = await pdb.shop.findUnique({ where: { id: shopId }, select: { name: true, city: true, businessId: true } });
    if (!shop) return;
    const business = shop.businessId ? await pdb.business.findUnique({ where: { id: shop.businessId }, select: { name: true } }) : null;
    const place = [business?.name ?? shop.name, shop.city].filter(Boolean).join(', ');
    const model = [job.vehicle.make, job.vehicle.model].filter(Boolean).join(' ');

    const lang = await languageOf(env, phone);
    const input = {
      customerName: job.customer.name,
      vehicle: model || job.vehicle.vehicleType.name,
      registrationNumber: job.vehicle.registrationNumber,
      place,
      services: job.jobServices.map((s) => ({ name: s.service.name, quantity: s.quantity })),
      total: job.total,
      discount: job.discount,
      paymentMethod: (job.paymentMethod as PaymentMethod | null) ?? null,
      at,
      // Get Directions on Ready; Rate us on the bill (answered by the assistant).
      buttonPayload: kind === 'ready' ? `loc|${shopId}` : rateChoiceId(shopId),
    };
    // A Telugu template Meta hasn't approved yet falls back to English.
    for (const l of lang === 'te' ? (['te', 'en'] as const) : (['en'] as const)) {
      const m = washTemplateMessage(kind, input, l);
      const sent = await graphSend(env, {
        recipient_type: 'individual',
        to: waId(phone),
        type: 'template',
        template: {
          name: m.name,
          language: { code: m.language },
          components: [
            { type: 'body', parameters: m.params.map((text) => ({ type: 'text', text })) },
            { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: m.buttonPayload }] },
          ],
        },
      });
      await logOutgoing(env, { phone, kind: 'template', body: m.preview, purpose: purposeOf(kind), sent, shopId, jobId });
      if (sent.ok) return;
    }
  } catch (err) {
    console.error(`WhatsApp ${kind} message for job ${jobId} failed`, err);
  }
}

/** The request's execution context, or undefined where there is none (tests calling app.request). */
export function executionCtx(c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }) {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

/** Runs `sendWashMessage` after the response, so the app never waits on WhatsApp. */
export function queueWashMessage(
  ctx: { waitUntil(p: Promise<unknown>): void } | undefined,
  env: Env,
  shopId: string,
  jobId: string,
  kind: WashTemplateKind,
  at: Date,
): Promise<void> {
  const work = sendWashMessage(env, shopId, jobId, kind, at);
  if (env.DEV_MODE === 'true' || !ctx) return work;
  ctx.waitUntil(work);
  return Promise.resolve();
}
