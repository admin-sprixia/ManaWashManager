import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { catalogRepo, createPlatformDb, createShopDb, paymentRepo, placeOrderRepo, placeRepo, planRepo, businessRules } from '@mana/db';
import {
  BEST_TIME_LABEL,
  CONTACT_NAME_MAX,
  INSPECTION_COUNT_MAX,
  PARKING_LABEL,
  PERMISSION_LABEL,
  POWER_LABEL,
  SPACE_LABEL,
  WATER_LABEL,
  isClockTime,
  istDay,
  isValidRegistration,
  MAX_PHOTO_BYTES,
  MAX_PLACE_TEAM,
  MAX_PROPOSED_SLOTS,
  normalizePhone,
  normalizeRegistration,
  PARKING_NOTE_MAX,
  parseUnitList,
  PLACE_CAPACITY_MAX,
  PLACE_LABEL_MAX,
  PLACE_LABEL_MIN,
  PLACE_NAME_MAX,
  PLACE_NOTES_MAX,
  PLACE_PHOTO_KINDS,
  PLACE_TYPES,
  REVIEW_NOTE_MAX,
  UNIT_BLOCK_MAX,
  VEHICLE_MAKE_MAX,
  type PlacePhotoKind,
  type PlaceType,
} from '@mana/domain';
import { checkPhoneCode, sendPhoneCode } from '../lib/phoneCode';
import { cancelOrder, paymentLinkMessage, paymentsNotReady, startPayment } from '../lib/placePayments';
import { daySchema, idSchema, joinFields, joinInput, PLACE_PHOTO_TYPES, placeError, placePhotoType, pointSchema } from '../lib/places';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';

/**
 * The team's side of places: setting a place up (pin, photo, label, wash days, flats), its
 * members (confirm, remove, add someone without a smartphone and send them a payment link),
 * the wash-day list (paid or not, record each vehicle), and where people are asking for us.
 * Setting up and refunds are for owners; the wash-day work is for everyone on the team.
 */

const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((p) => /^[6-9]\d{9}$/.test(p), 'Enter a valid 10-digit mobile number');
const washDaysSchema = z.array(z.number().int().min(0).max(6)).min(1, 'Pick at least one wash day').max(7);
const placeFields = {
  type: z.enum(PLACE_TYPES as [string, ...string[]]),
  name: z.string().trim().max(PLACE_NAME_MAX).nullish(),
  label: z.string().trim().min(PLACE_LABEL_MIN, 'Add a short label people know it by').max(PLACE_LABEL_MAX),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  washDays: washDaysSchema,
  washTime: z.string().refine(isClockTime, 'Pick the wash time'),
  needsApproval: z.boolean().default(false),
  capacity: z.number().int().min(1).max(PLACE_CAPACITY_MAX).nullish(),
};
const slotsSchema = z
  .array(z.object({ days: washDaysSchema, time: z.string().refine(isClockTime, 'Pick the time') }))
  .max(MAX_PROPOSED_SLOTS);
const answer = <T extends string>(labels: Readonly<Record<T, string>>) => z.enum(Object.keys(labels) as [T, ...T[]]).optional();
const vehicleCount = z.number().int().min(0).max(INSPECTION_COUNT_MAX).optional();
const inspectionSchema = z.object({
  water: answer(WATER_LABEL),
  power: answer(POWER_LABEL),
  parking: answer(PARKING_LABEL),
  space: answer(SPACE_LABEL),
  permission: answer(PERMISSION_LABEL),
  cars: vehicleCount,
  bikes: vehicleCount,
  bestTime: answer(BEST_TIME_LABEL),
});
const setupFields = {
  type: placeFields.type,
  name: placeFields.name,
  label: placeFields.label,
  latitude: placeFields.latitude,
  longitude: placeFields.longitude,
  notes: z.string().trim().max(PLACE_NOTES_MAX).nullish(),
  contactName: z.string().trim().max(CONTACT_NAME_MAX).nullish(),
  contactPhone: phoneSchema.nullish().or(z.literal('').transform(() => null)),
  inspection: inspectionSchema.default({}),
  slots: slotsSchema.default([]),
};
const createPlaceSchema = z.object(setupFields);
const updateSetupSchema = z.object({
  type: setupFields.type.optional(),
  name: setupFields.name,
  label: setupFields.label.optional(),
  latitude: setupFields.latitude.optional(),
  longitude: setupFields.longitude.optional(),
  notes: setupFields.notes,
  contactName: setupFields.contactName,
  contactPhone: setupFields.contactPhone,
  inspection: inspectionSchema.optional(),
  slots: slotsSchema.optional(),
});
const teamSchema = z.array(idSchema).max(MAX_PLACE_TEAM);
const goLiveSchema = z.object({
  washDays: washDaysSchema,
  washTime: placeFields.washTime,
  teamUserIds: teamSchema.default([]),
  needsApproval: z.boolean().default(false),
  capacity: placeFields.capacity,
});
const photoForm = z.object({
  file: z.instanceof(File, { message: 'Attach a photo' }),
  kind: z.enum(PLACE_PHOTO_KINDS as [PlacePhotoKind, ...PlacePhotoKind[]]).default('other'),
});
const updatePlaceSchema = z.object({
  type: placeFields.type.optional(),
  name: placeFields.name,
  label: placeFields.label.optional(),
  latitude: placeFields.latitude.optional(),
  longitude: placeFields.longitude.optional(),
  washDays: washDaysSchema.optional(),
  washTime: placeFields.washTime.optional(),
  needsApproval: z.boolean().optional(),
  capacity: placeFields.capacity,
  status: z.enum(['active', 'paused', 'closed']).optional(),
});
const unitsSchema = z.object({
  block: z.string().trim().max(UNIT_BLOCK_MAX).nullish(),
  numbers: z.string().trim().min(1, 'Type the flat numbers, e.g. 101-110, 201-210').max(4000),
});
const visitSchema = z.object({
  orderId: idSchema,
  date: daySchema,
  outcome: z.enum(['done', 'not_found', 'missed']),
  note: z.string().trim().max(200).nullish(),
  plate: z
    .object({
      registrationNumber: z.string().transform(normalizeRegistration).refine(isValidRegistration, 'Enter the number, e.g. AP39AB1234'),
      make: z.string().trim().max(VEHICLE_MAKE_MAX).nullish(),
      model: z.string().trim().max(VEHICLE_MAKE_MAX).nullish(),
    })
    .nullish(),
  /** Where the washer's phone was, to check they were at the community. */
  at: pointSchema.nullish(),
});
const staffJoinSchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the code they received'),
  ...joinFields,
});
const reasonSchema = z.object({ reason: z.string().trim().max(200).nullish() });
const placeParam = z.object({ id: idSchema });

function badPhoto(file: File) {
  if (!PLACE_PHOTO_TYPES[file.type]) return { error: 'bad_type' as const, message: 'Use a JPEG, PNG or WebP photo.' };
  if (file.size === 0 || file.size > MAX_PHOTO_BYTES) return { error: 'too_large' as const, message: 'That photo is too large.' };
  return null;
}

async function servePhoto(c: Context<{ Bindings: Env }>, key: string | null) {
  const object = key ? await c.env.PHOTOS.get(key) : null;
  if (!key || !object) return c.json({ error: 'not_found' as const }, 404);
  return c.body(object.body, 200, { 'Content-Type': placePhotoType(key), 'Cache-Control': 'private, max-age=3600' });
}

export const placeRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  // ---------- Places ----------
  .get('/', async (c) => {
    const places = await placeRepo.list(c.env.DB, c.get('session').shopId, new Date());
    return c.json({ places });
  })
  /** Anyone on the team saves a new community as a draft after visiting it. */
  .post('/', zValidator('json', createPlaceSchema), async (c) => {
    const session = c.get('session');
    const body = c.req.valid('json');
    const created = await placeRepo.create(
      c.env.DB,
      session.shopId,
      {
        ...body,
        type: body.type as PlaceType,
        name: body.name || null,
        notes: body.notes || null,
        contactName: body.contactName || null,
        contactPhone: body.contactPhone || null,
      },
      session.sub,
    );
    return c.json(created, 201);
  })
  /** The communities hub: every live community over the coming days, and today's progress. */
  .get(
    '/overview',
    zValidator('query', z.object({ from: daySchema.optional(), days: z.coerce.number().int().min(1).max(14).default(7) })),
    async (c) => {
      const now = new Date();
      const { from, days } = c.req.valid('query');
      return c.json(await placeRepo.overview(c.env.DB, c.get('session').shopId, from ?? istDay(now), days, now));
    },
  )
  /** Who can be put on a community's team. */
  .get('/team', async (c) => {
    const users = await c.get('db').user.findMany({
      where: { active: true, removedAt: null },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, role: true },
    });
    return c.json({ users });
  })
  /** A customer's running community plans, for New Wash to offer a plan wash at the shop. */
  .get('/shop-plans', zValidator('query', z.object({ phone: phoneSchema })), async (c) => {
    const plans = await placeOrderRepo.shopPlans(c.env.DB, c.get('session').shopId, c.req.valid('query').phone, new Date());
    return c.json({ plans });
  })
  /** Where people are asking for us: "Call me back" requests grouped by place. */
  .get('/demand', async (c) => {
    return c.json(await placeRepo.demand(c.env.DB, c.get('session').shopId));
  })
  /** What a member can buy here (plans and washes per vehicle type), for adding someone (Flow E). */
  .get('/menu', async (c) => {
    const shopId = c.get('session').shopId;
    const pdb = createPlatformDb(c.env.DB);
    const businessId = await catalogRepo.businessForShop(c.env.DB, shopId);
    const rules = await businessRules(pdb, businessId);
    return c.json({ menu: await planRepo.menu(pdb, shopId, businessId, rules.priceMode), rules });
  })
  .get('/:id', zValidator('param', placeParam), async (c) => {
    const id = c.req.valid('param').id;
    const place = await placeRepo.detail(c.env.DB, c.get('session').shopId, id, new Date());
    if (!place) return c.json({ error: 'not_found' as const, message: 'Place not found.' }, 404);
    return c.json({ place, units: await placeRepo.units(c.get('db'), id) });
  })
  /**
   * What the inspection found. Drafts are open to the whole team; once live, only the owner
   * changes them (the team can still add notes and photos).
   */
  .patch('/:id/setup', zValidator('param', placeParam), zValidator('json', updateSetupSchema), async (c) => {
    const session = c.get('session');
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    const place = await placeRepo.find(c.get('db'), id);
    if (!place) return c.json({ error: 'not_found' as const, message: 'Place not found.' }, 404);
    if (session.role !== 'owner') {
      if (place.stage === 'review') {
        return c.json({ error: 'not_allowed' as const, message: 'It’s with the owner now. They can send it back if anything needs changing.' }, 403);
      }
      if (place.stage === 'live' && Object.keys(body).some((k) => k !== 'notes')) {
        return c.json({ error: 'not_allowed' as const, message: 'Only the owner can change a live community. You can add notes and photos.' }, 403);
      }
    }
    try {
      await placeRepo.updateSetup(c.env.DB, session.shopId, id, {
        ...body,
        type: body.type as PlaceType | undefined,
        name: body.name === undefined ? undefined : body.name || null,
        notes: body.notes === undefined ? undefined : body.notes || null,
        contactName: body.contactName === undefined ? undefined : body.contactName || null,
        contactPhone: body.contactPhone === undefined ? undefined : body.contactPhone || null,
      });
      return c.json({ ok: true as const });
    } catch (e) {
      return placeError(c, e);
    }
  })
  .post('/:id/submit', zValidator('param', placeParam), async (c) => {
    try {
      await placeRepo.submit(c.env.DB, c.get('session').shopId, c.req.valid('param').id);
      return c.json({ ok: true as const });
    } catch (e) {
      return placeError(c, e);
    }
  })
  .post(
    '/:id/send-back',
    requireRole('owner'),
    zValidator('param', placeParam),
    zValidator('json', z.object({ note: z.string().trim().min(3, 'Say what needs fixing').max(REVIEW_NOTE_MAX) })),
    async (c) => {
      const session = c.get('session');
      try {
        await placeRepo.sendBack(c.env.DB, session.shopId, c.req.valid('param').id, c.req.valid('json').note, session.sub);
        return c.json({ ok: true as const });
      } catch (e) {
        return placeError(c, e);
      }
    },
  )
  /** The owner makes a community live; nearby people who asked for us are invited. */
  .post('/:id/go-live', requireRole('owner'), zValidator('param', placeParam), zValidator('json', goLiveSchema), async (c) => {
    const session = c.get('session');
    const id = c.req.valid('param').id;
    const body = c.req.valid('json');
    try {
      await placeRepo.goLive(c.env.DB, session.shopId, id, { ...body, capacity: body.capacity ?? null }, session.sub);
      return c.json({ ok: true as const, invited: await placeRepo.invite(c.env.DB, session.shopId, id) });
    } catch (e) {
      return placeError(c, e);
    }
  })
  .put('/:id/team', requireRole('owner'), zValidator('param', placeParam), zValidator('json', z.object({ userIds: teamSchema })), async (c) => {
    try {
      await placeRepo.setTeam(c.env.DB, c.get('session').shopId, c.req.valid('param').id, c.req.valid('json').userIds);
      return c.json({ ok: true as const });
    } catch (e) {
      return placeError(c, e);
    }
  })
  .patch('/:id', requireRole('owner'), zValidator('param', placeParam), zValidator('json', updatePlaceSchema), async (c) => {
    const body = c.req.valid('json');
    try {
      await placeRepo.update(c.env.DB, c.get('session').shopId, c.req.valid('param').id, {
        ...body,
        type: body.type as (typeof PLACE_TYPES)[number] | undefined,
        name: body.name === undefined ? undefined : body.name || null,
      });
      return c.json({ ok: true as const });
    } catch (e) {
      return placeError(c, e);
    }
  })
  .get('/:id/photo', zValidator('param', placeParam), async (c) => {
    const place = await placeRepo.find(c.get('db'), c.req.valid('param').id);
    return servePhoto(c, place?.photoKey ?? null);
  })
  /** Photos from the inspection (gate, parking, water point…). The first becomes the cover. */
  .post('/:id/photos', zValidator('param', placeParam), zValidator('form', photoForm), async (c) => {
    const session = c.get('session');
    const id = c.req.valid('param').id;
    const { file, kind } = c.req.valid('form');
    const bad = badPhoto(file);
    if (bad) return c.json(bad, 400);
    const key = `shops/${session.shopId}/places/${id}-${Date.now()}.${PLACE_PHOTO_TYPES[file.type]}`;
    await c.env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    try {
      return c.json(await placeRepo.addPhoto(c.env.DB, session.shopId, id, kind, key, session.sub), 201);
    } catch (e) {
      await c.env.PHOTOS.delete(key);
      return placeError(c, e);
    }
  })
  .get('/:id/photos/:photoId', zValidator('param', z.object({ id: idSchema, photoId: idSchema })), async (c) => {
    const { id, photoId } = c.req.valid('param');
    return servePhoto(c, await placeRepo.photoKeyOf(c.get('db'), id, photoId));
  })
  .delete('/:id/photos/:photoId', zValidator('param', z.object({ id: idSchema, photoId: idSchema })), async (c) => {
    const { id, photoId } = c.req.valid('param');
    const key = await placeRepo.removePhoto(c.env.DB, c.get('session').shopId, id, photoId);
    if (!key) return c.json({ error: 'not_found' as const, message: 'Photo not found.' }, 404);
    await c.env.PHOTOS.delete(key);
    return c.json({ ok: true as const });
  })
  .post('/:id/units', requireRole('owner'), zValidator('param', placeParam), zValidator('json', unitsSchema), async (c) => {
    const body = c.req.valid('json');
    const numbers = parseUnitList(body.numbers);
    if (!numbers?.length) {
      return c.json({ error: 'invalid' as const, message: 'Couldn’t read those numbers. Try “101-110, 201-210”.' }, 400);
    }
    try {
      const added = await placeRepo.addUnits(c.env.DB, c.get('session').shopId, c.req.valid('param').id, body.block || null, numbers);
      return c.json({ added, units: await placeRepo.units(c.get('db'), c.req.valid('param').id) });
    } catch (e) {
      return placeError(c, e);
    }
  })
  .delete('/:id/units/:unitId', requireRole('owner'), zValidator('param', z.object({ id: idSchema, unitId: idSchema })), async (c) => {
    const { id, unitId } = c.req.valid('param');
    const ok = await placeRepo.archiveUnit(c.env.DB, c.get('session').shopId, id, unitId);
    return ok ? c.json({ ok: true as const }) : c.json({ error: 'not_found' as const, message: 'Flat not found.' }, 404);
  })
  .post('/:id/invite', requireRole('owner'), zValidator('param', placeParam), async (c) => {
    try {
      return c.json({ invited: await placeRepo.invite(c.env.DB, c.get('session').shopId, c.req.valid('param').id) });
    } catch (e) {
      return placeError(c, e);
    }
  })

  // ---------- Members ----------
  .get(
    '/:id/members',
    zValidator('param', placeParam),
    zValidator('query', z.object({ filter: z.enum(['live', 'past']).default('live') })),
    async (c) => {
      try {
        const members = await placeRepo.members(c.env.DB, c.get('session').shopId, c.req.valid('param').id, c.req.valid('query').filter, new Date());
        return c.json({ members });
      } catch (e) {
        return placeError(c, e);
      }
    },
  )
  /** Flow E, step 1: a WhatsApp code to the person's phone; they read it out to the team. */
  .post('/:id/members/code', zValidator('param', placeParam), zValidator('json', z.object({ phone: phoneSchema })), async (c) => {
    const { phone } = c.req.valid('json');
    const sent = await sendPhoneCode({
      env: c.env,
      requestUrl: c.req.url,
      ip: c.req.header('cf-connecting-ip') ?? null,
      phone,
      purpose: 'customer',
      subject: `customer:${phone}`,
    });
    if (!sent.ok) return c.json(sent.body, sent.status);
    return c.json(sent.body);
  })
  /** Flow E, step 2: the code proves the number; the team joins them with flat, vehicles and plan. */
  .post('/:id/members', zValidator('param', placeParam), zValidator('json', staffJoinSchema), async (c) => {
    const body = c.req.valid('json');
    const session = c.get('session');
    const place = await placeRepo.find(c.get('db'), c.req.valid('param').id);
    if (!place) return c.json({ error: 'not_found' as const, message: 'Place not found.' }, 404);
    const checked = await checkPhoneCode({ env: c.env, phone: body.phone, purpose: 'customer', subject: `customer:${body.phone}`, code: body.code });
    if (!checked.ok) return c.json(checked.body, checked.status);
    try {
      const joined = await placeOrderRepo.join(
        c.env.DB,
        joinInput(body, { placeId: place.id, phone: body.phone, distanceM: null, byUserId: session.sub, via: 'staff' }),
      );
      return c.json(joined, 201);
    } catch (e) {
      return placeError(c, e);
    }
  })
  .post('/members/:id/approve', zValidator('param', placeParam), async (c) => {
    const session = c.get('session');
    const ok = await placeRepo.approve(c.env.DB, session.shopId, c.req.valid('param').id, session.sub);
    return ok ? c.json({ ok: true as const }) : c.json({ error: 'not_open' as const, message: 'Already handled.' }, 409);
  })
  .post('/members/:id/clear-checks', zValidator('param', placeParam), async (c) => {
    const session = c.get('session');
    const ok = await placeRepo.clearChecks(c.env.DB, session.shopId, c.req.valid('param').id, session.sub);
    return ok ? c.json({ ok: true as const }) : c.json({ error: 'not_open' as const, message: 'Already handled.' }, 409);
  })
  .patch(
    '/members/:id',
    zValidator('param', placeParam),
    zValidator('json', z.object({ parkingNote: z.string().trim().max(PARKING_NOTE_MAX).nullable() })),
    async (c) => {
      const ok = await placeRepo.setParkingNote(c.env.DB, c.get('session').shopId, c.req.valid('param').id, c.req.valid('json').parkingNote || null);
      return ok ? c.json({ ok: true as const }) : c.json({ error: 'not_found' as const, message: 'Member not found.' }, 404);
    },
  )
  /** Takes someone off the place; their live orders are cancelled and refunded by the refund rule. */
  .post('/members/:id/remove', zValidator('param', placeParam), zValidator('json', reasonSchema), async (c) => {
    const session = c.get('session');
    const reason = c.req.valid('json').reason || 'Removed by the team';
    const ended = await placeRepo.end(c.env.DB, session.shopId, c.req.valid('param').id, { status: 'removed', reason, byUserId: session.sub });
    if (!ended) return c.json({ error: 'not_open' as const, message: 'Already removed.' }, 409);
    let refunded = 0;
    for (const orderId of ended.orderIds) refunded += (await cancelOrder(c.env, session.shopId, orderId, 'staff', reason))?.refunded ?? 0;
    return c.json({ ok: true as const, refunded });
  })

  // ---------- Wash days ----------
  .get('/:id/day/:day', zValidator('param', z.object({ id: idSchema, day: daySchema })), async (c) => {
    const { id, day } = c.req.valid('param');
    try {
      return c.json(await placeRepo.washDay(c.env.DB, c.get('session').shopId, id, day, new Date()));
    } catch (e) {
      return placeError(c, e);
    }
  })
  .post('/:id/visits', zValidator('param', placeParam), zValidator('json', visitSchema), async (c) => {
    const session = c.get('session');
    const body = c.req.valid('json');
    try {
      const result = await placeOrderRepo.recordVisit(c.env.DB, session.shopId, {
        placeId: c.req.valid('param').id,
        orderId: body.orderId,
        date: body.date,
        outcome: body.outcome,
        byUserId: session.sub,
        note: body.note || null,
        plate: body.plate ? { registrationNumber: body.plate.registrationNumber, make: body.plate.make || null, model: body.plate.model || null } : null,
        at: body.at ?? null,
        now: new Date(),
      });
      return c.json(result, 201);
    } catch (e) {
      return placeError(c, e);
    }
  })
  /** The "after" photo of a washed vehicle. */
  .post(
    '/:id/visits/:visitId/photo',
    zValidator('param', z.object({ id: idSchema, visitId: idSchema })),
    zValidator('form', z.object({ file: z.instanceof(File, { message: 'Attach a photo' }) })),
    async (c) => {
      const shopId = c.get('session').shopId;
      const { id, visitId } = c.req.valid('param');
      const file = c.req.valid('form').file;
      const bad = badPhoto(file);
      if (bad) return c.json(bad, 400);
      const key = `shops/${shopId}/visits/${visitId}-${Date.now()}.${PLACE_PHOTO_TYPES[file.type]}`;
      await c.env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
      try {
        const old = await placeOrderRepo.setVisitPhoto(c.env.DB, shopId, id, visitId, key);
        if (old) await c.env.PHOTOS.delete(old);
        return c.json({ ok: true as const });
      } catch (e) {
        await c.env.PHOTOS.delete(key);
        return placeError(c, e);
      }
    },
  )
  .get('/:id/visits/:visitId/photo', zValidator('param', z.object({ id: idSchema, visitId: idSchema })), async (c) => {
    const { id, visitId } = c.req.valid('param');
    return servePhoto(c, await placeOrderRepo.visitPhotoKey(c.get('db'), id, visitId));
  })
  .delete('/:id/visits/:visitId', zValidator('param', z.object({ id: idSchema, visitId: idSchema })), async (c) => {
    const { id, visitId } = c.req.valid('param');
    try {
      await placeOrderRepo.undoVisit(c.env.DB, c.get('session').shopId, id, visitId, new Date());
      return c.json({ ok: true as const });
    } catch (e) {
      return placeError(c, e);
    }
  })

  // ---------- Orders and payments ----------
  .get('/orders/:id', zValidator('param', placeParam), async (c) => {
    const shopId = c.get('session').shopId;
    const id = c.req.valid('param').id;
    const order = await placeOrderRepo.detail(c.env.DB, shopId, id, new Date());
    if (!order) return c.json({ error: 'not_found' as const, message: 'Order not found.' }, 404);
    const db = createShopDb(c.env.DB, shopId);
    const [payments, refunds] = await Promise.all([paymentRepo.forOrder(db, id), paymentRepo.refundsFor(db, id)]);
    return c.json({
      order,
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        status: p.status,
        provider: p.provider,
        refunded: p.refunded,
        receiptNo: p.receiptNo,
        createdBy: p.createdBy,
        createdAt: p.createdAt.toISOString(),
        paidAt: p.paidAt?.toISOString() ?? null,
      })),
      refunds: refunds.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), processedAt: r.processedAt?.toISOString() ?? null })),
    });
  })
  /** Flow E: a Razorpay link the team sends by WhatsApp; anyone can pay it from any phone. */
  .post('/orders/:id/payment-link', zValidator('param', placeParam), async (c) => {
    const shopId = c.get('session').shopId;
    const id = c.req.valid('param').id;
    try {
      const payment = await startPayment(c.env, c.req.url, shopId, id, 'staff');
      if (!payment) return c.json(paymentsNotReady, 503);
      const order = await placeOrderRepo.detail(c.env.DB, shopId, id, new Date());
      const customer = await createShopDb(c.env.DB, shopId).placeOrder.findUnique({
        where: { id },
        select: { customer: { select: { name: true, phone: true } } },
      });
      return c.json({
        payment,
        phone: customer?.customer.phone ?? null,
        message: paymentLinkMessage({
          name: customer?.customer.name ?? null,
          amount: payment.amount,
          title: order?.title ?? 'wash',
          place: order?.place.label ?? '',
          url: payment.url,
        }),
      });
    } catch (e) {
      return placeError(c, e);
    }
  })
  .post('/orders/:id/cancel', requireRole('owner'), zValidator('param', placeParam), zValidator('json', reasonSchema), async (c) => {
    const result = await cancelOrder(c.env, c.get('session').shopId, c.req.valid('param').id, 'staff', c.req.valid('json').reason || null);
    if (!result) return c.json({ error: 'not_open' as const, message: 'This order has already ended.' }, 409);
    return c.json(result);
  });
