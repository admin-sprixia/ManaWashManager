import type { Context } from 'hono';
import { z } from 'zod';
import { PlaceError, type JoinInput } from '@mana/db';
import { JOINED_VIA, MAX_EXTRAS, MAX_VEHICLES_PER_JOIN, PARKING_NOTE_MAX, UNIT_TEXT_MAX } from '@mana/domain';

/** What the places, plans and payments routes share: input shapes and error replies. */

export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, 'Invalid id');
export const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a day');
export const pointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const choiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plan'), planId: idSchema, payMode: z.enum(['full', 'parts']).default('full') }),
  z.object({ kind: z.literal('single'), serviceIds: z.array(idSchema).min(1).max(MAX_EXTRAS + 1) }),
]);

export const joinVehicleSchema = z
  .object({
    vehicleTypeId: idSchema.nullish(),
    vehicleId: idSchema.nullish(),
    choice: choiceSchema,
  })
  .refine((v) => !!v.vehicleTypeId !== !!v.vehicleId, 'Pick the vehicle type, or one of your vehicles');

export const unitSchema = z.union([
  z.object({ unitId: idSchema }),
  z.object({ text: z.string().trim().min(1, 'Type your flat or house number').max(UNIT_TEXT_MAX) }),
]);

export const joinFields = {
  name: z.string().trim().max(60).nullish(),
  unit: unitSchema.nullish(),
  location: pointSchema.nullish(),
  /** How the customer found the place. "staff" is never accepted from the app: the team route sets it. */
  via: z.enum(JOINED_VIA.filter((v) => v !== 'staff') as [string, ...string[]]).default('app'),
  parkingNote: z.string().trim().max(PARKING_NOTE_MAX).nullish(),
  vehicles: z.array(joinVehicleSchema).min(1, 'Add a vehicle').max(MAX_VEHICLES_PER_JOIN),
};

/** Place photos the team can upload, and the file extension each is stored under. */
export const PLACE_PHOTO_TYPES: Readonly<Record<string, string>> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export const placePhotoType = (key: string) =>
  Object.entries(PLACE_PHOTO_TYPES).find(([, ext]) => key.endsWith(`.${ext}`))?.[0] ?? 'image/jpeg';

const STATUS: Record<PlaceError['code'], 400 | 403 | 404 | 409> = {
  not_found: 404,
  invalid: 400,
  conflict: 409,
  not_allowed: 403,
  busy: 409,
};

/** The repos' validation errors as API errors; anything else is a real failure. */
export function placeError(c: Context, e: unknown) {
  if (!(e instanceof PlaceError)) throw e;
  return c.json({ error: e.code, message: e.message }, STATUS[e.code]);
}

type JoinBody = {
  name?: string | null;
  unit?: { unitId: string } | { text: string } | null;
  parkingNote?: string | null;
  via: string;
  vehicles: { vehicleTypeId?: string | null; vehicleId?: string | null; choice: JoinInput['vehicles'][number]['choice'] }[];
};

/** A validated join body as the repo takes it. */
export function joinInput(
  body: JoinBody,
  extra: { placeId: string; phone: string; distanceM: number | null; byUserId: string | null; via?: JoinInput['via'] },
): JoinInput {
  return {
    placeId: extra.placeId,
    phone: extra.phone,
    name: body.name || null,
    unit: body.unit ?? null,
    distanceM: extra.distanceM,
    via: extra.via ?? (body.via as JoinInput['via']),
    byUserId: extra.byUserId,
    parkingNote: body.parkingNote || null,
    vehicles: body.vehicles.map((v) => ({ vehicleTypeId: v.vehicleTypeId ?? null, vehicleId: v.vehicleId ?? null, choice: v.choice })),
    now: new Date(),
  };
}
