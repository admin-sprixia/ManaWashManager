import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { couponRepo, reminderRepo, rewardRepo } from '@mana/db';
import {
  addDays,
  COMEBACK_DAYS,
  COUPON_VALID_DAYS,
  daysBetween,
  generateCouponCode,
  REMINDER_DUE_DAYS,
  REMINDER_LIST_MAX,
  REMINDER_LOOKBACK_DAYS,
  REMINDER_SNOOZE_DAYS,
  reminderBucket,
  washMessageDate,
  type FollowUpInput,
} from '@mana/domain';
import { followUpContact, followUpPlace, sendFollowUp } from '../lib/followUps';
import { drawPercent, randomBytes } from '../lib/random';
import { whatsappConfigured } from '../lib/whatsapp';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';

const actionSchema = z.object({ action: z.enum(['reminded', 'snooze', 'dismiss']) });
const vehicleParamSchema = z.object({ vehicleId: z.string().min(1).max(64) });
const couponParamSchema = z.object({ couponId: z.string().min(1).max(64) });
const RECENT_REDEMPTIONS_DAYS = 30;

const sameInstant = (a: Date | null | undefined, b: Date) =>
  Boolean(a) && a!.getTime() === b.getTime();

const stoppedOffers = {
  error: 'stopped_offers' as const,
  message: 'This customer turned off offers on WhatsApp (STOP), so we don’t send them reminders.',
};
const notSetUp = { error: 'whatsapp_unavailable' as const, message: 'WhatsApp isn’t set up yet.' };
const validTill = (d: Date) => washMessageDate(d).split(',')[0]!;

/** Sends a reminder or offer from the business number now; the error message when it couldn't. */
async function sendNow(env: Env, phone: string, shopId: string, input: FollowUpInput, purpose: string): Promise<string | null> {
  if (!whatsappConfigured(env)) return notSetUp.message;
  const contact = await followUpContact(env, phone);
  if (contact.stopped) return stoppedOffers.message;
  const sent = await sendFollowUp(env, phone, shopId, input, purpose, contact.lang);
  return sent.ok ? null : `WhatsApp didn’t take it: ${sent.error}`;
}

// Reminders go out by themselves each morning on WhatsApp (lib/followUps.ts); this is the list,
// and the buttons to send one now from the business number. Issuing a coupon is owner-only.
// Nothing here is offline-queued — these actions need a live answer.
export const reminderRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  .get('/', async (c) => {
    const db = c.get('db');
    const now = new Date();
    const dueBefore = addDays(now, -REMINDER_DUE_DAYS);
    const seenAfter = addDays(now, -REMINDER_LOOKBACK_DAYS);
    const [vehicles, coupons, cards] = await Promise.all([
      reminderRepo.listLapsed(db, dueBefore, now, seenAfter, REMINDER_LIST_MAX),
      couponRepo.listRecent(db, now, addDays(now, -RECENT_REDEMPTIONS_DAYS)),
      // Stamp cards to mention in the reminder ("2 more for a free wash", "free wash waiting").
      rewardRepo.cardsWhere(db, reminderRepo.lapsedWhere(dueBefore, seenAfter), now),
    ]);

    const items = vehicles.flatMap((v) => {
      const last = v.jobs[0];
      if (!last) return [];
      const daysSince = daysBetween(last.createdAt, now);
      const bucket = reminderBucket(daysSince);
      if (!bucket) return [];
      const state =
        v.reminder && sameInstant(v.reminder.lastVisitAt, last.createdAt) ? v.reminder : null;
      if (state?.dismissedAt) return [];
      if (state?.snoozedUntil && state.snoozedUntil.getTime() > now.getTime()) return [];
      const coupon = v.coupons.find((cp) => cp.customerId === v.customerId) ?? null;
      return [
        {
          vehicleId: v.id,
          registrationNumber: v.registrationNumber,
          vehicleType: v.vehicleType.name,
          customer: v.customer,
          lastVisitAt: last.createdAt.toISOString(),
          lastServices: [...new Set(last.jobServices.map((js) => js.service.name))],
          daysSince,
          bucket,
          remindedAt: state?.remindedAt?.toISOString() ?? null,
          coupon: coupon
            ? {
                id: coupon.id,
                code: coupon.code,
                percent: coupon.percent,
                expiresAt: coupon.expiresAt.toISOString(),
              }
            : null,
          rewards: cards.get(v.id) ?? [],
        },
      ];
    });

    // Untouched first, then most overdue first.
    items.sort(
      (a, b) =>
        Number(Boolean(a.remindedAt || a.coupon)) - Number(Boolean(b.remindedAt || b.coupon)) ||
        b.daysSince - a.daysSince,
    );

    const toCoupon = (cp: (typeof coupons.active)[number]) => ({
      id: cp.id,
      code: cp.code,
      kind: cp.kind === 'referral' ? ('referral' as const) : ('comeback' as const),
      notifiedAt: cp.notifiedAt?.toISOString() ?? null,
      referredName: cp.referrals[0]?.referred.name ?? null,
      percent: cp.percent,
      expiresAt: cp.expiresAt.toISOString(),
      createdAt: cp.createdAt.toISOString(),
      redeemedAt: cp.redeemedAt?.toISOString() ?? null,
      registrationNumber: cp.vehicle.registrationNumber,
      customer: cp.customer,
      issuedBy: cp.issuedBy.name,
      redeemedBy: cp.redeemedBy?.name ?? null,
    });

    const due = items.filter((i) => i.bucket === 'due');
    const comeback = items.filter((i) => i.bucket === 'comeback');
    return c.json({
      due,
      comeback,
      coupons: { active: coupons.active.map(toCoupon), redeemed: coupons.redeemed.map(toCoupon) },
      /** Badge count: vehicles nobody has acted on yet, plus referral rewards not yet sent. */
      actionable:
        items.filter((i) => !i.remindedAt && !i.coupon).length +
        coupons.active.filter((cp) => cp.kind === 'referral' && !cp.notifiedAt).length,
      rules: {
        dueDays: REMINDER_DUE_DAYS,
        comebackDays: COMEBACK_DAYS,
        validDays: COUPON_VALID_DAYS,
      },
    });
  })
  // A referral reward, sent now on WhatsApp from the business number.
  .post('/coupons/:couponId/whatsapp', zValidator('param', couponParamSchema), async (c) => {
    const db = c.get('db');
    const now = new Date();
    const coupon = await db.coupon.findFirst({
      where: { id: c.req.valid('param').couponId, status: 'active', expiresAt: { gt: now } },
      select: {
        id: true,
        code: true,
        percent: true,
        expiresAt: true,
        customer: { select: { name: true, phone: true } },
        referrals: { select: { referred: { select: { name: true } } }, take: 1 },
      },
    });
    if (!coupon) return c.json({ error: 'not_found' as const, message: 'This reward isn’t active any more.' }, 404);
    const shopId = c.get('session').shopId;
    const error = await sendNow(c.env, coupon.customer.phone, shopId, {
      kind: 'referral',
      customerName: coupon.customer.name,
      friend: coupon.referrals[0]?.referred.name ?? null,
      percent: coupon.percent,
      code: coupon.code,
      validTill: validTill(coupon.expiresAt),
      place: await followUpPlace(c.env, shopId),
      branchId: shopId,
    }, 'referral');
    if (error) return c.json({ error: 'not_sent' as const, message: error }, 409);
    await couponRepo.markNotified(db, coupon.id, now);
    return c.json({ ok: true as const, notifiedAt: now.toISOString() });
  })
  // Someone opened WhatsApp with this coupon — it stops counting as "to send".
  .post('/coupons/:couponId/sent', zValidator('param', couponParamSchema), async (c) => {
    const db = c.get('db');
    await couponRepo.markNotified(db, c.req.valid('param').couponId, new Date());
    return c.json({ ok: true as const });
  })
  // "Remind now": the reminder (or the vehicle's active offer again) on WhatsApp from the business number.
  .post('/:vehicleId/whatsapp', zValidator('param', vehicleParamSchema), async (c) => {
    const db = c.get('db');
    const { vehicleId } = c.req.valid('param');
    const now = new Date();
    const vehicle = await db.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, make: true, model: true, registrationNumber: true, customerId: true, vehicleType: { select: { name: true } }, customer: { select: { name: true, phone: true } } },
    });
    const lastVisitAt = vehicle ? await reminderRepo.lastVisit(db, vehicleId) : null;
    if (!vehicle || !lastVisitAt) return c.json({ error: 'vehicle_not_found' as const, message: 'No visits for this vehicle.' }, 404);
    const shopId = c.get('session').shopId;
    const coupon = await db.coupon.findFirst({
      where: { vehicleId, customerId: vehicle.customerId, kind: 'comeback', status: 'active', expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, code: true, percent: true, expiresAt: true },
    });
    const common = {
      customerName: vehicle.customer.name,
      vehicle: [vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.vehicleType.name,
      registrationNumber: vehicle.registrationNumber,
      place: await followUpPlace(c.env, shopId),
      branchId: shopId,
    };
    const error = await sendNow(
      c.env,
      vehicle.customer.phone,
      shopId,
      coupon
        ? { ...common, kind: 'comeback', percent: coupon.percent, code: coupon.code, validTill: validTill(coupon.expiresAt) }
        : { ...common, kind: 'reminder', days: daysBetween(lastVisitAt, now) },
      coupon ? 'comeback' : 'reminder',
    );
    if (error) return c.json({ error: 'not_sent' as const, message: error }, 409);
    await reminderRepo.record(db, { vehicleId, lastVisitAt, action: 'reminded', userId: c.get('session').sub, now });
    if (coupon) await couponRepo.markNotified(db, coupon.id, now);
    return c.json({ ok: true as const, remindedAt: now.toISOString() });
  })
  .post(
    '/:vehicleId',
    zValidator('param', vehicleParamSchema),
    zValidator('json', actionSchema),
    async (c) => {
      const db = c.get('db');
      const { vehicleId } = c.req.valid('param');
      const { action } = c.req.valid('json');
      const now = new Date();

      const lastVisitAt = await reminderRepo.lastVisit(db, vehicleId);
      if (!lastVisitAt)
        return c.json(
          { error: 'vehicle_not_found' as const, message: 'No visits for this vehicle.' },
          404,
        );

      await reminderRepo.record(db, {
        vehicleId,
        lastVisitAt,
        action,
        userId: c.get('session').sub,
        now,
        snoozeUntil: action === 'snooze' ? addDays(now, REMINDER_SNOOZE_DAYS) : undefined,
      });
      return c.json({ ok: true });
    },
  )
  // Owner-only: a comeback coupon for a vehicle that hasn't been in for COMEBACK_DAYS. The
  // percentage is drawn here, on the server, and never changes afterwards.
  .post(
    '/:vehicleId/coupon',
    requireRole('owner'),
    zValidator('param', vehicleParamSchema),
    async (c) => {
      const db = c.get('db');
      const { vehicleId } = c.req.valid('param');
      const session = c.get('session');
      const now = new Date();

      const vehicle = await db.vehicle.findUnique({
        where: { id: vehicleId },
        include: { customer: { select: { id: true, name: true, phone: true } }, vehicleType: true },
      });
      if (!vehicle || vehicle.registrationNumber.startsWith('WALK-IN')) {
        return c.json({ error: 'vehicle_not_found' as const, message: 'Vehicle not found.' }, 404);
      }
      const lastVisitAt = await reminderRepo.lastVisit(db, vehicleId);
      if (!lastVisitAt || daysBetween(lastVisitAt, now) < COMEBACK_DAYS) {
        return c.json(
          {
            error: 'not_eligible' as const,
            message: `Comeback offers are only for vehicles that haven’t visited in ${COMEBACK_DAYS} days.`,
          },
          409,
        );
      }

      const percent = drawPercent();
      const expiresAt = addDays(now, COUPON_VALID_DAYS);
      let coupon: Awaited<ReturnType<typeof couponRepo.issue>> | null = null;
      // A clash on the random code (or a simultaneous issue for the same vehicle) fails the
      // insert on a unique index; draw a fresh code and try again.
      for (let attempt = 0; attempt < 4 && !coupon; attempt++) {
        try {
          coupon = await couponRepo.issue(db, {
            vehicleId,
            customerId: vehicle.customerId,
            code: generateCouponCode(vehicle.registrationNumber, randomBytes(6)),
            percent,
            expiresAt,
            issuedByUserId: session.sub,
            now,
          });
        } catch (e) {
          if (attempt === 3) throw e;
        }
      }

      await reminderRepo.record(db, {
        vehicleId,
        lastVisitAt,
        action: 'reminded',
        userId: session.sub,
        now,
      });
      // The offer goes to the customer on WhatsApp right away, from the business number.
      const whatsappError = await sendNow(c.env, vehicle.customer.phone, session.shopId, {
        kind: 'comeback',
        customerName: vehicle.customer.name,
        vehicle: [vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.vehicleType.name,
        registrationNumber: vehicle.registrationNumber,
        percent: coupon!.percent,
        code: coupon!.code,
        validTill: validTill(coupon!.expiresAt),
        place: await followUpPlace(c.env, session.shopId),
        branchId: session.shopId,
      }, 'comeback');
      if (!whatsappError) await couponRepo.markNotified(db, coupon!.id, now);
      return c.json(
        {
          /** Null when it went out on WhatsApp; otherwise why not (the coupon still stands). */
          whatsappError,
          id: coupon!.id,
          code: coupon!.code,
          percent: coupon!.percent,
          expiresAt: coupon!.expiresAt.toISOString(),
          registrationNumber: vehicle.registrationNumber,
          vehicleType: vehicle.vehicleType.name,
          customer: vehicle.customer,
        },
        201,
      );
    },
  );
