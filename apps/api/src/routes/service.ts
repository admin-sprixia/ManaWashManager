import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { awayPricingRepo, branchPriceRepo, branchServiceRepo, catalogRepo, vehicleModelRepo, createPlatformDb, menuRepo, serviceRepo, type DbClient } from '@mana/db';
import {
  BODY_TYPES,
  DELIVERY_MODES,
  MAX_COMMISSION_PAISE,
  MAX_SERVICE_PRICE_PAISE,
  bodyTypeForName,
  catalogIds,
  categoryForClass,
  parseServiceAppliesTo,
  parseVehicleCategory,
  serviceAppliesToCategory,
  vehicleClassOf,
} from '@mana/domain';
import { requireAuth, requireRole } from '../middleware/auth';
import { catalogError } from '../lib/catalog';
import type { Env } from '../types';

const modeSchema = z.enum(DELIVERY_MODES as unknown as ['hub', 'doorstep']);
const catalogManaged = {
  error: 'catalog_managed' as const,
  message: 'This service comes from Mana Wash HQ. Ask an HQ admin to change it.',
};
const hqServicesOnly = {
  error: 'hq_services_only' as const,
  message: 'Branches sell Mana Wash HQ’s services only. Ask HQ to add it in Services and plans.',
};

const vehicleCategorySchema = z.enum(['car', 'bike']);
const priceSchema = z.number().int().nonnegative().max(MAX_SERVICE_PRICE_PAISE, 'That price looks too large');
const priceKeySchema = z.object({ serviceId: z.string(), vehicleTypeId: z.string(), mode: modeSchema.default('hub') });
const createVehicleTypeSchema = z.object({
  name: z.string().trim().min(1).max(40),
  category: vehicleCategorySchema.optional(),
  /** The business body type it stands for (e.g. "suvLarge"); matched from the name when left out. */
  bodyKey: z.string().max(40).optional(),
});
const hiddenSchema = z.object({ hidden: z.boolean() });
const idParamSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid id') });
const listServicesQuerySchema = z.object({
  category: vehicleCategorySchema.optional(),
});
const listVehicleTypesQuerySchema = z.object({
  category: vehicleCategorySchema.optional(),
});
const pricesQuerySchema = z.object({ vehicleTypeId: z.string().optional(), mode: modeSchema.optional() });
const upsertPriceSchema = z.object({
  serviceId: z.string(),
  vehicleTypeId: z.string(),
  price: priceSchema,
  mode: modeSchema.default('hub'),
});
const branchSizePriceSchema = z.object({
  serviceId: z.string(),
  classKey: z.string().max(40),
  sizeKey: z.string().max(4),
  /** The shop price for every vehicle of the size; null = HQ's price again; left out = unchanged. */
  price: priceSchema.nullable().optional(),
  commission: z.number().int().nonnegative().max(MAX_COMMISSION_PAISE, 'Commission looks too large').nullable().optional(),
});
const branchShiftSchema = z.object({
  classKey: z.string().max(40),
  /** % from HQ's price for every shop price of the group; null = all back to HQ's prices. */
  percent: z.number().int().min(-50).max(50).nullable(),
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

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const serviceRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  .get('/', zValidator('query', listServicesQuerySchema), async (c) => {
    const db = c.get('db');
    const { category } = c.req.valid('query');
    // The menu is rebuilt here when the business catalog changed since: one cheap read otherwise.
    await menuRepo.publishIfStale(c.env.DB, c.get('session').shopId);
    return c.json(await serviceRepo.listActive(db, category));
  })
  /**
   * How this branch fits the business: whether its menu comes from the business catalog, the
   * pricing policy (how far its own prices may go), how it delivers, and the catalog services it
   * stopped offering (so the owner can bring them back).
   */
  .get('/network', async (c) => {
    const session = c.get('session');
    const db = c.get('db');
    const pdb = createPlatformDb(c.env.DB);
    // Switching a service on makes its hub or team in the next menu build: do it now, so the
    // home screen's tabs and New Wash see them straight away.
    await menuRepo.publishIfStale(c.env.DB, session.shopId);
    const [caps, hidden] = await Promise.all([
      menuRepo.capabilities(c.env.DB, session.shopId),
      db.service.findMany({
        where: { branchHidden: true, catalogServiceId: { not: null } },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true },
      }),
    ]);
    const [isAdmin, services, away, shop] = await Promise.all([
      caps.businessId ? catalogRepo.isAdmin(pdb, caps.businessId, session.phone) : false,
      branchServiceRepo.get(pdb, session.shopId),
      awayPricingRepo.forShop(c.env.DB, session.shopId),
      pdb.shop.findUnique({ where: { id: session.shopId }, select: { latitude: true, longitude: true } }),
    ]);
    const homeOnly = await menuRepo.homeOnlyTypes(c.env.DB, session.shopId);
    const live = services?.live ?? { hub: true, community: false, doorstep: false };
    // Without doorstep washes, the community team only goes to communities: walk-ins are at the shop.
    const atHome = live.doorstep ? caps.modes : caps.modes.filter((m) => m !== 'doorstep');
    const hasTeam = caps.modes.includes('doorstep');
    return c.json({
      businessId: caps.businessId,
      isBusinessAdmin: isAdmin,
      policy: caps.policy,
      homeWash: live.doorstep,
      modes: atHome.length ? atHome : caps.modes,
      /**
       * The home screen's tabs: the shop, community wash days, and washes at customers' homes —
       * what the branch offers (its agreement and the owner's switches), with its hub and team.
       */
      lanes: { hub: live.hub && caps.modes.includes('hub'), community: live.community && hasTeam, doorstep: live.doorstep && hasTeam },
      /** What head office's agreement allows this branch, and what the owner switched on. */
      services: services ?? null,
      classesByMode: Object.fromEntries([...caps.classesByMode].map(([m, set]) => [m, [...set]])),
      hidden,
      /** A home wash: the hub price plus this visit charge, once per visit. */
      visit: away.doorstep,
      /** Vehicle types washed at homes only: not on the shop's menu. */
      homeOnlyTypes: [...homeOnly],
      /** Where the branch is, to measure how far a home is. */
      location:
        shop?.latitude != null && shop.longitude != null ? { latitude: shop.latitude, longitude: shop.longitude } : null,
    });
  })
  // Branches sell only Mana Wash HQ's services: none of their own, so these always refuse.
  .post('/', requireRole('owner'), (c) => c.json(hqServicesOnly, 403))
  .patch('/:id', requireRole('owner'), zValidator('param', idParamSchema), async (c) => {
    const service = await serviceRepo.findById(c.get('db'), c.req.valid('param').id);
    if (!service || !service.active) return c.json({ error: 'not_found' as const }, 404);
    return c.json(service.catalogServiceId ? catalogManaged : hqServicesOnly, service.catalogServiceId ? 409 : 403);
  })
  .put(
    '/:id/hidden',
    requireRole('owner'),
    zValidator('param', idParamSchema),
    zValidator('json', hiddenSchema),
    async (c) => {
      try {
        await menuRepo.setHidden(c.env.DB, c.get('session').shopId, c.req.valid('param').id, c.req.valid('json').hidden);
      } catch (e) {
        return catalogError(c, e);
      }
      return c.json({ ok: true as const });
    },
  )
  // Everyone: which size each kind of vehicle is priced as (the vehicle size guide), as head
  // office set it, and whether it's washed at all.
  .get('/vehicle-sizes', async (c) => {
    const businessId = await catalogRepo.businessForShop(c.env.DB, c.get('session').shopId).catch(() => null);
    const data = businessId ? await catalogRepo.load(c.env.DB, businessId) : null;
    if (!data || !businessId) return c.json({ canEdit: false, models: [], removed: [], classes: [], bodyTypes: [] });
    const classKey = new Map(data.classes.map((k) => [k.id, k.key]));
    const sizeKey = new Map(data.classes.flatMap((k) => k.sizes.map((s) => [s.id, s.key] as const)));
    // "We don't wash these" is about this branch: the kinds on its list.
    const pdb = createPlatformDb(c.env.DB);
    const [kinds, models, canEdit] = await Promise.all([
      catalogRepo.branchVehicles(pdb, c.get('session').shopId),
      vehicleModelRepo.list(pdb, businessId),
      catalogRepo.isAdmin(pdb, businessId, c.get('session').phone),
    ]);
    return c.json({
      /** Head office edits the guide (sizes, names, models); everyone else looks things up. */
      canEdit,
      /** Head office's changes to the built-in list of models. */
      models,
      removed: canEdit ? await vehicleModelRepo.removed(pdb, businessId) : [],
      classes: data.classes.map((k) => ({
        id: k.id,
        key: k.key,
        name: k.name,
        category: categoryForClass(k.key),
        sizes: k.sizes.map((s) => ({ id: s.id, key: s.key, name: s.name })),
      })),
      bodyTypes: data.bodyTypes.map((b) => ({
        id: b.id,
        sizeId: b.sizeId,
        key: b.key,
        name: b.name,
        classKey: classKey.get(b.classId) ?? null,
        sizeKey: sizeKey.get(b.sizeId) ?? null,
        active: b.active && (kinds == null || kinds.has(b.id)),
      })),
    });
  })
  .get('/vehicle-types', zValidator('query', listVehicleTypesQuerySchema), async (c) => {
    const db = c.get('db');
    const { category } = c.req.valid('query');
    const types = await serviceRepo.listVehicleTypes(db, category);
    // Its group (Car, Three-wheeler, Farm & machines…), for the owner's one-tab-per-group prices.
    return c.json(types.map((vt) => ({ ...vt, classKey: vehicleClassOf(vt) })));
  })
  // Owner-only: add a new vehicle size within Cars or Bikes from the settings screen.
  .post(
    '/vehicle-types',
    requireRole('owner'),
    zValidator('json', createVehicleTypeSchema),
    async (c) => {
      const body = c.req.valid('json');
      const db = c.get('db');
      const shopId = c.get('session').shopId;
      const category = body.category ?? 'car';
      // Tie it to the business body type, so the business price list prices it.
      const businessId = await catalogRepo.businessForShop(c.env.DB, shopId);
      const def = body.bodyKey ? (BODY_TYPES.find((b) => b.key === body.bodyKey) ?? null) : bodyTypeForName(body.name);
      if (body.bodyKey && !def) return c.json({ error: 'not_found' as const, message: 'Unknown body type.' }, 404);
      const bodyTypeId = def && categoryForClass(def.classKey) === category ? catalogIds.bodyType(businessId, def.key) : null;
      if (bodyTypeId) {
        const catalog = await catalogRepo.load(c.env.DB, businessId);
        const body = catalog?.bodyTypes.find((b) => b.id === bodyTypeId);
        if (body && !body.active) {
          return c.json(
            { error: 'hq_off' as const, message: `Head office has switched off ${body.name}. Ask them to switch it on first.` },
            409,
          );
        }
      }
      const created = await serviceRepo.createVehicleType(db, { name: body.name, category, bodyTypeId });
      if (bodyTypeId) {
        await menuRepo.markStale(c.env.DB, shopId);
        await menuRepo.publish(c.env.DB, shopId);
      }
      return c.json(created, 201);
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
    const { vehicleTypeId, mode } = c.req.valid('query');
    return c.json(await serviceRepo.listPrices(db, vehicleTypeId, mode));
  })
  // Owner-only: the branch's own price for one of HQ's services, within what HQ allows.
  .put('/prices', requireRole('owner'), zValidator('json', upsertPriceSchema), async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const session = c.get('session');
    const service = await serviceRepo.findById(db, body.serviceId);
    // A business catalog price: the branch's own price, within what the business allows.
    if (service?.catalogServiceId) {
      try {
        return c.json(await menuRepo.setOverride(c.env.DB, session.shopId, session.sub, body));
      } catch (e) {
        return catalogError(c, e);
      }
    }
    if (!service) return c.json({ error: 'not_found' as const }, 404);
    return c.json(hqServicesOnly, 403);
  })
  // For a business catalog price this goes back to the business's price.
  .delete('/prices', requireRole('owner'), zValidator('json', priceKeySchema), async (c) => {
    const db = c.get('db');
    const body = c.req.valid('json');
    const session = c.get('session');
    const service = await serviceRepo.findById(db, body.serviceId);
    if (service?.catalogServiceId) {
      try {
        await menuRepo.setOverride(c.env.DB, session.shopId, session.sub, { ...body, price: null });
      } catch (e) {
        return catalogError(c, e);
      }
      return c.json({ ok: true as const });
    }
    await serviceRepo.removePrice(db, body);
    return c.json({ ok: true as const });
  })
  // The owner's price sheet: HQ's services by group and size, from the branch's price book.
  .get('/branch-prices', requireRole('owner'), async (c) => {
    try {
      return c.json(await branchPriceRepo.sheet(c.env.DB, c.get('session').shopId));
    } catch (e) {
      return catalogError(c, e);
    }
  })
  .put('/branch-prices/size', requireRole('owner'), zValidator('json', branchSizePriceSchema), async (c) => {
    const session = c.get('session');
    try {
      return c.json(await branchPriceRepo.setSize(c.env.DB, session.shopId, session.sub, c.req.valid('json')));
    } catch (e) {
      return catalogError(c, e);
    }
  })
  // The owner moves the branch to another of HQ's price books (when HQ allows it); own prices clear.
  .put('/branch-prices/book', requireRole('owner'), zValidator('json', z.object({ priceBookId: z.string().max(100) })), async (c) => {
    try {
      return c.json(await branchPriceRepo.setBook(c.env.DB, c.get('session').shopId, c.req.valid('json').priceBookId));
    } catch (e) {
      return catalogError(c, e);
    }
  })
  .put('/branch-prices/shift', requireRole('owner'), zValidator('json', branchShiftSchema), async (c) => {
    const session = c.get('session');
    try {
      return c.json(await branchPriceRepo.shift(c.env.DB, session.shopId, session.sub, c.req.valid('json')));
    } catch (e) {
      return catalogError(c, e);
    }
  })
  // After the fixed paths ("/prices"), which it would otherwise catch as an id.
  // A business catalog service is hidden at this branch (when the policy allows), not deleted.
  .delete('/:id', requireRole('owner'), zValidator('param', idParamSchema), async (c) => {
    const db = c.get('db');
    const { id } = c.req.valid('param');
    const service = await serviceRepo.findById(db, id);
    if (service?.catalogServiceId) {
      try {
        await menuRepo.setHidden(c.env.DB, c.get('session').shopId, id, true);
      } catch (e) {
        return catalogError(c, e);
      }
      return c.json({ ok: true as const });
    }
    const removed = await serviceRepo.deactivateService(db, id);
    if (!removed) return c.json({ error: 'not_found' as const }, 404);
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
