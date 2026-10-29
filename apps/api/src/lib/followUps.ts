import { couponRepo, createPlatformDb, createShopDb, reminderRepo } from '@mana/db';
import {
  addDays,
  COMEBACK_DAYS,
  COUPON_VALID_DAYS,
  daysBetween,
  followUpMessage,
  generateCouponCode,
  hoursSummary,
  parseOffDays,
  REMINDER_DUE_DAYS,
  REMINDER_LIST_MAX,
  REMINDER_LOOKBACK_DAYS,
  reminderBucket,
  washMessageDate,
  type ChatLang,
  type FollowUpInput,
} from '@mana/domain';
import type { Env } from '../types';
import { drawPercent, randomBytes } from './random';
import { graphSend, logOutgoing, waId, whatsappConfigured } from './whatsapp';

/**
 * The morning WhatsApp follow-ups from the business number, so nobody on the team has to send
 * them by hand:
 *   - a "time for a wash" reminder REMINDER_DUE_DAYS after a vehicle's last visit,
 *   - a comeback offer (a fresh coupon) after COMEBACK_DAYS,
 *   - a referral reward when a friend's first wash was paid,
 *   - a heads-up three days before a wash plan ends with washes left.
 * Offers honour STOP; one message per customer a morning; nothing on the branch's day off; and at
 * most MAX_PER_RUN in all (WhatsApp limits how many conversations a business may start a day).
 */

const MAX_PER_RUN = 120;
const PLAN_NOTICE_DAYS = 3;
const MOBILE = /^[6-9]\d{9}$/;

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}
const d1 = (env: Env) => env.DB as unknown as { prepare(q: string): D1Statement };

/** Today's weekday in India (Sunday = 0). */
function indiaWeekday(now: Date): number {
  return new Date(now.getTime() + (5 * 60 + 30) * 60_000).getUTCDay();
}

/**
 * One follow-up template to one customer from the business number, in their language (a Telugu
 * template Meta hasn't approved falls back to English), logged. Also what the Reminders screen's
 * buttons use.
 */
export async function sendFollowUp(
  env: Env,
  phone: string,
  shopId: string,
  input: FollowUpInput,
  purpose: string,
  lang: ChatLang,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let error = 'Not sent';
  for (const l of lang === 'te' ? (['te', 'en'] as const) : (['en'] as const)) {
    const m = followUpMessage(input, l);
    const sent = await graphSend(env, {
      recipient_type: 'individual',
      to: waId(phone),
      type: 'template',
      template: {
        name: m.name,
        language: { code: m.language },
        components: [
          { type: 'body', parameters: m.params.map((text) => ({ type: 'text', text })) },
          ...m.buttonPayloads.map((payload, index) => ({
            type: 'button',
            sub_type: 'quick_reply',
            index: String(index),
            parameters: [{ type: 'payload', payload }],
          })),
        ],
      },
    });
    await logOutgoing(env, { phone, kind: 'template', body: m.preview, purpose, sent, shopId });
    if (sent.ok) return { ok: true };
    error = sent.error;
  }
  return { ok: false, error };
}

/** The customer's WhatsApp language and whether they said STOP to offers. */
export async function followUpContact(env: Env, phone: string): Promise<{ lang: ChatLang; stopped: boolean }> {
  const row = await d1(env)
    .prepare('SELECT language, marketing_stopped_at IS NOT NULL AS stopped FROM whatsapp_contacts WHERE phone = ?1')
    .bind(phone)
    .first<{ language: string | null; stopped: number }>();
  return { lang: row?.language === 'te' ? 'te' : 'en', stopped: !!row?.stopped };
}

/** "Sri Mana Wash, Kovur" for a branch. */
export async function followUpPlace(env: Env, shopId: string): Promise<string> {
  const pdb = createPlatformDb(env.DB);
  const shop = await pdb.shop.findUnique({ where: { id: shopId }, select: { name: true, city: true, businessId: true } });
  const business = shop?.businessId ? await pdb.business.findUnique({ where: { id: shop.businessId }, select: { name: true } }) : null;
  return [business?.name ?? shop?.name ?? 'our car wash', shop?.city].filter(Boolean).join(', ');
}

export interface FollowUpReport {
  sent: number;
  failed: number;
  skipped: number;
}

/** `onlyPhone`: local tests run it for one customer (the dev-only route in routes/whatsapp.ts). */
export async function runFollowUps(env: Env, now = new Date(), opts: { onlyPhone?: string } = {}): Promise<FollowUpReport> {
  const wanted = (phone: string) => !opts.onlyPhone || phone === opts.onlyPhone;
  const report: FollowUpReport = { sent: 0, failed: 0, skipped: 0 };
  const businessId = env.WHATSAPP_BUSINESS_ID?.trim();
  if (!businessId || !whatsappConfigured(env)) return report;
  const pdb = createPlatformDb(env.DB);
  const [business, shops] = await Promise.all([
    pdb.business.findUnique({ where: { id: businessId }, select: { name: true } }),
    pdb.shop.findMany({
      where: { businessId, kind: 'branch', status: 'active' },
      select: { id: true, name: true, city: true, opensAt: true, closesAt: true, weeklyOff: true, weeklyOffDays: true },
    }),
  ]);
  const contacts = await d1(env)
    .prepare('SELECT phone, language, marketing_stopped_at IS NOT NULL AS stopped FROM whatsapp_contacts')
    .all<{ phone: string; language: string | null; stopped: number }>();
  const contactOf = new Map(contacts.results.map((c) => [c.phone, c]));
  /** One message per customer per morning, across branches. */
  const messaged = new Set<string>();

  const send = async (phone: string, shopId: string, input: FollowUpInput, purpose: string): Promise<boolean> => {
    if (!wanted(phone)) return false;
    if (report.sent >= MAX_PER_RUN || messaged.has(phone) || !MOBILE.test(phone)) {
      report.skipped++;
      return false;
    }
    const contact = contactOf.get(phone);
    // Meta counts every one of these as marketing, so STOP stops them all.
    if (contact?.stopped) {
      report.skipped++;
      return false;
    }
    messaged.add(phone);
    const result = await sendFollowUp(env, phone, shopId, input, purpose, contact?.language === 'te' ? 'te' : 'en');
    if (result.ok) report.sent++;
    else report.failed++;
    return result.ok;
  };

  for (const shop of shops) {
    const offDays = shop.weeklyOffDays ? parseOffDays(shop.weeklyOffDays) : shop.weeklyOff != null ? [shop.weeklyOff] : [];
    // Nobody wants "come in today" on the day the shop is shut.
    if (offDays.includes(indiaWeekday(now))) continue;
    const db = createShopDb(env.DB, shop.id);
    const place = [business?.name ?? shop.name, shop.city].filter(Boolean).join(', ');
    const base = { place, branchId: shop.id };

    // ─── Referral rewards nobody has sent yet ─────────────────────────────────
    const rewards = await db.coupon.findMany({
      where: { kind: 'referral', status: 'active', expiresAt: { gt: now }, notifiedAt: null },
      select: {
        id: true,
        code: true,
        percent: true,
        expiresAt: true,
        customer: { select: { name: true, phone: true } },
        referrals: { select: { referred: { select: { name: true } } }, take: 1 },
      },
      take: 50,
    });
    for (const r of rewards) {
      const ok = await send(r.customer.phone, shop.id, {
        ...base,
        kind: 'referral',
        customerName: r.customer.name,
        friend: r.referrals[0]?.referred.name ?? null,
        percent: r.percent,
        code: r.code,
        validTill: washMessageDate(r.expiresAt).split(',')[0]!,
      }, 'referral');
      if (ok) await couponRepo.markNotified(db, r.id, now);
    }

    // ─── Plans ending soon with washes left ───────────────────────────────────
    const endsBy = addDays(now, PLAN_NOTICE_DAYS).toISOString().slice(0, 10);
    const today = new Date(now.getTime() + (5 * 60 + 30) * 60_000).toISOString().slice(0, 10);
    const plans = await d1(env)
      .prepare(
        `SELECT o.id, o.title, o.ends_on AS endsOn, o.washes_total - o.washes_used AS washesLeft,
                c.name AS customerName, c.phone, v.registration_number AS reg, v.make, v.model
         FROM shop_plan_orders o JOIN customers c ON c.id = o.customer_id JOIN vehicles v ON v.id = o.vehicle_id
         WHERE o.shop_id = ?1 AND o.status = 'active' AND o.washes_used < o.washes_total
           AND o.ends_on >= ?2 AND o.ends_on <= ?3
           AND NOT EXISTS (SELECT 1 FROM whatsapp_messages m WHERE m.purpose = 'plan_ending:' || o.id AND m.status != 'failed')
         LIMIT 50`,
      )
      .bind(shop.id, today, endsBy)
      .all<{ id: string; title: string; endsOn: string; washesLeft: number; customerName: string | null; phone: string; reg: string; make: string | null; model: string | null }>();
    const hours =
      hoursSummary({ opensAt: shop.opensAt, closesAt: shop.closesAt, weeklyOff: shop.weeklyOff, weeklyOffDays: offDays }) ?? 'every day';
    for (const p of plans.results) {
      await send(p.phone, shop.id, {
        ...base,
        kind: 'plan_ending',
        customerName: p.customerName,
        plan: p.title,
        vehicle: [p.make, p.model].filter(Boolean).join(' ') || 'vehicle',
        registrationNumber: p.reg,
        endsOn: washMessageDate(new Date(`${p.endsOn}T12:00:00+05:30`)).split(',')[0]!,
        washesLeft: p.washesLeft,
        hours,
      }, `plan_ending:${p.id}`);
    }

    // ─── "Time for a wash" and comeback offers ────────────────────────────────
    const vehicles = await reminderRepo.listLapsed(db, addDays(now, -REMINDER_DUE_DAYS), now, addDays(now, -REMINDER_LOOKBACK_DAYS), REMINDER_LIST_MAX);
    // Comeback coupons are issued in the owner's name (a coupon always has an issuer).
    const owner = await db.user.findFirst({ where: { role: 'owner', active: true }, select: { id: true } });
    for (const v of vehicles) {
      const last = v.jobs[0];
      if (!last) continue;
      const days = daysBetween(last.createdAt, now);
      const bucket = reminderBucket(days);
      const state = v.reminder && v.reminder.lastVisitAt.getTime() === last.createdAt.getTime() ? v.reminder : null;
      if (!bucket || state?.dismissedAt || (state?.snoozedUntil && state.snoozedUntil > now)) continue;
      const vehicle = [v.make, v.model].filter(Boolean).join(' ') || v.vehicleType.name;
      if (bucket === 'due' && !state?.remindedAt) {
        const ok = await send(v.customer.phone, shop.id, {
          ...base,
          kind: 'reminder',
          customerName: v.customer.name,
          vehicle,
          registrationNumber: v.registrationNumber,
          days,
        }, 'reminder');
        if (ok) await reminderRepo.record(db, { vehicleId: v.id, lastVisitAt: last.createdAt, action: 'reminded', userId: null, now });
      } else if (bucket === 'comeback' && v.coupons.length === 0 && owner && days >= COMEBACK_DAYS) {
        if (!wanted(v.customer.phone) || messaged.has(v.customer.phone) || report.sent >= MAX_PER_RUN) continue;
        const coupon = await couponRepo.issue(db, {
          vehicleId: v.id,
          customerId: v.customerId,
          code: generateCouponCode(v.registrationNumber, randomBytes(6)),
          percent: drawPercent(),
          expiresAt: addDays(now, COUPON_VALID_DAYS),
          issuedByUserId: owner.id,
          now,
        });
        const ok = await send(v.customer.phone, shop.id, {
          ...base,
          kind: 'comeback',
          customerName: v.customer.name,
          vehicle,
          registrationNumber: v.registrationNumber,
          percent: coupon.percent,
          code: coupon.code,
          validTill: washMessageDate(coupon.expiresAt).split(',')[0]!,
        }, 'comeback');
        if (ok) {
          await couponRepo.markNotified(db, coupon.id, now);
          await reminderRepo.record(db, { vehicleId: v.id, lastVisitAt: last.createdAt, action: 'reminded', userId: null, now });
        } else {
          // Not sent (a template not approved yet, say): take the coupon back so tomorrow tries again.
          await couponRepo.cancelActiveForVehicle(db, v.id, 'replaced', now, 'comeback');
        }
      }
    }
  }
  return report;
}
