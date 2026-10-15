import { sameHex } from './recovery';
import type { Env } from '../types';

/**
 * Razorpay over its REST API (no SDK — it doesn't run on Workers). Customers pay for plans and
 * place washes on Razorpay's hosted Payment Links, so no payment details ever touch the app or
 * this server. Test keys (rzp_test_…) and live keys work the same way.
 */

const API = 'https://api.razorpay.com/v1';

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
