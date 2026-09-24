import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createDbClient, jobRepo, serviceRepo } from '@mana/db';
import {
  applyDiscount,
  assertTransition,
  calculatePrice,
  InvalidJobTransitionError,
  PriceNotFoundError,
  type JobStatus,
} from '@mana/domain';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  endOfIstDay,
  formatIstDateOnly,
  parseIstDateOnly,
  startOfIstDay,
  startOfIstDaysAgo,
  startOfIstMonth,
  startOfIstYear,
} from '../lib/istDate';
import type { Env } from '../types';

const createJobSchema = z
  .object({
    customerId: z.string(),
    vehicleId: z.string(),
    vehicleTypeId: z.string(),
    services: z
      .array(z.object({ serviceId: z.string(), quantity: z.number().int().positive().default(1) }))
      .min(1),
    discount: z.number().int().min(0).default(0),
    discountReason: z.string().trim().max(200).optional(),
  })
  // V1.0's own feature table: "discounts require a reason" — enforced here too, not just in
  // the app UI, so no client (including a future staff app) can silently apply a bare discount.
  .refine((data) => data.discount === 0 || Boolean(data.discountReason?.trim()), {
    message: 'discountReason is required when discount is greater than 0',
    path: ['discountReason'],
  });

const updateStatusSchema = z.object({ status: z.enum(['washing', 'ready', 'paid', 'void']) });
const markPaidSchema = z.object({ paymentMethod: z.enum(['cash', 'upi', 'other']) });

const statsQuerySchema = z
  .object({
    range: z.enum(['today', 'week', 'month', 'year', 'custom']).default('today'),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .superRefine((q, ctx) => {
    if (q.range !== 'custom') return;
    if (!q.from || !parseIstDateOnly(q.from)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'from must be YYYY-MM-DD', path: ['from'] });
    }
    if (!q.to || !parseIstDateOnly(q.to)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'to must be YYYY-MM-DD', path: ['to'] });
    }
  });

/** Resolve an owner report window as half-open `[from, to)` in absolute UTC instants. */
function resolveReportWindow(query: z.infer<typeof statsQuerySchema>): {
  from: Date;
  to: Date;
  label: string;
} | { error: string } {
  const now = new Date();
  if (query.range === 'today') {
    const from = startOfIstDay(now);
    return { from, to: endOfIstDay(now), label: 'Today' };
  }
  if (query.range === 'week') {
    const from = startOfIstDaysAgo(6, now);
    return { from, to: endOfIstDay(now), label: 'Last 7 days' };
  }
  if (query.range === 'month') {
    const from = startOfIstMonth(now);
    return { from, to: endOfIstDay(now), label: 'This month' };
  }
  if (query.range === 'year') {
    const from = startOfIstYear(now);
    return { from, to: endOfIstDay(now), label: 'This year' };
  }

  const from = parseIstDateOnly(query.from ?? '');
  const toStart = parseIstDateOnly(query.to ?? '');
  if (!from || !toStart) return { error: 'invalid_custom_range' };
  const to = endOfIstDay(toStart);
  if (from.getTime() >= to.getTime()) return { error: 'from_after_to' };
  // Guardrail: don't let a year+ custom range accidentally dump the whole DB into a phone.
  const maxMs = 366 * 24 * 60 * 60 * 1000;
  if (to.getTime() - from.getTime() > maxMs) return { error: 'range_too_long' };

  return {
    from,
    to,
    label: `${formatIstDateOnly(from)} → ${formatIstDateOnly(toStart)}`,
  };
}

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const jobRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  // The full "New Wash" step: price is calculated server-side from the current price list —
  // the client sends what was selected, never a total it computed itself. Both domain errors
  // (a service with no price set for this vehicle type; a discount larger than the subtotal)
  // come back as a clean 400, not a raw 500 — these are real day-one operator mistakes, not
  // exceptional server failures.
  .post('/', zValidator('json', createJobSchema), async (c) => {
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    const session = c.get('session');

    const vehicleType = await serviceRepo.getVehicleType(db, body.vehicleTypeId);
    if (!vehicleType) {
      return c.json({ error: 'vehicle_type_not_found' as const }, 400);
    }

    const catalog = await serviceRepo.listActive(
      db,
      vehicleType.category === 'bike' ? 'bike' : 'car',
    );
    const allowed = new Set(catalog.map((s) => s.id));
    const mismatched = body.services.find((s) => !allowed.has(s.serviceId));
    if (mismatched) {
      return c.json(
        {
          error: 'service_not_for_vehicle' as const,
          message: 'One or more selected services are not offered for this vehicle type.',
        },
        400,
      );
    }

    const prices = await serviceRepo.listPrices(db, body.vehicleTypeId);

    let breakdown: ReturnType<typeof calculatePrice>;
    try {
      breakdown = calculatePrice(body.services, body.vehicleTypeId, prices);
    } catch (e) {
      if (e instanceof PriceNotFoundError) {
        return c.json({ error: 'price_not_set' as const, message: e.message }, 400);
      }
      throw e;
    }

    let total: number;
    try {
      total = applyDiscount(breakdown.subtotal, body.discount);
    } catch (e) {
      return c.json(
        { error: 'invalid_discount' as const, message: e instanceof Error ? e.message : 'Invalid discount' },
        400,
      );
    }

    const job = await jobRepo.create(db, {
      customerId: body.customerId,
      vehicleId: body.vehicleId,
      createdByUserId: session.sub,
      subtotal: breakdown.subtotal,
      discount: body.discount,
      discountReason: body.discountReason,
      total,
      lineItems: breakdown.lineItems.map((li) => ({
        serviceId: li.serviceId,
        priceAtTime: li.unitPrice,
        quantity: li.quantity,
      })),
    });

    return c.json(job, 201);
  })
  .get('/today', async (c) => {
    const db = createDbClient(c.env.DB);
    return c.json(await jobRepo.listToday(db, startOfIstDay()));
  })
  // Owner reports: today / rolling 7 days / calendar month / calendar year / custom IST dates.
  // Window is always half-open [from, to) so day boundaries never double-count.
  .get('/stats', requireRole('owner'), zValidator('query', statsQuerySchema), async (c) => {
    const db = createDbClient(c.env.DB);
    const query = c.req.valid('query');
    const window = resolveReportWindow(query);
    if ('error' in window) {
      return c.json({ error: window.error }, 400);
    }

    const [stats, pendingNow] = await Promise.all([
      jobRepo.getStats(db, window.from, window.to),
      jobRepo.countPending(db),
    ]);

    return c.json({
      ...stats,
      pendingNow,
      range: query.range,
      label: window.label,
      from: formatIstDateOnly(window.from),
      to: formatIstDateOnly(new Date(window.to.getTime() - 1)),
    });
  })
  // Full export payload for PDF — same window as /stats, plus every job line in the period.
  .get('/stats/export', requireRole('owner'), zValidator('query', statsQuerySchema), async (c) => {
    const db = createDbClient(c.env.DB);
    const query = c.req.valid('query');
    const window = resolveReportWindow(query);
    if ('error' in window) {
      return c.json({ error: window.error }, 400);
    }

    const [stats, pendingNow, jobs] = await Promise.all([
      jobRepo.getStats(db, window.from, window.to),
      jobRepo.countPending(db),
      jobRepo.listForReport(db, window.from, window.to),
    ]);

    return c.json({
      generatedAt: new Date().toISOString(),
      range: query.range,
      label: window.label,
      from: formatIstDateOnly(window.from),
      to: formatIstDateOnly(new Date(window.to.getTime() - 1)),
      stats: { ...stats, pendingNow },
      jobs: jobs.map((job) => ({
        id: job.id,
        createdAt: job.createdAt.toISOString(),
        status: job.status,
        total: job.total,
        discount: job.discount,
        discountReason: job.discountReason,
        paymentMethod: job.paymentMethod,
        customerName: job.customer.name,
        customerPhone: job.customer.phone,
        registrationNumber: job.vehicle.registrationNumber,
        vehicleType: job.vehicle.vehicleType.name,
        services: job.jobServices.map((js) => js.service.name),
      })),
    });
  })
  // Job Board: Waiting -> Washing -> Ready. Invalid transitions (e.g. Waiting straight to Paid,
  // or two staff tapping the same job at once) are rejected by @mana/domain's assertTransition
  // and come back as a 409, not a crash — and a job id that no longer exists is a clean 404.
  .patch('/:id/status', zValidator('json', updateStatusSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);

    const job = await jobRepo.findById(db, id).catch(() => null);
    if (!job) return c.json({ error: 'job_not_found' as const }, 404);

    try {
      assertTransition(job.status as JobStatus, body.status);
    } catch (e) {
      if (e instanceof InvalidJobTransitionError) {
        return c.json({ error: 'invalid_transition' as const, message: e.message }, 409);
      }
      throw e;
    }

    return c.json(await jobRepo.updateStatus(db, id, body.status));
  })
  .post('/:id/pay', zValidator('json', markPaidSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);

    const job = await jobRepo.findById(db, id).catch(() => null);
    if (!job) return c.json({ error: 'job_not_found' as const }, 404);

    try {
      assertTransition(job.status as JobStatus, 'paid');
    } catch (e) {
      if (e instanceof InvalidJobTransitionError) {
        return c.json({ error: 'invalid_transition' as const, message: e.message }, 409);
      }
      throw e;
    }

    return c.json(await jobRepo.markPaid(db, id, body.paymentMethod));
  });
