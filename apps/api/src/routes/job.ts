import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createDbClient, jobRepo, serviceRepo } from '@mana/db';
import { applyDiscount, assertTransition, calculatePrice, type JobStatus } from '@mana/domain';
import { requireAuth } from '../middleware/auth';
import type { Env } from '../types';

const createJobSchema = z.object({
  customerId: z.string(),
  vehicleId: z.string(),
  vehicleTypeId: z.string(),
  services: z
    .array(z.object({ serviceId: z.string(), quantity: z.number().int().positive().default(1) }))
    .min(1),
  discount: z.number().int().min(0).default(0),
  discountReason: z.string().optional(),
});

const updateStatusSchema = z.object({ status: z.enum(['washing', 'ready', 'paid', 'void']) });
const markPaidSchema = z.object({ paymentMethod: z.enum(['cash', 'upi', 'other']) });

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const jobRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  // The full "New Wash" step: price is calculated server-side from the current price list —
  // the client sends what was selected, never a total it computed itself.
  .post('/', zValidator('json', createJobSchema), async (c) => {
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    const session = c.get('session');

    const prices = await serviceRepo.listPrices(db, body.vehicleTypeId);
    const breakdown = calculatePrice(body.services, body.vehicleTypeId, prices);
    const total = applyDiscount(breakdown.subtotal, body.discount);

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
    return c.json(await jobRepo.listToday(db));
  })
  // Job Board: Waiting -> Washing -> Ready. Invalid transitions (e.g. Waiting straight to Paid)
  // are rejected by @mana/domain's assertTransition, not re-implemented here.
  .patch('/:id/status', zValidator('json', updateStatusSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);

    const job = await jobRepo.findById(db, id);
    assertTransition(job.status as JobStatus, body.status);

    return c.json(await jobRepo.updateStatus(db, id, body.status));
  })
  .post('/:id/pay', zValidator('json', markPaidSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);

    const job = await jobRepo.findById(db, id);
    assertTransition(job.status as JobStatus, 'paid');

    return c.json(await jobRepo.markPaid(db, id, body.paymentMethod));
  });
