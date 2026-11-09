import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  customerRepo,
  directoryRepo,
  placeOrderRepo,
  vehicleRepo,
  type DirectoryCursor,
} from '@mana/db';
import { isValidPhone, isValidRegistration, normalizePhone, normalizeRegistration } from '@mana/domain';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';

const lookupQuerySchema = z.object({
  phone: z.string().optional(),
  registrationNumber: z.string().optional(),
});

/**
 * Each page loads its rows' customers and jobs with one `IN (…)` list of ids, and D1 refuses a
 * query with more than 100 bound parameters — so a page stays well under that whatever is asked.
 */
const DIRECTORY_PAGE_MAX = 80;

const directoryQuerySchema = z.object({
  /** `<ISO updatedAt>|<vehicleId>` from the previous page; omit for a full download. */
  cursor: z.string().max(120).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .default(DIRECTORY_PAGE_MAX)
    .transform((n) => Math.min(n, DIRECTORY_PAGE_MAX)),
});

function parseCursor(raw: string | undefined): DirectoryCursor | null {
  if (!raw) return null;
  const [iso, id = ''] = raw.split('|');
  const updatedAt = new Date(iso ?? '');
  return Number.isNaN(updatedAt.getTime()) ? null : { updatedAt, id };
}

/** Jobs per page on a customer's profile. */
const HISTORY_PAGE = 50;
const historyQuerySchema = z.object({ before: z.string().datetime({ offset: true }).optional() });

const createCustomerSchema = z.object({
  phone: z.string().min(10),
  name: z.string().trim().min(1, 'Customer name is required'),
  source: z.enum(['google', 'friend', 'board', 'instagram', 'other']).optional(),
  vehicle: z.object({
    registrationNumber: z.string().min(4),
    vehicleTypeId: z.string(),
    make: z.string().optional(),
    model: z.string().optional(),
  }),
});

const editCustomerSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter the customer’s name').max(60).optional(),
    /** null removes the number (the customer is then known by their vehicle number). */
    phone: z
      .string()
      .nullable()
      .transform((p) => (p ? normalizePhone(p) : null))
      .refine((p) => p === null || isValidPhone(p), 'Enter a valid 10-digit mobile number')
      .optional(),
  })
  .refine((b) => b.name !== undefined || b.phone !== undefined, 'Nothing to change');
const editVehicleSchema = z.object({
  registrationNumber: z.string().transform(normalizeRegistration).refine(isValidRegistration, 'Enter a valid vehicle number'),
});
const idParam = z.object({ id: z.string().min(1).max(64) });

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const customerRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  // The single most-used lookup in the app: type a phone or reg. number, get the customer back.
  .get('/lookup', zValidator('query', lookupQuerySchema), async (c) => {
    const { phone, registrationNumber } = c.req.valid('query');
    const db = c.get('db');

    if (registrationNumber) {
      const vehicle = await vehicleRepo.findByRegistration(db, registrationNumber);
      if (!vehicle) return c.json(null);
      const [customer, summary] = await Promise.all([
        customerRepo.findById(db, vehicle.customerId),
        customerRepo.visitSummary(db, vehicle.customerId),
      ]);
      return c.json({
        customer,
        vehicle,
        visitCount: summary.visitCount,
        lastVisit: summary.lastVisit,
      });
    }

    if (!phone) return c.json({ error: 'phone_or_registrationNumber_required' as const }, 400);

    const customer = await customerRepo.findByPhone(db, phone);
    if (!customer) return c.json(null);

    const [vehicles, summary] = await Promise.all([
      vehicleRepo.listForCustomer(db, customer.id),
      customerRepo.visitSummary(db, customer.id),
    ]);

    return c.json({
      customer,
      vehicles,
      visitCount: summary.visitCount,
      lastVisit: summary.lastVisit,
    });
  })
  // New Wash's offline customer directory. Phones page through rows changed after their cursor
  // (no cursor = full download) and keep the result on the device for instant suggestions.
  .get('/directory', zValidator('query', directoryQuerySchema), async (c) => {
    const { cursor, limit } = c.req.valid('query');
    const db = c.get('db');
    const entries = await directoryRepo.page(db, parseCursor(cursor), limit, { rewards: true });
    const last = entries[entries.length - 1];
    return c.json({
      entries,
      nextCursor: last ? `${last.updatedAt}|${last.vehicleId}` : (cursor ?? null),
      hasMore: entries.length === limit,
      serverTime: new Date().toISOString(),
    });
  })
  // Customer Profile screen: one customer's vehicles, their jobs a page at a time (pass
  // `before` = the last job's createdAt for older ones), and lifetime numbers.
  // `lifetimeSpend` only counts paid jobs (money actually collected); `visitCount`/`lastVisit`
  // count every job the same way `/lookup` above does, so the same customer shows identical
  // numbers whether seen from New Wash or their profile.
  .get('/:id', zValidator('query', historyQuerySchema), async (c) => {
    const db = c.get('db');
    const id = c.req.param('id');
    const { before } = c.req.valid('query');
    const [customer, vehicles, page, summary, communities] = await Promise.all([
      customerRepo.findById(db, id),
      vehicleRepo.listForCustomer(db, id),
      customerRepo.getHistory(db, id, {
        before: before ? new Date(before) : undefined,
        limit: HISTORY_PAGE + 1,
      }),
      customerRepo.visitSummary(db, id),
      before ? Promise.resolve([]) : placeOrderRepo.forCustomer(c.env.DB, c.get('session').shopId, id, new Date()),
    ]);
    if (!customer) return c.json(null);

    return c.json({
      customer,
      vehicles,
      history: page.slice(0, HISTORY_PAGE),
      hasMoreHistory: page.length > HISTORY_PAGE,
      communities,
      ...summary,
    });
  })
  // The profile's Edit (owner and manager): fix a name or a mistyped number. The number is where
  // the WhatsApp ready message and bill go, so a typo there sends them to someone else.
  .patch('/:id', requireRole('owner', 'manager'), zValidator('param', idParam), zValidator('json', editCustomerSchema), async (c) => {
    const result = await customerRepo.updateDetails(c.get('db'), c.req.valid('param').id, c.req.valid('json'));
    if (result === 'not_found') return c.json({ error: 'not_found' as const, message: 'Customer not found.' }, 404);
    if (result === 'phone_taken') {
      return c.json({ error: 'phone_taken' as const, message: 'Another customer already has this number.' }, 409);
    }
    return c.json({ customer: result });
  })
  // …and a mistyped vehicle number.
  .patch(
    '/:id/vehicles/:vehicleId',
    requireRole('owner', 'manager'),
    zValidator('param', z.object({ id: z.string().min(1).max(64), vehicleId: z.string().min(1).max(64) })),
    zValidator('json', editVehicleSchema),
    async (c) => {
      const { id, vehicleId } = c.req.valid('param');
      const result = await vehicleRepo.updateRegistration(c.get('db'), vehicleId, id, c.req.valid('json').registrationNumber);
      if (result === 'not_found') return c.json({ error: 'not_found' as const, message: 'Vehicle not found.' }, 404);
      if (result === 'taken') {
        return c.json({ error: 'registration_taken' as const, message: 'Another vehicle already has this number.' }, 409);
      }
      return c.json({ vehicle: result });
    },
  )
  // The owner moves a vehicle saved under the wrong customer (or a duplicate profile) to the
  // right one; its washes go with it.
  .post(
    '/:id/vehicles/:vehicleId/move',
    requireRole('owner'),
    zValidator('param', z.object({ id: z.string().min(1).max(64), vehicleId: z.string().min(1).max(64) })),
    zValidator('json', z.object({ toCustomerId: z.string().min(1).max(64) })),
    async (c) => {
      const { id, vehicleId } = c.req.valid('param');
      const result = await vehicleRepo.moveToCustomer(c.get('db'), vehicleId, id, c.req.valid('json').toCustomerId);
      if (result === 'same') return c.json({ error: 'same_customer' as const, message: 'It’s already this customer’s vehicle.' }, 400);
      if (result === 'not_found') return c.json({ error: 'not_found' as const, message: 'Vehicle or customer not found.' }, 404);
      return c.json({ ok: true as const, washes: result.washes });
    },
  )
  // Quick-add: a brand new customer and their first vehicle in one call (New Wash screen, step 2).
  .post('/', zValidator('json', createCustomerSchema), async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');

    const customer = await customerRepo.create(db, {
      phone: body.phone,
      name: body.name,
      source: body.source,
    });
    const vehicle = await vehicleRepo.create(db, {
      customerId: customer.id,
      registrationNumber: body.vehicle.registrationNumber,
      vehicleTypeId: body.vehicle.vehicleTypeId,
      make: body.vehicle.make,
      model: body.vehicle.model,
    });

    return c.json({ customer, vehicle }, 201);
  })
  // New Wash: find-or-create by phone + registration so returning customers and new plates both work.
  .post('/ensure', zValidator('json', createCustomerSchema), async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const registrationNumber = body.vehicle.registrationNumber
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');

    const existingVehicle = await vehicleRepo.findByRegistration(db, registrationNumber);
    if (existingVehicle) {
      let customer = await customerRepo.findById(db, existingVehicle.customerId);
      if (!customer) return c.json({ error: 'customer_missing' as const }, 500);
      if (customer.name !== body.name) {
        customer = await customerRepo.updateName(db, customer.id, body.name);
      }
      return c.json({ customer, vehicle: existingVehicle });
    }

    let customer = await customerRepo.findByPhone(db, body.phone);
    if (!customer) {
      customer = await customerRepo.create(db, {
        phone: body.phone,
        name: body.name,
        source: body.source,
      });
    } else if (customer.name !== body.name) {
      customer = await customerRepo.updateName(db, customer.id, body.name);
    }

    const vehicle = await vehicleRepo.create(db, {
      customerId: customer.id,
      registrationNumber,
      vehicleTypeId: body.vehicle.vehicleTypeId,
      make: body.vehicle.make,
      model: body.vehicle.model,
    });

    return c.json({ customer, vehicle }, 201);
  });
