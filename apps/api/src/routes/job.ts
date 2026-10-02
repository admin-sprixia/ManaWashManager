import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  couponRepo,
  customerRepo,
  expenseRepo,
  jobRepo,
  referralRepo,
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
  MAX_SELLERS_PER_JOB,
  MAX_WASHERS_PER_JOB,
  MIN_REASON_LENGTH,
  normalizeCouponCode,
  normalizePhone,
  PriceNotFoundError,
  referralProblemMessage,
  resolveOccurredAt,
  type JobStatus,
  type PaymentMethod,
} from '@mana/domain';
import {
  cancelReferralForVoidedJob,
  evaluateReferral,
  settleReferralForPaidJob,
  verifyReferralQuote,
  type ReferralQuote,
} from '../lib/referral';
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
/** Who got the customer to take the commission services — they share the commission. */
const sellerIdsSchema = z
  .array(z.string().min(1).max(64))
  .max(MAX_SELLERS_PER_JOB, `At most ${MAX_SELLERS_PER_JOB} people can share a commission`)
  .transform((ids) => [...new Set(ids)]);

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
    /** Signed quote from POST /referrals/quote; the server works out the discount. */
    referralToken: z.string().min(1).max(2000).optional(),
    ...pricingFields,
    sellerIds: sellerIdsSchema.optional(),
  })
  .refine(discountNeedsReason, discountReasonIssue)
  .refine((d) => !d.couponCode || d.discount === 0, {
    message: 'A coupon can’t be combined with a manual discount',
    path: ['couponCode'],
  })
  .refine((d) => !d.referralToken || (d.discount === 0 && !d.couponCode), {
    message: 'A referral offer can’t be combined with another discount',
    path: ['referralToken'],
  });

const washerIdsSchema = z
  .array(z.string().min(1).max(64))
  .max(MAX_WASHERS_PER_JOB, `At most ${MAX_WASHERS_PER_JOB} washers per car`)
  .transform((ids) => [...new Set(ids)]);

const updateStatusSchema = z.object({
  status: z.enum(['washing', 'ready']),
  occurredAt: occurredAtSchema,
  /** Optional record of who is washing the car; no money depends on it. */
  washerIds: washerIdsSchema.optional(),
});
const setWashersSchema = z.object({ washerIds: washerIdsSchema });
const setSellersSchema = z.object({
  sellerIds: sellerIdsSchema.refine((ids) => ids.length > 0, 'Pick who got this service'),
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

  const [prices, commissionRates] = await Promise.all([
    serviceRepo.listPrices(db, body.vehicleTypeId),
    serviceRepo.listCommissionRates(db, body.vehicleTypeId),
  ]);
  const commissionFor = new Map(commissionRates.map((r) => [r.serviceId, r.amount]));
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
      commissionAtTime: commissionFor.get(li.serviceId) ?? 0,
      quantity: li.quantity,
    })),
  };
}

/** Picked people must be current, active team members. Returns their names in the given order. */
async function checkWashers(db: DbClient, ids: string[]) {
  const users = await db.user.findMany({
    where: { id: { in: ids }, active: true },
    select: { id: true, name: true },
  });
  if (users.length !== ids.length) return null;
  const byId = new Map(users.map((u) => [u.id, u.name]));
  return ids.map((id) => byId.get(id)!);
}

const invalidWashers = {
  error: 'invalid_washers' as const,
  message: 'One of the washers picked isn’t an active team member.',
};

/**
 * Who earns a new job's commission. None when no line carries one. Otherwise the people
 * picked — dropping anyone no longer active, since an offline wash may sync after someone
 * leaves — falling back to whoever entered the wash, so commission is never left unowned.
 */
async function resolveSellers(
  db: DbClient,
  lineItems: { commissionAtTime: number }[],
  requested: string[] | undefined,
  enteredBy: string,
): Promise<string[]> {
  if (!lineItems.some((li) => li.commissionAtTime > 0)) return [];
  if (!requested?.length) return [enteredBy];
  const active = await db.user.findMany({
    where: { id: { in: requested }, active: true },
    select: { id: true },
  });
  const activeIds = new Set(active.map((u) => u.id));
  const kept = requested.filter((id) => activeIds.has(id));
  return kept.length > 0 ? kept : [enteredBy];
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
    const db = c.get('db');
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
      sellerIds: await resolveSellers(db, priced.lineItems, undefined, session.sub),
    });
    return c.json(job, 201);
  })
  .post('/start', zValidator('json', startJobSchema), async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
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

    // Referrals: only the signed quote's percentage counts, and every rule is re-checked now —
    // the customer and vehicle must still be brand new, and the referrer still a paying customer.
    let referral: ReferralQuote | null = null;
    if (body.referralToken) {
      const referralInvalid = (message: string) =>
        c.json({ error: 'referral_invalid' as const, message }, 409);
      if (body.ownership) return referralInvalid('Referral offers are only for new customers.');
      const quote = await verifyReferralQuote(body.referralToken, c.env.JWT_SECRET);
      if (!quote || quote.shopId !== session.shopId) {
        return referralInvalid('This referral offer expired. Remove it and check the referral again.');
      }
      if (
        quote.phone !== body.customer.phone ||
        quote.registrationNumber !== body.registrationNumber
      ) {
        return referralInvalid('The phone or vehicle changed after the referral was checked. Check it again.');
      }
      const recheck = await evaluateReferral(db, quote);
      if (recheck.problem) return referralInvalid(referralProblemMessage(recheck.problem));
      referral = { ...quote, referrerCustomerId: recheck.referrer.id };
    }

    const percentOff = coupon?.percent ?? referral?.percent ?? null;
    const discount = percentOff != null ? couponDiscount(priced.subtotal, percentOff) : body.discount;
    const discountReason = coupon
      ? `Coupon ${coupon.code} · ${coupon.percent}% off`
      : referral
        ? `Referred by ${referral.referrerName?.trim() || referral.referrerPhone} · ${referral.percent}% off`
        : body.discountReason;
    const total = percentOff != null ? priced.subtotal - discount : priced.total;

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
    if (referral) {
      try {
        await referralRepo.create(db, {
          referredCustomerId: customer.id,
          referrerCustomerId: referral.referrerCustomerId,
          jobId: body.id,
          percent: referral.percent,
          createdByUserId: session.sub,
          now,
        });
      } catch {
        // Already written by a replay of this same request: carry on to the (idempotent) job.
        const mine = await referralRepo.findByJob(db, body.id);
        if (!mine) {
          const winner = await jobRepo.findBoardRow(db, body.id);
          if (winner) return c.json(winner, 200);
          if (coupon) await couponRepo.release(db, { couponId: coupon.id, jobId: body.id });
          return c.json(
            {
              error: 'referral_invalid' as const,
              message: 'This customer was already referred on another wash.',
            },
            409,
          );
        }
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
        sellerIds: await resolveSellers(db, priced.lineItems, body.sellerIds, session.sub),
      });
      return c.json(job, 201);
    } catch (e) {
      // A replay of this same request may have created the job first; its coupon and referral
      // are this job's, so leave them alone.
      const winner = await jobRepo.findBoardRow(db, body.id);
      if (winner) return c.json(winner, 200);
      if (coupon) await couponRepo.release(db, { couponId: coupon.id, jobId: body.id });
      if (referral) await referralRepo.removeForJob(db, body.id);
      throw e;
    }
  })
  .get('/today', async (c) => {
    const db = c.get('db');
    return c.json(await jobRepo.listToday(db, startOfIstDay()));
  })
  // Owner reports: today / rolling 7 days / calendar month / calendar year / custom IST dates.
  // Window is always half-open [from, to) so day boundaries never double-count.
  .get('/stats', requireRole('owner'), zValidator('query', reportQuerySchema), async (c) => {
    const db = c.get('db');
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
    const db = c.get('db');
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
    const db = c.get('db');
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
    const db = c.get('db');

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
    const washerIds = body.status === 'washing' ? body.washerIds : undefined;
    if (washerIds && !(await checkWashers(db, washerIds))) return c.json(invalidWashers, 400);

    const updated = await jobRepo.updateStatus(db, id, {
      from,
      to: body.status,
      userId: c.get('session').sub,
      at: resolveOccurredAt(body.occurredAt),
      washerIds,
    });
    if (updated) return c.json(updated, 200);
    // Someone else moved it between our read and write.
    const now = await jobRepo.findBoardRow(db, id);
    if (now?.status === body.status) return c.json(now, 200);
    return c.json(
      { error: 'invalid_transition' as const, message: `This job is already ${now?.status ?? 'gone'}.`, status: now?.status },
      409,
    );
  })
  // Correct who washed a car (or clear it). Only a record, so anyone on the team can fix it.
  .put('/:id/washers', zValidator('json', setWashersSchema), async (c) => {
    const id = c.req.param('id');
    const { washerIds } = c.req.valid('json');
    const db = c.get('db');
    const session = c.get('session');

    const job = await jobRepo.findBoardRow(db, id);
    if (!job) return c.json({ error: 'job_not_found' as const }, 404);
    if (job.status === 'void') {
      return c.json({ error: 'job_void' as const, message: 'This job was voided.' }, 409);
    }
    const names = await checkWashers(db, washerIds);
    if (!names) return c.json(invalidWashers, 400);

    const current = job.washers.map((w) => w.user.id);
    const unchanged =
      current.length === washerIds.length && washerIds.every((w) => current.includes(w));
    if (unchanged) return c.json(job, 200);

    return c.json(
      await jobRepo.setWashers(db, id, {
        washerIds,
        userId: session.sub,
        fromNames: job.washers.map((w) => w.user.name).join(', '),
        toNames: names.join(', '),
      }),
    );
  })
  // Correct who got the commission services. Anyone on shift while it's unpaid; once paid it
  // moves someone's earnings, so it's the owner's call.
  .put('/:id/sellers', zValidator('json', setSellersSchema), async (c) => {
    const id = c.req.param('id');
    const { sellerIds } = c.req.valid('json');
    const db = c.get('db');
    const session = c.get('session');

    const job = await jobRepo.findBoardRow(db, id);
    if (!job) return c.json({ error: 'job_not_found' as const }, 404);
    if (job.status === 'void') {
      return c.json({ error: 'job_void' as const, message: 'This job was voided.' }, 409);
    }
    if (!job.jobServices.some((js) => js.commissionAtTime > 0)) {
      return c.json(
        { error: 'no_commission' as const, message: 'None of this job’s services carry a commission.' },
        409,
      );
    }
    if (job.status === 'paid' && session.role !== 'owner') {
      return c.json(
        { error: 'owner_only' as const, message: 'Only the owner can change this on a paid job.' },
        403,
      );
    }
    const names = await checkWashers(db, sellerIds);
    if (!names) {
      return c.json(
        { error: 'invalid_sellers' as const, message: 'One of the people picked isn’t an active team member.' },
        400,
      );
    }

    const current = job.sellers.map((s) => s.user.id);
    const unchanged =
      current.length === sellerIds.length && sellerIds.every((s) => current.includes(s));
    if (unchanged) return c.json(job, 200);

    return c.json(
      await jobRepo.setSellers(db, id, {
        sellerIds,
        userId: session.sub,
        fromNames: job.sellers.map((s) => s.user.name).join(', '),
        toNames: names.join(', '),
      }),
    );
  })
  .post('/:id/pay', zValidator('json', markPaidSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = c.get('db');

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

    const paid = await jobRepo.markPaid(db, id, {
      from,
      paymentMethod: body.paymentMethod,
      userId: c.get('session').sub,
      at: resolveOccurredAt(body.occurredAt),
    });
    if (!paid) {
      const now = await jobRepo.findBoardRow(db, id);
      if (now?.status === 'paid' && now.paymentMethod === body.paymentMethod) return c.json(now, 200);
      return c.json(
        {
          error: now?.status === 'paid' ? ('already_paid' as const) : ('invalid_transition' as const),
          message: now?.status === 'paid' ? 'This job was already marked paid.' : `This job is ${now?.status ?? 'gone'} and can’t be paid.`,
          status: now?.status,
        },
        409,
      );
    }
    // A referred customer's first wash is now paid: the referrer earns their reward.
    await settleReferralForPaidJob(db, id, c.get('session').sub);
    return c.json(paid, 200);
  })
  // Void with a reason. Anyone can void an unpaid job; voiding a paid one reverses collected
  // money and is owner-only. The job is kept (status 'void') so the audit trail survives.
  .post('/:id/void', zValidator('json', voidSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = c.get('db');
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
    if (!voided) {
      // Already voided by someone else (they undo the coupon and referral), or it just got paid
      // and only the owner may void it now.
      const now = await jobRepo.findBoardRow(db, id);
      if (now?.status === 'void') return c.json(now, 200);
      return c.json(
        { error: 'job_changed' as const, message: 'This job just changed. Check it and try again.', status: now?.status },
        409,
      );
    }
    await couponRepo.restoreForVoidedJob(db, id, new Date());
    await cancelReferralForVoidedJob(db, id);
    return c.json(voided, 200);
  })
  // Owner correction: the job was paid by UPI but recorded as cash (or vice versa).
  .patch(
    '/:id/payment-method',
    requireRole('owner'),
    zValidator('json', paymentCorrectionSchema),
    async (c) => {
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const db = c.get('db');
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

      const changed = await jobRepo.changePaymentMethod(db, id, {
        from: job.paymentMethod as PaymentMethod | null,
        to: body.paymentMethod,
        userId: session.sub,
        reason: body.reason,
      });
      if (changed) return c.json(changed, 200);
      const now = await jobRepo.findBoardRow(db, id);
      if (now?.status === 'paid' && now.paymentMethod === body.paymentMethod) return c.json(now, 200);
      return c.json(
        { error: 'job_changed' as const, message: 'This job just changed. Check it and try again.' },
        409,
      );
    },
  );
