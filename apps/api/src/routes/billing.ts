import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { billingRepo, createPlatformDb, type DbClient } from '@mana/db';
import {
  FOUNDER_HOLD_CHECKOUT_HOURS,
  FOUNDER_SLOTS,
  founderSlotsAhead,
  PRO_PRICE_PAISE,
  priceKindFor,
  proPricePaise,
  type PlanStatus,
  type PriceKind,
} from '@mana/domain';
import {
  applySubscription,
  recordPayment,
  retireDuplicate,
  shopStatusFor,
  syncShopSubscription,
} from '../lib/billing';
import { loadPlan, ownsOtherPaidProShop } from '../lib/plan';
import {
  billingConfigured,
  cancelSubscription,
  createSubscription,
  fetchSubscription,
  subscriptionNotes,
  verifyWebhookSignature,
  type RazorpayPayment,
  type RazorpaySubscription,
} from '../lib/razorpay';
import { startOfIstMonth } from '../lib/istDate';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';

const subscribeSchema = z.object({ interval: z.enum(['monthly', 'yearly']) });

/** The signed-in owner: their shop, and the phone that links their other branches. */
type Owner = { shopId: string; phone: string };
type BillingShop = NonNullable<Awaited<ReturnType<typeof billingRepo.findPlan>>>;

interface WebhookEvent {
  event?: string;
  payload?: {
    subscription?: { entity?: RazorpaySubscription };
    payment?: { entity?: RazorpayPayment };
  };
}

/** Start the first charge on a future date only if it's at least this far away. */
const MIN_DEFERRED_START_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const unavailable = {
  error: 'billing_unavailable' as const,
  message: 'Payments aren’t reachable right now. Try again in a minute.',
};

function planJson(plan: PlanStatus) {
  return {
    tier: plan.tier,
    state: plan.state,
    endsAt: plan.endsAt?.toISOString() ?? null,
    daysLeft: plan.daysLeft,
    limits: plan.limits,
  };
}

/** What every signed-in phone needs to show the right screens: tier, limits and this month's use. */
async function planSummary(db: DbClient, plan: PlanStatus) {
  const washesThisMonth = await billingRepo.countWashesSince(db, startOfIstMonth());
  return { ...planJson(plan), usage: { washesThisMonth } };
}

/** Paid the founder price before, or holding a slot for a payment that's on its way. */
const hasFounderSlot = (shop: BillingShop | null, now: Date) =>
  Boolean(shop?.founderAt) || (shop?.founderHoldUntil != null && shop.founderHoldUntil > now);

/** Founder, branch or regular — the price this shop would get if it subscribed now. */
async function priceOffer(env: Env, db: DbClient, shop: BillingShop | null, owner: Owner, now = new Date()) {
  const [taken, branch] = await Promise.all([
    billingRepo.countFounderSlotsTaken(db, now),
    ownsOtherPaidProShop(createPlatformDb(env.DB), owner.phone, owner.shopId, now),
  ]);
  const founderSlotsLeft = Math.max(0, FOUNDER_SLOTS - taken);
  const kind = priceKindFor({ founder: hasFounderSlot(shop, now), founderSlotsLeft, branch });
  return { kind, founderSlotsLeft, branch };
}

/**
 * Takes a founder slot for this checkout before the owner pays. Every claim is stamped with the
 * moment it was made and only counts the claims ahead of it, so when two owners grab the last
 * slot at once exactly one keeps it (the earlier stamp, then the lower shop id) and the other
 * lets go and pays the next-best price.
 */
async function claimFounderSlot(db: DbClient, shop: BillingShop, branch: boolean): Promise<PriceKind> {
  const now = new Date();
  if (hasFounderSlot(shop, now)) {
    if (!shop.founderAt) {
      await billingRepo.holdFounderSlot(db, shop.id, new Date(now.getTime() + FOUNDER_HOLD_CHECKOUT_HOURS * HOUR_MS), now);
    }
    return 'founder';
  }
  await billingRepo.holdFounderSlot(db, shop.id, new Date(now.getTime() + FOUNDER_HOLD_CHECKOUT_HOURS * HOUR_MS), now);
  const held = await billingRepo.findPlan(db, shop.id);
  const claims = held?.founderHoldAt ? await billingRepo.listFounderClaims(db, now) : [];
  if (held?.founderHoldAt && founderSlotsAhead(claims, { id: shop.id, holdAt: held.founderHoldAt }, now) < FOUNDER_SLOTS) {
    return 'founder';
  }
  await billingRepo.releaseFounderSlot(db, shop.id);
  return priceKindFor({ founder: false, founderSlotsLeft: 0, branch });
}

/** The price a running subscription was set up with; null when there isn't one. */
function subscribedKind(shop: BillingShop | null): PriceKind | null {
  if (!shop || (shop.plan !== 'active' && shop.plan !== 'past_due')) return null;
  const interval = shop.billingInterval === 'yearly' ? 'yearly' : 'monthly';
  const kinds: PriceKind[] = ['founder', 'branch'];
  return kinds.find((k) => proPricePaise(interval, k) === shop.pricePaise) ?? 'regular';
}

/** The owner's plan screen: the summary plus the subscription, prices on offer and payments. */
async function billingDetail(env: Env, db: DbClient, owner: Owner) {
  const [shop, plan, payments] = await Promise.all([
    billingRepo.findPlan(db, owner.shopId),
    loadPlan(db, owner.shopId),
    billingRepo.listPayments(db),
  ]);
  const { kind, founderSlotsLeft } = await priceOffer(env, db, shop, owner);
  const priceKind = subscribedKind(shop);
  return {
    ...(await planSummary(db, plan)),
    configured: billingConfigured(env),
    subscription: {
      status: shop?.plan ?? 'free',
      interval: (shop?.billingInterval ?? null) as 'monthly' | 'yearly' | null,
      pricePaise: priceKind ? (shop?.pricePaise ?? null) : null,
      priceKind,
      paidUntil: shop?.paidUntil?.toISOString() ?? null,
      founder: Boolean(shop?.founderAt),
    },
    offer: {
      kind,
      founder: kind === 'founder',
      founderSlotsLeft,
      monthlyPaise: proPricePaise('monthly', kind),
      yearlyPaise: proPricePaise('yearly', kind),
      regularMonthlyPaise: PRO_PRICE_PAISE.monthly,
      regularYearlyPaise: PRO_PRICE_PAISE.yearly,
    },
    payments: payments.map((p) => ({
      id: p.id,
      amountPaise: p.amountPaise,
      status: p.status,
      method: p.method,
      paidAt: p.paidAt.toISOString(),
      periodEnd: p.periodEnd?.toISOString() ?? null,
    })),
  };
}

/** Fetches a subscription for the routes below; null when Razorpay can't be reached. */
async function tryFetch(env: Env, id: string): Promise<RazorpaySubscription | null> {
  try {
    return await fetchSubscription(env, id);
  } catch (e) {
    console.error(e);
    return null;
  }
}

function notConfigured(c: Context<{ Bindings: Env }>) {
  return c.json(
    {
      error: 'billing_not_configured' as const,
      message: 'Payments aren’t set up on the server yet.',
    },
    503,
  );
}

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const billingRoutes = new Hono<{ Bindings: Env }>()
  // Everyone: decides which screens and buttons the phone shows. The server enforces the same
  // rules on every request, so this is only for display.
  .get('/plan', requireAuth, async (c) => c.json(await planSummary(c.get('db'), c.get('plan'))))
  .get('/', requireAuth, requireRole('owner'), async (c) =>
    c.json(await billingDetail(c.env, c.get('db'), c.get('session'))),
  )
  // Asks Razorpay again — the phone calls this when the owner comes back from the payment page,
  // so Pro switches on even if the webhook is slow.
  .post('/sync', requireAuth, requireRole('owner'), async (c) => {
    const db = c.get('db');
    const session = c.get('session');
    if (billingConfigured(c.env)) {
      try {
        await syncShopSubscription(c.env, db, session.shopId);
      } catch (e) {
        console.error(e);
      }
    }
    return c.json(await billingDetail(c.env, db, session));
  })
  // Creates a subscription and returns Razorpay's hosted page for UPI AutoPay or card. Upgrading
  // during the trial (or before a cancelled period runs out) keeps those days: the first charge
  // is on the day they end.
  .post('/subscribe', requireAuth, requireRole('owner'), zValidator('json', subscribeSchema), async (c) => {
    if (!billingConfigured(c.env)) return notConfigured(c);
    const { interval } = c.req.valid('json');
    const db = c.get('db');
    const shopId = c.get('session').shopId;
    const shop = await billingRepo.findPlan(db, shopId);
    if (!shop) return c.json({ error: 'not_found' as const }, 404);

    if (shop.subscriptionId && shop.plan !== 'cancelled') {
      const existing = await tryFetch(c.env, shop.subscriptionId);
      if (!existing) return c.json(unavailable, 502);
      await applySubscription(db, shopId, existing);
      const status = shopStatusFor(existing.status);
      if (status === 'active' || status === 'past_due') {
        return c.json(
          {
            error: 'already_subscribed' as const,
            message:
              'You’re already on Pro. To switch between monthly and yearly, cancel first — you keep Pro until the end of what you’ve paid for — then pick the other one.',
          },
          409,
        );
      }
      // An unpaid checkout from before: retire it so there's never more than one live mandate.
      if (existing.status === 'created') {
        try {
          await cancelSubscription(c.env, existing.id);
        } catch (e) {
          console.error(e);
        }
      }
    }

    const offer = await priceOffer(c.env, db, shop, c.get('session'));
    const kind = offer.kind === 'founder' ? await claimFounderSlot(db, shop, offer.branch) : offer.kind;
    const amountPaise = proPricePaise(interval, kind);
    const now = Date.now();
    const carryOver = Math.max(shop.trialEndsAt?.getTime() ?? 0, shop.paidUntil?.getTime() ?? 0);
    const startAt = carryOver - now >= MIN_DEFERRED_START_MS ? new Date(carryOver) : null;

    let sub: RazorpaySubscription;
    try {
      sub = await createSubscription(c.env, db, { shopId, interval, amountPaise, kind, startAt });
    } catch (e) {
      // A founder hold taken above is kept: retrying gets the same slot back, and it lapses on
      // its own if they don't. Releasing here could drop the hold of a parallel request.
      console.error(e);
      return c.json(unavailable, 502);
    }
    const checkoutUrl = sub.short_url;
    const attached =
      Boolean(checkoutUrl) &&
      (await billingRepo.swapSubscription(db, shopId, shop.subscriptionId, {
        plan: 'pending',
        subscriptionId: sub.id,
        billingInterval: interval,
        pricePaise: amountPaise,
      }));
    if (!attached || !checkoutUrl) {
      // Another upgrade for this shop got there first (two taps or two phones at once), or
      // Razorpay gave no checkout page: retire this one so there's never a second live mandate.
      try {
        await cancelSubscription(c.env, sub.id);
      } catch (e) {
        console.error(e);
      }
      if (!checkoutUrl) return c.json(unavailable, 502);
      return c.json(
        {
          error: 'checkout_in_progress' as const,
          message: 'An upgrade for this shop was just started on another tap or phone. Pull down to refresh, then try again if needed.',
        },
        409,
      );
    }
    return c.json({
      checkoutUrl,
      amountPaise,
      interval,
      kind,
      founder: kind === 'founder',
      firstChargeAt: startAt?.toISOString() ?? null,
    });
  })
  // Stops renewals. Pro stays on until the paid period ends; nothing is deleted after that.
  .post('/cancel', requireAuth, requireRole('owner'), async (c) => {
    if (!billingConfigured(c.env)) return notConfigured(c);
    const db = c.get('db');
    const session = c.get('session');
    const shopId = session.shopId;
    const shop = await billingRepo.findPlan(db, shopId);
    if (!shop?.subscriptionId || shop.plan === 'cancelled') {
      return c.json({ error: 'not_subscribed' as const, message: 'There’s no subscription to cancel.' }, 409);
    }
    let sub: RazorpaySubscription;
    try {
      sub = await cancelSubscription(c.env, shop.subscriptionId);
    } catch (e) {
      // Already ended on Razorpay's side (e.g. cancelled from the UPI app): just catch up.
      const current = await tryFetch(c.env, shop.subscriptionId);
      if (!current) {
        console.error(e);
        return c.json(unavailable, 502);
      }
      sub = current;
    }
    await applySubscription(db, shopId, sub);
    return c.json(await billingDetail(c.env, db, session));
  })
  // Razorpay → us. Not signed in: trust comes from the HMAC signature over the raw body. Every
  // delivery is answered 200 once handled (or deliberately ignored) so Razorpay stops retrying;
  // a failure returns 500 so it tries again later. Handling is idempotent either way.
  .post('/webhook', async (c) => {
    const secret = c.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return notConfigured(c);
    const raw = await c.req.text();
    const signature = c.req.header('x-razorpay-signature');
    if (!signature || !(await verifyWebhookSignature(raw, signature, secret))) {
      return c.json({ error: 'invalid_signature' as const }, 400);
    }

    let event: WebhookEvent;
    try {
      event = JSON.parse(raw) as WebhookEvent;
    } catch {
      return c.json({ error: 'bad_request' as const }, 400);
    }

    const db = createPlatformDb(c.env.DB);
    const eventId = c.req.header('x-razorpay-event-id') ?? null;
    if (eventId && (await billingRepo.eventSeen(db, eventId))) return c.json({ ok: true as const });

    const snapshot = event.payload?.subscription?.entity;
    let shopId: string | null = null;
    if (snapshot?.id) {
      const shop =
        (await billingRepo.findPlanBySubscription(db, snapshot.id)) ??
        (subscriptionNotes(snapshot).shop_id
          ? await billingRepo.findPlan(db, subscriptionNotes(snapshot).shop_id!)
          : null);
      if (shop) {
        shopId = shop.id;
        // Webhooks can arrive out of order; the subscription as it stands now is the truth.
        const sub = (billingConfigured(c.env) && (await tryFetch(c.env, snapshot.id))) || snapshot;
        const payment = event.payload?.payment?.entity ?? null;
        // A failure here (Razorpay unreachable) returns 500, so Razorpay delivers again later.
        const duplicate = billingConfigured(c.env) && (await retireDuplicate(c.env, db, shop.id, sub, payment));
        if (!duplicate) {
          await applySubscription(db, shop.id, sub);
          if (payment?.id) await recordPayment(db, shop.id, sub, payment);
        }
      } else {
        console.warn(`billing webhook: no shop for subscription ${snapshot.id}`);
      }
    }
    if (eventId) await billingRepo.recordEvent(db, { id: eventId, event: event.event ?? 'unknown', shopId });
    return c.json({ ok: true as const });
  });
