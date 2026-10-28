import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  awayPricingRepo,
  businessRules,
  catalogRepo,
  couponRepo,
  createPlatformDb,
  customerRepo,
  expenseRepo,
  jobRepo,
  menuRepo,
  placeOrderRepo,
  referralRepo,
  rewardRepo,
  serviceAreaRepo,
  serviceRepo,
  shopPlanRepo,
  stockRepo,
  type D1Database,
  type DbClient,
} from '@mana/db';
import {
  VEHICLE_MAKE_MAX,
  applyDiscount,
  calculatePrice,
  canCorrectPayment,
  canTransition,
  canVoidJob,
  COUPON_CODE_PATTERN,
  couponDiscount,
  EXPENSE_CATEGORY_LABEL,
  gstBreakup,
  MAX_SELLERS_PER_JOB,
  MAX_WASHERS_PER_JOB,
  MIN_REASON_LENGTH,
  normalizeCouponCode,
  normalizePhone,
  PriceNotFoundError,
  referralProblemMessage,
  stockLevel,
  distanceKm,
  roadKm,
  visitCharge,
  type ExpenseCategory,
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
import { checkFreeWashes, settleRewardsForPaidJob } from '../lib/rewards';
import { occurredAt } from '../lib/clientTime';
import { requireAuth, requireRole } from '../middleware/auth';
import { formatIstDateOnly, startOfIstDay } from '../lib/istDate';
import { reportQuerySchema, resolveReportWindow, windowMeta } from '../lib/reportWindow';
import { executionCtx, queueWashMessage } from '../lib/washMessages';
import type { Env } from '../types';

const MAX_SERVICE_QUANTITY = 20;
const MAX_SERVICES_PER_JOB = 30;

/**
 * A voided wash hands back its coupon, cancels its referral and takes back its welcome gift
 * (stock returns to the shelf), and gives back the plan wash it used. Its free washes come back
 * by themselves: a claim only counts while its job isn't voided. Safe to run more than once.
 */
async function undoVoidedJobExtras(db: DbClient, d1: D1Database, jobId: string, userId: string) {
  const now = new Date();
  await couponRepo.restoreForVoidedJob(db, jobId, now);
  await cancelReferralForVoidedJob(db, jobId);
  await rewardRepo.returnForVoidedJob(db, jobId, { userId, now });
  await placeOrderRepo.releaseShopWash(d1, db.$shopId(), jobId);
  await shopPlanRepo.release(d1, db.$shopId(), jobId);
  await shopPlanRepo.cancelSale(db, jobId);
}

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
  // One line per service: a service sent twice is merged (quantities added), since the job can
  // only store it once and a half-written job must never look complete.
  services: z
    .array(z.object({ serviceId: z.string().min(1).max(64), quantity: z.number().int().positive().max(MAX_SERVICE_QUANTITY).default(1) }))
    .min(1)
    .max(MAX_SERVICES_PER_JOB)
    .transform((lines) => {
      const merged = new Map<string, number>();
      for (const l of lines) merged.set(l.serviceId, (merged.get(l.serviceId) ?? 0) + l.quantity);
      return [...merged].map(([serviceId, quantity]) => ({ serviceId, quantity }));
    })
    .refine((lines) => lines.every((l) => l.quantity <= MAX_SERVICE_QUANTITY), `At most ${MAX_SERVICE_QUANTITY} of one service`),
  discount: z.number().int().min(0).default(0),
  discountReason: z.string().trim().max(200).optional(),
  /** Washed at the hub or at the customer's home: a home wash is the hub price plus a visit charge. */
  mode: z.enum(['hub', 'doorstep']).default('hub'),
  /**
   * A home wash: where the home is (the phone's location at the home). The server measures the
   * distance from the branch for the visit charge; without it, the customer's saved home is used.
   */
  visitPoint: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).optional(),
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
    /**
     * The price per service this phone showed when the wash was entered. A wash that waited
     * offline keeps it if the branch's prices changed meanwhile (within half to double).
     */
    quoted: z
      .array(z.object({ serviceId: z.string().min(1).max(64), price: z.number().int().min(0).max(10_000_000) }))
      .max(MAX_SERVICES_PER_JOB)
      .optional(),
    /** The company and model picked from the size guide's list; kept on the vehicle. */
    make: z.string().trim().min(1).max(VEHICLE_MAKE_MAX).optional(),
    model: z.string().trim().min(1).max(VEHICLE_MAKE_MAX).optional(),
    couponCode: z
      .string()
      .transform(normalizeCouponCode)
      .refine((code) => COUPON_CODE_PATTERN.test(code), 'That doesn’t look like a MANA coupon code')
      .optional(),
    /** Signed quote from POST /referrals/quote; the server works out the discount. */
    referralToken: z.string().min(1).max(2000).optional(),
    /** Services taken as a free wash from the car's stamp card (one of each, needs internet). */
    rewardServiceIds: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(MAX_SERVICES_PER_JOB)
      .transform((ids) => [...new Set(ids)])
      .optional(),
    /** A community plan pays for this wash: its service is free and one plan wash is used. */
    planOrderId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
    /** A plan bought at this counter for this vehicle pays for its wash (one a day). */
    shopPlanId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
    ...pricingFields,
    sellerIds: sellerIdsSchema.optional(),
  })
  .refine(discountNeedsReason, discountReasonIssue)
  .refine((d) => !d.shopPlanId || (!d.planOrderId && d.discount === 0 && !d.couponCode && !d.referralToken && !d.rewardServiceIds), {
    message: 'A plan wash can’t be combined with another discount',
    path: ['shopPlanId'],
  })
  .refine((d) => !d.planOrderId || (d.discount === 0 && !d.couponCode && !d.referralToken && !d.rewardServiceIds), {
    message: 'A plan wash can’t be combined with another discount',
    path: ['planOrderId'],
  })
  .refine((d) => !d.rewardServiceIds || (d.discount === 0 && !d.couponCode && !d.referralToken), {
    message: 'A free wash can’t be combined with another discount',
    path: ['rewardServiceIds'],
  })
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
/** What a doorstep visit charge needs: whose visit, when, and the branch whose rules apply. */
interface VisitContext {
  d1: D1Database;
  shopId: string;
  at: Date;
  customer: { phone: string } | { customerId: string };
  jobId?: string;
}

/** A wash this long after it happened was queued offline. */
const LATE_SYNC_MS = 2 * 60_000;
/** A quoted price is kept only within this band of today's price, so it can't hide a discount. */
const QUOTE_MIN_RATIO = 0.5;
const QUOTE_MAX_RATIO = 2;

async function priceJob(
  db: DbClient,
  body: Pick<PricingInput, keyof typeof pricingFields>,
  visit?: VisitContext,
  /** Service id → the price the phone showed; given only for a wash that waited offline. */
  quoted?: Map<string, number>,
) {
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
  const picked = catalog.filter((s) => body.services.some((x) => x.serviceId === s.id));
  if (body.mode === 'doorstep') {
    // A home wash: a service done only at communities, or only at the shop, isn't sold there.
    const notAtHomes = picked.find((s) => s.teamAt === 'community' || s.modes === 'hub');
    if (notAtHomes) {
      const where = notAtHomes.teamAt === 'community' ? 'at communities only' : 'at the shop only';
      return { error: 'not_at_homes' as const, message: `${notAtHomes.name} is done ${where}, not at customers’ homes.` };
    }
    const team = await db.servicePoint.count({ where: { kind: 'doorstep', active: true } });
    if (!team) return { error: 'mode_not_offered' as const, message: 'This branch doesn’t do doorstep washes.' };
  } else {
    const notAtShop = picked.find((s) => s.catalogServiceId && s.modes === 'doorstep');
    if (notAtShop) return { error: 'not_at_shop' as const, message: `${notAtShop.name} is done at customers’ homes only.` };
    // Home washes are priced like the hub, so a vehicle only the doorstep team takes (a tractor)
    // has a hub price too: the shop itself still doesn't wash it.
    if (visit && (await menuRepo.homeOnlyTypes(visit.d1, visit.shopId)).has(vehicleType.id)) {
      return { error: 'not_at_shop' as const, message: `${vehicleType.name} is washed at customers’ homes only, not at the shop.` };
    }
  }

  const [allPrices, commissionRates] = await Promise.all([
    serviceRepo.listPrices(db, body.vehicleTypeId),
    serviceRepo.listCommissionRates(db, body.vehicleTypeId),
  ]);
  // Head-office services cost the same at a home as at the shop (the visit charge is its own
  // line); a branch's hand-made service keeps its own doorstep price.
  const fromCatalog = new Map(catalog.map((s) => [s.id, s.catalogServiceId != null]));
  const prices = allPrices.filter(
    (p) => p.mode === (body.mode === 'doorstep' && !fromCatalog.get(p.serviceId) ? 'doorstep' : 'hub'),
  );
  const commissionFor = new Map(commissionRates.map((r) => [r.serviceId, r.amount]));
  // The customer was told a price while this wash waited offline: if the branch's price changed
  // since, keep what they were told (the cash taken matches), within a sane band.
  const picks = new Set(body.services.map((x) => x.serviceId));
  const kept = quoted?.size
    ? prices.map((p) => {
        const q = quoted.get(p.serviceId);
        if (q == null || !picks.has(p.serviceId) || p.vehicleTypeId !== body.vehicleTypeId || q === p.price) return p;
        if (q < p.price * QUOTE_MIN_RATIO || q > p.price * QUOTE_MAX_RATIO) return p;
        return { ...p, price: q };
      })
    : prices;
  const priceChanged = kept.some((p, i) => p !== prices[i]);
  let breakdown: ReturnType<typeof calculatePrice>;
  let todaySubtotal: number;
  try {
    breakdown = calculatePrice(body.services, body.vehicleTypeId, kept);
    todaySubtotal = priceChanged ? calculatePrice(body.services, body.vehicleTypeId, prices).subtotal : breakdown.subtotal;
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

  const lineItems = breakdown.lineItems.map((li) => ({
    serviceId: li.serviceId,
    priceAtTime: li.unitPrice,
    commissionAtTime: commissionFor.get(li.serviceId) ?? 0,
    quantity: li.quantity,
  }));

  // One visit charge per visit: a second car at the same home that day shares the first's.
  let visitAmount = 0;
  let visitKm: number | null = null;
  let visitPoint: { latitude: number; longitude: number } | null = null;
  if (body.mode === 'doorstep' && visit) {
    const { doorstep } = await awayPricingRepo.forShop(visit.d1, visit.shopId);
    // The distance is measured, never typed: from the branch's pin to the home.
    let km = 0;
    if (doorstep.perKmPaise > 0 || doorstep.maxKm < 100) {
      visitPoint = body.visitPoint ?? (await awayPricingRepo.savedHome(db, visit.customer));
      if (!visitPoint) {
        return {
          error: 'location_needed' as const,
          message: 'Turn on location on this phone at the customer’s home, so the visit can be measured.',
        };
      }
      const branch = await awayPricingRepo.branchPoint(visit.d1, visit.shopId);
      if (!branch) {
        return { error: 'branch_location_missing' as const, message: 'This branch has no map location yet. Ask head office to set it.' };
      }
      km = roadKm(distanceKm(branch, visitPoint));
    }
    const charge = visitCharge(km, doorstep, visit.at);
    if (charge.tooFar) {
      return {
        error: 'too_far' as const,
        message: `That home is ${charge.km} km from the branch. The team goes up to ${doorstep.maxKm} km.`,
      };
    }
    visitKm = charge.km;
    const shared = await awayPricingRepo.sameVisit(db, visit.customer, visit.at, visit.jobId);
    visitAmount = shared ? 0 : charge.total;
    if (visitAmount > 0) {
      lineItems.push({
        serviceId: await awayPricingRepo.visitService(db, visit.shopId),
        priceAtTime: visitAmount,
        commissionAtTime: 0,
        quantity: 1,
      });
    }
  }

  return {
    subtotal: breakdown.subtotal + visitAmount,
    total: total + visitAmount,
    /** The visit charge in the subtotal: coupons and offers take nothing off it. */
    visitAmount,
    visitKm,
    /** Where the home was: kept on the wash, and as the customer's home. */
    visitPoint,
    lineItems,
    /** Set when a wash that waited offline kept the price it was quoted (services only, paise). */
    priceKept: priceChanged ? { today: todaySubtotal, quoted: breakdown.subtotal } : null,
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

type BoardRow = NonNullable<Awaited<ReturnType<typeof jobRepo.findBoardRow>>>;

/**
 * A replayed create found its job already there. Usually it's complete and is returned as is;
 * if a crash left it without its lines (D1 has no transactions), the missing parts are written
 * from this request so the wash never shows up half-made.
 */
async function finishReplayedJob(
  db: DbClient,
  existing: BoardRow,
  body: Pick<PricingInput, keyof typeof pricingFields> & { sellerIds?: string[] },
  userId: string,
  visit?: VisitContext,
) {
  if (existing.jobServices.length > 0) return existing;
  const priced = await priceJob(db, body, visit && { ...visit, jobId: existing.id });
  if ('error' in priced) return existing;
  return (
    (await jobRepo.completeCreate(db, existing.id, {
      customerId: existing.customerId,
      vehicleId: existing.vehicleId,
      createdByUserId: existing.createdByUserId,
      subtotal: existing.subtotal,
      discount: existing.discount,
      discountReason: existing.discountReason ?? undefined,
      total: existing.total,
      lineItems: priced.lineItems,
      sellerIds: await resolveSellers(db, priced.lineItems, body.sellerIds, userId),
    })) ?? existing
  );
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

    const createdAt = occurredAt(c, body.occurredAt);
    const visit: VisitContext = {
      d1: c.env.DB,
      shopId: session.shopId,
      at: createdAt,
      customer: { customerId: body.customerId },
      jobId: body.id,
    };
    if (body.id) {
      const existing = await jobRepo.findBoardRow(db, body.id);
      if (existing) return c.json(await finishReplayedJob(db, existing, body, session.sub, visit), 200);
    }

    const priced = await priceJob(db, body, visit);
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
      createdAt,
      lineItems: priced.lineItems,
      sellerIds: await resolveSellers(db, priced.lineItems, undefined, session.sub),
      deliveryMode: body.mode,
      visitKm: priced.visitKm,
      visitPoint: priced.visitPoint,
    });
    if (priced.visitPoint) await awayPricingRepo.rememberHome(db, body.customerId, priced.visitPoint);
    return c.json(job, 201);
  })
  .post('/start', zValidator('json', startJobSchema), async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const session = c.get('session');

    const createdAt = occurredAt(c, body.occurredAt);
    const visit: VisitContext = {
      d1: c.env.DB,
      shopId: session.shopId,
      at: createdAt,
      customer: { phone: body.customer.phone },
      jobId: body.id,
    };
    const existing = await jobRepo.findBoardRow(db, body.id);
    if (existing) return c.json(await finishReplayedJob(db, existing, body, session.sub, visit), 200);

    // Price first so a bad selection never leaves a half-created customer behind. A wash that
    // reaches us well after it happened (it waited offline) keeps the prices it was quoted.
    const late = Date.now() - createdAt.getTime() > LATE_SYNC_MS;
    const quoted = late && body.quoted?.length ? new Map(body.quoted.map((q) => [q.serviceId, q.price])) : undefined;
    const priced = await priceJob(db, body, visit, quoted);
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

    // Free washes from the car's stamp cards: re-checked against its history right now, and
    // claimed below so two phones can't spend the same one.
    let freeWash: { vehicleId: string; discount: number; reason: string; seqs: Map<string, number> } | null = null;
    if (body.rewardServiceIds) {
      const rewardInvalid = (message: string) => c.json({ error: 'reward_invalid' as const, message }, 409);
      if (body.ownership) return rewardInvalid('A free wash can’t be used while the vehicle’s owner is being changed.');
      const check = await checkFreeWashes(db, {
        registrationNumber: body.registrationNumber,
        serviceIds: body.rewardServiceIds,
        lineItems: priced.lineItems,
        jobId: body.id,
        now,
      });
      if (!check.ok) return rewardInvalid(check.message);
      freeWash = check;
    }

    // A community plan member at the shop: the plan's wash is free, and uses one of its washes.
    const planInvalid = (message: string) => c.json({ error: 'plan_wash_invalid' as const, message }, 409);
    let planWash: { discount: number; reason: string; serviceId: string } | null = null;
    if (body.planOrderId) {
      if (body.ownership) return planInvalid('A plan wash can’t be used while the vehicle’s owner is being changed.');
      const plans = await placeOrderRepo.shopPlans(c.env.DB, session.shopId, body.customer.phone, now);
      const found = plans.find((p) => p.orderId === body.planOrderId);
      if (!found) return planInvalid('This plan isn’t running for this customer any more.');
      if (found.problem) return planInvalid(found.problem);
      const line = priced.lineItems.find((l) => l.serviceId === found.service?.id);
      if (!line) return planInvalid(`Add ${found.service?.name ?? 'the plan’s wash'} to the bill to use the plan.`);
      planWash = {
        discount: line.priceAtTime,
        reason: `Plan wash · ${found.planName} · ${found.placeName}`.slice(0, 200),
        serviceId: line.serviceId,
      };
    }
    // A plan bought at this counter for this vehicle: the same, one wash a day.
    if (body.shopPlanId) {
      if (body.ownership) return planInvalid('A plan wash can’t be used while the vehicle’s owner is being changed.');
      const plans = await shopPlanRepo.forVehicle(db, body.registrationNumber, now);
      const found = plans.find((p) => p.orderId === body.shopPlanId);
      if (!found) return planInvalid('This plan isn’t running for this vehicle any more.');
      if (found.problem) return planInvalid(found.problem);
      const line = priced.lineItems.find((l) => l.serviceId === found.service?.id);
      if (!line) return planInvalid(`Add ${found.service?.name ?? 'the plan’s wash'} to the bill to use the plan.`);
      planWash = {
        discount: line.priceAtTime,
        reason: `Plan wash · ${found.title} · ${found.washesUsed + 1} of ${found.washesTotal}`.slice(0, 200),
        serviceId: line.serviceId,
      };
    }

    const percentOff = coupon?.percent ?? referral?.percent ?? null;
    const discount = freeWash
      ? freeWash.discount
      : planWash
        ? planWash.discount
        : percentOff != null
          ? couponDiscount(priced.subtotal - priced.visitAmount, percentOff)
          : body.discount;
    const discountReason = freeWash
      ? freeWash.reason
      : planWash
        ? planWash.reason
        : coupon
        ? `Coupon ${coupon.code} · ${coupon.percent}% off`
        : referral
          ? `Referred by ${referral.referrerName?.trim() || referral.referrerPhone} · ${referral.percent}% off`
          : body.discountReason;
    const total = freeWash || planWash || percentOff != null ? priced.subtotal - discount : priced.total;

    const ensured = await customerRepo.ensureWithVehicle(db, {
      phone: body.customer.phone,
      name: body.customer.name,
      registrationNumber: body.registrationNumber,
      vehicleTypeId: body.vehicleTypeId,
      ownership: body.ownership,
      make: body.make,
      model: body.model,
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

    if (planWash && body.planOrderId) {
      const used = await placeOrderRepo.useAtShop(c.env.DB, session.shopId, {
        orderId: body.planOrderId,
        jobId: body.id,
        phone: body.customer.phone,
        byUserId: session.sub,
        now,
      });
      if (!used.ok) {
        const winner = await jobRepo.findBoardRow(db, body.id);
        if (winner) return c.json(winner, 200);
        return planInvalid(used.message);
      }
    }
    if (planWash && body.shopPlanId) {
      const used = await shopPlanRepo.use(c.env.DB, session.shopId, {
        orderId: body.shopPlanId,
        jobId: body.id,
        registrationNumber: body.registrationNumber,
        now,
      });
      if (!used.ok) {
        const winner = await jobRepo.findBoardRow(db, body.id);
        if (winner) return c.json(winner, 200);
        return planInvalid(used.message);
      }
    }

    if (freeWash && body.rewardServiceIds) {
      for (const serviceId of body.rewardServiceIds) {
        const claimed = await rewardRepo.claimFree(db, {
          vehicleId: vehicle.id,
          serviceId,
          seq: freeWash.seqs.get(serviceId) ?? 1,
          jobId: body.id,
          userId: session.sub,
          now,
        });
        if (!claimed) {
          const winner = await jobRepo.findBoardRow(db, body.id);
          if (winner) return c.json(winner, 200);
          await rewardRepo.releaseClaims(db, body.id);
          return c.json(
            { error: 'reward_invalid' as const, message: 'This free wash was just used on another wash.' },
            409,
          );
        }
      }
    }

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
        createdAt,
        lineItems: priced.lineItems,
        sellerIds: await resolveSellers(db, priced.lineItems, body.sellerIds, session.sub),
        deliveryMode: body.mode,
        planServiceId: planWash?.serviceId ?? null,
        visitKm: priced.visitKm,
        visitPoint: priced.visitPoint,
      });
      if (priced.visitPoint) await awayPricingRepo.rememberHome(db, customer.id, priced.visitPoint);
      if (priced.priceKept) {
        await db.jobEvent.create({
          data: {
            jobId: body.id,
            userId: session.sub,
            action: 'price_kept',
            fromValue: String(priced.priceKept.today),
            toValue: String(priced.priceKept.quoted),
            reason: 'Prices changed while this wash waited offline; kept the price the customer was told.',
          },
        });
      }
      return c.json(job, 201);
    } catch (e) {
      // A replay of this same request may have created the job first; its coupon, referral and
      // free washes are this job's, so leave them alone.
      const winner = await jobRepo.findBoardRow(db, body.id);
      if (winner) return c.json(await finishReplayedJob(db, winner, body, session.sub, visit), 200);
      if (coupon) await couponRepo.release(db, { couponId: coupon.id, jobId: body.id });
      if (referral) await referralRepo.removeForJob(db, body.id);
      if (freeWash) await rewardRepo.releaseClaims(db, body.id);
      if (planWash) await placeOrderRepo.releaseShopWash(c.env.DB, session.shopId, body.id);
      if (planWash) await shopPlanRepo.release(c.env.DB, session.shopId, body.id);
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
    const [stats, pendingNow, expenses, plans] = await Promise.all([
      jobRepo.getStats(db, window.from, window.to),
      jobRepo.countPending(db),
      expenseRepo.total(db, window.from, window.to),
      placeOrderRepo.income(db, window.from, window.to),
    ]);

    return c.json({
      ...stats,
      pendingNow,
      expenses,
      planIncome: plans.amount,
      planPayments: plans.count,
      net: stats.revenue + plans.amount - expenses,
      ...windowMeta(query, window),
    });
  })
  // Full export payload for PDF — stats, ledger, expenses, staff, stock, GST, prior period, shop contact.
  .get('/stats/export', requireRole('owner'), zValidator('query', reportQuerySchema), async (c) => {
    const db = c.get('db');
    const session = c.get('session');
    const query = c.req.valid('query');
    const window = resolveReportWindow(query);
    if ('error' in window) return c.json({ error: window.error }, 400);

    const durationMs = window.to.getTime() - window.from.getTime();
    const prevFrom = new Date(window.from.getTime() - durationMs);
    const prevTo = window.from;

    const platform = createPlatformDb(c.env.DB);
    const businessId = await catalogRepo.businessForShop(c.env.DB, session.shopId);

    const [
      stats,
      pendingNow,
      expenses,
      jobs,
      plans,
      prevStats,
      prevExpenses,
      prevPlans,
      expenseRows,
      staffRows,
      stockItems,
      rewards,
      area,
      shopRow,
      owners,
      rules,
    ] = await Promise.all([
      jobRepo.getStats(db, window.from, window.to),
      jobRepo.countPending(db),
      expenseRepo.total(db, window.from, window.to),
      jobRepo.listForReport(db, window.from, window.to),
      placeOrderRepo.income(db, window.from, window.to),
      jobRepo.getStats(db, prevFrom, prevTo),
      expenseRepo.total(db, prevFrom, prevTo),
      placeOrderRepo.income(db, prevFrom, prevTo),
      expenseRepo.list(db, window.from, window.to),
      jobRepo.getStaffStats(db, window.from, window.to),
      stockRepo.list(db),
      rewardRepo.report(db, window.from, window.to),
      serviceAreaRepo.get(db),
      platform.shop.findUnique({
        where: { id: session.shopId },
        select: { name: true, city: true, code: true, businessId: true },
      }),
      db.user.findMany({
        where: { role: 'owner', active: true, removedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { name: true, phone: true },
      }),
      businessRules(platform, businessId),
    ]);

    const business =
      shopRow?.businessId != null
        ? await platform.business.findUnique({
            where: { id: shopRow.businessId },
            select: { name: true },
          })
        : null;

    const byCategory = new Map<string, { category: string; amount: number; count: number }>();
    for (const row of expenseRows) {
      if (row.voidedAt) continue;
      const key = row.category;
      const cur = byCategory.get(key) ?? { category: key, amount: 0, count: 0 };
      cur.amount += row.amount;
      cur.count += 1;
      byCategory.set(key, cur);
    }
    const expensesByCategory = [...byCategory.values()]
      .map((r) => ({
        category: r.category,
        label: EXPENSE_CATEGORY_LABEL[r.category as ExpenseCategory] ?? r.category,
        amount: r.amount,
        count: r.count,
      }))
      .sort((a, b) => b.amount - a.amount);

    const gst = gstBreakup(stats.revenue + plans.amount, rules.gstRateBp);

    return c.json({
      generatedAt: new Date().toISOString(),
      ...windowMeta(query, window),
      stats: {
        ...stats,
        pendingNow,
        expenses,
        planIncome: plans.amount,
        planPayments: plans.count,
        net: stats.revenue + plans.amount - expenses,
      },
      previous: {
        from: formatIstDateOnly(prevFrom),
        to: formatIstDateOnly(new Date(prevTo.getTime() - 1)),
        carsWashed: prevStats.carsWashed,
        revenue: prevStats.revenue,
        expenses: prevExpenses,
        planIncome: prevPlans.amount,
        planPayments: prevPlans.count,
        net: prevStats.revenue + prevPlans.amount - prevExpenses,
        cash: prevStats.cash,
        upi: prevStats.upi,
        other: prevStats.other,
        discounts: prevStats.discounts,
        voided: prevStats.voided,
      },
      shop: {
        name: shopRow?.name ?? null,
        city: shopRow?.city ?? null,
        code: shopRow?.code ?? null,
        address: area.contact.address,
        phone: area.contact.phone,
        businessName: business?.name ?? null,
        owners: owners.map((o) => ({ name: o.name, phone: o.phone })),
      },
      gst: {
        rateBp: rules.gstRateBp,
        gstin: rules.gstin,
        legalName: rules.legalName,
        taxable: gst.taxable,
        cgst: gst.cgst,
        sgst: gst.sgst,
      },
      expensesByCategory,
      staff: staffRows
        .filter(
          (r) =>
            r.washesDone +
              r.communityWashes +
              r.servicesSold +
              r.jobsCollected +
              r.commission +
              r.collected >
            0,
        )
        .map((r) => ({
          name: r.name,
          role: r.role,
          washesDone: r.washesDone,
          communityWashes: r.communityWashes,
          servicesSold: r.servicesSold,
          commission: r.commission,
          jobsCollected: r.jobsCollected,
          collected: r.collected,
          cash: r.cash,
          upi: r.upi,
        })),
      stock: stockItems.map((item) => ({
        name: item.name,
        unit: item.unit,
        balance: item.balance,
        lowAt: item.lowAt,
        low: stockLevel(item.balance, item.lowAt) !== 'ok',
      })),
      rewards: {
        freeWashes: rewards.freeWashes,
        freeValue: rewards.freeValue,
        giftsGiven: rewards.giftsGiven,
        giftsOwedNow: rewards.giftsOwedNow,
        gifts: rewards.gifts.map((g) => ({
          name: g.name,
          label: g.label,
          unit: g.unit,
          quantity: g.quantity,
        })),
      },
      jobs: jobs.map((job) => ({
        id: job.id,
        createdAt: job.createdAt.toISOString(),
        completedAt: job.completedAt?.toISOString() ?? null,
        status: job.status,
        total: job.total,
        discount: job.discount,
        discountReason: job.discountReason,
        paymentMethod: job.paymentMethod,
        /** A wash plan sold at the counter: money in, not a car washed. */
        planSale: job.planSaleId != null,
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

    const at = occurredAt(c, body.occurredAt);
    const updated = await jobRepo.updateStatus(db, id, {
      from,
      to: body.status,
      userId: c.get('session').sub,
      at,
      washerIds,
    });
    if (updated) {
      // The customer hears it's ready on WhatsApp, from the business number.
      if (body.status === 'ready') await queueWashMessage(executionCtx(c), c.env, c.get('session').shopId, id, 'ready', at);
      return c.json(updated, 200);
    }
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
    const userId = c.get('session').sub;
    // The referral reward and the welcome gift. Safe to repeat: a retry after a crash part-way
    // only finishes what's missing.
    const settle = async () => {
      await settleReferralForPaidJob(db, id, userId);
      return settleRewardsForPaidJob(db, id, userId);
    };

    const from = job.status as JobStatus;
    if (from === 'paid') {
      await settle();
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

    const paidAt = occurredAt(c, body.occurredAt);
    const paid = await jobRepo.markPaid(db, id, {
      from,
      paymentMethod: body.paymentMethod,
      userId,
      at: paidAt,
    });
    if (!paid) {
      const now = await jobRepo.findBoardRow(db, id);
      const gifted = now?.status === 'paid' && (await settle());
      if (now?.status === 'paid' && now.paymentMethod === body.paymentMethod) {
        return c.json((gifted ? await jobRepo.findBoardRow(db, id) : null) ?? now, 200);
      }
      return c.json(
        {
          error: now?.status === 'paid' ? ('already_paid' as const) : ('invalid_transition' as const),
          message: now?.status === 'paid' ? 'This job was already marked paid.' : `This job is ${now?.status ?? 'gone'} and can’t be paid.`,
          status: now?.status,
        },
        409,
      );
    }
    // A referred customer's first wash is now paid: the referrer earns their reward. A car's
    // first paid wash gets the welcome gift.
    const gifted = await settle();
    // The bill and a thank-you go to the customer on WhatsApp.
    await queueWashMessage(executionCtx(c), c.env, c.get('session').shopId, id, 'bill', paidAt);
    return c.json((gifted ? await jobRepo.findBoardRow(db, id) : null) ?? paid, 200);
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
    if (from === 'void') {
      // A retry after a crash between voiding and the undo steps: finish them (safe to repeat).
      await undoVoidedJobExtras(db, c.env.DB, id, session.sub);
      return c.json(await jobRepo.findBoardRow(db, id), 200);
    }
    if (!canVoidJob(from, session.role)) {
      return c.json(
        { error: 'owner_only' as const, message: 'Only the owner can void a paid job.' },
        403,
      );
    }
    // A plan's sale bill: voiding it cancels the plan, but not once a wash on it is used.
    if (job.planSaleId) {
      const inUse = await shopPlanRepo.saleInUse(db, id);
      if (inUse) return c.json({ error: 'plan_in_use' as const, message: inUse }, 409);
    }

    const voided = await jobRepo.voidJob(db, id, {
      from,
      userId: session.sub,
      reason: body.reason,
      at: occurredAt(c, body.occurredAt),
    });
    if (!voided) {
      // Already voided by someone else (they undo the coupon and referral), or it just got paid
      // and only the owner may void it now.
      const now = await jobRepo.findBoardRow(db, id);
      if (now?.status === 'void') {
        await undoVoidedJobExtras(db, c.env.DB, id, session.sub);
        return c.json(now, 200);
      }
      return c.json(
        { error: 'job_changed' as const, message: 'This job just changed. Check it and try again.', status: now?.status },
        409,
      );
    }
    await undoVoidedJobExtras(db, c.env.DB, id, session.sub);
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
