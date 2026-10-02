import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createPlatformDb,
  createShopDb,
  joinRequestRepo,
  shopRepo,
  signupCodeRepo,
  userRepo,
} from '@mana/db';
import {
  checkPin,
  isValidShopCode,
  JOIN_REQUEST_TTL_DAYS,
  JOIN_REQUESTS_PER_SHOP,
  LOGIN_CODE_MAX_ATTEMPTS,
  LOGIN_CODE_RESEND_SECONDS,
  LOGIN_CODE_TTL_MINUTES,
  LOGIN_CODES_PER_HOUR,
  normalizePhone,
  pinProblemMessage,
  SIGNUP_CODES_PER_IP_PER_HOUR,
} from '@mana/domain';
import {
  bypassWhatsAppOtp,
  generateLoginCode,
  hashLoginCode,
  loginCodeExpiry,
  sendLoginCodeOnWhatsApp,
  whatsappConfigured,
} from '../lib/loginCode';
import { hashPin } from '../lib/pin';
import { devCode, sameHex } from '../lib/recovery';
import { issueSession } from '../lib/session';
import { createShopWithOwner } from '../lib/shops';
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

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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
// Join shop: /shops/:code → /code → /verify → /join → owner approves in Team → /join/complete (PIN).
export const signupRoutes = new Hono<{ Bindings: Env }>()
  .post('/code', zValidator('json', codeRequestSchema), async (c) => {
    const { phone, purpose } = c.req.valid('json');
    const platform = createPlatformDb(c.env.DB);
    if (await userRepo.findByPhone(platform, phone)) return c.json(alreadyRegistered, 409);

    const now = new Date();
    const recent = await signupCodeRepo.listForPhoneSince(
      platform,
      phone,
      new Date(now.getTime() - HOUR_MS),
    );
    const latest = recent[0];
    if (latest) {
      const wait = Math.ceil(
        LOGIN_CODE_RESEND_SECONDS - (now.getTime() - latest.createdAt.getTime()) / 1000,
      );
      if (wait > 0) return c.json({ error: 'too_soon' as const, retryAfter: wait }, 429);
    }
    const tooMany = (retryAfter: number) =>
      c.json(
        {
          error: 'too_many' as const,
          retryAfter,
          message: `Too many codes asked for. Try again in ${Math.ceil(retryAfter / 60)} min.`,
        },
        429,
      );
    if (recent.length >= LOGIN_CODES_PER_HOUR) {
      const oldest = recent[recent.length - 1]!;
      return tooMany(Math.ceil((oldest.createdAt.getTime() + HOUR_MS - now.getTime()) / 1000));
    }
    const ip = c.req.header('cf-connecting-ip') ?? null;
    if (
      ip &&
      (await signupCodeRepo.countForIpSince(platform, ip, new Date(now.getTime() - HOUR_MS))) >=
        SIGNUP_CODES_PER_IP_PER_HOUR
    ) {
      return tooMany(60 * 60);
    }

    const bypass = bypassWhatsAppOtp(c.env, c.req.url);
    if (!bypass && !whatsappConfigured(c.env)) {
      return c.json(
        {
          error: 'code_not_configured' as const,
          message: 'WhatsApp codes aren’t set up on the server yet.',
        },
        503,
      );
    }

    const code = bypass ? devCode(c.env) : generateLoginCode();
    const row = await signupCodeRepo.create(platform, {
      phone,
      purpose,
      codeHash: await hashLoginCode(code, codeSubject(purpose, phone), c.env.JWT_SECRET),
      ip,
      expiresAt: loginCodeExpiry(now),
    });
    await signupCodeRepo.retireOthers(platform, phone, row.id, now);

    if (!bypass && !(await sendLoginCodeOnWhatsApp(c.env, phone, code))) {
      await signupCodeRepo.consume(platform, row.id, now);
      return c.json(
        {
          error: 'send_failed' as const,
          message: 'Couldn’t send the WhatsApp message. Try again in a minute.',
        },
        502,
      );
    }
    return c.json({
      sent: true as const,
      expiresInMinutes: LOGIN_CODE_TTL_MINUTES,
      resendAfter: LOGIN_CODE_RESEND_SECONDS,
    });
  })
  .post('/verify', zValidator('json', codeVerifySchema), async (c) => {
    const { phone, purpose, code } = c.req.valid('json');
    const platform = createPlatformDb(c.env.DB);
    const now = new Date();
    const expired = {
      error: 'code_expired' as const,
      message: 'This code has expired or was replaced. Tap “Send a new code”.',
    };
    const live = await signupCodeRepo.findLive(
      platform,
      phone,
      purpose,
      now,
      LOGIN_CODE_MAX_ATTEMPTS,
    );
    if (!live) return c.json(expired, 410);

    const attemptsLeft = await signupCodeRepo.reserveGuess(platform, live.id, LOGIN_CODE_MAX_ATTEMPTS);
    if (attemptsLeft == null) {
      return c.json({ ...expired, message: 'Too many wrong tries. Tap “Send a new code”.' }, 410);
    }
    const expected = await hashLoginCode(code, codeSubject(purpose, phone), c.env.JWT_SECRET);
    if (!sameHex(expected, live.codeHash)) {
      if (attemptsLeft <= 0) {
        return c.json({ ...expired, message: 'Too many wrong tries. Tap “Send a new code”.' }, 410);
      }
      return c.json(
        { error: 'invalid_code' as const, message: 'That code isn’t right.', attemptsLeft },
        401,
      );
    }
    if (!(await signupCodeRepo.consume(platform, live.id, now))) return c.json(expired, 410);
    return c.json({ ticket: await createTicket({ phone, purpose }, c.env.JWT_SECRET) });
  })
  // The last step of a new shop: shop, owner and PIN are created together, so an app closed
  // halfway through leaves nothing behind.
  .post('/shop', zValidator('json', createShopSchema), async (c) => {
    const body = c.req.valid('json');
    const ticket = await readTicket(body.ticket, c.env.JWT_SECRET, 'signup');
    if (!ticket) return c.json(ticketExpired, 401);
    const problem = checkPin(body.pin);
    if (problem)
      return c.json({ error: 'weak_pin' as const, message: pinProblemMessage(problem) }, 400);

    const platform = createPlatformDb(c.env.DB);
    if (await userRepo.findByPhone(platform, ticket.phone)) return c.json(alreadyRegistered, 409);

    try {
      const owner = await createShopWithOwner(c.env, {
        shopName: body.shopName,
        city: body.city || null,
        ownerName: body.name,
        phone: ticket.phone,
        pinHash: await hashPin(body.pin),
      });
      return c.json(await issueSession(owner, c.env), 201);
    } catch (e) {
      // Two sign-ups for the same number at once: the other one won.
      if (await userRepo.findByPhone(platform, ticket.phone)) return c.json(alreadyRegistered, 409);
      throw e;
    }
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
