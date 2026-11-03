import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { serviceAreaRepo } from '@mana/db';
import {
  clockMinutes,
  isValidClock,
  MAX_WEEKLY_OFF_DAYS,
  normalizePhone,
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
    /** The first closed day (older apps send just this). */
    weeklyOff: z.number().int().min(0).max(6).nullable().optional(),
    /** Every closed day; the branch opens at least one day a week. */
    weeklyOffDays: z.array(z.number().int().min(0).max(6)).max(MAX_WEEKLY_OFF_DAYS, 'Leave at least one day open').optional(),
  })
  .refine((h) => (h.opensAt == null) === (h.closesAt == null), 'Set both opening and closing times, or neither')
  .refine(
    (h) => h.opensAt == null || h.closesAt == null || clockMinutes(h.closesAt) > clockMinutes(h.opensAt),
    'Closing time must be after opening time',
  );

// This branch's contact details and hours (shown on WhatsApp and bills), and where it washes (the
// hub with a radius). Owner only.
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
    const { weeklyOff, weeklyOffDays, ...rest } = c.req.valid('json');
    const days = weeklyOffDays ?? (weeklyOff != null ? [weeklyOff] : []);
    if (new Set(days).size > MAX_WEEKLY_OFF_DAYS) return c.json({ error: 'invalid' as const, message: 'Leave at least one day open.' }, 400);
    await serviceAreaRepo.setContact(db, { ...rest, weeklyOffDays: days });
    return c.json(await serviceAreaRepo.get(db));
  });
