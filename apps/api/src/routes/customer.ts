import { Hono } from 'hono';
import { z } from 'zod';
import { createDbClient, customerRepo, vehicleRepo } from '@mana/db';
import { requireAuth } from '../middleware/auth';
import type { Env } from '../types';

export const customerRoutes = new Hono<{ Bindings: Env }>();
customerRoutes.use('*', requireAuth);

// The single most-used lookup in the app: type a phone or reg. number, get the customer back.
customerRoutes.get('/lookup', async (c) => {
  const phone = c.req.query('phone');
  const registrationNumber = c.req.query('registrationNumber');

  const db = createDbClient(c.env.DB);

  if (registrationNumber) {
    const vehicle = await vehicleRepo.findByRegistration(db, registrationNumber);
    if (!vehicle) return c.json(null);
    const customer = await customerRepo.findById(db, vehicle.customerId);
    const history = await customerRepo.getHistory(db, vehicle.customerId);
    return c.json({ customer, vehicle, visitCount: history.length, lastVisit: history[0]?.createdAt ?? null });
  }

  if (!phone) return c.json({ error: 'phone_or_registrationNumber_required' }, 400);

  const customer = await customerRepo.findByPhone(db, phone);
  if (!customer) return c.json(null);

  const [vehicles, history] = await Promise.all([
    vehicleRepo.listForCustomer(db, customer.id),
    customerRepo.getHistory(db, customer.id),
  ]);

  return c.json({ customer, vehicles, visitCount: history.length, lastVisit: history[0]?.createdAt ?? null });
});

customerRoutes.get('/:id/history', async (c) => {
  const db = createDbClient(c.env.DB);
  return c.json(await customerRepo.getHistory(db, c.req.param('id')));
});

const createCustomerSchema = z.object({
  phone: z.string().min(10),
  name: z.string().optional(),
  source: z.enum(['google', 'friend', 'board', 'instagram', 'other']).optional(),
  vehicle: z.object({
    registrationNumber: z.string().min(4),
    vehicleTypeId: z.string(),
    make: z.string().optional(),
    model: z.string().optional(),
  }),
});

// Quick-add: a brand new customer and their first vehicle in one call (New Wash screen, step 2).
customerRoutes.post('/', async (c) => {
  const body = createCustomerSchema.parse(await c.req.json());
  const db = createDbClient(c.env.DB);

  const customer = await customerRepo.create(db, {
    phone: body.phone,
    name: body.name,
    source: body.source,
  });
  const vehicle = await vehicleRepo.create(db, {
    customerId: customer.id,
    registrationNumber: body.vehicle.registrationNumber,
    vehicleTypeId: body.vehicle.vehicleTypeId,
    make: body.vehicle.make,
    model: body.vehicle.model,
  });

  return c.json({ customer, vehicle }, 201);
});
