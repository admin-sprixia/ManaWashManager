import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  couponRepo,
  createDbClient,
  customerRepo,
  expenseRepo,
  jobRepo,
  serviceRepo,
  type DbClient,
} from '@mana/db';
import {
  applyDiscount,
  calculatePrice,
  canCorrectPayment,
  canTransition,
  canVoidJob,
  COUPON_CODE_PATTERN,
  couponDiscount,
  MIN_REASON_LENGTH,
  normalizeCouponCode,
  normalizePhone,
  PriceNotFoundError,
  resolveOccurredAt,
  type JobStatus,
  type PaymentMethod,
} from '@mana/domain';
import { requireAuth, requireRole } from '../middleware/auth';
import { startOfIstDay } from '../lib/istDate';
import { reportQuerySchema, resolveReportWindow, windowMeta } from '../lib/reportWindow';
import type { Env } from '../types';

/** Client-generated ids (offline queue) — opaque, URL-safe, bounded. */
const clientIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid id');
const occurredAtSchema = z.string().datetime({ offset: true }).optional();
const reasonSchema = z
  .string()
  .trim()
  .min(MIN_REASON_LENGTH, `Reason must be at least ${MIN_REASON_LENGTH} characters`)
  .max(200);
const paymentMethodSchema = z.enum(['cash', 'upi', 'other']);

const pricingFields = {
  vehicleTypeId: z.string(),
  services: z
    .array(z.object({ serviceId: z.string(), quantity: z.number().int().positive().default(1) }))
    .min(1),
  discount: z.number().int().min(0).default(0),
  discountReason: z.string().trim().max(200).optional(),
};

// V1.0's own feature table: "discounts require a reason" — enforced here too, not just in
// the app UI, so no client (including a future staff app) can silently apply a bare discount.
const discountNeedsReason = <T extends { discount: number; discountReason?: string }>(data: T) =>
  data.discount === 0 || Boolean(data.discountReason?.trim());
const discountReasonIssue = {
  message: 'discountReason is required when discount is greater than 0',
  path: ['discountReason'],
};

const createJobSchema = z
  .object({
    id: clientIdSchema.optional(),
    customerId: z.string(),
    vehicleId: z.string(),
    occurredAt: occurredAtSchema,
    ...pricingFields,
  })
  .refine(discountNeedsReason, discountReasonIssue);

/** New Wash in one round trip — customer + vehicle find-or-create + job — so it can be queued offline. */
const startJobSchema = z
  .object({
    id: clientIdSchema,
    occurredAt: occurredAtSchema,
    customer: z.object({
      phone: z
        .string()
        .transform(normalizePhone)
        .refine((p) => /^[6-9]\d{9}$/.test(p), 'Enter a valid 10-digit mobile number'),
      name: z.string().trim().min(1, 'Customer name is required').max(80),
    }),
    registrationNumber: z
      .string()
      .transform((r) => r.trim().toUpperCase().replace(/\s+/g, ''))
      .refine((r) => r.length >= 4 && r.length <= 15, 'Enter a valid registration number'),
    /** Only sent when a known plate came in with a different phone and the operator chose. */
    ownership: z.enum(['new_owner', 'same_person']).optional(),
    couponCode: z
      .string()
      .transform(normalizeCouponCode)
      .refine((code) => COUPON_CODE_PATTERN.test(code), 'That doesn’t look like a MANA coupon code')
      .optional(),
    ...pricingFields,
  })
  .refine(discountNeedsReason, discountReasonIssue)
  .refine((d) => !d.couponCode || d.discount === 0, {
    message: 'A coupon can’t be combined with a manual discount',
    path: ['couponCode'],
  });

const updateStatusSchema = z.object({
  status: z.enum(['washing', 'ready']),
  occurredAt: occurredAtSchema,
});
const markPaidSchema = z.object({
  paymentMethod: paymentMethodSchema,
  occurredAt: occurredAtSchema,
});
const voidSchema = z.object({ reason: reasonSchema, occurredAt: occurredAtSchema });
const paymentCorrectionSchema = z.object({
  paymentMethod: paymentMethodSchema,
  reason: reasonSchema,
});

type PricingInput = z.infer<typeof createJobSchema>;

/**
 * Prices a job server-side from the current price list — the client sends what was selected,
 * never a total it computed itself. Both domain errors (a service with no price for this
 * vehicle type; a discount larger than the subtotal) are real operator mistakes, returned as
 * a typed error rather than thrown.
 */
async function priceJob(db: DbClient, body: Pick<PricingInput, keyof typeof pricingFields>) {
  const vehicleType = await serviceRepo.getVehicleType(db, body.vehicleTypeId);
  if (!vehicleType)
    return { error: 'vehicle_type_not_found' as const, message: 'Unknown vehicle type.' };

  const catalog = await serviceRepo.listActive(
    db,
    vehicleType.category === 'bike' ? 'bike' : 'car',
  );
  const allowed = new Set(catalog.map((s) => s.id));
  if (body.services.some((s) => !allowed.has(s.serviceId))) {
    return {
      error: 'service_not_for_vehicle' as const,
      message: 'One or more selected services are not offered for this vehicle type.',
    };
  }

  const prices = await serviceRepo.listPrices(db, body.vehicleTypeId);
  let breakdown: ReturnType<typeof calculatePrice>;
  try {
    breakdown = calculatePrice(body.services, body.vehicleTypeId, prices);
  } catch (e) {
    if (e instanceof PriceNotFoundError)
      return { error: 'price_not_set' as const, message: e.message };
    throw e;
  }

  let total: number;
  try {
    total = applyDiscount(breakdown.subtotal, body.discount);
  } catch (e) {
    return {
      error: 'invalid_discount' as const,
      message: e instanceof Error ? e.message : 'Invalid discount',
    };
  }

  return {
    subtotal: breakdown.subtotal,
    total,
    lineItems: breakdown.lineItems.map((li) => ({
      serviceId: li.serviceId,
      priceAtTime: li.unitPrice,
      quantity: li.quantity,
    })),
  };
}

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
//
// Every write below is safe to replay: the offline queue on the phone may resend a request
// whose response was lost. Creates are keyed by a client id; status/pay/void return the
// current job unchanged when it's already in the requested state.
export const jobRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  .post('/', zValidator('json', createJobSchema), async (c) => {
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    const session = c.get('session');

    if (body.id) {
      const existing = await jobRepo.findBoardRow(db, body.id);
      if (existing) return c.json(existing, 200);
    }

    const priced = await priceJob(db, body);
    if ('error' in priced) return c.json({ error: priced.error, message: priced.message }, 400);

    const job = await jobRepo.create(db, {
      id: body.id,
      customerId: body.customerId,
      vehicleId: body.vehicleId,
      createdByUserId: session.sub,
      subtotal: priced.subtotal,
      discount: body.discount,
      discountReason: body.discountReason,
      total: priced.total,
      createdAt: resolveOccurredAt(body.occurredAt),
      lineItems: priced.lineItems,
    });
    return c.json(job, 201);
  })
  .post('/start', zValidator('json', startJobSchema), async (c) => {
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    const session = c.get('session');

    const existing = await jobRepo.findBoardRow(db, body.id);
    if (existing) return c.json(existing, 200);

    // Price first so a bad selection never leaves a half-created customer behind.
    const priced = await priceJob(db, body);
    if ('error' in priced) return c.json({ error: priced.error, message: priced.message }, 400);

    // Coupons are checked against the vehicle and owner as they stand *before* this request
    // changes anything, and never alongside an ownership change.
    const now = new Date();
    let coupon: { id: string; code: string; percent: number } | null = null;
    if (body.couponCode) {
      if (body.ownership) {
        return c.json(
          {
            error: 'coupon_invalid' as const,
            message: 'A coupon can’t be used while the vehicle’s owner is being changed.',
          },
          409,
        );
      }
      const check = await couponRepo.checkRedeemable(db, {
        code: body.couponCode,
        registrationNumber: body.registrationNumber,
        phone: body.customer.phone,
        jobId: body.id,
        now,
      });
      if ('error' in check) return c.json({ error: check.error, message: check.message }, 409);
      coupon = check.coupon;
    }
    const discount = coupon ? couponDiscount(priced.subtotal, coupon.percent) : body.discount;
    const discountReason = coupon
      ? `Coupon ${coupon.code} · ${coupon.percent}% off`
      : body.discountReason;
    const total = coupon ? priced.subtotal - discount : priced.total;

    const ensured = await customerRepo.ensureWithVehicle(db, {
      phone: body.customer.phone,
      name: body.customer.name,
      registrationNumber: body.registrationNumber,
      vehicleTypeId: body.vehicleTypeId,
      ownership: body.ownership,
    });
    if ('error' in ensured) {
      return c.json(
        {
          error: ensured.error,
          message: `${body.customer.phone} already belongs to ${ensured.holderName || 'another customer'}. Choose “New owner” instead.`,
        },
        409,
      );
    }
    const { customer, vehicle } = ensured;

    if (coupon) {
      const claimed = await couponRepo.claim(db, {
        couponId: coupon.id,
        jobId: body.id,
        userId: session.sub,
        now,
      });
      if (!claimed) {
        return c.json(
          {
            error: 'coupon_invalid' as const,
            message: 'This coupon was just used on another wash.',
          },
          409,
        );
      }
    }

    try {
      const job = await jobRepo.create(db, {
        id: body.id,
        customerId: customer.id,
        vehicleId: vehicle.id,
        createdByUserId: session.sub,
        subtotal: priced.subtotal,
        discount,
        discountReason,
        total,
        createdAt: resolveOccurredAt(body.occurredAt),
        lineItems: priced.lineItems,
      });
      return c.json(job, 201);
    } catch (e) {
      if (coupon) await couponRepo.release(db, { couponId: coupon.id, jobId: body.id });
      throw e;
    }
  })
  .get('/today', async (c) => {
    const db = createDbClient(c.env.DB);
    return c.json(await jobRepo.listToday(db, startOfIstDay()));
  })
  // Owner reports: today / rolling 7 days / calendar month / calendar year / custom IST dates.
  // Window is always half-open [from, to) so day boundaries never double-count.
  .get('/stats', requireRole('owner'), zValidator('query', reportQuerySchema), async (c) => {
    const db = createDbClient(c.env.DB);
    const query = c.req.valid('query');
    const window = resolveReportWindow(query);
    if ('error' in window) return c.json({ error: window.error }, 400);

    const [stats, pendingNow, expenses] = await Promise.all([
      jobRepo.getStats(db, window.from, window.to),
      jobRepo.countPending(db),
      expenseRepo.total(db, window.from, window.to),
    ]);

    return c.json({
      ...stats,
      pendingNow,
      expenses,
      net: stats.revenue - expenses,
      ...windowMeta(query, window),
    });
  })
  // Full export payload for PDF — same window as /stats, plus every job line in the period.
  .get('/stats/export', requireRole('owner'), zValidator('query', reportQuerySchema), async (c) => {
    const db = createDbClient(c.env.DB);
    const query = c.req.valid('query');
    const window = resolveReportWindow(query);
    if ('error' in window) return c.json({ error: window.error }, 400);

    const [stats, pendingNow, expenses, jobs] = await Promise.all([
      jobRepo.getStats(db, window.from, window.to),
      jobRepo.countPending(db),
      expenseRepo.total(db, window.from, window.to),
      jobRepo.listForReport(db, window.from, window.to),
    ]);

    return c.json({
      generatedAt: new Date().toISOString(),
      ...windowMeta(query, window),
      stats: { ...stats, pendingNow, expenses, net: stats.revenue - expenses },
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
        createdBy: job.createdBy.name,
        paidBy: job.paidBy?.name ?? null,
      })),
    });
  })
  // Job Detail: the job plus its full audit trail (who did what, when, and why).
  .get('/:id', async (c) => {
    const db = createDbClient(c.env.DB);
    const job = await jobRepo.findDetail(db, c.req.param('id'));
    if (!job) return c.json({ error: 'job_not_found' as const }, 404);
    return c.json(job);
  })
  // Job Board: Waiting -> Washing -> Ready. A request for the state the job is already in
  // (a replay, or two people tapping at once) returns the job as-is; anything else invalid
  // is a 409.
  .patch('/:id/status', zValidator('json', updateStatusSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);

    const job = await jobRepo.findById(db, id);
    if (!job) return c.json({ error: 'job_not_found' as const }, 404);

    const from = job.status as JobStatus;
    if (from === body.status) return c.json(await jobRepo.findBoardRow(db, id), 200);
    if (!canTransition(from, body.status)) {
      return c.json(
        {
          error: 'invalid_transition' as const,
          message: `This job is already ${from}.`,
          status: from,
        },
        409,
      );
    }

    return c.json(
      await jobRepo.updateStatus(db, id, {
        from,
        to: body.status,
        userId: c.get('session').sub,
        at: resolveOccurredAt(body.occurredAt),
      }),
    );
  })
  .post('/:id/pay', zValidator('json', markPaidSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);

    const job = await jobRepo.findById(db, id);
    if (!job) return c.json({ error: 'job_not_found' as const }, 404);

    const from = job.status as JobStatus;
    if (from === 'paid') {
      if (job.paymentMethod === body.paymentMethod)
        return c.json(await jobRepo.findBoardRow(db, id), 200);
      return c.json(
        {
          error: 'already_paid' as const,
          message: 'This job was already marked paid.',
          status: from,
        },
        409,
      );
    }
    if (!canTransition(from, 'paid')) {
      return c.json(
        {
          error: 'invalid_transition' as const,
          message: `This job is ${from} and can’t be paid.`,
          status: from,
        },
        409,
      );
    }

    return c.json(
      await jobRepo.markPaid(db, id, {
        from,
        paymentMethod: body.paymentMethod,
        userId: c.get('session').sub,
        at: resolveOccurredAt(body.occurredAt),
      }),
    );
  })
  // Void with a reason. Anyone can void an unpaid job; voiding a paid one reverses collected
  // money and is owner-only. The job is kept (status 'void') so the audit trail survives.
  .post('/:id/void', zValidator('json', voidSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    const session = c.get('session');

    const job = await jobRepo.findById(db, id);
    if (!job) return c.json({ error: 'job_not_found' as const }, 404);

    const from = job.status as JobStatus;
    if (from === 'void') return c.json(await jobRepo.findBoardRow(db, id), 200);
    if (!canVoidJob(from, session.role)) {
      return c.json(
        { error: 'owner_only' as const, message: 'Only the owner can void a paid job.' },
        403,
      );
    }

    const voided = await jobRepo.voidJob(db, id, {
      from,
      userId: session.sub,
      reason: body.reason,
      at: resolveOccurredAt(body.occurredAt),
    });
    await couponRepo.restoreForVoidedJob(db, id, new Date());
    return c.json(voided);
  })
  // Owner correction: the job was paid by UPI but recorded as cash (or vice versa).
  .patch(
    '/:id/payment-method',
    requireRole('owner'),
    zValidator('json', paymentCorrectionSchema),
    async (c) => {
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const db = createDbClient(c.env.DB);
      const session = c.get('session');

      const job = await jobRepo.findById(db, id);
      if (!job) return c.json({ error: 'job_not_found' as const }, 404);
      if (!canCorrectPayment(job.status as JobStatus, session.role)) {
        return c.json(
          { error: 'not_paid' as const, message: 'Only paid jobs can be corrected.' },
          409,
        );
      }
      if (job.paymentMethod === body.paymentMethod)
        return c.json(await jobRepo.findBoardRow(db, id), 200);

      return c.json(
        await jobRepo.changePaymentMethod(db, id, {
          from: job.paymentMethod as PaymentMethod | null,
          to: body.paymentMethod,
          userId: session.sub,
          reason: body.reason,
        }),
      );
    },
  );
