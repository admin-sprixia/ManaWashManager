import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { businessRules, catalogRepo, createPlatformDb, menuRepo, servicePointRepo } from '@mana/db';
import { SERVICE_POINT_NAME_MAX, SERVICE_RADIUS_MAX_KM, SERVICE_RADIUS_MIN_KM } from '@mana/domain';
import { requireAuth, requireRole } from '../middleware/auth';
import { catalogError } from '../lib/catalog';
import type { Env } from '../types';

/**
 * How this branch washes: its hub and doorstep teams, and the vehicle classes each takes. The
 * branch's menu follows: a doorstep team that takes tractors brings tractor prices with it.
 */

const idParam = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, 'Invalid id') });
const pointFields = {
  kind: z.enum(['hub', 'doorstep']),
  name: z.string().trim().min(1).max(SERVICE_POINT_NAME_MAX),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  radiusKm: z.number().min(SERVICE_RADIUS_MIN_KM).max(SERVICE_RADIUS_MAX_KM).nullable(),
  classIds: z.array(z.string().max(100)).min(1, 'Pick at least one vehicle class.').max(20),
};
const located = (p: { latitude?: number | null; longitude?: number | null; radiusKm?: number | null }) =>
  (p.latitude == null) === (p.longitude == null) && (p.radiusKm == null || p.latitude != null);
const locationIssue = { message: 'Set the map point before the distance.', path: ['latitude'] };
const createPointSchema = z
  .object({
    ...pointFields,
    latitude: pointFields.latitude.default(null),
    longitude: pointFields.longitude.default(null),
    radiusKm: pointFields.radiusKm.default(null),
  })
  .refine(located, locationIssue);
const updatePointSchema = z
  .object({
    kind: pointFields.kind.optional(),
    name: pointFields.name.optional(),
    latitude: pointFields.latitude.optional(),
    longitude: pointFields.longitude.optional(),
    radiusKm: pointFields.radiusKm.optional(),
    classIds: pointFields.classIds.optional(),
    active: z.boolean().optional(),
  })
  .refine((p) => p.latitude === undefined || p.longitude !== undefined, locationIssue)
  .refine((p) => p.latitude === undefined || located(p), locationIssue);

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const branchRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  /** The branch's service points, and the business's vehicle classes to pick from. */
  .get('/points', async (c) => {
    const shopId = c.get('session').shopId;
    const businessId = await catalogRepo.businessForShop(c.env.DB, shopId);
    // The first menu build makes the branch's hub, so there is always something to show.
    await menuRepo.publishIfStale(c.env.DB, shopId);
    const [points, catalog, rules] = await Promise.all([
      servicePointRepo.list(c.env.DB, shopId),
      catalogRepo.load(c.env.DB, businessId),
      businessRules(createPlatformDb(c.env.DB), businessId),
    ]);
    return c.json({
      points,
      homeWash: rules.homeWash,
      classes: (catalog?.classes ?? []).map((cl) => ({ id: cl.id, key: cl.key, name: cl.name, category: cl.category })),
    });
  })
  .post('/points', requireRole('owner'), zValidator('json', createPointSchema), async (c) => {
    const shopId = c.get('session').shopId;
    try {
      const id = await servicePointRepo.create(c.env.DB, shopId, c.req.valid('json'));
      await menuRepo.publish(c.env.DB, shopId);
      return c.json({ id }, 201);
    } catch (e) {
      return catalogError(c, e);
    }
  })
  .patch('/points/:id', requireRole('owner'), zValidator('param', idParam), zValidator('json', updatePointSchema), async (c) => {
    const shopId = c.get('session').shopId;
    try {
      await servicePointRepo.update(c.env.DB, shopId, c.req.valid('param').id, c.req.valid('json'));
      await menuRepo.publish(c.env.DB, shopId);
      return c.json({ ok: true as const });
    } catch (e) {
      return catalogError(c, e);
    }
  });
