import { billingRepo, type DbClient } from '@mana/db';
import { FOUNDER_HOLD_RETRY_DAYS, type SubscriptionStatus } from '@mana/domain';
import { reportError } from './alerts';
import {
  cancelSubscription,
  fetchSubscription,
  refundPayment,
  subscriptionNotes,
  type RazorpayPayment,
  type RazorpaySubscription,
  type RazorpaySubscriptionStatus,
} from './razorpay';
import type { Env } from '../types';

/** Razorpay's subscription status → the status kept on the shop. */
export function shopStatusFor(status: RazorpaySubscriptionStatus): SubscriptionStatus {
  switch (status) {
    case 'created':
      return 'pending';
    case 'authenticated':
    case 'active':
      return 'active';
    case 'pending':
    case 'halted':
    case 'paused':
      return 'past_due';
    case 'cancelled':
    case 'completed':
    case 'expired':
      return 'cancelled';
  }
}

const fromUnix = (seconds: number) => new Date(seconds * 1000);
const DAY_MS = 24 * 60 * 60 * 1000;

/** AutoPay approved (first charge maybe still to come) or charging normally. */
const isLive = (sub: Pick<RazorpaySubscription, 'status'>) =>
  sub.status === 'active' || sub.status === 'authenticated';

/**
 * Brings the shop in line with one of its Razorpay subscriptions. Safe to run any number of
 * times and in any order: paid_until only ever moves forward, the founder date is set once, and
 * a subscription the shop has since replaced can't change the shop's status.
 */
export async function applySubscription(
  db: DbClient,
  shopId: string,
  sub: RazorpaySubscription,
  now = new Date(),
): Promise<void> {
  const shop = await billingRepo.findPlan(db, shopId);
  if (!shop) return;
  const notes = subscriptionNotes(sub);
  const current = !shop.subscriptionId || shop.subscriptionId === sub.id;
  // The owner opened two checkouts and paid the older one: that's the live subscription now.
  const live = isLive(sub);
  const adopt = !current && live && shop.plan !== 'active' && shop.plan !== 'past_due';

  const paidCycle = sub.status === 'active' || sub.status === 'cancelled' || sub.status === 'completed';
  if (sub.paid_count > 0 && sub.current_end && paidCycle) {
    await billingRepo.extendPaidUntil(db, shopId, fromUnix(sub.current_end));
  }
  if (sub.paid_count > 0 && notes.founder === '1') {
    await billingRepo.markFounder(db, shopId, now);
  }
  if (notes.founder === '1' && sub.paid_count === 0 && (current || adopt)) {
    if (live) {
      // AutoPay approved, first charge still to come (often the end of the trial): keep the slot
      // until then plus Razorpay's retries.
      const due = sub.charge_at ?? sub.start_at;
      const dueAt = due ? fromUnix(due).getTime() : now.getTime();
      await billingRepo.holdFounderSlot(db, shopId, new Date(dueAt + FOUNDER_HOLD_RETRY_DAYS * DAY_MS), now);
    } else if (shopStatusFor(sub.status) === 'cancelled') {
      await billingRepo.releaseFounderSlot(db, shopId);
    }
  }
  if (current || adopt) {
    const interval = notes.interval === 'monthly' || notes.interval === 'yearly' ? notes.interval : undefined;
    const amount = Number(notes.amount_paise);
    await billingRepo.updateSubscription(db, shopId, {
      plan: shopStatusFor(sub.status),
      subscriptionId: sub.id,
      ...(interval ? { billingInterval: interval } : {}),
      ...(Number.isInteger(amount) && amount >= 0 ? { pricePaise: amount } : {}),
    });
  }
}

/**
 * A shop must never pay twice. If a second subscription goes live while the shop's own one is
 * still running — two checkouts opened at once, or an old link that couldn't be retired — the
 * second is cancelled and any charge on it refunded, and Sprixia is alerted. Returns true when
 * `sub` was such a duplicate (the caller must then not apply it).
 */
export async function retireDuplicate(
  env: Env,
  db: DbClient,
  shopId: string,
  sub: RazorpaySubscription,
  payment: RazorpayPayment | null,
): Promise<boolean> {
  const shop = await billingRepo.findPlan(db, shopId);
  if (!shop?.subscriptionId || shop.subscriptionId === sub.id || !isLive(sub)) return false;
  if (shop.plan !== 'active' && shop.plan !== 'past_due') return false;
  // Our record could be stale (a cancel webhook that never came): only a running one counts.
  const own = await fetchSubscription(env, shop.subscriptionId);
  if (!isLive(own)) return false;

  await cancelSubscription(env, sub.id);
  let refunded = false;
  if (payment?.status === 'captured') {
    await refundPayment(env, payment.id);
    refunded = true;
  }
  await reportError(env, {
    source: 'api',
    shopId,
    message: `Duplicate subscription ${sub.id} cancelled${refunded ? ` and payment ${payment!.id} refunded` : ''}; the shop stays on ${own.id}.`,
    context: 'billing',
  });
  return true;
}

/** Records one charge for the payment history. Razorpay amounts are already in paise. */
export async function recordPayment(
  db: DbClient,
  shopId: string,
  sub: RazorpaySubscription,
  payment: RazorpayPayment,
): Promise<void> {
  const status = payment.status === 'captured' ? 'captured' : payment.status === 'refunded' ? 'refunded' : 'failed';
  await billingRepo.upsertPayment(db, {
    id: payment.id,
    shopId,
    subscriptionId: sub.id,
    amountPaise: payment.amount,
    status,
    method: payment.method ?? null,
    periodEnd: status === 'captured' && sub.current_end ? fromUnix(sub.current_end) : null,
    paidAt: fromUnix(payment.created_at),
  });
}

/** Re-reads the shop's subscription from Razorpay and applies it — the fallback when a webhook is late. */
export async function syncShopSubscription(env: Env, db: DbClient, shopId: string): Promise<void> {
  const shop = await billingRepo.findPlan(db, shopId);
  if (!shop?.subscriptionId) return;
  const sub = await fetchSubscription(env, shop.subscriptionId);
  await applySubscription(db, shopId, sub);
}
