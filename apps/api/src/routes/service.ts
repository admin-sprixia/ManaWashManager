import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createDbClient, serviceRepo } from '@mana/db';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';

const createServiceSchema = z.object({ name: z.string().min(1), description: z.string().optional() });
const createVehicleTypeSchema = z.object({ name: z.string().min(1) });
const pricesQuerySchema = z.object({ vehicleTypeId: z.string().optional() });
const upsertPriceSchema = z.object({
  serviceId: z.string(),
  vehicleTypeId: z.string(),
  price: z.number().int().nonnegative(),
});

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const serviceRoutes = new Hono<{ Bindings: Env }>()
  .get('/', async (c) => {
    const db = createDbClient(c.env.DB);
    return c.json(await serviceRepo.listActive(db));
  })
  // Owner-only: add a new service from the settings screen — no code change, no deploy.
  .post('/', requireAuth, requireRole('owner'), zValidator('json', createServiceSchema), async (c) => {
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    return c.json(await serviceRepo.createService(db, body), 201);
  })
  .get('/vehicle-types', async (c) => {
    const db = createDbClient(c.env.DB);
    return c.json(await serviceRepo.listVehicleTypes(db));
  })
  // Owner-only: add a new vehicle category (e.g. "Bike") from the settings screen.
  .post(
    '/vehicle-types',
    requireAuth,
    requireRole('owner'),
    zValidator('json', createVehicleTypeSchema),
    async (c) => {
      const body = c.req.valid('json');
      const db = createDbClient(c.env.DB);
      return c.json(await serviceRepo.createVehicleType(db, body), 201);
    },
  )
  .get('/prices', zValidator('query', pricesQuerySchema), async (c) => {
    const db = createDbClient(c.env.DB);
    const { vehicleTypeId } = c.req.valid('query');
    return c.json(await serviceRepo.listPrices(db, vehicleTypeId));
  })
  // Owner-only: the settings screen that lets the owner add a service or change a price
  // without a code change (V0.1's "Owner settings: services & prices" feature).
  .put('/prices', requireAuth, requireRole('owner'), zValidator('json', upsertPriceSchema), async (c) => {
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    return c.json(await serviceRepo.upsertPrice(db, body));
  });
