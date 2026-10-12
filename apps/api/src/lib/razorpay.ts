import { platformSettingsRepo, type DbClient } from '@mana/db';
import type { BillingInterval, PriceKind } from '@mana/domain';
import { sameHex } from './recovery';
import type { Env } from '../types';

/**
 * Razorpay Subscriptions over its REST API (no SDK — it doesn't run on Workers). Shops pay for
 * Pro on Razorpay's hosted page (UPI AutoPay or card), so no payment details ever touch the app
 * or this server. Test keys (rzp_test_…) and live keys work the same way.
 *
 * Docs: https://razorpay.com/docs/api/payments/subscriptions/
 */

const API = 'https://api.razorpay.com/v1';

/** Months/years a subscription runs before Razorpay ends it; effectively "until cancelled". */
const TOTAL_COUNT: Record<BillingInterval, number> = { monthly: 120, yearly: 10 };

/** An unpaid checkout link stops working after this long; asking again makes a fresh one. */
const CHECKOUT_LINK_HOURS = 48;

export type RazorpaySubscriptionStatus =
  | 'created'
  | 'authenticated'
  | 'active'
  | 'pending'
  | 'halted'
  | 'paused'
  | 'cancelled'
  | 'completed'
  | 'expired';

export interface RazorpaySubscription {
  id: string;
  plan_id: string;
  status: RazorpaySubscriptionStatus;
  /** Unix seconds; the current paid cycle. Null before the first charge. */
  current_start: number | null;
  current_end: number | null;
  /** Unix seconds; when the first charge is due (end of the trial, or now). */
  start_at?: number | null;
  /** Unix seconds; when Razorpay will next try to charge. */
  charge_at?: number | null;
  paid_count: number;
  short_url?: string;
  notes?: Record<string, string> | unknown[];
}

export interface RazorpayPayment {
  id: string;
  amount: number;
  status: string;
  method?: string | null;
  created_at: number;
}

export class RazorpayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Real Razorpay key IDs start with rzp_test_ or rzp_live_. Anything else (empty, or a placeholder
 * kept until the account exists) reads as "payments aren't set up yet" instead of failing at checkout.
 */
export function billingConfigured(env: Env): boolean {
  return /^rzp_(test|live)_/.test(env.RAZORPAY_KEY_ID ?? '') && Boolean(env.RAZORPAY_KEY_SECRET);
}

function apiBase(env: Env): string {
  return env.RAZORPAY_API_BASE && env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') ? env.RAZORPAY_API_BASE : API;
}

async function call<T>(env: Env, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const res = await fetch(apiBase(env) + path, {
    method,
    headers: {
      authorization: `Basic ${auth}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON error page; reported below with the status.
  }
  if (!res.ok) {
    const description =
      (json as { error?: { description?: string } } | null)?.error?.description ?? text.slice(0, 200);
    throw new RazorpayError(res.status, `Razorpay ${method} ${path} → ${res.status}: ${description}`);
  }
  return json as T;
}

const PLAN_NAME_SUFFIX: Record<PriceKind, string> = {
  regular: '',
  founder: ' (founder price)',
  branch: ' (branch price)',
};

/**
 * The Razorpay plan for this price, created on first use and remembered. Keyed by the key id
 * too, so test-mode and live-mode plans never mix. Branch plans get their own key so the owner's
 * Razorpay statement says "branch price" even though the amount matches the founder price.
 */
async function planId(env: Env, db: DbClient, interval: BillingInterval, amountPaise: number, kind: PriceKind) {
  const key = `razorpay_plan:${env.RAZORPAY_KEY_ID}:${interval}:${amountPaise}${kind === 'branch' ? ':branch' : ''}`;
  const cached = await platformSettingsRepo.get(db, key);
  if (cached) return cached;
  const plan = await call<{ id: string }>(env, 'POST', '/plans', {
    period: interval,
    interval: 1,
    item: {
      name: `MANA Pro${PLAN_NAME_SUFFIX[kind]} — ${interval}`,
      amount: amountPaise,
      currency: 'INR',
      description: 'MANA Wash Manager Pro plan',
    },
  });
  await platformSettingsRepo.set(db, key, plan.id);
  return plan.id;
}

export async function createSubscription(
  env: Env,
  db: DbClient,
  input: {
    shopId: string;
    interval: BillingInterval;
    amountPaise: number;
    kind: PriceKind;
    /** First charge on this date (end of the trial or of a period already paid); else now. */
    startAt: Date | null;
  },
): Promise<RazorpaySubscription> {
  const plan = await planId(env, db, input.interval, input.amountPaise, input.kind);
  const now = Date.now();
  return call<RazorpaySubscription>(env, 'POST', '/subscriptions', {
    plan_id: plan,
    total_count: TOTAL_COUNT[input.interval],
    quantity: 1,
    customer_notify: 1,
    ...(input.startAt ? { start_at: Math.floor(input.startAt.getTime() / 1000) } : {}),
    expire_by: Math.floor((now + CHECKOUT_LINK_HOURS * 60 * 60 * 1000) / 1000),
    notes: {
      shop_id: input.shopId,
      founder: input.kind === 'founder' ? '1' : '0',
      price: input.kind,
      interval: input.interval,
      amount_paise: String(input.amountPaise),
    },
  });
}

export async function fetchSubscription(env: Env, id: string): Promise<RazorpaySubscription> {
  return call<RazorpaySubscription>(env, 'GET', `/subscriptions/${encodeURIComponent(id)}`);
}

/** Stops future charges now. The shop keeps Pro until the end of what it already paid for. */
export async function cancelSubscription(env: Env, id: string): Promise<RazorpaySubscription> {
  return call<RazorpaySubscription>(env, 'POST', `/subscriptions/${encodeURIComponent(id)}/cancel`, {
    cancel_at_cycle_end: 0,
  });
}

/** Full refund of one payment. */
export async function refundPayment(env: Env, paymentId: string): Promise<void> {
  await call(env, 'POST', `/payments/${encodeURIComponent(paymentId)}/refund`, {});
}

// ─── Payment Links (customers paying for plans and place washes) ─────────────
// Docs: https://razorpay.com/docs/api/payments/payment-links/

export type PaymentLinkStatus = 'created' | 'partially_paid' | 'paid' | 'expired' | 'cancelled';

export interface RazorpayPaymentLink {
  id: string;
  short_url: string;
  status: PaymentLinkStatus;
  amount: number;
  amount_paid?: number;
  reference_id?: string;
  payments?: { payment_id: string; amount: number; method?: string | null; status: string }[] | null;
}

/** A hosted checkout for one amount; the customer comes back to `callbackUrl` after paying. */
export async function createPaymentLink(
  env: Env,
  input: {
    referenceId: string;
    amountPaise: number;
    description: string;
    customer: { name: string | null; phone: string };
    callbackUrl: string;
    expiresAt: Date;
    notes: Record<string, string>;
  },
): Promise<RazorpayPaymentLink> {
  return call<RazorpayPaymentLink>(env, 'POST', '/payment_links', {
    amount: input.amountPaise,
    currency: 'INR',
    accept_partial: false,
    reference_id: input.referenceId,
    description: input.description.slice(0, 2048),
    customer: { contact: `+91${input.customer.phone}`, ...(input.customer.name ? { name: input.customer.name } : {}) },
    notify: { sms: false, email: false },
    reminder_enable: false,
    expire_by: Math.floor(input.expiresAt.getTime() / 1000),
    callback_url: input.callbackUrl,
    callback_method: 'get',
    notes: input.notes,
  });
}

export async function fetchPaymentLink(env: Env, id: string): Promise<RazorpayPaymentLink> {
  return call<RazorpayPaymentLink>(env, 'GET', `/payment_links/${encodeURIComponent(id)}`);
}

export async function cancelPaymentLink(env: Env, id: string): Promise<void> {
  await call(env, 'POST', `/payment_links/${encodeURIComponent(id)}/cancel`, {});
}

/** Refunds part (or all) of a payment; returns Razorpay's refund id. */
export async function refundAmount(env: Env, paymentId: string, amountPaise: number, note: string): Promise<string> {
  const refund = await call<{ id: string }>(env, 'POST', `/payments/${encodeURIComponent(paymentId)}/refund`, {
    amount: amountPaise,
    speed: 'normal',
    notes: { reason: note.slice(0, 200) },
  });
  return refund.id;
}

/**
 * The redirect back from a paid link carries a signature over the link id, reference, status
 * and payment id, made with the key secret: proof the "paid" in the URL came from Razorpay.
 */
export async function verifyPaymentLinkReturn(
  env: Env,
  q: { linkId: string; referenceId: string; status: string; paymentId: string; signature: string },
): Promise<boolean> {
  if (!env.RAZORPAY_KEY_SECRET) return false;
  return verifyWebhookSignature(`${q.linkId}|${q.referenceId}|${q.status}|${q.paymentId}`, q.signature, env.RAZORPAY_KEY_SECRET);
}

export function subscriptionNotes(sub: RazorpaySubscription): Record<string, string> {
  return sub.notes && !Array.isArray(sub.notes) ? sub.notes : {};
}

/** Razorpay signs each webhook body with HMAC-SHA256 using the webhook secret (hex). */
export async function verifyWebhookSignature(body: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sameHex(hex, signature.trim().toLowerCase());
}
