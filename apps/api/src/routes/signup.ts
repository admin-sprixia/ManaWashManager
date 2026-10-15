import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createPlatformDb, createShopDb, joinRequestRepo, securityRepo, shopRepo, userRepo } from '@mana/db';
import {
  checkPin,
  isSeniorRole,
  isValidShopCode,
  JOIN_REQUEST_TTL_DAYS,
  JOIN_REQUESTS_PER_SHOP,
  normalizePhone,
  pinProblemMessage,
  SIGNUP_CODES_PER_IP_PER_HOUR,
} from '@mana/domain';
import { checkPhoneCode, sendPhoneCode } from '../lib/phoneCode';
import { hashPin } from '../lib/pin';
import { deviceHash, deviceLabel } from '../lib/device';
import { issueSession } from '../lib/session';
import { createTicket, readTicket } from '../lib/ticket';
import type { Env } from '../types';

const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((p) => /^[6-9]\d{9}$/.test(p), 'Enter a valid 10-digit mobile number');
const purposeSchema = z.literal('join', {
  errorMap: () => ({ message: 'New branches are opened by Mana Wash HQ. Ask your manager for the branch ID.' }),
});

const codeRequestSchema = z.object({ phone: phoneSchema, purpose: purposeSchema });
const codeVerifySchema = z.object({
  phone: phoneSchema,
  purpose: purposeSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'Enter the code'),
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

const shopNotFound = {
  error: 'shop_not_found' as const,
  message: 'No branch has this ID. Check the number with your owner or manager.',
};
const shopPaused = {
  error: 'branch_paused' as const,
  message: 'This branch is paused by Mana Wash HQ and isn’t taking new team members right now.',
};

/** A branch people can ask to join: closed ones don't exist as far as joining goes. */
async function joinableShop(env: Env, rawCode: string) {
  const code = rawCode.replace(/\D/g, '');
  if (!isValidShopCode(code)) return { problem: shopNotFound, status: 404 as const };
  const shop = await shopRepo.findByCode(createPlatformDb(env.DB), code);
  if (!shop || shop.status === 'closed') return { problem: shopNotFound, status: 404 as const };
  if (shop.status === 'paused') return { problem: shopPaused, status: 409 as const };
  return { shop };
}

function codeSubject(purpose: 'join', phone: string) {
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
// There is no way to start a shop here: branches are opened by HQ (routes/business.ts).
//
// Join a branch: /shops/:code → /code → /verify → /join → owner approves in Team → /join/complete (PIN).
export const signupRoutes = new Hono<{ Bindings: Env }>()
  .post('/code', zValidator('json', codeRequestSchema), async (c) => {
    const { phone, purpose } = c.req.valid('json');
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
  // Shows "Join Mana Wash, Hyderabad?" before anything is sent, so a mistyped ID is caught.
  .get('/shops/:code', async (c) => {
    const found = await joinableShop(c.env, c.req.param('code'));
    if (!found.shop) return c.json(found.problem, found.status);
    const { shop } = found;
    return c.json({ code: shop.code, name: shop.name, city: shop.city });
  })
  .post('/join', zValidator('json', joinSchema), async (c) => {
    const body = c.req.valid('json');
    const ticket = await readTicket(body.ticket, c.env.JWT_SECRET, 'join');
    if (!ticket) return c.json(ticketExpired, 401);

    const platform = createPlatformDb(c.env.DB);
    const found = await joinableShop(c.env, body.shopCode);
    if (!found.shop) return c.json(found.problem, found.status);
    const { shop } = found;
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
  // After the owner approves: the new teammate picks their own PIN and is signed in. They proved
  // the number with a WhatsApp code at the start, so this phone is trusted for it.
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
    const problem = checkPin(body.pin, isSeniorRole(user.role));
    if (problem)
      return c.json({ error: 'weak_pin' as const, message: pinProblemMessage(problem) }, 400);

    const withPin = await userRepo.setPinHash(db, user.id, { hash: await hashPin(body.pin), digits: body.pin.length });
    const device = await deviceHash(c);
    if (device) await securityRepo.trust(createPlatformDb(c.env.DB), user.phone, device, { label: deviceLabel(c), pinConfirmed: true });
    return c.json(await issueSession(withPin, c.env, device));
  });
