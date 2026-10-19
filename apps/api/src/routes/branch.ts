import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { branchServiceRepo, catalogRepo, createPlatformDb, menuRepo, servicePointRepo, type ServicePointView } from '@mana/db';
import {
  BRANCH_SERVICE_LABEL,
  SERVICE_POINT_NAME_MAX,
  SERVICE_RADIUS_MAX_KM,
  SERVICE_RADIUS_MIN_KM,
  branchServicesProblem,
  liveBranchServices,
  type BranchServiceKey,
  type BranchServices,
} from '@mana/domain';
import { requireAuth, requireRole } from '../middleware/auth';
import { catalogError } from '../lib/catalog';
import type { Env } from '../types';

/**
 * How this branch washes: what it offers (at its hub, at communities, at customers' doors — the
 * owner switches these on within what head office's agreement allows), its hub and community
 * teams, and the vehicle classes each takes. The branch's menu follows: a team that takes
 * tractors brings tractor prices with it.
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
const servicesSchema = z.object({ hub: z.boolean(), community: z.boolean(), doorstep: z.boolean() });
const vehiclesSchema = z.object({ bodyTypeIds: z.array(z.string().max(100)).max(200) });

type Ctx = Context<{ Bindings: Env }>;

/** The service a kind of point gives: a hub the hub, a team communities (and doorstep). */
const serviceOfKind = (kind: 'hub' | 'doorstep'): BranchServiceKey => (kind === 'hub' ? 'hub' : 'community');

const notInAgreement = (key: BranchServiceKey) => ({
  error: 'not_allowed' as const,
  message: `${BRANCH_SERVICE_LABEL[key]} isn’t in this branch’s agreement with head office. Ask head office to add it.`,
});

/**
 * Community plans keep running until they end: the team can't be taken away from residents
 * who paid for washes. Null when it's fine to stop.
 */
async function communityStopProblem(c: Ctx, shopId: string) {
  const running = await branchServiceRepo.runningPlans(createPlatformDb(c.env.DB), shopId);
  return running > 0
    ? {
        error: 'plans_running' as const,
        message: `${running} community plan${running === 1 ? ' is' : 's are'} still running. Let them finish (or cancel them) before switching Community off.`,
      }
    : null;
}

/** A hub or team can only take groups the branch washes (switched on in its Vehicles). */
async function unwashedProblem(c: Ctx, shopId: string, classIds: string[]) {
  const businessId = await catalogRepo.businessForShop(c.env.DB, shopId);
  const washed = await catalogRepo.washedClasses(c.env.DB, businessId, shopId);
  return classIds.every((id) => washed.has(id))
    ? null
    : { error: 'not_washed' as const, message: 'This branch doesn’t wash one of those groups. Switch its vehicles on in Vehicles first.' };
}

/** What the owner has on, read back from the points after a change made on How this branch washes. */
function offeredFromPoints(points: Pick<ServicePointView, 'kind' | 'active'>[], before: BranchServices): BranchServices {
  const community = points.some((p) => p.kind === 'doorstep' && p.active);
  return { hub: points.some((p) => p.kind === 'hub' && p.active), community, doorstep: community && before.doorstep };
}

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const branchRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  /** The branch's service points, and the business's vehicle classes to pick from. */
  .get('/points', async (c) => {
    const shopId = c.get('session').shopId;
    const businessId = await catalogRepo.businessForShop(c.env.DB, shopId);
    // The menu build makes the hub or team the branch offers, so there is always something to show.
    await menuRepo.publishIfStale(c.env.DB, shopId);
    const [points, catalog, services, washed] = await Promise.all([
      servicePointRepo.list(c.env.DB, shopId),
      catalogRepo.load(c.env.DB, businessId),
      branchServiceRepo.get(createPlatformDb(c.env.DB), shopId),
      catalogRepo.washedClasses(c.env.DB, businessId, shopId),
    ]);
    return c.json({
      // Each place's groups the branch washes now; the others wait for their vehicles to come back.
      points: points.map((p) => ({ ...p, classIds: p.classIds.filter((id) => washed.has(id)) })),
      homeWash: services?.live.doorstep ?? false,
      services,
      classes: (catalog?.classes ?? []).map((cl) => ({ id: cl.id, key: cl.key, name: cl.name, category: cl.category })),
      /** The groups the branch washes: the only ones a hub or team can take. */
      washedClassIds: [...washed],
    });
  })
  .post('/points', requireRole('owner'), zValidator('json', createPointSchema), async (c) => {
    const shopId = c.get('session').shopId;
    const body = c.req.valid('json');
    const services = await branchServiceRepo.get(createPlatformDb(c.env.DB), shopId);
    if (!services) return c.json({ error: 'not_found' as const }, 404);
    const key = serviceOfKind(body.kind);
    if (!services.allowed[key]) return c.json(notInAgreement(key), 403);
    const unwashed = await unwashedProblem(c, shopId, body.classIds);
    if (unwashed) return c.json(unwashed, 400);
    try {
      const id = await servicePointRepo.create(c.env.DB, shopId, body);
      await branchServiceRepo.setOffered(c.env.DB, shopId, { ...services.offered, [key]: true });
      await menuRepo.publish(c.env.DB, shopId);
      return c.json({ id }, 201);
    } catch (e) {
      return catalogError(c, e);
    }
  })
  .patch('/points/:id', requireRole('owner'), zValidator('param', idParam), zValidator('json', updatePointSchema), async (c) => {
    const shopId = c.get('session').shopId;
    const id = c.req.valid('param').id;
    const patch = c.req.valid('json');
    const [points, services] = await Promise.all([
      servicePointRepo.list(c.env.DB, shopId),
      branchServiceRepo.get(createPlatformDb(c.env.DB), shopId),
    ]);
    const point = points.find((p) => p.id === id);
    if (!point || !services) return c.json({ error: 'not_found' as const, message: 'Not found.' }, 404);
    const after = points.map((p) => (p.id === id ? { ...p, kind: patch.kind ?? p.kind, active: patch.active ?? p.active } : p));
    const moved = after.find((p) => p.id === id)!;
    if (moved.active && !services.allowed[serviceOfKind(moved.kind)]) return c.json(notInAgreement(serviceOfKind(moved.kind)), 403);
    const offered = offeredFromPoints(after, services.offered);
    const problem = branchServicesProblem(liveBranchServices(services.allowed, offered));
    if (problem) return c.json({ error: 'invalid' as const, message: problem }, 400);
    const unwashed = patch.classIds ? await unwashedProblem(c, shopId, patch.classIds) : null;
    if (unwashed) return c.json(unwashed, 400);
    if (services.live.community && !offered.community) {
      const stop = await communityStopProblem(c, shopId);
      if (stop) return c.json(stop, 409);
    }
    try {
      await servicePointRepo.update(c.env.DB, shopId, id, patch);
      await branchServiceRepo.setOffered(c.env.DB, shopId, offered);
      await menuRepo.publish(c.env.DB, shopId);
      return c.json({ ok: true as const });
    } catch (e) {
      return catalogError(c, e);
    }
  })
  /**
   * The owner's switches for what the branch offers: at the shop (a hub), at communities (a
   * team) and at customers' doors (the same team) — only what head office's agreement allows.
   * Switching one on makes its hub or team at the branch's location (or brings it back); off
   * pauses it. A branch keeps the hub or the community team, and Community stays on while
   * community plans are running.
   */
  .put('/types', requireRole('owner'), zValidator('json', servicesSchema), async (c) => {
    const want = c.req.valid('json');
    const shopId = c.get('session').shopId;
    const services = await branchServiceRepo.get(createPlatformDb(c.env.DB), shopId);
    if (!services) return c.json({ error: 'not_found' as const, message: 'Not found.' }, 404);
    for (const key of ['hub', 'community', 'doorstep'] as const) {
      if (want[key] && !services.allowed[key]) return c.json(notInAgreement(key), 403);
    }
    const problem = branchServicesProblem(want);
    if (problem) return c.json({ error: 'invalid' as const, message: problem }, 400);
    if (services.live.community && !want.community) {
      const stop = await communityStopProblem(c, shopId);
      if (stop) return c.json(stop, 409);
    }
    try {
      await branchServiceRepo.setOffered(c.env.DB, shopId, want);
      await menuRepo.publish(c.env.DB, shopId);
    } catch (e) {
      return catalogError(c, e);
    }
    const live = liveBranchServices(services.allowed, want);
    return c.json({ lanes: live, services: { allowed: services.allowed, offered: want, live } });
  })
  /**
   * The kinds of vehicle this branch washes: the same list Mana Wash HQ switches on the branch's
   * page, so a change on either side shows on both, in New Wash and in the customer app.
   */
  .get('/vehicles', requireRole('owner'), async (c) => {
    const shopId = c.get('session').shopId;
    const businessId = await catalogRepo.businessForShop(c.env.DB, shopId);
    const [data, list] = await Promise.all([catalogRepo.load(c.env.DB, businessId), catalogRepo.branchVehicles(createPlatformDb(c.env.DB), shopId)]);
    if (!data) return c.json({ error: 'not_found' as const, message: 'This branch isn’t part of the business.' }, 404);
    const kinds = data.bodyTypes.filter((b) => b.active);
    return c.json({
      classes: data.classes.map((cl) => ({ id: cl.id, key: cl.key, name: cl.name, sizes: cl.sizes.map((z) => ({ id: z.id, key: z.key, name: z.name })) })),
      bodyTypes: kinds.map((b) => ({ id: b.id, key: b.key, name: b.name, classId: b.classId, sizeId: b.sizeId })),
      /** Switched on here; every kind while the branch has no list of its own yet. */
      vehicles: kinds.map((b) => b.id).filter((id) => list == null || list.has(id)),
    });
  })
  .put('/vehicles', requireRole('owner'), zValidator('json', vehiclesSchema), async (c) => {
    const shopId = c.get('session').shopId;
    const businessId = await catalogRepo.businessForShop(c.env.DB, shopId);
    try {
      const data = await catalogRepo.load(c.env.DB, businessId);
      // Kinds HQ switched off for everyone aren't shown to the owner; they stay on the list as they were.
      const list = await catalogRepo.branchVehicles(createPlatformDb(c.env.DB), shopId);
      const hqOff = (data?.bodyTypes ?? []).filter((b) => !b.active && (list == null || list.has(b.id))).map((b) => b.id);
      const vehicles = await catalogRepo.checkBranchVehicles(c.env.DB, businessId, c.req.valid('json').bodyTypeIds);
      await catalogRepo.saveBranchVehicles(c.env.DB, businessId, shopId, [...new Set([...vehicles, ...hqOff])]);
      await menuRepo.markStale(c.env.DB, shopId);
      await menuRepo.publish(c.env.DB, shopId);
      return c.json({ ok: true as const, vehicles });
    } catch (e) {
      return catalogError(c, e);
    }
  });
