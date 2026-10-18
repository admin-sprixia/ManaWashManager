import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { customerRepo, jobRepo, shopPlanRepo } from '@mana/db';
import { normalizePhone, type JobStatus } from '@mana/domain';
import { occurredAt } from '../lib/clientTime';
import { requireAuth } from '../middleware/auth';
import type { Env } from '../types';

const registrationSchema = z
  .string()
  .transform((r) => r.trim().toUpperCase().replace(/\s+/g, ''))
  .refine((r) => r.length >= 4 && r.length <= 15, 'Enter a valid registration number');

const sellSchema = z.object({
  /** The client's id for the sale: also the id of its bill, so a retry sells it once. */
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid id'),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  customer: z.object({
    phone: z
      .string()
      .transform(normalizePhone)
      .refine((p) => /^[6-9]\d{9}$/.test(p), 'Enter a valid 10-digit mobile number'),
    name: z.string().trim().min(1, 'Customer name is required').max(80),
  }),
  registrationNumber: registrationSchema,
  vehicleTypeId: z.string().min(1).max(64),
  ownership: z.enum(['new_owner', 'same_person']).optional(),
  planId: z.string().min(1).max(64),
  paymentMethod: z.enum(['cash', 'upi', 'other']),
});

/**
 * Wash plans at the counter: what the branch sells for a vehicle, a vehicle's running plans, and
 * selling one (paid in full, on a bill of its own).
 */
export const shopPlanRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  /** The plans sold here for a vehicle type, with their price. */
  .get('/for-sale', zValidator('query', z.object({ vehicleTypeId: z.string().min(1).max(64) })), async (c) => {
    const plans = await shopPlanRepo.forSale(c.env.DB, c.get('session').shopId, c.req.valid('query').vehicleTypeId);
    return c.json({ plans });
  })
  /** A vehicle's running shop plans here, and whether each can pay for a wash today. */
  .get('/vehicle', zValidator('query', z.object({ registrationNumber: registrationSchema })), async (c) => {
    const plans = await shopPlanRepo.forVehicle(c.get('db'), c.req.valid('query').registrationNumber, new Date());
    return c.json({ plans });
  })
  /** Sells a plan for a vehicle: the customer and vehicle are found or added, and the bill is paid. */
  .post('/sell', zValidator('json', sellSchema), async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const session = c.get('session');
    const now = occurredAt(c, body.occurredAt);

    const done = await jobRepo.findBoardRow(db, body.id);
    if (done?.planSaleId) return c.json({ job: done }, 200);

    const ensured = await customerRepo.ensureWithVehicle(db, {
      phone: body.customer.phone,
      name: body.customer.name,
      registrationNumber: body.registrationNumber,
      vehicleTypeId: body.vehicleTypeId,
      ownership: body.ownership,
    });
    if ('error' in ensured) {
      return c.json(
        { error: ensured.error, message: `${body.customer.phone} already belongs to ${ensured.holderName || 'another customer'}. Choose “New owner” instead.` },
        409,
      );
    }
    const { customer, vehicle } = ensured;

    const sold = await shopPlanRepo.sell(c.env.DB, session.shopId, {
      saleId: body.id,
      planId: body.planId,
      customerId: customer.id,
      vehicleId: vehicle.id,
      vehicleTypeId: vehicle.vehicleTypeId,
      paymentMethod: body.paymentMethod,
      byUserId: session.sub,
      now,
    });
    if (!sold.ok) return c.json({ error: 'plan_not_sold' as const, message: sold.message }, 400);

    let job = await jobRepo.findBoardRow(db, body.id);
    if (!job) {
      await jobRepo.create(db, {
        id: body.id,
        customerId: customer.id,
        vehicleId: vehicle.id,
        createdByUserId: session.sub,
        subtotal: sold.value.total,
        discount: 0,
        total: sold.value.total,
        createdAt: now,
        lineItems: [{ serviceId: shopPlanRepo.saleServiceId(session.shopId), priceAtTime: sold.value.total, commissionAtTime: 0, quantity: 1 }],
        sellerIds: [],
        deliveryMode: 'hub',
        planSaleId: sold.value.orderId,
      });
      job = await jobRepo.findBoardRow(db, body.id);
    }
    if (job && job.status !== 'paid') {
      job = (await jobRepo.markPaid(db, body.id, { from: job.status as JobStatus, paymentMethod: body.paymentMethod, userId: session.sub, at: now })) ?? job;
    }
    return c.json({ job, plan: { id: sold.value.orderId, endsOn: sold.value.endsOn } }, 201);
  });
