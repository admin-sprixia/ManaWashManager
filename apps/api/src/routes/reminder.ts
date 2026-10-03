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
} from '@mana/domain';
import { drawPercent, randomBytes } from '../lib/random';
import { requireAuth, requireRole } from '../middleware/auth';
import { requirePro } from '../lib/plan';
import type { Env } from '../types';

const actionSchema = z.object({ action: z.enum(['reminded', 'snooze', 'dismiss']) });
const vehicleParamSchema = z.object({ vehicleId: z.string().min(1).max(64) });
const couponParamSchema = z.object({ couponId: z.string().min(1).max(64) });
const RECENT_REDEMPTIONS_DAYS = 30;

const sameInstant = (a: Date | null | undefined, b: Date) =>
  Boolean(a) && a!.getTime() === b.getTime();

// Reminders are for everyone on the team (anyone can nudge a customer on WhatsApp); issuing a
// coupon is owner-only. Nothing here is offline-queued — these actions need a live answer.
export const reminderRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth, requirePro('reminders'))
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
  // Someone opened WhatsApp with this coupon — it stops counting as "to send".
  .post('/coupons/:couponId/sent', zValidator('param', couponParamSchema), async (c) => {
    const db = c.get('db');
    await couponRepo.markNotified(db, c.req.valid('param').couponId, new Date());
    return c.json({ ok: true as const });
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
      await couponRepo.markNotified(db, coupon!.id, now);
      return c.json(
        {
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
