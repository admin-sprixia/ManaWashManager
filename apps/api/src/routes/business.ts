import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { awayPricingRepo, branchServiceRepo, branchTownRepo, vehicleModelRepo, VehicleModelError, CatalogError, catalogRepo, createPlatformDb, createShopDb, menuRepo, planRepo, shopRepo, userRepo, type DbClient } from '@mana/db';
import {
  GSTIN_RE,
  isClockTime,
  isValidPincode,
  ALL_BRANCH_SERVICES,
  BRANCH_SERVICES_SELECT,
  branchServicesOf,
  branchServicesProblem,
  liveBranchServices,
  offerWithin,
  pincodeCentre,
  pincodePlace,
  TOWN_NAME_MAX,
  BRANCH_CHECK_KINDS,
  WASH_PLAN_MAX_DISCOUNT_BP,
  WASH_PLAN_MAX_MONTHS,
  WASH_PLAN_MAX_WASHES,
  WASH_PLAN_NAME_MAX,
  WASH_PLAN_RULE_LIMITS,
  WASH_PLAN_UPGRADE_EVERY,
  MAX_PLAN_PRICE_PAISE,
  CATALOG_NAME_MAX,
  CATALOG_SERVICE_DESCRIPTION_MAX,
  CATALOG_SERVICE_NAME_MAX,
  SERVICE_CHECKLIST_ITEM_MAX,
  SERVICE_CHECKLIST_MAX,
  SERVICE_DURATION_MAX_MIN,
  SERVICE_KINDS,
  placesToModes,
  type ServiceKind,
  MAX_ADJUSTMENT_BP,
  MAX_ADJUSTMENT_FIXED_PAISE,
  MAX_OVERRIDE_PCT,
  MAX_SERVICE_PRICE_PAISE,
  MIN_ADJUSTMENT_BP,
  VEHICLE_MAKE_MAX,
  COMMUNITY_TIERS_MAX,
  COMMUNITY_TIER_MAX_BP,
  DOORSTEP_LIMITS,
  PRICE_BOOK_NAME_MAX,
  PRICE_ZONE_NAME_MAX,
  MAX_BRANCHES_PER_PERSON,
  normalizePhone,
  BRANCH_STATUSES,
  BRANCH_STATUS_REASON_MAX,
  BRANCH_STATUS_REASON_MIN,
  toUserRole,
} from '@mana/domain';
import { forgetShop, requireAuth } from '../middleware/auth';
import { catalogError, publishBusiness, requireBusinessAdmin } from '../lib/catalog';
import { phoneBusy, withLock, withPhoneLock } from '../lib/phoneLock';
import { placeError } from '../lib/places';
import { openBranch } from '../lib/shops';
import { isPlanError, planBranch, type PlanError } from '../lib/branchPlan';
import { resetPin } from '../lib/pinReset';
import { endOfIstDay, startOfIstDay, startOfIstMonth } from '../lib/istDate';
import type { Env } from '../types';

/**
 * The business catalog: services, base prices by vehicle size, pricing rules and policy, price
 * books and zones, which book and zone each branch uses, and who the admins are. Every change
 * rebuilds the branches' menus. Only business admins (by phone) reach these; the manager app
 * edits through them today and a web admin panel can use the same endpoints later.
 */

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, 'Invalid id');
const idParam = z.object({ id: idSchema });
const nameSchema = (max: number) => z.string().trim().min(1).max(max);
const modeSchema = z.enum(['hub', 'doorstep']);
const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((p) => /^[6-9]\d{9}$/.test(p), 'Enter a valid 10-digit mobile number');

const serviceFields = {
  name: nameSchema(CATALOG_SERVICE_NAME_MAX),
  description: z.string().trim().max(CATALOG_SERVICE_DESCRIPTION_MAX).nullable(),
  modes: z.enum(['hub', 'doorstep', 'both']),
  classIds: z.array(idSchema).min(1, 'Pick at least one vehicle class.').max(20),
  /** Sizes of those vehicles it's for; left out = every size (new) or unchanged (edit). */
  sizeIds: z.array(idSchema).min(1).max(60).optional(),
  /** A combo bundles at least two services; empty for a plain service. */
  includes: z
    .array(idSchema)
    .max(30)
    .refine((ids) => ids.length !== 1, 'A combo needs at least two services.'),
};
const priceSchema = z.number().int().nonnegative().max(MAX_SERVICE_PRICE_PAISE, 'That price looks too large');
/** The rest of a service: where it's done as three ticks, time, kind, badge, app, checklist, and prices. */
/**
 * Community prices are the hub price with the community rule (HQ › Base prices › Community):
 * a size can't be given its own. `null` clears an old one.
 */
const communityPriceSchema = z
  .number()
  .int()
  .nullable()
  .optional()
  .refine((v) => v == null, 'Community prices follow the community rule: change the rule instead.');

const serviceDetails = {
  /** Shop, community, doorstep in any combination; replaces `modes` when given. */
  places: z
    .object({ shop: z.boolean(), community: z.boolean(), doorstep: z.boolean() })
    .refine((p) => p.shop || p.community || p.doorstep, 'Tick where it’s done: shop, community or doorstep.')
    .optional(),
  durationMin: z.number().int().min(1, 'Enter how long it takes').max(SERVICE_DURATION_MAX_MIN, 'That’s more than 30 days').nullable().optional(),
  kind: z.enum(SERVICE_KINDS as [ServiceKind, ...ServiceKind[]]).optional(),
  popular: z.boolean().optional(),
  showInApp: z.boolean().optional(),
  checklist: z
    .array(z.string().trim().min(1).max(SERVICE_CHECKLIST_ITEM_MAX, `Keep each line under ${SERVICE_CHECKLIST_ITEM_MAX} letters`))
    .max(SERVICE_CHECKLIST_MAX, `Up to ${SERVICE_CHECKLIST_MAX} lines`)
    .optional(),
  /** Prices in the default price book, per size; `price: null` = not offered for that size. */
  prices: z
    .array(z.object({ sizeId: idSchema, price: priceSchema.nullable(), doorstepPrice: communityPriceSchema }))
    .max(60)
    .optional(),
};
const createServiceSchema = z.object({
  ...serviceFields,
  ...serviceDetails,
  description: serviceFields.description.default(null),
  modes: serviceFields.modes.default('both'),
  includes: serviceFields.includes.default([]),
});
const updateServiceSchema = z.object({
  name: serviceFields.name.optional(),
  description: serviceFields.description.optional(),
  modes: serviceFields.modes.optional(),
  classIds: serviceFields.classIds.optional(),
  sizeIds: serviceFields.sizeIds,
  includes: serviceFields.includes.optional(),
  active: z.boolean().optional(),
  ...serviceDetails,
});

/** `places` → the stored modes and where the team does it. */
function withPlaces<T extends { places?: { shop: boolean; community: boolean; doorstep: boolean }; modes?: 'hub' | 'doorstep' | 'both' }>(
  body: T,
) {
  const { places, ...rest } = body;
  const stored = places ? placesToModes(places) : null;
  return stored ? { ...rest, modes: stored.modes, teamAt: stored.teamAt } : rest;
}

/** Saves a service's prices in the default price book, when the form sent them. */
async function saveServicePrices(
  d1: Env['DB'],
  businessId: string,
  serviceId: string,
  prices: { sizeId: string; price: number | null; doorstepPrice?: number | null }[] | undefined,
) {
  if (!prices?.length) return;
  const book = await catalogRepo.defaultPriceBookId(d1, businessId);
  if (!book) return;
  await catalogRepo.setPrices(d1, businessId, book, prices.map((p) => ({ ...p, serviceId })));
}
const pricesSchema = z.object({
  priceBookId: idSchema,
  entries: z
    .array(
      z.object({
        serviceId: idSchema,
        sizeId: idSchema,
        price: z.number().int().nonnegative().max(MAX_SERVICE_PRICE_PAISE, 'That price looks too large').nullable(),
        doorstepPrice: communityPriceSchema,
      }),
    )
    .min(1)
    .max(2000),
});
const adjustmentKey = { mode: modeSchema, classId: idSchema.nullable() };
const adjustmentSchema = z.object({
  ...adjustmentKey,
  // Only the community rule: shop prices are the hub prices themselves (Base prices › Hub).
  mode: modeSchema.refine((m) => m === 'doorstep', 'Shop prices are the hub prices: change them in Base prices.'),
  percentBp: z.number().int().min(MIN_ADJUSTMENT_BP).max(MAX_ADJUSTMENT_BP),
  fixedPaise: z.number().int().min(-MAX_ADJUSTMENT_FIXED_PAISE).max(MAX_ADJUSTMENT_FIXED_PAISE),
  minExtraPaise: z.number().int().min(0).max(MAX_ADJUSTMENT_FIXED_PAISE),
});
const doorstepRulesSchema = z.object({
  visitFeePaise: z.number().int().min(0).max(DOORSTEP_LIMITS.visitFeeMaxPaise),
  freeKm: z.number().min(0).max(DOORSTEP_LIMITS.freeKmMax),
  perKmPaise: z.number().int().min(0).max(DOORSTEP_LIMITS.perKmMaxPaise),
  maxKm: z.number().min(1).max(DOORSTEP_LIMITS.maxKmMax),
  roundTo9: z.boolean(),
  busy: z
    .array(
      z.object({
        days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
        from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        extraPaise: z.number().int().min(1).max(DOORSTEP_LIMITS.visitFeeMaxPaise),
      }),
    )
    .max(DOORSTEP_LIMITS.busyMax),
});
const communityTiersSchema = z.object({
  tiers: z
    .array(z.object({ minCars: z.number().int().min(2).max(1000), discountBp: z.number().int().min(100).max(COMMUNITY_TIER_MAX_BP) }))
    .max(COMMUNITY_TIERS_MAX),
});
const zoneSchema = z.object({
  name: nameSchema(PRICE_ZONE_NAME_MAX),
  percentBp: z.number().int().min(-5000).max(10000),
});
const policySchema = z
  .object({
    branchOverrides: z.boolean(),
    maxIncreasePct: z.number().int().min(0).max(MAX_OVERRIDE_PCT),
    maxDecreasePct: z.number().int().min(0).max(MAX_OVERRIDE_PCT),
    branchCanHideServices: z.boolean(),
  })
  .partial();

const planSchema = z.object({
  name: nameSchema(WASH_PLAN_NAME_MAX),
  washes: z.number().int().min(1).max(WASH_PLAN_MAX_WASHES),
  months: z.number().int().min(1).max(WASH_PLAN_MAX_MONTHS),
  catalogServiceId: idSchema,
  discountBp: z.number().int().min(0).max(WASH_PLAN_MAX_DISCOUNT_BP).default(0),
  allowParts: z.boolean().default(false),
  popular: z.boolean().default(false),
  /** Where it's sold: communities, the shop counter, or both. */
  soldAt: z.enum(['community', 'shop', 'both']).default('community'),
  /** A community plan can also pay for a wash at the shop. */
  shopUse: z.boolean().default(true),
  /** Every Nth wash is this service instead; both or neither. */
  upgradeServiceId: idSchema.nullable().default(null),
  upgradeEvery: z.number().int().min(WASH_PLAN_UPGRADE_EVERY[0]).max(WASH_PLAN_UPGRADE_EVERY[1]).nullable().default(null),
  /** Fixed prices per size and way of washing; the whole list is replaced when sent. */
  prices: z
    .array(
      z.object({
        sizeId: idSchema,
        mode: modeSchema,
        price: z.number().int().nonnegative().max(MAX_PLAN_PRICE_PAISE, 'That price looks too large'),
      }),
    )
    .max(200)
    .optional(),
});
const planPatchSchema = planSchema
  .extend({ active: z.boolean(), sortOrder: z.number().int().min(0).max(1000) })
  .partial()
  .refine((p) => (p.upgradeServiceId === undefined) === (p.upgradeEvery === undefined), {
    message: 'Send the upgraded wash and how often together.',
  });
const ruleInt = (key: keyof typeof WASH_PLAN_RULE_LIMITS) =>
  z.number().int().min(WASH_PLAN_RULE_LIMITS[key][0]).max(WASH_PLAN_RULE_LIMITS[key][1]).optional();
const clockSchema = z.string().refine(isClockTime, 'Pick a time');
const planRulesSchema = z.object({
  partsFirstPct: ruleInt('partsFirstPct'),
  partsCount: ruleInt('partsCount'),
  graceDays: ruleInt('graceDays'),
  payDeadlineTime: clockSchema.optional(),
  atPlaceMeters: ruleInt('atPlaceMeters'),
  skipCutoffTime: clockSchema.optional(),
  skipsPerMonth: ruleInt('skipsPerMonth'),
  pauseDaysPerMonth: ruleInt('pauseDaysPerMonth'),
  refundRule: z.enum(['single_price', 'pro_rata']).optional(),
  renewalReminderDays: ruleInt('renewalReminderDays'),
  unpaidCloseDays: ruleInt('unpaidCloseDays'),
  priceMode: z.enum(['doorstep', 'hub']).optional(),
  gstRateBp: ruleInt('gstRateBp'),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === '' || GSTIN_RE.test(v), 'Enter a valid GSTIN')
    .nullable()
    .optional(),
  legalName: z.string().trim().max(120).nullable().optional(),
});

const personName = z.string().trim().min(1, 'Enter the owner’s name').max(60);
const pincodeSchema = z
  .string()
  .transform((s) => s.replace(/\D/g, ''))
  .refine(isValidPincode, 'Enter the branch’s 6-digit pincode');
const branchPlaceSchema = z.object({
  pincode: pincodeSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** One of the town choices the preview gave; null = the best one. */
  town: z.string().trim().max(TOWN_NAME_MAX).nullable().default(null),
  /** One of the area choices, or null for none; left out = the default. */
  area: z.string().trim().max(TOWN_NAME_MAX).nullable().optional(),
});
const servicesSchema = z
  .object({ hub: z.boolean(), community: z.boolean(), doorstep: z.boolean() })
  .refine((v) => branchServicesProblem(v) == null, (v) => ({ message: branchServicesProblem(v) ?? '' }));
const openBranchSchema = branchPlaceSchema.extend({
  ownerName: personName,
  ownerPhone: phoneSchema,
  /** What the branch's agreement allows; it opens with all of them switched on. */
  services: servicesSchema.default(ALL_BRANCH_SERVICES),
  /** The head-office services it sells from the start (more can be switched on later). */
  menu: z.array(idSchema).max(200).default([]),
  /** The kinds of vehicle it washes (body type ids); left out: cars and two-wheelers. */
  vehicles: z.array(idSchema).max(200).optional(),
  /** The checks HQ has looked at and accepted (near_branch, new_state…). */
  confirmed: z.array(z.enum(BRANCH_CHECK_KINDS)).max(10).default([]),
});
/** What a new branch washes when HQ doesn't say: cars and two-wheelers. */
async function defaultVehicles(d1: Env['DB'], businessId: string): Promise<string[]> {
  const data = await catalogRepo.load(d1, businessId);
  if (!data) return [];
  const wanted = new Set(data.classes.filter((k) => k.key === 'car' || k.key === 'twoWheeler').map((k) => k.id));
  return data.bodyTypes.filter((b) => wanted.has(b.classId)).map((b) => b.id);
}
const modelKeySchema = z.object({ make: z.string().trim().min(1).max(VEHICLE_MAKE_MAX), model: z.string().trim().min(1).max(VEHICLE_MAKE_MAX) });
const vehicleModelSchema = modelKeySchema.extend({
  category: z.enum(['car', 'bike']),
  bodyKey: z.string().min(1).max(40),
  from: modelKeySchema.optional(),
});
const ownerSchema = z.object({ name: personName, phone: phoneSchema });
const ownerParam = z.object({ id: idSchema, userId: idSchema });
const statusSchema = z
  .object({
    status: z.enum(BRANCH_STATUSES),
    reason: z.string().trim().max(BRANCH_STATUS_REASON_MAX).optional(),
  })
  .refine((d) => d.status === 'active' || (d.reason?.length ?? 0) >= BRANCH_STATUS_REASON_MIN, {
    message: 'Say why, so the branch team knows.',
    path: ['reason'],
  });

type Ctx = Context<{ Bindings: Env }>;

const PLAN_ERROR_STATUS = {
  unknown_pincode: 404,
  outside_india: 400,
  bad_choice: 400,
  no_code: 409,
  no_offices: 503,
  needs_confirmation: 409,
} as const satisfies Record<PlanError['error'], number>;

function planErrorResponse(c: Ctx, e: PlanError) {
  return c.json(e, PLAN_ERROR_STATUS[e.error]);
}

type OwnerProblem = { status: 404 | 409; body: { error: string; message: string } };

type PersonPin = { hash: string | null; digits: number | null; setAt: Date | null };

/**
 * Whether this number can become the owner of another branch, and the name and PIN it already
 * has: someone's rows share one PIN, so the new branch opens with the same sign-in, whatever
 * their role at the others.
 */
async function ownerCandidate(
  platform: DbClient,
  phone: string,
): Promise<{ problem: OwnerProblem } | { name: string | null; pin: PersonPin }> {
  const rows = await userRepo.listByPhone(platform, phone);
  if (rows.length >= MAX_BRANCHES_PER_PERSON) {
    return {
      problem: {
        status: 409,
        body: { error: 'too_many_shops', message: `One number can work at up to ${MAX_BRANCHES_PER_PERSON} branches.` },
      },
    };
  }
  const person = await userRepo.personPin(platform, phone);
  return { name: person?.name ?? null, pin: person?.pin ?? { hash: null, digits: null, setAt: null } };
}

/** The branch, only if it belongs to the signed-in HQ's business. */
async function hqBranch(c: Ctx, shopId: string) {
  const branch = await catalogRepo.branchOf(createPlatformDb(c.env.DB), shopId);
  return branch && branch.businessId === c.get('businessId') ? branch : null;
}

const branchNotFound = { error: 'not_found' as const, message: 'No such branch in this business.' };

/** Runs a catalog change, then rebuilds the branches' menus. */
async function change(c: Ctx, write: () => Promise<unknown>) {
  try {
    await write();
  } catch (e) {
    return catalogError(c, e);
  }
  const { branches } = await publishBusiness(c, c.get('businessId'));
  return c.json({ ok: true as const, branches });
}

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const businessRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  .use('*', requireBusinessAdmin)
  .get('/catalog', async (c) => {
    const businessId = c.get('businessId');
    const [view, shops] = await Promise.all([
      catalogRepo.view(c.env.DB, businessId),
      createPlatformDb(c.env.DB).shop.findMany({ where: { businessId, status: { not: 'closed' } }, select: BRANCH_SERVICES_SELECT }),
    ]);
    if (!view) return c.json({ error: 'not_found' as const }, 404);
    // Whether any branch washes at customers' homes: the community price column is then also doorstep.
    return c.json({ ...view, homeWash: shops.some((sh) => branchServicesOf(sh).live.doorstep) });
  })
  .patch('/', zValidator('json', z.object({ name: nameSchema(80) })), async (c) => {
    await catalogRepo.renameBusiness(c.env.DB, c.get('businessId'), c.req.valid('json').name);
    return c.json({ ok: true as const });
  })

  // ---------- Admins ----------
  .post('/admins', zValidator('json', z.object({ phone: phoneSchema })), async (c) => {
    try {
      await catalogRepo.addAdmin(c.env.DB, c.get('businessId'), c.req.valid('json').phone);
    } catch (e) {
      return catalogError(c, e);
    }
    return c.json({ ok: true as const }, 201);
  })
  .delete('/admins/:phone', zValidator('param', z.object({ phone: phoneSchema })), async (c) => {
    try {
      await catalogRepo.removeAdmin(c.env.DB, c.get('businessId'), c.req.valid('param').phone);
    } catch (e) {
      return catalogError(c, e);
    }
    return c.json({ ok: true as const });
  })

  // ---------- Vehicles ----------
  .patch('/classes/:id', zValidator('param', idParam), zValidator('json', z.object({ name: nameSchema(CATALOG_NAME_MAX) })), (c) =>
    change(c, () => catalogRepo.renameClass(c.env.DB, c.get('businessId'), c.req.valid('param').id, c.req.valid('json').name)),
  )
  .patch('/sizes/:id', zValidator('param', idParam), zValidator('json', z.object({ name: nameSchema(CATALOG_NAME_MAX) })), (c) =>
    change(c, () => catalogRepo.renameSize(c.env.DB, c.get('businessId'), c.req.valid('param').id, c.req.valid('json').name)),
  )
  .patch(
    '/body-types/:id',
    zValidator('param', idParam),
    zValidator(
      'json',
      z.object({ name: nameSchema(CATALOG_NAME_MAX).optional(), sizeId: idSchema.optional() }),
    ),
    (c) => change(c, () => catalogRepo.updateBodyType(c.env.DB, c.get('businessId'), c.req.valid('param').id, c.req.valid('json'))),
  )

  // ---------- Companies and models (the vehicle size guide) ----------
  /** Adds a model or changes one (its company, name or kind); `from` is the model being edited. */
  .put('/vehicle-models', zValidator('json', vehicleModelSchema), async (c) => {
    try {
      const saved = await vehicleModelRepo.save(c.env.DB, c.get('businessId'), c.req.valid('json'), c.get('session').phone);
      return c.json({ ok: true as const, ...saved });
    } catch (e) {
      if (e instanceof VehicleModelError) return c.json({ error: 'invalid' as const, message: e.message }, 400);
      throw e;
    }
  })
  /** Takes a model off the list. */
  .delete('/vehicle-models', zValidator('json', modelKeySchema.extend({ category: z.enum(['car', 'bike']) })), async (c) => {
    await vehicleModelRepo.remove(c.env.DB, c.get('businessId'), c.req.valid('json'), c.get('session').phone);
    return c.json({ ok: true as const });
  })
  /** Puts a listed model back as it ships (undoes head office's change). */
  .post('/vehicle-models/reset', zValidator('json', modelKeySchema), async (c) => {
    try {
      await vehicleModelRepo.reset(c.env.DB, c.get('businessId'), c.req.valid('json'));
      return c.json({ ok: true as const });
    } catch (e) {
      if (e instanceof VehicleModelError) return c.json({ error: 'invalid' as const, message: e.message }, 400);
      throw e;
    }
  })

  // ---------- Services ----------
  .post('/services', zValidator('json', createServiceSchema), async (c) => {
    let id: string;
    const { prices, ...body } = withPlaces(c.req.valid('json'));
    try {
      id = await catalogRepo.createService(c.env.DB, c.get('businessId'), body as Parameters<typeof catalogRepo.createService>[2]);
      await saveServicePrices(c.env.DB, c.get('businessId'), id, prices);
    } catch (e) {
      return catalogError(c, e);
    }
    const { branches } = await publishBusiness(c, c.get('businessId'));
    return c.json({ id, branches }, 201);
  })
  .patch('/services/:id', zValidator('param', idParam), zValidator('json', updateServiceSchema), (c) =>
    change(c, async () => {
      const raw = c.req.valid('json');
      const { prices, ...body } = withPlaces(raw);
      const id = c.req.valid('param').id;
      // Wash plans are sold at communities: their wash can't stop being done there.
      if (raw.places && !raw.places.community) {
        const plan = await createPlatformDb(c.env.DB).washPlan.findFirst({
          where: { businessId: c.get('businessId'), active: true, OR: [{ catalogServiceId: id }, { upgradeServiceId: id }] },
          select: { name: true },
        });
        if (plan) throw new CatalogError('in_use', `${plan.name} uses this service, so it has to stay at communities.`);
      }
      await catalogRepo.updateService(c.env.DB, c.get('businessId'), id, body);
      await saveServicePrices(c.env.DB, c.get('businessId'), id, prices);
    }),
  )
  // Deletes a service: off every branch's menu for good. Past washes keep its name. A service a
  // wash plan or a combo uses can't go until it's taken out of them.
  .delete('/services/:id', zValidator('param', idParam), (c) =>
    change(c, () => catalogRepo.deleteService(c.env.DB, c.get('businessId'), c.req.valid('param').id)),
  )
  .put('/services/order', zValidator('json', z.object({ ids: z.array(idSchema).min(1).max(200) })), (c) =>
    change(c, () => catalogRepo.reorderServices(c.env.DB, c.get('businessId'), c.req.valid('json').ids)),
  )

  // ---------- Prices ----------
  .put('/prices', zValidator('json', pricesSchema), (c) =>
    change(c, () => {
      const body = c.req.valid('json');
      return catalogRepo.setPrices(c.env.DB, c.get('businessId'), body.priceBookId, body.entries);
    }),
  )
  .post(
    '/price-books',
    zValidator('json', z.object({ name: nameSchema(PRICE_BOOK_NAME_MAX), copyFrom: idSchema.nullable().default(null) })),
    async (c) => {
      const body = c.req.valid('json');
      try {
        const id = await catalogRepo.createPriceBook(c.env.DB, c.get('businessId'), body.name, body.copyFrom);
        return c.json({ id }, 201);
      } catch (e) {
        return catalogError(c, e);
      }
    },
  )
  .patch(
    '/price-books/:id',
    zValidator('param', idParam),
    zValidator('json', z.object({ name: nameSchema(PRICE_BOOK_NAME_MAX).optional(), isDefault: z.literal(true).optional() })),
    (c) =>
      change(c, async () => {
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        if (body.name) await catalogRepo.renamePriceBook(c.env.DB, c.get('businessId'), id, body.name);
        if (body.isDefault) await catalogRepo.setDefaultPriceBook(c.env.DB, c.get('businessId'), id);
      }),
  )
  .delete('/price-books/:id', zValidator('param', idParam), async (c) => {
    try {
      await catalogRepo.deletePriceBook(c.env.DB, c.get('businessId'), c.req.valid('param').id);
    } catch (e) {
      return catalogError(c, e);
    }
    return c.json({ ok: true as const });
  })

  // ---------- Pricing rules ----------
  .put('/adjustments', zValidator('json', adjustmentSchema), (c) =>
    change(c, () => catalogRepo.setAdjustment(c.env.DB, c.get('businessId'), c.req.valid('json'))),
  )
  .delete('/adjustments', zValidator('json', z.object(adjustmentKey)), (c) =>
    change(c, () => {
      const { mode, classId } = c.req.valid('json');
      return catalogRepo.deleteAdjustment(c.env.DB, c.get('businessId'), mode, classId);
    }),
  )
  .post('/zones', zValidator('json', zoneSchema), async (c) => {
    const id = await catalogRepo.createZone(c.env.DB, c.get('businessId'), c.req.valid('json'));
    return c.json({ id }, 201);
  })
  .patch(
    '/zones/:id',
    zValidator('param', idParam),
    zValidator('json', zoneSchema.partial().extend({ active: z.boolean().optional() })),
    (c) => change(c, () => catalogRepo.updateZone(c.env.DB, c.get('businessId'), c.req.valid('param').id, c.req.valid('json'))),
  )
  .patch('/policy', zValidator('json', policySchema), (c) =>
    change(c, () => catalogRepo.setPolicy(c.env.DB, c.get('businessId'), c.req.valid('json'), c.get('session').phone)),
  )
  /** What a home visit costs on top of the hub price. */
  .put('/doorstep-rules', zValidator('json', doorstepRulesSchema), async (c) => {
    const saved = await awayPricingRepo.setDoorstep(c.env.DB, c.get('businessId'), c.req.valid('json'), c.get('session').phone);
    if (!saved.ok) return c.json({ error: 'invalid_rules' as const, message: saved.message }, 400);
    return c.json({ rules: saved.rules });
  })
  /** Bigger communities pay less: from N cars, X% off the community price. */
  .put('/community-tiers', zValidator('json', communityTiersSchema), async (c) => {
    const saved = await awayPricingRepo.setCommunityTiers(c.env.DB, c.get('businessId'), c.req.valid('json').tiers, c.get('session').phone);
    if (!saved.ok) return c.json({ error: 'invalid_tiers' as const, message: saved.message }, 400);
    return c.json({ tiers: saved.tiers });
  })

  // ---------- Branches ----------
  // Only HQ opens a branch: always inside its business, with HQ's menu, and an owner who signs
  // in with a WhatsApp code and picks a PIN (or uses the PIN they already have as an owner).
  /** A pincode's district, state and post offices, as soon as HQ has typed it. */
  .get('/pincodes/:pincode', zValidator('param', z.object({ pincode: pincodeSchema })), async (c) => {
    const { pincode } = c.req.valid('param');
    const pdb = createPlatformDb(c.env.DB);
    const offices = await branchTownRepo.postOffices(pdb, pincode);
    if (!offices.length) {
      const loaded = await branchTownRepo.hasPostOffices(pdb);
      return c.json(
        loaded
          ? { error: 'unknown_pincode' as const, message: `India Post has no pincode ${pincode}. Check it and try again.` }
          : { error: 'no_offices' as const, message: 'The pincode list isn’t loaded on the server yet. Ask Sprixia to load it.' },
        404,
      );
    }
    const place = pincodePlace(offices)!;
    return c.json({ pincode, district: place.district, state: place.state, offices: offices.length, centre: pincodeCentre(offices) });
  })
  /** What opening a branch here would make: town, code, name, choices and checks. Writes nothing. */
  .post('/branches/preview', zValidator('json', branchPlaceSchema), async (c) => {
    const plan = await planBranch(c.env, c.get('businessId'), c.req.valid('json'));
    if (isPlanError(plan)) return planErrorResponse(c, plan);
    return c.json({ plan });
  })
  // Only HQ opens a branch: always inside its business, with HQ's menu, and an owner who signs
  // in with a WhatsApp code and picks a PIN (or uses the PIN they already have as an owner). The
  // server decides the town, code, number and name again; the checks the preview showed must be
  // confirmed (a new one that appeared meanwhile sends HQ back to look).
  .post('/branches', zValidator('json', openBranchSchema), async (c) => {
    const body = c.req.valid('json');
    const businessId = c.get('businessId');
    const platform = createPlatformDb(c.env.DB);
    const confirmed = new Set(body.confirmed);
    let menu: string[];
    let vehicles: string[];
    try {
      menu = await catalogRepo.checkBranchMenu(c.env.DB, businessId, body.menu);
      vehicles = await catalogRepo.checkBranchVehicles(c.env.DB, businessId, body.vehicles ?? (await defaultVehicles(c.env.DB, businessId)));
    } catch (e) {
      return catalogError(c, e);
    }
    const result = await withLock(c.env, `branches:${businessId}`, () =>
      withPhoneLock(c.env, body.ownerPhone, async () => {
        const candidate = await ownerCandidate(platform, body.ownerPhone);
        if ('problem' in candidate) return candidate;
        return openBranch(
          c.env,
          businessId,
          body,
          { name: candidate.name ?? body.ownerName, phone: body.ownerPhone, pin: candidate.pin },
          body.services,
          menu,
          vehicles,
          (plan) => {
            const open = plan.checks.filter((k) => !confirmed.has(k.kind));
            return open.length ? { error: 'needs_confirmation', message: open[0]!.message, checks: open, plan } : null;
          },
        );
      }),
    );
    if (result === null) return c.json({ error: 'busy' as const, message: 'Another branch is being opened right now. Try again in a moment.' }, 409);
    if ('problem' in result) return c.json(result.problem.body, result.problem.status);
    if ('error' in result) return planErrorResponse(c, result);
    return c.json({ id: result.shopId, code: result.plan.code, name: result.plan.name, town: result.plan.town.name }, 201);
  })
  // Only HQ makes someone an owner: a teammate of the branch is promoted, anyone else is added.
  .post('/branches/:id/owners', zValidator('param', idParam), zValidator('json', ownerSchema), async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (!(await hqBranch(c, id))) return c.json(branchNotFound, 404);
    const platform = createPlatformDb(c.env.DB);
    const db = createShopDb(c.env.DB, id);
    const result = await withPhoneLock(c.env, body.phone, async () => {
      const here = (await userRepo.listByPhone(platform, body.phone)).find((r) => r.shopId === id);
      if (here?.role === 'owner') {
        return { problem: { status: 409, body: { error: 'already_owner', message: 'This person already owns the branch.' } } as OwnerProblem };
      }
      if (here) {
        await userRepo.update(db, here.id, { role: 'owner', active: true });
        return { id: here.id };
      }
      const candidate = await ownerCandidate(platform, body.phone);
      if ('problem' in candidate) return candidate;
      const owner = await userRepo.createWithPin(db, {
        name: candidate.name ?? body.name,
        phone: body.phone,
        role: 'owner',
        pin: candidate.pin,
      });
      return { id: owner.id };
    });
    forgetShop(id);
    if (result === null) return c.json(phoneBusy, 409);
    if ('problem' in result) return c.json(result.problem.body, result.problem.status);
    return c.json(result, 201);
  })
  // Takes an owner off the branch (signed out, kept on past work). Another owner must remain.
  .delete('/branches/:id/owners/:userId', zValidator('param', ownerParam), async (c) => {
    const { id, userId } = c.req.valid('param');
    if (!(await hqBranch(c, id))) return c.json(branchNotFound, 404);
    const db = createShopDb(c.env.DB, id);
    const target = await userRepo.findMember(db, userId);
    if (!target || target.role !== 'owner') return c.json({ error: 'not_found' as const, message: 'Not an owner of this branch.' }, 404);
    if (target.active && !(await userRepo.dropOwnerAccess(db, userId, { demote: false, deactivate: true }))) {
      return c.json({ error: 'last_owner' as const, message: 'Add another owner before removing the last one.' }, 400);
    }
    await userRepo.remove(db, userId, new Date());
    forgetShop(id);
    return c.json({ ok: true as const });
  })
  // The branch's managers and staff, so HQ can reset someone who works at more than one branch.
  .get('/branches/:id/team', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    if (!(await hqBranch(c, id))) return c.json(branchNotFound, 404);
    const team = await userRepo.list(createShopDb(c.env.DB, id));
    return c.json({
      team: team
        .filter((u) => u.role !== 'owner')
        .map((u) => ({ id: u.id, name: u.name, phone: u.phone, role: toUserRole(u.role), active: u.active, pinSet: u.hasPin })),
    });
  })
  // Forgot their PIN, or it got locked: HQ resets branch owners (and anyone who works at more
  // than one branch). Only clears it — see lib/pinReset.ts.
  .post('/branches/:id/team/:userId/reset-pin', zValidator('param', ownerParam), async (c) => {
    const { id, userId } = c.req.valid('param');
    if (!(await hqBranch(c, id))) return c.json(branchNotFound, 404);
    const session = c.get('session');
    const target = await userRepo.findMember(createShopDb(c.env.DB, id), userId);
    if (!target) return c.json({ error: 'not_found' as const, message: 'Not on this branch’s team.' }, 404);
    if (target.phone === session.phone) {
      return c.json(
        { error: 'cannot_change_self' as const, message: 'Change your own PIN from More → Change PIN.' },
        400,
      );
    }
    const me = await userRepo.findById(c.get('db'), session.sub);
    await resetPin(c.env, target, { phone: session.phone, label: `${me?.name ?? 'Someone'} (Mana Wash HQ)` });
    return c.json({ ok: true as const });
  })
  // Every branch with its status and today's and this month's numbers.
  .get('/overview', async (c) => {
    const now = new Date();
    const branches = await shopRepo.businessOverview(createPlatformDb(c.env.DB), c.get('businessId'), {
      dayFrom: startOfIstDay(now),
      dayTo: endOfIstDay(now),
      monthFrom: startOfIstMonth(now),
    });
    return c.json({ branches, currentShopId: c.get('session').shopId });
  })
  .get('/branches/:id/status', zValidator('param', idParam), async (c) => {
    const { id } = c.req.valid('param');
    if (!(await hqBranch(c, id))) return c.json(branchNotFound, 404);
    return c.json({ history: await shopRepo.statusHistory(createPlatformDb(c.env.DB), id) });
  })
  // Open, pause or close a branch. Paused: no new washes, but today's open ones can be finished
  // and paid. Closed: nobody there can sign in. Every change is kept with who did it and why.
  .patch('/branches/:id/status', zValidator('param', idParam), zValidator('json', statusSchema), async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (!(await hqBranch(c, id))) return c.json(branchNotFound, 404);
    const session = c.get('session');
    if (body.status === 'closed' && id === session.shopId) {
      return c.json(
        {
          error: 'cannot_close_own' as const,
          message: 'You’re signed in to this branch. Switch to another branch before closing it.',
        },
        400,
      );
    }
    const changed = await shopRepo.setStatus(c.env.DB, createPlatformDb(c.env.DB), id, {
      status: body.status,
      reason: body.reason ?? null,
      byPhone: session.phone,
    });
    forgetShop(id);
    return c.json({ ok: true as const, changed });
  })
  .patch(
    '/branches/:id',
    zValidator('param', idParam),
    zValidator('json', z.object({ priceBookId: idSchema.nullable().optional(), priceZoneId: idSchema.nullable().optional() })),
    async (c) => {
      const { id } = c.req.valid('param');
      try {
        await catalogRepo.setBranchPricing(c.env.DB, c.get('businessId'), id, c.req.valid('json'));
      } catch (e) {
        return catalogError(c, e);
      }
      await menuRepo.publish(c.env.DB, id);
      return c.json({ ok: true as const });
    },
  )
  /**
   * What a branch's agreement allows (hub, communities, doorstep). The owner's switches stay
   * inside it; taking Community away waits until the branch's community plans have finished.
   */
  .put('/branches/:id/services', zValidator('param', idParam), zValidator('json', servicesSchema), async (c) => {
    const { id } = c.req.valid('param');
    if (!(await hqBranch(c, id))) return c.json(branchNotFound, 404);
    const pdb = createPlatformDb(c.env.DB);
    const services = await branchServiceRepo.get(pdb, id);
    if (!services) return c.json(branchNotFound, 404);
    const allowed = c.req.valid('json');
    const offered = offerWithin(allowed, services.offered);
    if (services.live.community && !liveBranchServices(allowed, offered).community) {
      const running = await branchServiceRepo.runningPlans(pdb, id);
      if (running > 0) {
        return c.json(
          {
            error: 'plans_running' as const,
            message: `${running} community plan${running === 1 ? ' is' : 's are'} still running at this branch. Let them finish (or cancel them) before taking Community away.`,
          },
          409,
        );
      }
    }
    await branchServiceRepo.setAllowed(c.env.DB, id, allowed, offered);
    await menuRepo.publish(c.env.DB, id);
    forgetShop(id);
    return c.json({ services: { allowed, offered, live: liveBranchServices(allowed, offered) } });
  })
  // Which head-office services this branch sells. Nothing reaches a branch until HQ switches it on
  // here; a combo brings the services it bundles with it.
  /** The kinds of vehicle a branch washes; its hub and team take their vehicle groups. */
  .put(
    '/branches/:id/vehicles',
    zValidator('param', idParam),
    zValidator('json', z.object({ bodyTypeIds: z.array(idSchema).max(200) })),
    async (c) => {
      const { id } = c.req.valid('param');
      if (!(await hqBranch(c, id))) return c.json(branchNotFound, 404);
      let vehicles: string[];
      try {
        vehicles = await catalogRepo.checkBranchVehicles(c.env.DB, c.get('businessId'), c.req.valid('json').bodyTypeIds);
      } catch (e) {
        return catalogError(c, e);
      }
      await catalogRepo.saveBranchVehicles(c.env.DB, c.get('businessId'), id, vehicles);
      await menuRepo.markStale(c.env.DB, id);
      await menuRepo.publish(c.env.DB, id);
      forgetShop(id);
      return c.json({ ok: true as const, vehicles });
    },
  )
  .put('/branches/:id/menu', zValidator('param', idParam), zValidator('json', z.object({ serviceIds: z.array(idSchema).max(200) })), async (c) => {
    const { id } = c.req.valid('param');
    if (!(await hqBranch(c, id))) return c.json(branchNotFound, 404);
    let menu: string[];
    try {
      menu = await catalogRepo.checkBranchMenu(c.env.DB, c.get('businessId'), c.req.valid('json').serviceIds);
    } catch (e) {
      return catalogError(c, e);
    }
    await catalogRepo.saveBranchMenu(c.env.DB, id, menu);
    await menuRepo.markStale(c.env.DB, id);
    await menuRepo.publish(c.env.DB, id);
    forgetShop(id);
    return c.json({ ok: true as const, menu });
  })
  /** Starts the catalog from a branch's own menu (the signed-in branch unless another is named). */
  .post('/import', zValidator('json', z.object({ shopId: idSchema.optional() })), async (c) => {
    const session = c.get('session');
    const shopId = c.req.valid('json').shopId ?? session.shopId;
    try {
      const result = await menuRepo.importFromBranch(c.env.DB, c.get('businessId'), shopId);
      const { branches } = await publishBusiness(c, c.get('businessId'));
      return c.json({ ...result, branches });
    } catch (e) {
      return catalogError(c, e);
    }
  })
  /** Rebuilds every branch's menu now (normally automatic). */
  .post('/publish', async (c) => {
    await catalogRepo.markAllStale(c.env.DB, c.get('businessId'));
    const { branches } = await publishBusiness(c, c.get('businessId'));
    return c.json({ ok: true as const, branches });
  })

  // ---------- Wash plans and their rules (places) ----------
  .get('/plans', async (c) => {
    const pdb = createPlatformDb(c.env.DB);
    const businessId = c.get('businessId');
    const [plans, rules] = await Promise.all([planRepo.list(pdb, businessId), planRepo.rules(pdb, businessId)]);
    return c.json({ plans, rules });
  })
  .post('/plans', zValidator('json', planSchema), async (c) => {
    try {
      return c.json({ id: await planRepo.create(c.env.DB, c.get('businessId'), c.req.valid('json')) }, 201);
    } catch (e) {
      return placeError(c, e);
    }
  })
  .patch(
    '/plans/:id',
    zValidator('param', idParam),
    zValidator('json', planPatchSchema),
    async (c) => {
      try {
        await planRepo.update(c.env.DB, c.get('businessId'), c.req.valid('param').id, c.req.valid('json'));
        return c.json({ ok: true as const });
      } catch (e) {
        return placeError(c, e);
      }
    },
  )
  .patch('/plan-rules', zValidator('json', planRulesSchema), async (c) => {
    const businessId = c.get('businessId');
    await planRepo.setRules(c.env.DB, businessId, c.req.valid('json'), c.get('session').phone);
    return c.json({ rules: await planRepo.rules(createPlatformDb(c.env.DB), businessId) });
  });
