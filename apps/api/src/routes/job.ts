import { Hono } from 'hono';
import { z } from 'zod';
import { createDbClient, jobRepo, serviceRepo } from '@mana/db';
import { applyDiscount, assertTransition, calculatePrice, type JobStatus } from '@mana/domain';
import { requireAuth } from '../middleware/auth';
import type { Env } from '../types';

export const jobRoutes = new Hono<{ Bindings: Env }>();
jobRoutes.use('*', requireAuth);

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

// The full "New Wash" step: price is calculated server-side from the current price list —
// the client sends what was selected, never a total it computed itself.
jobRoutes.post('/', async (c) => {
  const body = createJobSchema.parse(await c.req.json());
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
});

jobRoutes.get('/today', async (c) => {
  const db = createDbClient(c.env.DB);
  return c.json(await jobRepo.listToday(db));
});

const updateStatusSchema = z.object({ status: z.enum(['washing', 'ready', 'paid', 'void']) });

// Job Board: Waiting -> Washing -> Ready. Invalid transitions (e.g. Waiting straight to Paid)
// are rejected by @mana/domain's assertTransition, not re-implemented here.
jobRoutes.patch('/:id/status', async (c) => {
  const id = c.req.param('id');
  const body = updateStatusSchema.parse(await c.req.json());
  const db = createDbClient(c.env.DB);

  const job = await jobRepo.findById(db, id);
  assertTransition(job.status as JobStatus, body.status);

  return c.json(await jobRepo.updateStatus(db, id, body.status));
});

const markPaidSchema = z.object({ paymentMethod: z.enum(['cash', 'upi', 'other']) });

jobRoutes.post('/:id/pay', async (c) => {
  const id = c.req.param('id');
  const body = markPaidSchema.parse(await c.req.json());
  const db = createDbClient(c.env.DB);

  const job = await jobRepo.findById(db, id);
  assertTransition(job.status as JobStatus, 'paid');

  return c.json(await jobRepo.markPaid(db, id, body.paymentMethod));
});
