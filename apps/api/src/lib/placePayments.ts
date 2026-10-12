import { createPlatformDb, createShopDb, paymentRepo, placeOrderRepo, type PaymentRow } from '@mana/db';
import { formatInr } from '@mana/domain';
import { reportError } from './alerts';
import {
  billingConfigured,
  cancelPaymentLink,
  createPaymentLink,
  fetchPaymentLink,
  refundAmount,
  type RazorpayPaymentLink,
} from './razorpay';
import { usesTestCodes } from './recovery';
import type { Env } from '../types';

/**
 * Customers pay for plans and place washes online only, through Razorpay Payment Links: a hosted
 * checkout that works the same in the app and in a link the team sends by WhatsApp (Flow E).
 * A payment is confirmed by whichever comes first — the webhook, the customer's return from the
 * checkout, the app asking, or the nightly check — and confirming twice changes nothing.
 * Without Razorpay keys, local dev and staging use a test checkout page instead.
 */

/** How long a link can be paid: a day from the app, three days when the team sends it. */
const LINK_HOURS = { customer: 24, staff: 72 } as const;
const RECONCILE_BATCH = 100;
const REFUND_RETRY_BATCH = 50;

export type PaymentsMode = 'razorpay' | 'test';

export function paymentsMode(env: Env, requestUrl: string): PaymentsMode | null {
  if (billingConfigured(env)) return 'razorpay';
  return usesTestCodes(env, requestUrl) ? 'test' : null;
}

export const paymentsNotReady = {
  error: 'payments_not_ready' as const,
  message: 'Online payment isn’t set up yet. Please call the branch.',
};

export interface StartedPayment {
  id: string;
  url: string;
  amount: number;
  expiresAt: string;
}

/**
 * A checkout link for the next part due on an order. A still-valid link for the same part is
 * reused, so tapping "Pay" twice never makes two payments.
 */
export async function startPayment(
  env: Env,
  requestUrl: string,
  shopId: string,
  orderId: string,
  by: 'customer' | 'staff',
  now = new Date(),
): Promise<StartedPayment | null> {
  const mode = paymentsMode(env, requestUrl);
  if (!mode) return null;
  const { order, installment, open, shop, rules } = await paymentRepo.prepare(env.DB, shopId, orderId, now);
  if (open?.linkUrl && open.provider === mode) {
    return { id: open.id, url: open.linkUrl, amount: open.amount, expiresAt: open.expiresAt.toISOString() };
  }
  const origin = new URL(requestUrl).origin;
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + LINK_HOURS[by] * 60 * 60 * 1000);
  let linkId: string | null = null;
  let url = `${origin}/pay/test/${id}`;
  if (mode === 'razorpay') {
    const link = await createPaymentLink(env, {
      referenceId: id,
      amountPaise: installment.amount,
      description: `${shop.name} · ${order.title} · ${order.member.place.label}${installment.seq > 1 ? ` (part ${installment.seq})` : ''}`,
      customer: { name: order.customer.name, phone: order.customer.phone },
      callbackUrl: `${origin}/pay/return`,
      expiresAt,
      notes: { payment_id: id, shop_id: shopId, order_id: orderId },
    });
    linkId = link.id;
    url = link.short_url;
  }
  await paymentRepo.create(env.DB, {
    id,
    shopId,
    customerId: order.customerId,
    orderId,
    installmentId: installment.id,
    amount: installment.amount,
    provider: mode,
    linkId,
    linkUrl: url,
    gstRateBp: rules.gstRateBp,
    createdBy: by,
    expiresAt,
  });
  return { id, url, amount: installment.amount, expiresAt: expiresAt.toISOString() };
}

/**
 * Records a successful payment and deals with the two unlucky cases: the part was already paid
 * through another link, or the order was cancelled while the customer was paying. Either way
 * the money goes straight back.
 */
export async function confirmPaid(
  env: Env,
  paymentId: string,
  provider: { paymentId: string | null; method: string | null },
  now = new Date(),
) {
  const done = await paymentRepo.markPaid(env.DB, paymentId, { providerPaymentId: provider.paymentId, method: provider.method, now });
  if (done.result === 'duplicate' && provider.paymentId) {
    const payment = await paymentRepo.find(createPlatformDb(env.DB), paymentId);
    if (payment) await providerRefund(env, payment.provider, provider.paymentId, payment.amount, 'Paid twice').catch((e) => report(env, e, done.shopId));
  }
  if (done.result === 'paid' && done.orderStatus === 'cancelled' && done.shopId && done.orderId) {
    const payment = await paymentRepo.find(createPlatformDb(env.DB), paymentId);
    if (payment) await refundPayments(env, done.shopId, done.orderId, payment.amount, 'Order was cancelled while paying', [payment]);
  }
  return done;
}

/** Asks Razorpay where an open link stands and records the outcome. Returns the fresh row. */
export async function syncPayment(env: Env, payment: PaymentRow, now = new Date()): Promise<PaymentRow> {
  if (payment.status !== 'created') return payment;
  if (payment.provider === 'razorpay' && payment.linkId && billingConfigured(env)) {
    let link: RazorpayPaymentLink;
    try {
      link = await fetchPaymentLink(env, payment.linkId);
    } catch (e) {
      console.error(e);
      return payment;
    }
    await applyLinkState(env, payment, link, now);
  } else if (payment.expiresAt.getTime() <= now.getTime()) {
    await paymentRepo.close(env.DB, payment.id, 'expired');
  }
  return (await paymentRepo.find(createPlatformDb(env.DB), payment.id)) ?? payment;
}

/** One link's state (from a fetch or a webhook) applied to its payment row. */
export async function applyLinkState(env: Env, payment: PaymentRow, link: RazorpayPaymentLink, now = new Date()) {
  if (link.status === 'paid') {
    const captured = link.payments?.find((p) => p.status === 'captured') ?? link.payments?.[0] ?? null;
    await confirmPaid(env, payment.id, { paymentId: captured?.payment_id ?? null, method: captured?.method ?? null }, now);
  } else if (link.status === 'expired' || link.status === 'cancelled') {
    await paymentRepo.close(env.DB, payment.id, 'expired');
  } else if (payment.expiresAt.getTime() <= now.getTime()) {
    await cancelPaymentLink(env, link.id).catch(() => undefined);
    await paymentRepo.close(env.DB, payment.id, 'expired');
  }
}

async function providerRefund(env: Env, provider: string, providerPaymentId: string | null, amount: number, note: string) {
  if (provider === 'test') return `test_rfnd_${crypto.randomUUID().slice(0, 12)}`;
  if (!providerPaymentId) throw new Error('Payment has no Razorpay payment id to refund');
  return refundAmount(env, providerPaymentId, amount, note);
}

function report(env: Env, e: unknown, shopId: string | null) {
  console.error(e);
  return reportError(env, {
    source: 'api',
    message: `Customer refund failed: ${e instanceof Error ? e.message : String(e)}`,
    stack: e instanceof Error ? e.stack : undefined,
    context: 'placePayments',
    shopId,
  });
}

/**
 * Sends `amount` back across the order's paid payments, newest first. Each refund is recorded
 * before Razorpay is asked, so a failed call stays "pending" and the nightly job retries it.
 */
export async function refundPayments(
  env: Env,
  shopId: string,
  orderId: string,
  amount: number,
  reason: string,
  only?: PaymentRow[],
): Promise<number> {
  let left = amount;
  const payments = only ?? (await paymentRepo.refundable(createShopDb(env.DB, shopId), orderId));
  for (const p of payments) {
    if (left <= 0) break;
    const take = Math.min(left, p.amount - p.refunded);
    if (take <= 0) continue;
    const refundId = await paymentRepo.addRefund(env.DB, { shopId, paymentId: p.id, orderId, amount: take, reason });
    if (!refundId) continue;
    left -= take;
    try {
      const providerRefundId = await providerRefund(env, p.provider, p.providerPaymentId, take, reason);
      await paymentRepo.settleRefund(env.DB, refundId, { status: 'processed', providerRefundId });
    } catch (e) {
      await report(env, e, shopId);
    }
  }
  return amount - left;
}

/** Cancels an order and refunds what the refund rule says. */
export async function cancelOrder(
  env: Env,
  shopId: string,
  orderId: string,
  by: 'customer' | 'staff' | 'system',
  reason: string | null,
) {
  const result = await placeOrderRepo.cancel(env.DB, shopId, orderId, { by, reason, now: new Date() });
  if (!result) return null;
  const refunded = result.refund > 0 ? await refundPayments(env, shopId, orderId, result.refund, reason ?? 'Cancelled') : 0;
  return { ...result, refunded };
}

/** Nightly: open links checked with Razorpay (a webhook may have been missed). */
export async function reconcilePayments(env: Env, now = new Date()) {
  const open = await paymentRepo.openLinks(createPlatformDb(env.DB), RECONCILE_BATCH);
  for (const p of open) await syncPayment(env, p, now);
}

/** Nightly: refunds whose Razorpay call failed earlier. */
export async function retryRefunds(env: Env) {
  const pending = await paymentRepo.pendingRefunds(createPlatformDb(env.DB), REFUND_RETRY_BATCH);
  for (const r of pending) {
    try {
      const providerRefundId = await providerRefund(env, r.payment.provider, r.payment.providerPaymentId, r.amount, 'Refund');
      await paymentRepo.settleRefund(env.DB, r.id, { status: 'processed', providerRefundId });
    } catch (e) {
      await report(env, e, r.shopId);
    }
  }
}

/** The WhatsApp text the team sends with a payment link (Flow E). */
export function paymentLinkMessage(input: { name: string | null; amount: number; title: string; place: string; url: string }) {
  const hello = input.name ? `Hello ${input.name},` : 'Hello,';
  return `${hello} please pay ${formatInr(input.amount)} for your MANA Car Wash ${input.title} at ${input.place}: ${input.url}`;
}
