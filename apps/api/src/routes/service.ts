import { Hono } from 'hono';
import { z } from 'zod';
import { createDbClient, serviceRepo } from '@mana/db';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';

export const serviceRoutes = new Hono<{ Bindings: Env }>();

serviceRoutes.get('/', async (c) => {
  const db = createDbClient(c.env.DB);
  return c.json(await serviceRepo.listActive(db));
});

const createServiceSchema = z.object({ name: z.string().min(1), description: z.string().optional() });

// Owner-only: add a new service from the settings screen — no code change, no deploy.
serviceRoutes.post('/', requireAuth, requireRole('owner'), async (c) => {
  const body = createServiceSchema.parse(await c.req.json());
  const db = createDbClient(c.env.DB);
  return c.json(await serviceRepo.createService(db, body), 201);
});

serviceRoutes.get('/vehicle-types', async (c) => {
  const db = createDbClient(c.env.DB);
  return c.json(await serviceRepo.listVehicleTypes(db));
});

const createVehicleTypeSchema = z.object({ name: z.string().min(1) });

// Owner-only: add a new vehicle category (e.g. "Bike") from the settings screen.
serviceRoutes.post('/vehicle-types', requireAuth, requireRole('owner'), async (c) => {
  const body = createVehicleTypeSchema.parse(await c.req.json());
  const db = createDbClient(c.env.DB);
  return c.json(await serviceRepo.createVehicleType(db, body), 201);
});

serviceRoutes.get('/prices', async (c) => {
  const db = createDbClient(c.env.DB);
  const vehicleTypeId = c.req.query('vehicleTypeId');
  return c.json(await serviceRepo.listPrices(db, vehicleTypeId));
});

const upsertPriceSchema = z.object({
  serviceId: z.string(),
  vehicleTypeId: z.string(),
  price: z.number().int().nonnegative(),
});

// Owner-only: the settings screen that lets the owner add a service or change a price
// without a code change (V0.1's "Owner settings: services & prices" feature).
serviceRoutes.put('/prices', requireAuth, requireRole('owner'), async (c) => {
  const body = upsertPriceSchema.parse(await c.req.json());
  const db = createDbClient(c.env.DB);
  return c.json(await serviceRepo.upsertPrice(db, body));
});
