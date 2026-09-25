import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { couponRepo, createDbClient } from '@mana/db';
import { normalizePhone } from '@mana/domain';
import { requireAuth } from '../middleware/auth';
import type { Env } from '../types';

const usableQuerySchema = z.object({
  registrationNumber: z.string().transform((r) => r.trim().toUpperCase().replace(/\s+/g, '')),
  phone: z.string().transform(normalizePhone),
});

export const couponRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  // New Wash asks this once the customer is known. Only a live coupon issued to this vehicle's
  // current owner — presented under the owner's own number — comes back.
  .get('/usable', zValidator('query', usableQuerySchema), async (c) => {
    const db = createDbClient(c.env.DB);
    const { registrationNumber, phone } = c.req.valid('query');
    const coupon = await couponRepo.findUsable(db, { registrationNumber, phone, now: new Date() });
    return c.json({
      coupon: coupon
        ? {
            code: coupon.code,
            percent: coupon.percent,
            expiresAt: coupon.expiresAt.toISOString(),
            issuedFor: coupon.vehicle.registrationNumber,
          }
        : null,
    });
  });
