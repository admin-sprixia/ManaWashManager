import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createDbClient, customerRepo, vehicleRepo } from '@mana/db';
import { requireAuth } from '../middleware/auth';
import type { Env } from '../types';

const lookupQuerySchema = z.object({
  phone: z.string().optional(),
  registrationNumber: z.string().optional(),
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

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const customerRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  // The single most-used lookup in the app: type a phone or reg. number, get the customer back.
  .get('/lookup', zValidator('query', lookupQuerySchema), async (c) => {
    const { phone, registrationNumber } = c.req.valid('query');
    const db = createDbClient(c.env.DB);

    if (registrationNumber) {
      const vehicle = await vehicleRepo.findByRegistration(db, registrationNumber);
      if (!vehicle) return c.json(null);
      const customer = await customerRepo.findById(db, vehicle.customerId);
      const history = await customerRepo.getHistory(db, vehicle.customerId);
      return c.json({ customer, vehicle, visitCount: history.length, lastVisit: history[0]?.createdAt ?? null });
    }

    if (!phone) return c.json({ error: 'phone_or_registrationNumber_required' as const }, 400);

    const customer = await customerRepo.findByPhone(db, phone);
    if (!customer) return c.json(null);

    const [vehicles, history] = await Promise.all([
      vehicleRepo.listForCustomer(db, customer.id),
      customerRepo.getHistory(db, customer.id),
    ]);

    return c.json({ customer, vehicles, visitCount: history.length, lastVisit: history[0]?.createdAt ?? null });
  })
  // Customer Profile screen: full picture of one customer — their vehicles, every job they've
  // ever had, and lifetime numbers. `lifetimeSpend` only counts paid jobs (money actually
  // collected); `visitCount`/`lastVisit` count every job the same way `/lookup` above does,
  // so the same customer shows identical numbers whether seen from New Wash or their profile.
  .get('/:id', async (c) => {
    const db = createDbClient(c.env.DB);
    const id = c.req.param('id');
    const customer = await customerRepo.findById(db, id);
    if (!customer) return c.json(null);

    const [vehicles, history] = await Promise.all([
      vehicleRepo.listForCustomer(db, id),
      customerRepo.getHistory(db, id),
    ]);

    const lifetimeSpend = history
      .filter((job) => job.status === 'paid')
      .reduce((sum, job) => sum + job.total, 0);

    return c.json({
      customer,
      vehicles,
      history,
      visitCount: history.length,
      lifetimeSpend,
      lastVisit: history[0]?.createdAt ?? null,
    });
  })
  // Quick-add: a brand new customer and their first vehicle in one call (New Wash screen, step 2).
  .post('/', zValidator('json', createCustomerSchema), async (c) => {
    const body = c.req.valid('json');
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
  })
  // New Wash: find-or-create by phone + registration so returning customers and new plates both work.
  .post('/ensure', zValidator('json', createCustomerSchema), async (c) => {
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    const registrationNumber = body.vehicle.registrationNumber.trim().toUpperCase().replace(/\s+/g, '');

    const existingVehicle = await vehicleRepo.findByRegistration(db, registrationNumber);
    if (existingVehicle) {
      const customer = await customerRepo.findById(db, existingVehicle.customerId);
      if (!customer) return c.json({ error: 'customer_missing' as const }, 500);
      return c.json({ customer, vehicle: existingVehicle });
    }

    let customer = await customerRepo.findByPhone(db, body.phone);
    if (!customer) {
      customer = await customerRepo.create(db, {
        phone: body.phone,
        name: body.name,
        source: body.source,
      });
    }

    const vehicle = await vehicleRepo.create(db, {
      customerId: customer.id,
      registrationNumber,
      vehicleTypeId: body.vehicle.vehicleTypeId,
      make: body.vehicle.make,
      model: body.vehicle.model,
    });

    return c.json({ customer, vehicle }, 201);
  });
