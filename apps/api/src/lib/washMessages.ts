import { createPlatformDb, createShopDb, jobRepo, settingsRepo, shopPlanRepo } from '@mana/db';
import { planUseBy, planWashMessage, rateChoiceId, washTemplateMessage, type ChatLang, type PaymentMethod, type WashTemplateKind } from '@mana/domain';
import type { Env } from '../types';
import { billPdf } from './washBill';
import { graphSend, logOutgoing, uploadMedia, waId, whatsappConfigured } from './whatsapp';

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
    const languages = lang === 'te' ? (['te', 'en'] as const) : (['en'] as const);
    // "Rate us" only once the branch has its Google review link; until then the plain bill, or the
    // one with the button while Meta hasn't approved the plain one yet.
    const reviewUrl = kind === 'bill' ? (await settingsRepo.listPublic(createShopDb(env.DB, shopId))).google_review_url : null;
    const plainFirst = kind === 'bill' && !reviewUrl ? [true, false] : [false];
    /** One template in one language; a Telugu one Meta hasn't approved yet falls back to English. */
    const send = async (which: WashTemplateKind, document: { id: string; filename: string } | null) => {
      for (const plain of plainFirst) for (const l of languages) {
        const m = washTemplateMessage(which, input, l, { plain });
        const sent = await graphSend(env, {
          recipient_type: 'individual',
          to: waId(phone),
          type: 'template',
          template: {
            name: m.name,
            language: { code: m.language },
            components: [
              ...(document ? [{ type: 'header', parameters: [{ type: 'document', document }] }] : []),
              { type: 'body', parameters: m.params.map((text) => ({ type: 'text', text })) },
              ...(m.hasButton ? [{ type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: m.buttonPayload }] }] : []),
            ],
          },
        });
        await logOutgoing(env, { phone, kind: document ? 'document' : 'template', body: m.preview, purpose: purposeOf(kind), sent, shopId, jobId });
        if (sent.ok) return true;
      }
      return false;
    };
    // The bill goes with its PDF (photos and all) when it can; otherwise as text.
    if (kind === 'bill') {
      const pdf = await billPdf(env, shopId, jobId).catch(() => null);
      const media = pdf ? await uploadMedia(env, pdf.bytes, 'application/pdf', pdf.fileName) : null;
      if (pdf && media?.ok && (await send('invoice', { id: media.id, filename: pdf.fileName }))) return;
    }
    await send(kind, null);
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

/** "2026-11-28" → "28 Nov 2026". */
function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}

/**
 * After a wash a shop plan paid for: what was done and what's left of the pack, so the customer
 * always knows their balance (and sees at once if a wash was marked that they didn't have). Once
 * per wash; never throws.
 */
export async function sendPlanWashMessage(env: Env, shopId: string, jobId: string, at: Date): Promise<void> {
  try {
    if (!whatsappConfigured(env)) return;
    if (Date.now() - at.getTime() > BILL_STALE_MS) return;
    const db = createShopDb(env.DB, shopId);
    const use = await db.shopPlanUse.findFirst({ where: { jobId }, select: { orderId: true, kind: true, catalogServiceId: true } });
    if (!use) return;
    const [order, job] = await Promise.all([db.shopPlanOrder.findUnique({ where: { id: use.orderId } }), jobRepo.findBoardRow(db, jobId)]);
    if (!order || !job) return;
    const phone = job.customer.phone;
    if (!/^\d{10}$/.test(phone)) return;
    const sentBefore = await d1(env)
      .prepare(`SELECT 1 AS sent FROM whatsapp_messages WHERE job_id = ?1 AND purpose = 'plan_wash' AND direction = 'out' AND status != 'failed' LIMIT 1`)
      .bind(jobId)
      .first<{ sent: number }>();
    if (sentBefore) return;

    const pdb = createPlatformDb(env.DB);
    const pack = (await shopPlanRepo.pack(env.DB, shopId, order)).filter((w) => w.washesTotal > 0);
    const [shop, catalog] = await Promise.all([
      pdb.shop.findUnique({ where: { id: shopId }, select: { name: true, city: true, businessId: true } }),
      pdb.catalogService.findMany({ where: { id: { in: pack.map((w) => w.catalogServiceId) } }, select: { id: true, name: true } }),
    ]);
    if (!shop) return;
    const business = shop.businessId ? await pdb.business.findUnique({ where: { id: shop.businessId }, select: { name: true } }) : null;
    const washName = (id: string | null) => catalog.find((c) => c.id === id)?.name ?? 'Wash';
    const model = [job.vehicle.make, job.vehicle.model].filter(Boolean).join(' ');
    const input = {
      customerName: job.customer.name,
      vehicle: model || job.vehicle.vehicleType.name,
      registrationNumber: job.vehicle.registrationNumber,
      wash: washName(use.catalogServiceId ?? (use.kind === 'upgrade' ? order.upgradeServiceId : order.catalogServiceId)),
      plan: order.title,
      left: pack.map((w) => ({ wash: washName(w.catalogServiceId), count: w.washesTotal - w.washesUsed })),
      useBy: dayLabel(planUseBy(order.endsOn)),
      place: [business?.name ?? shop.name, shop.city].filter(Boolean).join(', '),
      branchId: shopId,
    };
    const languages = (await languageOf(env, phone)) === 'te' ? (['te', 'en'] as const) : (['en'] as const);
    for (const lang of languages) {
      const m = planWashMessage(input, lang);
      const sent = await graphSend(env, {
        recipient_type: 'individual',
        to: waId(phone),
        type: 'template',
        template: {
          name: m.name,
          language: { code: m.language },
          components: [
            { type: 'body', parameters: m.params.map((text) => ({ type: 'text', text })) },
            ...m.buttonPayloads.map((payload, i) => ({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload }] })),
          ],
        },
      });
      await logOutgoing(env, { phone, kind: 'template', body: m.preview, purpose: 'plan_wash', sent, shopId, jobId });
      if (sent.ok) return;
    }
  } catch (err) {
    console.error(`WhatsApp plan wash message for job ${jobId} failed`, err);
  }
}

/** Runs `sendPlanWashMessage` after the response, like `queueWashMessage`. */
export function queuePlanWashMessage(ctx: { waitUntil(p: Promise<unknown>): void } | undefined, env: Env, shopId: string, jobId: string, at: Date): Promise<void> {
  const work = sendPlanWashMessage(env, shopId, jobId, at);
  if (env.DEV_MODE === 'true' || !ctx) return work;
  ctx.waitUntil(work);
  return Promise.resolve();
}
