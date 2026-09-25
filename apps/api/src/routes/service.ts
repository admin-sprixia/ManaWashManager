import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createDbClient, serviceRepo } from '@mana/db';
import { parseServiceAppliesTo, parseVehicleCategory, serviceAppliesToCategory } from '@mana/domain';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';

const vehicleCategorySchema = z.enum(['car', 'bike']);
const appliesToSchema = z.enum(['car', 'bike', 'both']);

const createServiceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  appliesTo: appliesToSchema.optional(),
});
const createVehicleTypeSchema = z.object({
  name: z.string().min(1),
  category: vehicleCategorySchema.optional(),
});
const listServicesQuerySchema = z.object({
  category: vehicleCategorySchema.optional(),
});
const listVehicleTypesQuerySchema = z.object({
  category: vehicleCategorySchema.optional(),
});
const pricesQuerySchema = z.object({ vehicleTypeId: z.string().optional() });
const upsertPriceSchema = z.object({
  serviceId: z.string(),
  vehicleTypeId: z.string(),
  price: z.number().int().nonnegative(),
});

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const serviceRoutes = new Hono<{ Bindings: Env }>()
  .get('/', zValidator('query', listServicesQuerySchema), async (c) => {
    const db = createDbClient(c.env.DB);
    const { category } = c.req.valid('query');
    return c.json(await serviceRepo.listActive(db, category));
  })
  // Owner-only: add a new service from the settings screen — no code change, no deploy.
  .post('/', requireAuth, requireRole('owner'), zValidator('json', createServiceSchema), async (c) => {
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    return c.json(await serviceRepo.createService(db, body), 201);
  })
  .get('/vehicle-types', zValidator('query', listVehicleTypesQuerySchema), async (c) => {
    const db = createDbClient(c.env.DB);
    const { category } = c.req.valid('query');
    return c.json(await serviceRepo.listVehicleTypes(db, category));
  })
  // Owner-only: add a new vehicle size within Cars or Bikes from the settings screen.
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

    const [service, vehicleType] = await Promise.all([
      serviceRepo.findById(db, body.serviceId),
      serviceRepo.getVehicleType(db, body.vehicleTypeId),
    ]);
    if (!service || !vehicleType) {
      return c.json({ error: 'not_found' as const }, 404);
    }
    const appliesTo = parseServiceAppliesTo(service.appliesTo);
    const category = parseVehicleCategory(vehicleType.category);
    if (!serviceAppliesToCategory(appliesTo, category)) {
      return c.json(
        {
          error: 'category_mismatch' as const,
          message: `${service.name} is not offered for ${category} vehicles.`,
        },
        400,
      );
    }

    return c.json(await serviceRepo.upsertPrice(db, body));
  });
