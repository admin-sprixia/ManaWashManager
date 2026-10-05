import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { customerCareRepo, customerRepo, retryOnClash, serviceAreaRepo, serviceRequestRepo, type ServiceRequestRow } from '@mana/db';
import { isOpenRequest } from '@mana/domain';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';

const idParam = z.object({ id: z.string().min(1).max(64) });
const listQuery = z.object({ filter: z.enum(['open', 'handled']).default('open') });
const approveSchema = z.object({ name: z.string().trim().min(1, 'Enter their name').max(60).optional() });
const rejectSchema = z.object({ reason: z.string().trim().min(2, 'Say why, in a few words').max(200) });

const notFound = { error: 'not_found' as const, message: 'This request isn’t available any more.' };
const alreadyHandled = {
  error: 'already_handled' as const,
  message: 'Someone already handled this request.',
};

function view(r: ServiceRequestRow) {
  return {
    id: r.id,
    status: r.status as 'pending' | 'out_of_area' | 'approved' | 'rejected' | 'cancelled',
    phone: r.phone,
    name: r.name,
    location: r.latitude != null && r.longitude != null ? { latitude: r.latitude, longitude: r.longitude } : null,
    area: r.area,
    address: r.address,
    placeKind: r.placeKind,
    placeName: r.placeName,
    homeText: r.homeText,
    cars: r.cars,
    bikes: r.bikes,
    preferredTime: r.preferredTime,
    notes: r.notes,
    reason: r.reason,
    customerId: r.customerId,
    handledBy: r.handledBy,
    handledAt: r.handledAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export type ServiceRequestView = ReturnType<typeof view>;

// "Request service" from the MANA Car Wash app, as the team sees it. Anyone on the team can see
// requests (to call the person); only the owner approves or declines. Approving registers the
// person as a customer of this branch, which is what lets them sign in to the app.
export const serviceRequestRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  // For the More screen: whether to show the app section at all, and its badges.
  .get('/summary', async (c) => {
    const db = c.get('db');
    const [listed, open, care] = await Promise.all([
      serviceAreaRepo.isListed(db),
      serviceRequestRepo.countOpen(db),
      customerCareRepo.counts(db),
    ]);
    return c.json({ listed, open, ...care });
  })
  .get('/', zValidator('query', listQuery), async (c) => {
    const db = c.get('db');
    const [rows, open] = await Promise.all([
      serviceRequestRepo.list(db, c.req.valid('query').filter),
      serviceRequestRepo.countOpen(db),
    ]);
    return c.json({ requests: rows.map(view), open });
  })
  .post(
    '/:id/approve',
    requireRole('owner'),
    zValidator('param', idParam),
    zValidator('json', approveSchema),
    async (c) => {
      const db = c.get('db');
      const request = await serviceRequestRepo.findById(db, c.req.valid('param').id);
      if (!request) return c.json(notFound, 404);
      if (!isOpenRequest(request.status)) return c.json(alreadyHandled, 409);

      const name = c.req.valid('json').name ?? request.name;
      const customer = await retryOnClash(async () => {
        const existing = await customerRepo.findByPhone(db, request.phone);
        return existing ?? customerRepo.create(db, { phone: request.phone, name, source: 'app' });
      });
      const moved = await serviceRequestRepo.decide(db, request.id, {
        status: 'approved',
        byUserId: c.get('session').sub,
        now: new Date(),
        customerId: customer.id,
      });
      if (!moved) return c.json(alreadyHandled, 409);
      const updated = await serviceRequestRepo.findById(db, request.id);
      return c.json({ request: view(updated!) });
    },
  )
  .post(
    '/:id/reject',
    requireRole('owner'),
    zValidator('param', idParam),
    zValidator('json', rejectSchema),
    async (c) => {
      const db = c.get('db');
      const request = await serviceRequestRepo.findById(db, c.req.valid('param').id);
      if (!request) return c.json(notFound, 404);
      const moved = await serviceRequestRepo.decide(db, request.id, {
        status: 'rejected',
        byUserId: c.get('session').sub,
        now: new Date(),
        reason: c.req.valid('json').reason,
      });
      if (!moved) return c.json(alreadyHandled, 409);
      const updated = await serviceRequestRepo.findById(db, request.id);
      return c.json({ request: view(updated!) });
    },
  );
