import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { serviceRepo, type DbClient } from '@mana/db';
import {
  MAX_COMMISSION_PAISE,
  parseServiceAppliesTo,
  parseVehicleCategory,
  serviceAppliesToCategory,
} from '@mana/domain';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';

const vehicleCategorySchema = z.enum(['car', 'bike']);
const descriptionSchema = z.string().trim().max(160, 'Keep the description under 160 characters.');
/** Services a combo bundles. At least two, or it isn't a combo. */
const includesSchema = z.array(z.string()).refine((ids) => ids.length !== 1, 'A combo needs at least two services.');
const createServiceSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: descriptionSchema.optional(),
  includes: includesSchema.optional(),
  /** The vehicles this service is for, each with its price. New Wash shows it only for these. */
  vehicles: z
    .array(z.object({ vehicleTypeId: z.string(), price: z.number().int().nonnegative() }))
    .min(1, 'Pick at least one vehicle for this service.'),
});
const updateServiceSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: descriptionSchema.nullable().optional(),
  includes: includesSchema.optional(),
});
const priceKeySchema = z.object({ serviceId: z.string(), vehicleTypeId: z.string() });
const createVehicleTypeSchema = z.object({
  name: z.string().trim().min(1).max(40),
  category: vehicleCategorySchema.optional(),
});
const idParamSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid id') });
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
const setCommissionSchema = z.object({
  serviceId: z.string(),
  vehicleTypeId: z.string(),
  amount: z.number().int().nonnegative().max(MAX_COMMISSION_PAISE, 'Commission looks too large').nullable(),
});

/** Both ids exist and the service is offered for that vehicle's category. */
async function checkServiceForType(db: DbClient, serviceId: string, vehicleTypeId: string) {
  const [service, vehicleType] = await Promise.all([
    serviceRepo.findById(db, serviceId),
    serviceRepo.getVehicleType(db, vehicleTypeId),
  ]);
  if (!service || !vehicleType) return { error: 'not_found' as const, status: 404 as const };
  const category = parseVehicleCategory(vehicleType.category);
  if (!serviceAppliesToCategory(parseServiceAppliesTo(service.appliesTo), category)) {
    return {
      error: 'category_mismatch' as const,
      status: 400 as const,
      message: `${service.name} is not offered for ${category} vehicles.`,
    };
  }
  return null;
}

/** A combo may only bundle active, plain services of this shop — never itself or another combo. */
async function checkComboItems(db: DbClient, ids: string[], comboId?: string): Promise<string | null> {
  if (ids.length === 0) return null;
  const active = new Map((await serviceRepo.listActive(db)).map((s) => [s.id, s]));
  for (const id of new Set(ids)) {
    const item = active.get(id);
    if (!item || id === comboId) return 'One of the picked services no longer exists.';
    if (item.includes.length > 0) return `${item.name} is a combo itself, so it can’t go inside another combo.`;
  }
  return null;
}

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const serviceRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  .get('/', zValidator('query', listServicesQuerySchema), async (c) => {
    const db = c.get('db');
    const { category } = c.req.valid('query');
    return c.json(await serviceRepo.listActive(db, category));
  })
  // Owner-only: add a new service from the settings screen — no code change, no deploy.
  .post('/', requireRole('owner'), zValidator('json', createServiceSchema), async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const types = await Promise.all(body.vehicles.map((v) => serviceRepo.getVehicleType(db, v.vehicleTypeId)));
    if (types.some((t) => !t)) return c.json({ error: 'not_found' as const, message: 'A picked vehicle no longer exists.' }, 404);
    const includes = [...new Set(body.includes ?? [])];
    const comboProblem = await checkComboItems(db, includes);
    if (comboProblem) return c.json({ error: 'invalid_combo' as const, message: comboProblem }, 400);
    const categories = new Set(types.map((t) => parseVehicleCategory(t!.category)));
    const appliesTo = categories.size > 1 ? 'both' : [...categories][0];
    const service = await serviceRepo.createService(db, {
      name: body.name,
      description: body.description || undefined,
      appliesTo,
    });
    for (const v of body.vehicles) {
      await serviceRepo.upsertPrice(db, { serviceId: service.id, vehicleTypeId: v.vehicleTypeId, price: v.price });
    }
    if (includes.length > 0) await serviceRepo.setComboItems(db, service.id, includes);
    return c.json(service, 201);
  })
  .patch(
    '/:id',
    requireRole('owner'),
    zValidator('param', idParamSchema),
    zValidator('json', updateServiceSchema),
    async (c) => {
      const db = c.get('db');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const service = await serviceRepo.findById(db, id);
      if (!service || !service.active) return c.json({ error: 'not_found' as const }, 404);
      if (body.includes) {
        const comboProblem = await checkComboItems(db, body.includes, id);
        if (comboProblem) return c.json({ error: 'invalid_combo' as const, message: comboProblem }, 400);
      }
      await serviceRepo.updateService(db, id, {
        name: body.name,
        description: body.description === undefined ? undefined : body.description || null,
      });
      if (body.includes) await serviceRepo.setComboItems(db, id, [...new Set(body.includes)]);
      return c.json({ ok: true as const });
    },
  )
  .delete('/:id', requireRole('owner'), zValidator('param', idParamSchema), async (c) => {
    const db = c.get('db');
    const removed = await serviceRepo.deactivateService(db, c.req.valid('param').id);
    if (!removed) return c.json({ error: 'not_found' as const }, 404);
    return c.json({ ok: true as const });
  })
  .get('/vehicle-types', zValidator('query', listVehicleTypesQuerySchema), async (c) => {
    const db = c.get('db');
    const { category } = c.req.valid('query');
    return c.json(await serviceRepo.listVehicleTypes(db, category));
  })
  // Owner-only: add a new vehicle size within Cars or Bikes from the settings screen.
  .post(
    '/vehicle-types',
    requireRole('owner'),
    zValidator('json', createVehicleTypeSchema),
    async (c) => {
      const body = c.req.valid('json');
      const db = c.get('db');
      return c.json(await serviceRepo.createVehicleType(db, body), 201);
    },
  )
  .delete(
    '/vehicle-types/:id',
    requireRole('owner'),
    zValidator('param', idParamSchema),
    async (c) => {
      const db = c.get('db');
      const result = await serviceRepo.removeVehicleType(db, c.req.valid('param').id);
      if (result === 'not_found') return c.json({ error: 'not_found' as const }, 404);
      return c.json({ ok: true as const, result });
    },
  )
  .get('/prices', zValidator('query', pricesQuerySchema), async (c) => {
    const db = c.get('db');
    const { vehicleTypeId } = c.req.valid('query');
    return c.json(await serviceRepo.listPrices(db, vehicleTypeId));
  })
  // Owner-only: the settings screen that lets the owner add a service or change a price
  // without a code change (V0.1's "Owner settings: services & prices" feature).
  .put('/prices', requireRole('owner'), zValidator('json', upsertPriceSchema), async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const problem = await checkServiceForType(db, body.serviceId, body.vehicleTypeId);
    if (problem?.error === 'category_mismatch') {
      // Ticking a two-wheeler on a car service (or the reverse) makes it a service for both.
      await serviceRepo.setServiceAppliesTo(db, body.serviceId, 'both');
    } else if (problem) {
      const { status, ...error } = problem;
      return c.json(error, status);
    }
    return c.json(await serviceRepo.upsertPrice(db, body));
  })
  .delete('/prices', requireRole('owner'), zValidator('json', priceKeySchema), async (c) => {
    const db = c.get('db');
    await serviceRepo.removePrice(db, c.req.valid('json'));
    return c.json({ ok: true as const });
  })
  // Staff commission rates. Everyone reads them — New Wash asks who got a commission service,
  // and seeing the reward is the point. Only the owner sets them. Copied onto job lines at
  // creation, so a change only affects washes started afterwards.
  .get('/commissions', async (c) => {
    const db = c.get('db');
    return c.json(await serviceRepo.listCommissionRates(db));
  })
  .put(
    '/commissions',
    requireRole('owner'),
    zValidator('json', setCommissionSchema),
    async (c) => {
      const body = c.req.valid('json');
      const db = c.get('db');
      const problem = await checkServiceForType(db, body.serviceId, body.vehicleTypeId);
      if (problem) {
        const { status, ...error } = problem;
        return c.json(error, status);
      }
      await serviceRepo.setCommissionRate(db, body);
      return c.json({ ok: true as const });
    },
  );
