import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  businessRules,
  createPlatformDb,
  createShopDb,
  customerAccountRepo,
  customerAppRepo,
  paymentRepo,
  placeOrderRepo,
  placeRepo,
  placeView,
  planRepo,
  type CustomerLink,
} from '@mana/db';
import {
  distanceMeters,
  firstWashDay,
  isPlaceCode,
  parseWashDays,
  payDeadline,
  SINGLE_PER_WEEK,
} from '@mana/domain';
import { createCustomerToken } from '../lib/customerToken';
import { cancelOrder, paymentsNotReady, startPayment, syncPayment } from '../lib/placePayments';
import { daySchema, idSchema, joinFields, joinInput, placeError, placePhotoType } from '../lib/places';
import { readTicket } from '../lib/ticket';
import { requireCustomer } from '../middleware/customer';
import type { Env } from '../types';

/**
 * The MANA Car Wash app's side of places and plans: finding a served place (nearby, or from a
 * QR poster / neighbour's link), joining it with flat and vehicles, and then managing each
 * vehicle's plan — paying, skipping, pausing, cancelling, renewing — and its receipts.
 * Looking at places is public (like prices); everything about a customer is their own only.
 */

const placeNotFound = { error: 'not_found' as const, message: 'This place isn’t on MANA Car Wash any more.' };
const codeNotFound = { error: 'not_found' as const, message: 'No place has this code. Check the code on the poster.' };
const orderNotFound = { error: 'not_found' as const, message: 'This plan isn’t in your account.' };
const ticketExpired = { error: 'ticket_expired' as const, message: 'Please sign in again with your number.' };

const joinSchema = z.object(joinFields);
const ticketJoinSchema = z.object({ ticket: z.string().min(1), placeId: idSchema, ...joinFields });
const nearQuery = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });
const reasonSchema = z.object({ reason: z.string().trim().max(200).nullish() });
const pauseSchema = z.object({ fromOn: daySchema, toOn: daySchema });

/** First wash day for each pace a place's plans run at, so the app can say "First wash Tue 14 Oct". */
function firstWashes(washDaysText: string, perWeeks: number[], rules: Parameters<typeof firstWashDay>[0]['rules'], now: Date) {
  const washDays = parseWashDays(washDaysText);
  return Object.fromEntries(
    [...new Set([...perWeeks, SINGLE_PER_WEEK])].map((perWeek) => {
      const day = firstWashDay({ washDays, perWeek, now, rules });
      return [String(perWeek), day ? { day, payBy: payDeadline(day, rules).toISOString() } : null];
    }),
  );
}

async function signIn(env: Env, phone: string) {
  const platform = createPlatformDb(env.DB);
  const links = await customerAppRepo.links(platform, phone);
  if (!links.length) return null;
  const account = await customerAccountRepo.ensure(platform, phone, new Date());
  const token = await createCustomerToken({ sub: account.id, phone, sv: account.sessionVersion }, env.JWT_SECRET);
  return {
    token,
    account: {
      phone,
      name: links.find((l) => l.customerName)?.customerName ?? null,
      branches: links.map((l) => ({ id: l.shopId, name: l.shopName, city: l.city })),
    },
  };
}

function linkOf(links: CustomerLink[], shopId: string) {
  return links.find((l) => l.shopId === shopId) ?? null;
}

export const customerPlaceRoutes = new Hono<{ Bindings: Env }>()
  // ---------- Finding a place (public) ----------
  .get('/places/near', zValidator('query', nearQuery), async (c) => {
    const { lat, lng } = c.req.valid('query');
    const places = await placeRepo.nearby(createPlatformDb(c.env.DB), { latitude: lat, longitude: lng }, new Date());
    return c.json({ places });
  })
  .get('/places/by-code/:code', zValidator('param', z.object({ code: z.string().toUpperCase() })), async (c) => {
    const code = c.req.valid('param').code;
    if (!isPlaceCode(code)) return c.json(codeNotFound, 404);
    const found = await placeRepo.byCode(createPlatformDb(c.env.DB), code);
    if (!found) return c.json(codeNotFound, 404);
    return c.json({ place: { ...placeView(found.place, new Date()), branchName: found.branchName } });
  })
  /** Everything the join screens need: the place, its flats, what can be bought and when it starts. */
  .get('/places/:id', zValidator('param', z.object({ id: idSchema })), async (c) => {
    const pdb = createPlatformDb(c.env.DB);
    const found = await placeRepo.publicFind(pdb, c.req.valid('param').id);
    if (!found) return c.json(placeNotFound, 404);
    const { place } = found;
    const shop = await pdb.shop.findUnique({ where: { id: place.shopId }, select: { businessId: true, contactPhone: true } });
    const rules = await businessRules(pdb, shop?.businessId ?? null);
    const now = new Date();
    const [units, menu] = await Promise.all([
      placeRepo.units(createShopDb(c.env.DB, place.shopId), place.id),
      planRepo.menu(pdb, place.shopId, shop?.businessId ?? null, rules.priceMode),
    ]);
    return c.json({
      place: { ...placeView(place, now), branchId: place.shopId, branchName: found.branchName, branchPhone: shop?.contactPhone ?? null },
      units,
      menu,
      firstWash: firstWashes(place.washDays, menu.plans.map((p) => p.perWeek), rules, now),
      rules: {
        partsFirstPct: rules.partsFirstPct,
        partsCount: rules.partsCount,
        payDeadlineTime: rules.payDeadlineTime,
        skipCutoffTime: rules.skipCutoffTime,
        atPlaceMeters: rules.atPlaceMeters,
        gstRateBp: rules.gstRateBp,
      },
    });
  })
  .get('/places/:id/photo', zValidator('param', z.object({ id: idSchema })), async (c) => {
    const key = await placeRepo.photoKey(createPlatformDb(c.env.DB), c.req.valid('param').id);
    const object = key ? await c.env.PHOTOS.get(key) : null;
    if (!object) return c.json({ error: 'not_found' as const }, 404);
    return c.body(object.body, 200, { 'Content-Type': placePhotoType(key!), 'Cache-Control': 'public, max-age=86400' });
  })

  // ---------- Joining ----------
  /** A new number (signed in with a service-request ticket): joining makes them a customer. */
  .post('/join', zValidator('json', ticketJoinSchema), async (c) => {
    const body = c.req.valid('json');
    const ticket = await readTicket(body.ticket, c.env.JWT_SECRET, 'service_request');
    if (!ticket) return c.json(ticketExpired, 401);
    const pdb = createPlatformDb(c.env.DB);
    const found = await placeRepo.publicFind(pdb, body.placeId);
    if (!found) return c.json(placeNotFound, 404);
    try {
      const joined = await placeOrderRepo.join(
        c.env.DB,
        joinInput(body, {
          placeId: found.place.id,
          phone: ticket.phone,
          distanceM: body.location ? distanceMeters(body.location, found.place) : null,
          byUserId: null,
        }),
      );
      // Their open "Call me back" is answered: they're a member now.
      await pdb.serviceRequest.updateMany({
        where: { phone: ticket.phone, status: { in: ['pending', 'out_of_area'] } },
        data: { status: 'approved', handledAt: new Date(), reason: `Joined ${found.place.label}`, customerId: joined.customerId },
      });
      const session = await signIn(c.env, ticket.phone);
      return c.json({ ...joined, session }, 201);
    } catch (e) {
      return placeError(c, e);
    }
  })
  /** A signed-in customer joining a place, or adding vehicles to one they're in. */
  .post('/places/:id/join', requireCustomer, zValidator('param', z.object({ id: idSchema })), zValidator('json', joinSchema), async (c) => {
    const body = c.req.valid('json');
    const found = await placeRepo.publicFind(createPlatformDb(c.env.DB), c.req.valid('param').id);
    if (!found) return c.json(placeNotFound, 404);
    const link = linkOf(c.get('customerLinks'), found.place.shopId);
    try {
      const joined = await placeOrderRepo.join(
        c.env.DB,
        joinInput(
          { ...body, name: body.name ?? link?.customerName ?? null },
          {
            placeId: found.place.id,
            phone: c.get('customer').phone,
            distanceM: body.location ? distanceMeters(body.location, found.place) : null,
            byUserId: null,
          },
        ),
      );
      return c.json(joined, 201);
    } catch (e) {
      return placeError(c, e);
    }
  })

  // ---------- My places and plans ----------
  .get('/home/places', requireCustomer, async (c) => {
    const memberships = await placeRepo.mine(c.env.DB, c.get('customerLinks'), new Date());
    return c.json({ memberships });
  })
  .post('/members/:id/leave', requireCustomer, zValidator('param', z.object({ id: idSchema })), zValidator('json', reasonSchema), async (c) => {
    const id = c.req.valid('param').id;
    for (const link of c.get('customerLinks')) {
      const member = await createShopDb(c.env.DB, link.shopId).placeMember.findFirst({
        where: { id, customerId: link.customerId },
        select: { id: true },
      });
      if (!member) continue;
      const ended = await placeRepo.end(c.env.DB, link.shopId, id, {
        status: 'left',
        reason: c.req.valid('json').reason || 'Moved out',
        byUserId: null,
      });
      if (!ended) return c.json({ error: 'not_open' as const, message: 'You already left this place.' }, 409);
      for (const orderId of ended.orderIds) await cancelOrder(c.env, link.shopId, orderId, 'customer', 'Moved out');
      return c.json({ ok: true as const });
    }
    return c.json({ error: 'not_found' as const, message: 'This place isn’t in your account.' }, 404);
  })
  .get('/orders/:id', requireCustomer, zValidator('param', z.object({ id: idSchema })), async (c) => {
    const id = c.req.valid('param').id;
    const link = await placeOrderRepo.findForCustomer(c.env.DB, c.get('customerLinks'), id);
    if (!link) return c.json(orderNotFound, 404);
    const order = await placeOrderRepo.detail(c.env.DB, link.shopId, id, new Date());
    if (!order) return c.json(orderNotFound, 404);
    const payments = await paymentRepo.forOrder(createShopDb(c.env.DB, link.shopId), id);
    return c.json({
      order,
      /** Paid parts, newest first; each has a receipt. */
      receipts: payments
        .filter((p) => p.status === 'paid' && p.receiptNo)
        .map((p) => ({ paymentId: p.id, receiptNo: p.receiptNo!, amount: p.amount, refunded: p.refunded, paidAt: p.paidAt?.toISOString() ?? null })),
    });
  })
  .post('/orders/:id/pay', requireCustomer, zValidator('param', z.object({ id: idSchema })), async (c) => {
    const id = c.req.valid('param').id;
    const link = await placeOrderRepo.findForCustomer(c.env.DB, c.get('customerLinks'), id);
    if (!link) return c.json(orderNotFound, 404);
    try {
      const payment = await startPayment(c.env, c.req.url, link.shopId, id, 'customer');
      if (!payment) return c.json(paymentsNotReady, 503);
      return c.json({ payment });
    } catch (e) {
      return placeError(c, e);
    }
  })
  .post('/orders/:id/skip', requireCustomer, zValidator('param', z.object({ id: idSchema })), zValidator('json', z.object({ day: daySchema })), async (c) => {
    const id = c.req.valid('param').id;
    const link = await placeOrderRepo.findForCustomer(c.env.DB, c.get('customerLinks'), id);
    if (!link) return c.json(orderNotFound, 404);
    try {
      await placeOrderRepo.skip(c.env.DB, link.shopId, id, c.req.valid('json').day, new Date());
      return c.json({ order: await placeOrderRepo.detail(c.env.DB, link.shopId, id, new Date()) });
    } catch (e) {
      return placeError(c, e);
    }
  })
  .post('/orders/:id/unskip', requireCustomer, zValidator('param', z.object({ id: idSchema })), zValidator('json', z.object({ day: daySchema })), async (c) => {
    const id = c.req.valid('param').id;
    const link = await placeOrderRepo.findForCustomer(c.env.DB, c.get('customerLinks'), id);
    if (!link) return c.json(orderNotFound, 404);
    try {
      await placeOrderRepo.unskip(c.env.DB, link.shopId, id, c.req.valid('json').day, new Date());
      return c.json({ order: await placeOrderRepo.detail(c.env.DB, link.shopId, id, new Date()) });
    } catch (e) {
      return placeError(c, e);
    }
  })
  .post('/orders/:id/pauses', requireCustomer, zValidator('param', z.object({ id: idSchema })), zValidator('json', pauseSchema), async (c) => {
    const id = c.req.valid('param').id;
    const link = await placeOrderRepo.findForCustomer(c.env.DB, c.get('customerLinks'), id);
    if (!link) return c.json(orderNotFound, 404);
    try {
      await placeOrderRepo.pause(c.env.DB, link.shopId, id, c.req.valid('json'), new Date());
      return c.json({ order: await placeOrderRepo.detail(c.env.DB, link.shopId, id, new Date()) });
    } catch (e) {
      return placeError(c, e);
    }
  })
  .delete('/orders/:id/pauses/:pauseId', requireCustomer, zValidator('param', z.object({ id: idSchema, pauseId: idSchema })), async (c) => {
    const { id, pauseId } = c.req.valid('param');
    const link = await placeOrderRepo.findForCustomer(c.env.DB, c.get('customerLinks'), id);
    if (!link) return c.json(orderNotFound, 404);
    try {
      await placeOrderRepo.endPause(c.env.DB, link.shopId, id, pauseId, new Date());
      return c.json({ order: await placeOrderRepo.detail(c.env.DB, link.shopId, id, new Date()) });
    } catch (e) {
      return placeError(c, e);
    }
  })
  .post('/orders/:id/cancel', requireCustomer, zValidator('param', z.object({ id: idSchema })), zValidator('json', reasonSchema), async (c) => {
    const id = c.req.valid('param').id;
    const link = await placeOrderRepo.findForCustomer(c.env.DB, c.get('customerLinks'), id);
    if (!link) return c.json(orderNotFound, 404);
    const result = await cancelOrder(c.env, link.shopId, id, 'customer', c.req.valid('json').reason || null);
    if (!result) return c.json({ error: 'not_open' as const, message: 'This plan has already ended.' }, 409);
    return c.json({ refund: result.refund, order: await placeOrderRepo.detail(c.env.DB, link.shopId, id, new Date()) });
  })
  .post(
    '/orders/:id/renew',
    requireCustomer,
    zValidator('param', z.object({ id: idSchema })),
    zValidator('json', z.object({ payMode: z.enum(['full', 'parts']).default('full') })),
    async (c) => {
      const id = c.req.valid('param').id;
      const link = await placeOrderRepo.findForCustomer(c.env.DB, c.get('customerLinks'), id);
      if (!link) return c.json(orderNotFound, 404);
      try {
        const newId = await placeOrderRepo.renew(c.env.DB, link.shopId, id, c.req.valid('json').payMode, new Date());
        return c.json({ order: await placeOrderRepo.detail(c.env.DB, link.shopId, newId, new Date()) }, 201);
      } catch (e) {
        return placeError(c, e);
      }
    },
  )

  // ---------- Payments and receipts ----------
  /** Where a payment stands; asks Razorpay when it's still open (the app polls after checkout). */
  .get('/payments/:id', requireCustomer, zValidator('param', z.object({ id: idSchema })), async (c) => {
    const id = c.req.valid('param').id;
    const links = c.get('customerLinks');
    const payment = await paymentRepo.find(createPlatformDb(c.env.DB), id);
    if (!payment || !links.some((l) => l.shopId === payment.shopId && l.customerId === payment.customerId)) {
      return c.json({ error: 'not_found' as const, message: 'Payment not found.' }, 404);
    }
    const fresh = await syncPayment(c.env, payment);
    return c.json({
      payment: {
        id: fresh.id,
        status: fresh.status as 'created' | 'paid' | 'failed' | 'expired',
        amount: fresh.amount,
        orderId: fresh.orderId,
        receiptNo: fresh.receiptNo,
        paidAt: fresh.paidAt?.toISOString() ?? null,
      },
    });
  })
  .get('/receipts/:id', requireCustomer, zValidator('param', z.object({ id: idSchema })), async (c) => {
    const id = c.req.valid('param').id;
    const payment = await paymentRepo.find(createPlatformDb(c.env.DB), id);
    const link = payment && c.get('customerLinks').find((l) => l.shopId === payment.shopId && l.customerId === payment.customerId);
    if (!payment || !link) return c.json({ error: 'not_found' as const, message: 'Receipt not found.' }, 404);
    const receipt = await paymentRepo.receipt(c.env.DB, link.shopId, id);
    return receipt ? c.json({ receipt }) : c.json({ error: 'not_found' as const, message: 'Receipt not found.' }, 404);
  });
