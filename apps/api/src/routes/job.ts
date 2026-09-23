import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createDbClient, jobRepo, serviceRepo } from '@mana/db';
import {
  applyDiscount,
  assertTransition,
  calculatePrice,
  InvalidJobTransitionError,
  PriceNotFoundError,
  type JobStatus,
} from '@mana/domain';
import { requireAuth, requireRole } from '../middleware/auth';
import { startOfIstDay, startOfIstDaysAgo } from '../lib/istDate';
import type { Env } from '../types';

const createJobSchema = z
  .object({
    customerId: z.string(),
    vehicleId: z.string(),
    vehicleTypeId: z.string(),
    services: z
      .array(z.object({ serviceId: z.string(), quantity: z.number().int().positive().default(1) }))
      .min(1),
    discount: z.number().int().min(0).default(0),
    discountReason: z.string().trim().max(200).optional(),
  })
  // V1.0's own feature table: "discounts require a reason" — enforced here too, not just in
  // the app UI, so no client (including a future staff app) can silently apply a bare discount.
  .refine((data) => data.discount === 0 || Boolean(data.discountReason?.trim()), {
    message: 'discountReason is required when discount is greater than 0',
    path: ['discountReason'],
  });

const updateStatusSchema = z.object({ status: z.enum(['washing', 'ready', 'paid', 'void']) });
const markPaidSchema = z.object({ paymentMethod: z.enum(['cash', 'upi', 'other']) });
const statsQuerySchema = z.object({ range: z.enum(['today', 'week']).default('today') });

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const jobRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  // The full "New Wash" step: price is calculated server-side from the current price list —
  // the client sends what was selected, never a total it computed itself. Both domain errors
  // (a service with no price set for this vehicle type; a discount larger than the subtotal)
  // come back as a clean 400, not a raw 500 — these are real day-one operator mistakes, not
  // exceptional server failures.
  .post('/', zValidator('json', createJobSchema), async (c) => {
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    const session = c.get('session');

    const prices = await serviceRepo.listPrices(db, body.vehicleTypeId);

    let breakdown: ReturnType<typeof calculatePrice>;
    try {
      breakdown = calculatePrice(body.services, body.vehicleTypeId, prices);
    } catch (e) {
      if (e instanceof PriceNotFoundError) {
        return c.json({ error: 'price_not_set' as const, message: e.message }, 400);
      }
      throw e;
    }

    let total: number;
    try {
      total = applyDiscount(breakdown.subtotal, body.discount);
    } catch (e) {
      return c.json(
        { error: 'invalid_discount' as const, message: e instanceof Error ? e.message : 'Invalid discount' },
        400,
      );
    }

    const job = await jobRepo.create(db, {
      customerId: body.customerId,
      vehicleId: body.vehicleId,
      createdByUserId: session.sub,
      subtotal: breakdown.subtotal,
      discount: body.discount,
      discountReason: body.discountReason,
      total,
      lineItems: breakdown.lineItems.map((li) => ({
        serviceId: li.serviceId,
        priceAtTime: li.unitPrice,
        quantity: li.quantity,
      })),
    });

    return c.json(job, 201);
  })
  .get('/today', async (c) => {
    const db = createDbClient(c.env.DB);
    return c.json(await jobRepo.listToday(db, startOfIstDay()));
  })
  // Today dashboard / basic reports (owner-only, same access rule as pricing — see V2.0's
  // role field). "week" is a rolling 7 days including today, not a Mon–Sun calendar week —
  // simpler and unambiguous, and it never leaves a business with only a day or two of history
  // staring at a mostly-empty "this week" view right after they start using the app.
  .get('/stats', requireRole('owner'), zValidator('query', statsQuerySchema), async (c) => {
    const db = createDbClient(c.env.DB);
    const { range } = c.req.valid('query');
    const from = range === 'week' ? startOfIstDaysAgo(6) : startOfIstDay();

    const [stats, pendingNow] = await Promise.all([jobRepo.getStats(db, from), jobRepo.countPending(db)]);

    return c.json({ ...stats, pendingNow, range });
  })
  // Job Board: Waiting -> Washing -> Ready. Invalid transitions (e.g. Waiting straight to Paid,
  // or two staff tapping the same job at once) are rejected by @mana/domain's assertTransition
  // and come back as a 409, not a crash — and a job id that no longer exists is a clean 404.
  .patch('/:id/status', zValidator('json', updateStatusSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);

    const job = await jobRepo.findById(db, id).catch(() => null);
    if (!job) return c.json({ error: 'job_not_found' as const }, 404);

    try {
      assertTransition(job.status as JobStatus, body.status);
    } catch (e) {
      if (e instanceof InvalidJobTransitionError) {
        return c.json({ error: 'invalid_transition' as const, message: e.message }, 409);
      }
      throw e;
    }

    return c.json(await jobRepo.updateStatus(db, id, body.status));
  })
  .post('/:id/pay', zValidator('json', markPaidSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);

    const job = await jobRepo.findById(db, id).catch(() => null);
    if (!job) return c.json({ error: 'job_not_found' as const }, 404);

    try {
      assertTransition(job.status as JobStatus, 'paid');
    } catch (e) {
      if (e instanceof InvalidJobTransitionError) {
        return c.json({ error: 'invalid_transition' as const, message: e.message }, 409);
      }
      throw e;
    }

    return c.json(await jobRepo.markPaid(db, id, body.paymentMethod));
  });
