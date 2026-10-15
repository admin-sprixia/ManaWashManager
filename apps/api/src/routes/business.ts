import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { catalogRepo, createPlatformDb, createShopDb, joinRequestRepo, menuRepo, planRepo, shopRepo, userRepo, type DbClient } from '@mana/db';
import {
  GSTIN_RE,
  isClockTime,
  WASH_PLAN_MAX_DISCOUNT_BP,
  WASH_PLAN_MAX_MONTHS,
  WASH_PLAN_MAX_WASHES,
  WASH_PLAN_NAME_MAX,
  WASH_PLAN_RULE_LIMITS,
  CATALOG_NAME_MAX,
  CATALOG_SERVICE_DESCRIPTION_MAX,
  CATALOG_SERVICE_NAME_MAX,
  MAX_ADJUSTMENT_BP,
  MAX_ADJUSTMENT_FIXED_PAISE,
  MAX_OVERRIDE_PCT,
  MAX_SERVICE_PRICE_PAISE,
  MIN_ADJUSTMENT_BP,
  PRICE_BOOK_NAME_MAX,
  PRICE_ZONE_NAME_MAX,
  ROUND_TO_CHOICES_PAISE,
  MAX_SHOPS_PER_OWNER,
  normalizePhone,
  BRANCH_STATUSES,
  BRANCH_STATUS_REASON_MAX,
  BRANCH_STATUS_REASON_MIN,
  toUserRole,
} from '@mana/domain';
import { forgetShop, requireAuth } from '../middleware/auth';
import { catalogError, publishBusiness, requireBusinessAdmin } from '../lib/catalog';
import { phoneBusy, withPhoneLock } from '../lib/phoneLock';
import { placeError } from '../lib/places';
import { createShopWithOwner } from '../lib/shops';
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
  /** A combo bundles at least two services; empty for a plain service. */
  includes: z
    .array(idSchema)
    .max(30)
    .refine((ids) => ids.length !== 1, 'A combo needs at least two services.'),
};
const createServiceSchema = z.object({
  ...serviceFields,
  description: serviceFields.description.default(null),
  modes: serviceFields.modes.default('both'),
  includes: serviceFields.includes.default([]),
});
const updateServiceSchema = z.object({
  name: serviceFields.name.optional(),
  description: serviceFields.description.optional(),
  modes: serviceFields.modes.optional(),
  classIds: serviceFields.classIds.optional(),
  includes: serviceFields.includes.optional(),
  active: z.boolean().optional(),
});
const pricesSchema = z.object({
  priceBookId: idSchema,
  entries: z
    .array(
      z.object({
        serviceId: idSchema,
        sizeId: idSchema,
        price: z.number().int().nonnegative().max(MAX_SERVICE_PRICE_PAISE, 'That price looks too large').nullable(),
      }),
    )
    .min(1)
    .max(2000),
});
const adjustmentKey = { mode: modeSchema, classId: idSchema.nullable() };
const adjustmentSchema = z.object({
  ...adjustmentKey,
  percentBp: z.number().int().min(MIN_ADJUSTMENT_BP).max(MAX_ADJUSTMENT_BP),
  fixedPaise: z.number().int().min(-MAX_ADJUSTMENT_FIXED_PAISE).max(MAX_ADJUSTMENT_FIXED_PAISE),
  minExtraPaise: z.number().int().min(0).max(MAX_ADJUSTMENT_FIXED_PAISE),
});
const zoneSchema = z.object({
  name: nameSchema(PRICE_ZONE_NAME_MAX),
  percentBp: z.number().int().min(-5000).max(10000),
});
const policySchema = z
  .object({
    roundToPaise: z
      .number()
      .int()
      .refine((v) => ROUND_TO_CHOICES_PAISE.includes(v), 'Pick one of the rounding choices.'),
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
  homeWash: z.boolean().optional(),
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
const openBranchSchema = z.object({
  name: z.string().trim().min(2, 'Enter the branch name').max(60),
  city: z.string().trim().max(40).optional(),
  ownerName: personName,
  ownerPhone: phoneSchema,
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
  if (rows.length >= MAX_SHOPS_PER_OWNER) {
    return {
      problem: {
        status: 409,
        body: { error: 'too_many_shops', message: `One number can work at up to ${MAX_SHOPS_PER_OWNER} branches.` },
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
    const [view, rules] = await Promise.all([
      catalogRepo.view(c.env.DB, businessId),
      planRepo.rules(createPlatformDb(c.env.DB), businessId),
    ]);
    if (!view) return c.json({ error: 'not_found' as const }, 404);
    return c.json({ ...view, homeWash: rules.homeWash });
  })
  .patch('/', zValidator('json', z.object({ name: nameSchema(80) })), async (c) => {
    await catalogRepo.renameBusiness(c.env.DB, c.get('businessId'), c.req.valid('json').name);
    return c.json({ ok: true as const });
  })

  // ---------- Admins ----------
  .post('/admins', zValidator('json', z.object({ phone: phoneSchema })), async (c) => {
    await catalogRepo.addAdmin(c.env.DB, c.get('businessId'), c.req.valid('json').phone);
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
      z.object({ name: nameSchema(CATALOG_NAME_MAX).optional(), sizeId: idSchema.optional(), active: z.boolean().optional() }),
    ),
    (c) => change(c, () => catalogRepo.updateBodyType(c.env.DB, c.get('businessId'), c.req.valid('param').id, c.req.valid('json'))),
  )

  // ---------- Services ----------
  .post('/services', zValidator('json', createServiceSchema), async (c) => {
    let id: string;
    try {
      id = await catalogRepo.createService(c.env.DB, c.get('businessId'), c.req.valid('json'));
    } catch (e) {
      return catalogError(c, e);
    }
    const { branches } = await publishBusiness(c, c.get('businessId'));
    return c.json({ id, branches }, 201);
  })
  .patch('/services/:id', zValidator('param', idParam), zValidator('json', updateServiceSchema), (c) =>
    change(c, () => catalogRepo.updateService(c.env.DB, c.get('businessId'), c.req.valid('param').id, c.req.valid('json'))),
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

  // ---------- Branches ----------
  // Only HQ opens a branch: always inside its business, with HQ's menu, and an owner who signs
  // in with a WhatsApp code and picks a PIN (or uses the PIN they already have as an owner).
  .post('/branches', zValidator('json', openBranchSchema), async (c) => {
    const body = c.req.valid('json');
    const platform = createPlatformDb(c.env.DB);
    const result = await withPhoneLock(c.env, body.ownerPhone, async () => {
      const candidate = await ownerCandidate(platform, body.ownerPhone);
      if ('problem' in candidate) return candidate;
      const created = await createShopWithOwner(c.env, {
        shopName: body.name,
        city: body.city || null,
        ownerName: candidate.name ?? body.ownerName,
        phone: body.ownerPhone,
        pin: candidate.pin,
        businessId: c.get('businessId'),
      });
      await joinRequestRepo.cancelOpenForPhone(platform, body.ownerPhone, new Date());
      return created;
    });
    if (result === null) return c.json(phoneBusy, 409);
    if ('problem' in result) return c.json(result.problem.body, result.problem.status);
    return c.json({ id: result.shop.id, code: result.shop.code, name: result.shop.name }, 201);
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
      await joinRequestRepo.cancelOpenForPhone(platform, body.phone, new Date());
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
    zValidator('json', planSchema.partial().extend({ active: z.boolean().optional(), sortOrder: z.number().int().min(0).max(1000).optional() })),
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
