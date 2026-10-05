import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { serviceAreaRepo } from '@mana/db';
import {
  clockMinutes,
  isValidClock,
  normalizePhone,
  SERVICE_AREA_NAME_MAX,
  SERVICE_RADIUS_MAX_KM,
  SERVICE_RADIUS_MIN_KM,
} from '@mana/domain';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';

const hubSchema = z
  .object({
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    radiusKm: z
      .number()
      .min(SERVICE_RADIUS_MIN_KM, `At least ${SERVICE_RADIUS_MIN_KM} km`)
      .max(SERVICE_RADIUS_MAX_KM, `At most ${SERVICE_RADIUS_MAX_KM} km`)
      .nullable(),
  })
  .refine((h) => (h.latitude == null) === (h.longitude == null), 'Set both latitude and longitude, or neither')
  .refine((h) => h.radiusKm == null || h.latitude != null, 'Set the hub location before a radius');

const pincodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'A pincode has 6 digits')
  .nullish()
  .transform((v) => v ?? null);
const areaSchema = z.object({
  name: z.string().trim().min(2, 'Enter the area name').max(SERVICE_AREA_NAME_MAX),
  pincode: pincodeSchema,
});
const areaPatchSchema = z.object({
  name: z.string().trim().min(2, 'Enter the area name').max(SERVICE_AREA_NAME_MAX).optional(),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'A pincode has 6 digits')
    .nullable()
    .optional(),
  active: z.boolean().optional(),
});

const clockSchema = z
  .string()
  .refine(isValidClock, 'Use a 24-hour time like 08:00')
  .nullable();
const contactSchema = z
  .object({
    address: z
      .string()
      .trim()
      .max(300)
      .nullable()
      .transform((v) => v || null)
      .refine((v) => v == null || v.length >= 5, 'Enter the full address'),
    phone: z
      .string()
      .nullable()
      .transform((v) => (v ? normalizePhone(v) : null))
      .refine((v) => v == null || /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number'),
    opensAt: clockSchema,
    closesAt: clockSchema,
    weeklyOff: z.number().int().min(0).max(6).nullable(),
  })
  .refine((h) => (h.opensAt == null) === (h.closesAt == null), 'Set both opening and closing times, or neither')
  .refine(
    (h) => h.opensAt == null || h.closesAt == null || clockMinutes(h.closesAt) > clockMinutes(h.opensAt),
    'Closing time must be after opening time',
  );

const nameTaken = { error: 'name_taken' as const, message: 'You already have an area with this name.' };

// This branch in the MANA Car Wash app: its contact details and hours, and where it washes (the hub
// with a radius, and named areas as the backup). Owner only. Being listed in the app at all is decided by Sprixia (in_customer_app).
export const serviceAreaRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth, requireRole('owner'))
  .get('/', async (c) => c.json(await serviceAreaRepo.get(c.get('db'))))
  .put('/', zValidator('json', hubSchema), async (c) => {
    const db = c.get('db');
    await serviceAreaRepo.setHub(db, c.req.valid('json'));
    return c.json(await serviceAreaRepo.get(db));
  })
  .put('/contact', zValidator('json', contactSchema), async (c) => {
    const db = c.get('db');
    await serviceAreaRepo.setContact(db, c.req.valid('json'));
    return c.json(await serviceAreaRepo.get(db));
  })
  .post('/areas', zValidator('json', areaSchema), async (c) => {
    const area = await serviceAreaRepo.createArea(c.get('db'), c.req.valid('json'));
    if (!area) return c.json(nameTaken, 409);
    return c.json({ area }, 201);
  })
  .patch(
    '/areas/:id',
    zValidator('param', z.object({ id: z.string().min(1).max(64) })),
    zValidator('json', areaPatchSchema),
    async (c) => {
      const result = await serviceAreaRepo.updateArea(c.get('db'), c.req.valid('param').id, c.req.valid('json'));
      if (result === 'not_found') return c.json({ error: 'not_found' as const }, 404);
      if (result === 'name_taken') return c.json(nameTaken, 409);
      return c.json({ area: result });
    },
  );
