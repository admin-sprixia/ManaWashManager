import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createPlatformDb, paymentRepo, type PaymentRow } from '@mana/db';
import { formatInr } from '@mana/domain';
import { esc, openAppButton, page } from '../lib/pages';
import { applyLinkState, confirmPaid, paymentsMode, syncPayment } from '../lib/placePayments';
import { verifyPaymentLinkReturn, verifyWebhookSignature, type RazorpayPaymentLink } from '../lib/razorpay';
import type { Env } from '../types';

/**
 * Public payment pages and Razorpay's webhook. People land here from the Razorpay checkout (in
 * the app's browser or from a WhatsApp link), so every page explains what happened in plain
 * words and offers a way back into the app.
 */

const idParam = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });

function resultPage(payment: PaymentRow | null) {
  if (!payment) {
    return page('Payment', `<main><div class="card"><div class="badge bad">!</div><h1>Payment not found</h1>
<p>Open the Mana Wash app to see your plan.</p>${openAppButton('home')}</div></main>`);
  }
  const back = openAppButton(`payment/${payment.id}`, 'Back to Mana Wash');
  if (payment.status === 'paid') {
    return page('Payment received', `<main><div class="card"><div class="badge ok">✓</div><h1>Payment received</h1>
<div class="amount">${esc(formatInr(payment.amount))}</div>
<p>Receipt ${esc(payment.receiptNo)}. See you on your wash day!</p>${back}</div></main>`);
  }
  if (payment.status === 'created') {
    return page('Checking payment', `<main><div class="card"><div class="badge wait">…</div><h1>Checking your payment</h1>
<p>This can take a minute. If money was taken, it will show in the app shortly — you don’t need to pay again.</p>${back}</div></main>`);
  }
  return page('Payment not done', `<main><div class="card"><div class="badge bad">✕</div><h1>The payment didn’t go through</h1>
<p>No money was taken. Please try again from the app.</p>${back}</div></main>`);
}

export const payRoutes = new Hono<{ Bindings: Env }>()
  /** Razorpay sends the customer here after the checkout, with a signed summary in the URL. */
  .get('/return', async (c) => {
    const q = c.req.query();
    const pdb = createPlatformDb(c.env.DB);
    const referenceId = q.razorpay_payment_link_reference_id ?? '';
    let payment = referenceId ? await paymentRepo.find(pdb, referenceId) : null;
    if (payment && payment.status === 'created') {
      const signed =
        q.razorpay_payment_link_status === 'paid' &&
        q.razorpay_payment_link_id === payment.linkId &&
        (await verifyPaymentLinkReturn(c.env, {
          linkId: q.razorpay_payment_link_id ?? '',
          referenceId,
          status: q.razorpay_payment_link_status ?? '',
          paymentId: q.razorpay_payment_id ?? '',
          signature: q.razorpay_signature ?? '',
        }));
      if (signed) await confirmPaid(c.env, payment.id, { paymentId: q.razorpay_payment_id ?? null, method: null });
      else await syncPayment(c.env, payment);
      payment = await paymentRepo.find(pdb, payment.id);
    }
    return c.html(resultPage(payment));
  })
  .get('/done/:id', zValidator('param', idParam), async (c) => {
    return c.html(resultPage(await paymentRepo.find(createPlatformDb(c.env.DB), c.req.valid('param').id)));
  })

  // ---------- Test checkout (local dev and staging without Razorpay keys) ----------
  .get('/test/:id', zValidator('param', idParam), async (c) => {
    const payment = await paymentRepo.find(createPlatformDb(c.env.DB), c.req.valid('param').id);
    if (!payment || payment.provider !== 'test' || paymentsMode(c.env, c.req.url) !== 'test') return c.html(resultPage(null), 404);
    if (payment.status !== 'created') return c.html(resultPage(payment));
    return c.html(
      page(
        'Test payment',
        `<main><div class="card"><p class="small">TEST CHECKOUT · no real money</p><h1>Mana Wash</h1>
<div class="amount">${esc(formatInr(payment.amount))}</div>
<form method="post"><button class="btn primary" name="action" value="pay">Pay ${esc(formatInr(payment.amount))}</button>
<button class="btn danger" name="action" value="fail">Make it fail</button></form></div></main>`,
      ),
    );
  })
  .post('/test/:id', zValidator('param', idParam), zValidator('form', z.object({ action: z.enum(['pay', 'fail']) })), async (c) => {
    const id = c.req.valid('param').id;
    const payment = await paymentRepo.find(createPlatformDb(c.env.DB), id);
    if (!payment || payment.provider !== 'test' || paymentsMode(c.env, c.req.url) !== 'test') return c.html(resultPage(null), 404);
    if (payment.status === 'created') {
      if (c.req.valid('form').action === 'pay') {
        await confirmPaid(c.env, id, { paymentId: `test_pay_${crypto.randomUUID().slice(0, 12)}`, method: 'test' });
      } else {
        await paymentRepo.close(c.env.DB, id, 'failed');
      }
    }
    return c.redirect(`/pay/done/${id}`, 303);
  })

  // ---------- Razorpay webhook ----------
  /** payment_link.paid / expired / cancelled. Signed with the webhook secret; replays change nothing. */
  .post('/webhook', async (c) => {
    const secret = c.env.RAZORPAY_WEBHOOK_SECRET;
    const body = await c.req.text();
    const signature = c.req.header('x-razorpay-signature') ?? '';
    if (!secret || !(await verifyWebhookSignature(body, signature, secret))) {
      return c.json({ error: 'bad_signature' as const }, 400);
    }
    const event = JSON.parse(body) as {
      event?: string;
      payload?: {
        payment_link?: { entity?: RazorpayPaymentLink };
        payment?: { entity?: { id: string; method?: string | null; status: string; amount: number } };
      };
    };
    const link = event.payload?.payment_link?.entity;
    if (!link?.id || !event.event?.startsWith('payment_link.')) return c.json({ ok: true as const, ignored: true });
    const payment = await paymentRepo.findByLink(createPlatformDb(c.env.DB), link.id);
    if (!payment) return c.json({ ok: true as const, ignored: true });
    const paid = event.payload?.payment?.entity;
    if (event.event === 'payment_link.paid' && paid) {
      await confirmPaid(c.env, payment.id, { paymentId: paid.id, method: paid.method ?? null });
    } else {
      await applyLinkState(c.env, payment, link);
    }
    return c.json({ ok: true as const });
  });
