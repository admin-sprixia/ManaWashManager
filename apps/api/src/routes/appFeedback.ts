import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { customerCareRepo } from '@mana/db';
import { PROBLEM_RESOLUTION_MAX, type ProblemKind } from '@mana/domain';
import { requireAuth } from '../middleware/auth';
import type { Env } from '../types';

const idParam = z.object({ id: z.string().min(1).max(64) });
const problemsQuery = z.object({ filter: z.enum(['open', 'resolved']).default('open') });
const vehiclesQuery = z.object({ filter: z.enum(['pending', 'handled']).default('pending') });
const ratingsQuery = z.object({
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
const resolveSchema = z.object({
  resolution: z.string().trim().min(2, 'Say what was done, in a few words').max(PROBLEM_RESOLUTION_MAX),
});
const rejectSchema = z.object({ reason: z.string().trim().min(2, 'Say why, in a few words').max(200) });

const notFound = { error: 'not_found' as const, message: 'This isn’t available any more.' };
const alreadyHandled = { error: 'already_handled' as const, message: 'Someone already handled this.' };

const washers = (job: { washers: { user: { name: string } }[] } | null) => job?.washers.map((w) => w.user.name) ?? [];

// What customers send from the MANA Car Wash app: problem reports, ratings, and vehicles they ask
// to add. The whole team sees them and can act — the person at the counter is usually the one
// who sorts it out.
export const appFeedbackRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  .get('/problems', zValidator('query', problemsQuery), async (c) => {
    const rows = await customerCareRepo.listProblems(c.get('db'), c.req.valid('query').filter);
    return c.json({
      problems: rows.map((p) => ({
        id: p.id,
        kind: p.kind as ProblemKind,
        details: p.details,
        status: p.status as 'open' | 'resolved',
        resolution: p.resolution,
        resolvedAt: p.resolvedAt?.toISOString() ?? null,
        resolvedBy: p.resolvedBy,
        createdAt: p.createdAt.toISOString(),
        customer: p.customer,
        wash: p.job
          ? {
              id: p.job.id,
              createdAt: p.job.createdAt.toISOString(),
              total: p.job.total,
              registrationNumber: p.job.vehicle.registrationNumber,
              washers: washers(p.job),
            }
          : null,
      })),
    });
  })
  .post('/problems/:id/resolve', zValidator('param', idParam), zValidator('json', resolveSchema), async (c) => {
    const db = c.get('db');
    const id = c.req.valid('param').id;
    const ok = await customerCareRepo.resolveProblem(db, id, {
      userId: c.get('session').sub,
      resolution: c.req.valid('json').resolution,
      now: new Date(),
    });
    if (ok) return c.json({ ok: true as const });
    return (await customerCareRepo.problemExists(db, id)) ? c.json(alreadyHandled, 409) : c.json(notFound, 404);
  })
  .get('/ratings', zValidator('query', ratingsQuery), async (c) => {
    const { before, limit } = c.req.valid('query');
    const { rows, last30 } = await customerCareRepo.listRatings(
      c.get('db'),
      before ? new Date(before) : null,
      limit,
      new Date(),
    );
    const ratings = rows.map((r) => ({
      washId: r.jobId,
      stars: r.stars,
      comment: r.comment,
      ratedAt: r.updatedAt.toISOString(),
      customer: r.customer,
      washedAt: r.job.createdAt.toISOString(),
      registrationNumber: r.job.vehicle.registrationNumber,
      washers: washers(r.job),
    }));
    return c.json({
      ratings,
      last30,
      nextBefore: rows.length === limit ? ratings[ratings.length - 1]!.ratedAt : null,
    });
  })
  .get('/vehicles', zValidator('query', vehiclesQuery), async (c) => {
    const rows = await customerCareRepo.listVehicleRequests(c.get('db'), c.req.valid('query').filter);
    return c.json({
      requests: rows.map((r) => ({
        id: r.id,
        registrationNumber: r.registrationNumber,
        make: r.make,
        model: r.model,
        type: r.vehicleType,
        status: r.status as 'pending' | 'approved' | 'rejected',
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
        handledAt: r.handledAt?.toISOString() ?? null,
        handledBy: r.handledBy,
        customer: r.customer,
        /** Someone else's vehicle at this branch today: approving moves it to this customer. */
        currentOwner: r.currentOwner,
      })),
    });
  })
  .post('/vehicles/:id/approve', zValidator('param', idParam), async (c) => {
    const result = await customerCareRepo.approveVehicleRequest(c.get('db'), c.req.valid('param').id, {
      userId: c.get('session').sub,
      now: new Date(),
    });
    if (result === 'not_found') return c.json(notFound, 404);
    if (result === 'already_handled') return c.json(alreadyHandled, 409);
    return c.json({ ok: true as const });
  })
  .post('/vehicles/:id/reject', zValidator('param', idParam), zValidator('json', rejectSchema), async (c) => {
    const result = await customerCareRepo.rejectVehicleRequest(c.get('db'), c.req.valid('param').id, {
      userId: c.get('session').sub,
      reason: c.req.valid('json').reason,
      now: new Date(),
    });
    if (result === 'not_found') return c.json(notFound, 404);
    if (result === 'already_handled') return c.json(alreadyHandled, 409);
    return c.json({ ok: true as const });
  });
