import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createPlatformDb, createShopDb, joinRequestRepo, shopRepo, userRepo } from '@mana/db';
import {
  checkPin,
  isValidShopCode,
  JOIN_REQUEST_TTL_DAYS,
  JOIN_REQUESTS_PER_SHOP,
  normalizePhone,
  pinProblemMessage,
  SIGNUP_CODES_PER_IP_PER_HOUR,
} from '@mana/domain';
import { checkPhoneCode, sendPhoneCode } from '../lib/phoneCode';
import { phoneBusy, withPhoneLock } from '../lib/phoneLock';
import { hashPin } from '../lib/pin';
import { issueSession } from '../lib/session';
import { createShopWithOwner, signupClosed, signupOpen } from '../lib/shops';
import { createTicket, readTicket } from '../lib/ticket';
import type { Env } from '../types';

const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((p) => /^[6-9]\d{9}$/.test(p), 'Enter a valid 10-digit mobile number');
const purposeSchema = z.enum(['signup', 'join']);

const codeRequestSchema = z.object({ phone: phoneSchema, purpose: purposeSchema });
const codeVerifySchema = z.object({
  phone: phoneSchema,
  purpose: purposeSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'Enter the code'),
});
const createShopSchema = z.object({
  ticket: z.string().min(1),
  pin: z.string(),
  name: z.string().trim().min(1, 'Enter your name').max(60),
  shopName: z.string().trim().min(2, 'Enter the shop name').max(60),
  city: z.string().trim().max(40).optional(),
});
const joinSchema = z.object({
  ticket: z.string().min(1),
  shopCode: z.string().trim(),
  name: z.string().trim().min(1, 'Enter your name').max(60),
});
const requestTokenSchema = z.object({ requestToken: z.string().min(1) });
const completeJoinSchema = z.object({ requestToken: z.string().min(1), pin: z.string() });

const DAY_MS = 24 * 60 * 60 * 1000;

const alreadyRegistered = {
  error: 'already_registered' as const,
  message: 'This number already has an account. Go back and sign in with your PIN.',
};
const ticketExpired = {
  error: 'ticket_expired' as const,
  message: 'This took too long. Start again from your number.',
};
const requestGone = {
  error: 'request_not_found' as const,
  message: 'This request isn’t available any more. Start again from your number.',
};

function codeSubject(purpose: 'signup' | 'join', phone: string) {
  return `${purpose}:${phone}`;
}

function joinRequestCutoff(now: Date) {
  return new Date(now.getTime() - JOIN_REQUEST_TTL_DAYS * DAY_MS);
}

/** The request behind a join ticket, with the shop's name and whether it's still open. */
async function loadJoinRequest(env: Env, requestToken: string) {
  const ticket = await readTicket(requestToken, env.JWT_SECRET, 'join_request');
  if (!ticket?.requestId) return null;
  const platform = createPlatformDb(env.DB);
  const request = await joinRequestRepo.findById(platform, ticket.requestId);
  if (!request || request.phone !== ticket.phone) return null;
  const shop = await shopRepo.findById(platform, request.shopId);
  if (!shop) return null;
  const expired = request.status === 'pending' && request.createdAt < joinRequestCutoff(new Date());
  return {
    request,
    shop,
    status: (expired ? 'expired' : request.status) as
      'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired',
  };
}

function describeJoin(found: NonNullable<Awaited<ReturnType<typeof loadJoinRequest>>>) {
  return {
    status: found.status,
    name: found.request.name,
    shop: { name: found.shop.name, city: found.shop.city, code: found.shop.code },
  };
}

// Everything here runs before the person has an account, so none of it needs a session. Each step
// hands the phone a signed ticket for the next one; nothing is created until the last step.
//
// New shop:  /code → /verify → /shop (PIN, name, shop name) — the shop and owner are made together.
//            Only while sign-up is open (`signupOpen`); every step checks, so an old ticket can't.
// Join shop: /shops/:code → /code → /verify → /join → owner approves in Team → /join/complete (PIN).
export const signupRoutes = new Hono<{ Bindings: Env }>()
  .post('/code', zValidator('json', codeRequestSchema), async (c) => {
    const { phone, purpose } = c.req.valid('json');
    if (purpose === 'signup' && !(await signupOpen(c.env, c.req.url))) {
      return c.json(signupClosed, 403);
    }
    const platform = createPlatformDb(c.env.DB);
    if (await userRepo.findByPhone(platform, phone)) return c.json(alreadyRegistered, 409);

    const sent = await sendPhoneCode({
      env: c.env,
      requestUrl: c.req.url,
      ip: c.req.header('cf-connecting-ip') ?? null,
      phone,
      purpose,
      subject: codeSubject(purpose, phone),
      perIpPerHour: SIGNUP_CODES_PER_IP_PER_HOUR,
    });
    if (!sent.ok) return c.json(sent.body, sent.status);
    return c.json(sent.body);
  })
  .post('/verify', zValidator('json', codeVerifySchema), async (c) => {
    const { phone, purpose, code } = c.req.valid('json');
    if (purpose === 'signup' && !(await signupOpen(c.env, c.req.url))) {
      return c.json(signupClosed, 403);
    }
    const checked = await checkPhoneCode({
      env: c.env,
      phone,
      purpose,
      subject: codeSubject(purpose, phone),
      code,
    });
    if (!checked.ok) return c.json(checked.body, checked.status);
    return c.json({ ticket: await createTicket({ phone, purpose }, c.env.JWT_SECRET) });
  })
  // The last step of a new shop: shop, owner and PIN are created together, so an app closed
  // halfway through leaves nothing behind.
  .post('/shop', zValidator('json', createShopSchema), async (c) => {
    const body = c.req.valid('json');
    if (!(await signupOpen(c.env, c.req.url))) return c.json(signupClosed, 403);
    const ticket = await readTicket(body.ticket, c.env.JWT_SECRET, 'signup');
    if (!ticket) return c.json(ticketExpired, 401);
    const problem = checkPin(body.pin);
    if (problem)
      return c.json({ error: 'weak_pin' as const, message: pinProblemMessage(problem) }, 400);

    const platform = createPlatformDb(c.env.DB);
    const pinHash = await hashPin(body.pin);
    // A double tap (or two phones with the same ticket) must make one shop, not two.
    const owner = await withPhoneLock(c.env, ticket.phone, async () => {
      if (await userRepo.findByPhone(platform, ticket.phone)) return 'taken' as const;
      return createShopWithOwner(c.env, {
        shopName: body.shopName,
        city: body.city || null,
        ownerName: body.name,
        phone: ticket.phone,
        pinHash,
        trial: true,
      });
    });
    if (owner === null) return c.json(phoneBusy, 409);
    if (owner === 'taken') return c.json(alreadyRegistered, 409);
    return c.json(await issueSession(owner, c.env), 201);
  })
  // Shows "Join MANA Car Wash, Hyderabad?" before anything is sent, so a mistyped ID is caught.
  .get('/shops/:code', async (c) => {
    const code = c.req.param('code').replace(/\D/g, '');
    const notFound = {
      error: 'shop_not_found' as const,
      message: 'No shop has this ID. Check the number with your owner.',
    };
    if (!isValidShopCode(code)) return c.json(notFound, 404);
    const shop = await shopRepo.findByCode(createPlatformDb(c.env.DB), code);
    if (!shop) return c.json(notFound, 404);
    return c.json({ code: shop.code, name: shop.name, city: shop.city });
  })
  .post('/join', zValidator('json', joinSchema), async (c) => {
    const body = c.req.valid('json');
    const ticket = await readTicket(body.ticket, c.env.JWT_SECRET, 'join');
    if (!ticket) return c.json(ticketExpired, 401);

    const platform = createPlatformDb(c.env.DB);
    const shop = await shopRepo.findByCode(platform, body.shopCode.replace(/\D/g, ''));
    if (!shop) {
      return c.json({ error: 'shop_not_found' as const, message: 'No shop has this ID.' }, 404);
    }
    if (await userRepo.findByPhone(platform, ticket.phone)) return c.json(alreadyRegistered, 409);

    const now = new Date();
    const db = createShopDb(c.env.DB, shop.id);
    if (
      (await joinRequestRepo.countPending(db, joinRequestCutoff(now))) >= JOIN_REQUESTS_PER_SHOP
    ) {
      return c.json(
        {
          error: 'shop_busy' as const,
          message: 'This shop has too many requests waiting. Ask the owner to check Team first.',
        },
        429,
      );
    }
    // A number has one open request at a time; asking again (here or elsewhere) replaces it.
    await joinRequestRepo.cancelOpenForPhone(platform, ticket.phone, now);
    const request = await joinRequestRepo.create(db, { phone: ticket.phone, name: body.name });
    const requestToken = await createTicket(
      { phone: ticket.phone, purpose: 'join_request', requestId: request.id },
      c.env.JWT_SECRET,
    );
    return c.json(
      {
        requestToken,
        status: 'pending' as const,
        name: request.name,
        shop: { name: shop.name, city: shop.city, code: shop.code },
      },
      201,
    );
  })
  .post('/join/status', zValidator('json', requestTokenSchema), async (c) => {
    const found = await loadJoinRequest(c.env, c.req.valid('json').requestToken);
    if (!found) return c.json(requestGone, 404);
    return c.json(describeJoin(found));
  })
  .post('/join/cancel', zValidator('json', requestTokenSchema), async (c) => {
    const found = await loadJoinRequest(c.env, c.req.valid('json').requestToken);
    if (!found) return c.json(requestGone, 404);
    if (found.request.status === 'pending') {
      await joinRequestRepo.decide(createPlatformDb(c.env.DB), found.request.id, {
        status: 'cancelled',
        now: new Date(),
      });
    }
    return c.json({ ok: true as const });
  })
  // After the owner approves: the new teammate picks their own PIN and is signed in.
  .post('/join/complete', zValidator('json', completeJoinSchema), async (c) => {
    const body = c.req.valid('json');
    const found = await loadJoinRequest(c.env, body.requestToken);
    if (!found) return c.json(requestGone, 404);
    if (found.status !== 'approved' || !found.request.userId) {
      return c.json(
        {
          error: 'not_approved' as const,
          message: 'The owner hasn’t approved this request yet.',
          ...describeJoin(found),
        },
        409,
      );
    }

    const db = createShopDb(c.env.DB, found.request.shopId);
    const user = await userRepo.findMember(db, found.request.userId);
    if (!user) return c.json(requestGone, 404);
    if (!user.active) return c.json({ error: 'account_disabled' as const }, 403);
    if (user.pinHash) {
      return c.json(
        {
          error: 'pin_already_set' as const,
          message: 'You already have a PIN. Sign in with your number and PIN.',
        },
        409,
      );
    }
    const problem = checkPin(body.pin);
    if (problem)
      return c.json({ error: 'weak_pin' as const, message: pinProblemMessage(problem) }, 400);

    const withPin = await userRepo.setPinHash(db, user.id, await hashPin(body.pin));
    return c.json(await issueSession(withPin, c.env));
  });
