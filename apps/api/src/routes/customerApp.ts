import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createPlatformDb,
  createShopDb,
  customerAccountRepo,
  customerAppRepo,
  customerCareRepo,
  customerRepo,
  serviceAreaRepo,
  serviceRequestRepo,
  type CustomerLink,
  type CustomerWashView,
} from '@mana/db';
import {
  branchFor,
  CUSTOMER_NAME_MAX,
  isValidRegistration,
  nearestBranch,
  normalizePhone,
  normalizeRegistration,
  PLACE_KINDS,
  PREFERRED_TIMES,
  PROBLEM_DETAILS_MAX,
  PROBLEM_DETAILS_MIN,
  PROBLEM_KINDS,
  RATING_COMMENT_MAX,
  RATING_WINDOW_DAYS,
  VEHICLE_MAKE_MAX,
  MAX_VEHICLES_PER_REQUEST,
  SERVICE_REQUEST_ADDRESS_MAX,
  SERVICE_REQUEST_NOTES_MAX,
  SIGNUP_CODES_PER_IP_PER_HOUR,
} from '@mana/domain';
import { createCustomerToken } from '../lib/customerToken';
import { checkPhoneCode, sendPhoneCode } from '../lib/phoneCode';
import { createTicket, readTicket } from '../lib/ticket';
import { requireCustomer } from '../middleware/customer';
import type { Env } from '../types';

const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((p) => /^[6-9]\d{9}$/.test(p), 'Enter a valid 10-digit mobile number');
const codeSchema = z.string().trim().regex(/^\d{4,8}$/, 'Enter the code');
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid id');
const pointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const placeSchema = z
  .object({ location: pointSchema.nullish(), areaId: idSchema.nullish() })
  .refine((p) => p.location || p.areaId, 'Share your location or pick your area');

const requestSchema = z
  .object({
    ticket: z.string().min(1),
    name: z.string().trim().min(1, 'Enter your name').max(60),
    location: pointSchema.nullish(),
    areaId: idSchema.nullish(),
    address: z.string().trim().min(5, 'Enter your address').max(SERVICE_REQUEST_ADDRESS_MAX),
    placeKind: z.enum(PLACE_KINDS),
    placeName: optionalText(80),
    homeText: optionalText(40),
    cars: z.number().int().min(0).max(MAX_VEHICLES_PER_REQUEST),
    bikes: z.number().int().min(0).max(MAX_VEHICLES_PER_REQUEST),
    preferredTime: z.enum(PREFERRED_TIMES).nullish(),
    notes: optionalText(SERVICE_REQUEST_NOTES_MAX),
  })
  .refine((r) => r.cars + r.bikes >= 1, 'Add at least one car or bike')
  .refine((r) => r.location || r.areaId, 'Share your location or pick your area');

const ticketSchema = z.object({ ticket: z.string().min(1) });
const washesQuerySchema = z.object({
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const profileSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(CUSTOMER_NAME_MAX),
});
const ratingSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: optionalText(RATING_COMMENT_MAX),
});
const problemSchema = z.object({
  washId: idSchema.nullish(),
  branchId: idSchema.nullish(),
  kind: z.enum(PROBLEM_KINDS),
  details: z
    .string()
    .trim()
    .min(PROBLEM_DETAILS_MIN, 'Tell us a little more, so the team can help')
    .max(PROBLEM_DETAILS_MAX),
});
const vehicleRequestSchema = z.object({
  branchId: idSchema,
  registrationNumber: z
    .string()
    .transform(normalizeRegistration)
    .refine(isValidRegistration, 'Enter the registration number, e.g. AP39AB1234'),
  vehicleTypeId: idSchema,
  make: optionalText(VEHICLE_MAKE_MAX),
  model: optionalText(VEHICLE_MAKE_MAX),
});

const branchNotFound = { error: 'branch_not_found' as const, message: 'Pick your branch again.' };

/** One of the customer's own branches, or null — never a branch they aren't a customer of. */
function linkFor(links: CustomerLink[], branchId: string | null | undefined): CustomerLink | null {
  return links.find((l) => l.shopId === branchId) ?? null;
}

const ticketExpired = {
  error: 'ticket_expired' as const,
  message: 'Please sign in again with your number.',
};
const notOpen = {
  error: 'not_open' as const,
  message: 'MANA Car Wash isn’t taking requests in the app yet. Please call us.',
};
const alreadyCustomer = {
  error: 'already_customer' as const,
  message: 'You’re already a MANA customer. Sign in again to see your cars and washes.',
};
const washNotFound = { error: 'not_found' as const, message: 'This wash isn’t available.' };

type RequestRow = Awaited<ReturnType<typeof serviceRequestRepo.listForPhone>>[number];

function requestView(r: RequestRow) {
  return {
    id: r.id,
    status: r.status as 'pending' | 'out_of_area' | 'approved' | 'rejected' | 'cancelled',
    name: r.name,
    address: r.address,
    placeKind: r.placeKind,
    placeName: r.placeName,
    homeText: r.homeText,
    cars: r.cars,
    bikes: r.bikes,
    preferredTime: r.preferredTime,
    notes: r.notes,
    reason: r.reason,
    location: r.latitude != null && r.longitude != null ? { latitude: r.latitude, longitude: r.longitude } : null,
    area: r.area ? { id: r.area.id, name: r.area.name } : null,
    branch: r.branch ? { name: r.branch.name, city: r.branch.city } : null,
    createdAt: r.createdAt.toISOString(),
    handledAt: r.handledAt?.toISOString() ?? null,
  };
}

function accountView(phone: string, links: CustomerLink[]) {
  return {
    phone,
    name: links.find((l) => l.customerName)?.customerName ?? null,
    branches: links.map((l) => ({ id: l.shopId, name: l.shopName, city: l.city })),
  };
}

/** Newest first across branches; ties broken by id so paging never skips or repeats. */
function byNewest(a: CustomerWashView, b: CustomerWashView) {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

/** The listed branch whose shop-scoped client finds this wash (or photo) for this customer. */
async function findAcross<T>(
  env: Env,
  links: CustomerLink[],
  load: (db: ReturnType<typeof createShopDb>, link: CustomerLink) => Promise<T | null>,
): Promise<{ value: T; link: CustomerLink } | null> {
  for (const link of links) {
    const value = await load(createShopDb(env.DB, link.shopId), link);
    if (value) return { value, link };
  }
  return null;
}

// The MANA Car Wash app. Everything a customer reads goes through `requireCustomer` and is limited
// to the branches where their own phone is a customer. A number the car wash hasn't registered
// gets a service-request ticket instead of a sign-in: it can ask for service and follow that
// request, nothing else.
export const customerAppRoutes = new Hono<{ Bindings: Env }>()
  // ---------- Sign in ----------
  .post('/auth/code', zValidator('json', z.object({ phone: phoneSchema })), async (c) => {
    const { phone } = c.req.valid('json');
    const sent = await sendPhoneCode({
      env: c.env,
      requestUrl: c.req.url,
      ip: c.req.header('cf-connecting-ip') ?? null,
      phone,
      purpose: 'customer',
      subject: `customer:${phone}`,
      perIpPerHour: SIGNUP_CODES_PER_IP_PER_HOUR,
    });
    if (!sent.ok) return c.json(sent.body, sent.status);
    return c.json(sent.body);
  })
  .post('/auth/verify', zValidator('json', z.object({ phone: phoneSchema, code: codeSchema })), async (c) => {
    const { phone, code } = c.req.valid('json');
    const checked = await checkPhoneCode({ env: c.env, phone, purpose: 'customer', subject: `customer:${phone}`, code });
    if (!checked.ok) return c.json(checked.body, checked.status);

    const platform = createPlatformDb(c.env.DB);
    const links = await customerAppRepo.links(platform, phone);
    if (links.length === 0) {
      const requests = await serviceRequestRepo.listForPhone(platform, phone);
      return c.json({
        status: 'request' as const,
        ticket: await createTicket({ phone, purpose: 'service_request' }, c.env.JWT_SECRET),
        requests: requests.map(requestView),
      });
    }
    const account = await customerAccountRepo.ensure(platform, phone, new Date());
    const token = await createCustomerToken({ sub: account.id, phone, sv: account.sessionVersion }, c.env.JWT_SECRET);
    return c.json({ status: 'signed_in' as const, token, account: accountView(phone, links) });
  })

  // ---------- Before signing in: prices and where we wash ----------
  .get('/prices/from', async (c) => {
    const prices = await serviceAreaRepo.lowestPrices(createPlatformDb(c.env.DB));
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(prices);
  })
  .get('/service-areas', async (c) => {
    const areas = await serviceAreaRepo.listPublicAreas(createPlatformDb(c.env.DB));
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ areas });
  })
  .post('/service-area/check', zValidator('json', placeSchema), async (c) => {
    const { location, areaId } = c.req.valid('json');
    const branches = await serviceAreaRepo.listBranches(createPlatformDb(c.env.DB));
    if (branches.length === 0) return c.json(notOpen, 503);
    const match = branchFor({ point: location ?? null, areaId: areaId ?? null }, branches);
    if (!match) return c.json({ served: false as const });
    const branch = branches.find((b) => b.shopId === match.shopId)!;
    return c.json({ served: true as const, via: match.via, branch: { name: branch.name, city: branch.city } });
  })

  // ---------- Request service (number not registered yet) ----------
  .post('/service-requests', zValidator('json', requestSchema), async (c) => {
    const body = c.req.valid('json');
    const ticket = await readTicket(body.ticket, c.env.JWT_SECRET, 'service_request');
    if (!ticket) return c.json(ticketExpired, 401);

    const platform = createPlatformDb(c.env.DB);
    const [branches, links] = await Promise.all([
      serviceAreaRepo.listBranches(platform),
      customerAppRepo.links(platform, ticket.phone),
    ]);
    if (branches.length === 0) return c.json(notOpen, 503);
    if (links.length > 0) return c.json(alreadyCustomer, 409);
    if (body.areaId && !branches.some((b) => b.areaIds.includes(body.areaId!))) {
      return c.json({ error: 'area_not_found' as const, message: 'Pick your area from the list again.' }, 400);
    }

    const point = body.location ?? null;
    const match = branchFor({ point, areaId: body.areaId ?? null }, branches);
    const shopId = match?.shopId ?? nearestBranch(point, branches)!;
    const branch = branches.find((b) => b.shopId === shopId)!;
    const now = new Date();
    const created = await serviceRequestRepo.replaceOpenAndCreate(
      createShopDb(c.env.DB, shopId),
      platform,
      {
        phone: ticket.phone,
        name: body.name,
        latitude: point?.latitude ?? null,
        longitude: point?.longitude ?? null,
        // Kept only when the area belongs to the branch that got the request.
        areaId: body.areaId && branch.areaIds.includes(body.areaId) ? body.areaId : null,
        address: body.address,
        placeKind: body.placeKind,
        placeName: body.placeName,
        homeText: body.homeText,
        cars: body.cars,
        bikes: body.bikes,
        preferredTime: body.preferredTime ?? null,
        notes: body.notes,
        status: match ? 'pending' : 'out_of_area',
      },
      now,
    );
    if (!created) {
      return c.json({ error: 'busy' as const, message: 'Your request is already being saved. Try again.' }, 409);
    }
    return c.json(
      { request: requestView({ ...created, branch: { id: branch.shopId, name: branch.name, city: branch.city } }) },
      201,
    );
  })
  .post('/service-requests/mine', zValidator('json', ticketSchema), async (c) => {
    const ticket = await readTicket(c.req.valid('json').ticket, c.env.JWT_SECRET, 'service_request');
    if (!ticket) return c.json(ticketExpired, 401);
    const platform = createPlatformDb(c.env.DB);
    const [requests, links] = await Promise.all([
      serviceRequestRepo.listForPhone(platform, ticket.phone),
      customerAppRepo.links(platform, ticket.phone),
    ]);
    // Approved since the ticket was issued: the app asks them to sign in again for their account.
    return c.json({ registered: links.length > 0, requests: requests.map(requestView) });
  })
  .post(
    '/service-requests/:id/cancel',
    zValidator('param', z.object({ id: idSchema })),
    zValidator('json', ticketSchema),
    async (c) => {
      const ticket = await readTicket(c.req.valid('json').ticket, c.env.JWT_SECRET, 'service_request');
      if (!ticket) return c.json(ticketExpired, 401);
      const ok = await serviceRequestRepo.cancelForPhone(
        createPlatformDb(c.env.DB),
        c.req.valid('param').id,
        ticket.phone,
        new Date(),
      );
      if (!ok) {
        return c.json({ error: 'not_open' as const, message: 'This request was already handled.' }, 409);
      }
      return c.json({ ok: true as const });
    },
  )

  // ---------- Branches: contact, hours, prices (public, like the starting prices) ----------
  .get('/branches', async (c) => {
    const branches = await customerAppRepo.branches(createPlatformDb(c.env.DB));
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ branches });
  })

  // ---------- Signed in ----------
  .get('/me', requireCustomer, (c) => {
    return c.json(accountView(c.get('customer').phone, c.get('customerLinks')));
  })
  .patch('/me', requireCustomer, zValidator('json', profileSchema), async (c) => {
    const { name } = c.req.valid('json');
    const links = c.get('customerLinks');
    // Their name on every branch they're a customer of: it's the same person.
    await Promise.all(links.map((l) => customerRepo.updateName(createShopDb(c.env.DB, l.shopId), l.customerId, name)));
    return c.json(accountView(c.get('customer').phone, links.map((l) => ({ ...l, customerName: name }))));
  })
  .get('/live', requireCustomer, async (c) => {
    const now = new Date();
    const perBranch = await Promise.all(
      c.get('customerLinks').map((link) => customerAppRepo.live(createShopDb(c.env.DB, link.shopId), link, now)),
    );
    return c.json({ washes: perBranch.flat().sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
  })
  .get('/referrals', requireCustomer, async (c) => {
    const perBranch = await Promise.all(
      c.get('customerLinks').map((link) => customerAppRepo.referrals(createShopDb(c.env.DB, link.shopId), link)),
    );
    return c.json({
      canRefer: perBranch.some((b) => b.paidWashes > 0),
      referrals: perBranch.flatMap((b) => b.referrals).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
  })
  .post('/me/sign-out-everywhere', requireCustomer, async (c) => {
    await customerAccountRepo.signOutEverywhere(createPlatformDb(c.env.DB), c.get('customer').accountId);
    return c.json({ ok: true as const });
  })
  .delete('/me', requireCustomer, async (c) => {
    await customerAccountRepo.delete(createPlatformDb(c.env.DB), c.get('customer').accountId);
    return c.json({ ok: true as const });
  })
  .get('/vehicles', requireCustomer, async (c) => {
    const now = new Date();
    const links = c.get('customerLinks');
    const [vehicles, requests] = await Promise.all([
      Promise.all(links.map((link) => customerAppRepo.vehicles(createShopDb(c.env.DB, link.shopId), link, now))),
      Promise.all(links.map((link) => customerCareRepo.vehicleRequests(createShopDb(c.env.DB, link.shopId), link, now))),
    ]);
    return c.json({ vehicles: vehicles.flat(), requests: requests.flat() });
  })
  .post('/vehicles', requireCustomer, zValidator('json', vehicleRequestSchema), async (c) => {
    const body = c.req.valid('json');
    const link = linkFor(c.get('customerLinks'), body.branchId);
    if (!link) return c.json(branchNotFound, 404);
    const result = await customerCareRepo.requestVehicle(
      createShopDb(c.env.DB, link.shopId),
      link,
      { registrationNumber: body.registrationNumber, vehicleTypeId: body.vehicleTypeId, make: body.make, model: body.model },
      new Date(),
    );
    switch (result.kind) {
      case 'restored':
        return c.json({ status: 'restored' as const });
      case 'requested':
        return c.json({ status: 'requested' as const, id: result.id }, 201);
      case 'already_yours':
        return c.json({ error: 'already_yours' as const, message: 'This vehicle is already in your list.' }, 409);
      case 'already_requested':
        return c.json(
          { error: 'already_requested' as const, message: 'This vehicle is already waiting for the car wash to confirm.' },
          409,
        );
      case 'too_many':
        return c.json(
          { error: 'too_many' as const, message: 'You have vehicles waiting to be confirmed. Please wait for those first.' },
          429,
        );
      case 'bad_type':
        return c.json({ error: 'bad_type' as const, message: 'Pick the vehicle type again.' }, 400);
    }
  })
  .delete('/vehicles/:id', requireCustomer, zValidator('param', z.object({ id: idSchema })), async (c) => {
    const id = c.req.valid('param').id;
    const now = new Date();
    for (const link of c.get('customerLinks')) {
      if (await customerCareRepo.hideVehicle(createShopDb(c.env.DB, link.shopId), link, id, now)) {
        return c.json({ ok: true as const });
      }
    }
    return c.json({ error: 'not_found' as const, message: 'This vehicle isn’t in your list.' }, 404);
  })
  .post('/vehicle-requests/:id/cancel', requireCustomer, zValidator('param', z.object({ id: idSchema })), async (c) => {
    const id = c.req.valid('param').id;
    const now = new Date();
    for (const link of c.get('customerLinks')) {
      if (await customerCareRepo.cancelVehicleRequest(createShopDb(c.env.DB, link.shopId), link, id, now)) {
        return c.json({ ok: true as const });
      }
    }
    return c.json({ error: 'not_open' as const, message: 'The car wash already handled this request.' }, 409);
  })
  .get('/washes', requireCustomer, zValidator('query', washesQuerySchema), async (c) => {
    const { before, limit } = c.req.valid('query');
    const cutoff = before ? new Date(before) : null;
    const perBranch = await Promise.all(
      c
        .get('customerLinks')
        .map((link) => customerAppRepo.washes(createShopDb(c.env.DB, link.shopId), link, cutoff, limit + 1)),
    );
    const all = perBranch.flat().sort(byNewest);
    const washes = all.slice(0, limit);
    return c.json({ washes, nextBefore: all.length > limit ? washes[washes.length - 1]!.createdAt : null });
  })
  .get('/washes/:id', requireCustomer, zValidator('param', z.object({ id: idSchema })), async (c) => {
    const id = c.req.valid('param').id;
    const now = new Date();
    const found = await findAcross(c.env, c.get('customerLinks'), (db, link) => customerAppRepo.wash(db, link, id, now));
    if (!found) return c.json(washNotFound, 404);
    return c.json({ wash: found.value });
  })
  .put(
    '/washes/:id/rating',
    requireCustomer,
    zValidator('param', z.object({ id: idSchema })),
    zValidator('json', ratingSchema),
    async (c) => {
      const id = c.req.valid('param').id;
      const body = c.req.valid('json');
      const now = new Date();
      for (const link of c.get('customerLinks')) {
        const result = await customerCareRepo.rate(createShopDb(c.env.DB, link.shopId), link, id, body, now);
        if (result === 'not_found') continue;
        if (result === 'not_rateable') {
          return c.json(
            {
              error: 'not_rateable' as const,
              message: `You can rate a wash after paying, for ${RATING_WINDOW_DAYS} days.`,
            },
            409,
          );
        }
        return c.json({ rating: { ...result, updatedAt: result.updatedAt.toISOString() } });
      }
      return c.json(washNotFound, 404);
    },
  )
  .get('/problems', requireCustomer, async (c) => {
    const perBranch = await Promise.all(
      c.get('customerLinks').map((link) => customerCareRepo.problems(createShopDb(c.env.DB, link.shopId), link)),
    );
    return c.json({ problems: perBranch.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  })
  .post('/problems', requireCustomer, zValidator('json', problemSchema), async (c) => {
    const body = c.req.valid('json');
    const links = c.get('customerLinks');
    const now = new Date();
    const data = { jobId: body.washId ?? null, kind: body.kind, details: body.details };
    // About a wash: the branch that did it. Otherwise the branch they picked (or their only one).
    const candidates = body.washId ? links : [linkFor(links, body.branchId ?? (links.length === 1 ? links[0]!.shopId : null))];
    for (const link of candidates) {
      if (!link) break;
      const result = await customerCareRepo.reportProblem(createShopDb(c.env.DB, link.shopId), link, data, now);
      if (result === 'not_found') continue;
      if (result === 'too_many') {
        return c.json(
          {
            error: 'too_many' as const,
            message: 'You already have reports the car wash is looking into. Please call the branch.',
          },
          429,
        );
      }
      return c.json({ problem: result }, 201);
    }
    return body.washId ? c.json(washNotFound, 404) : c.json(branchNotFound, 404);
  })
  .get('/photos/:id', requireCustomer, zValidator('param', z.object({ id: idSchema })), async (c) => {
    const id = c.req.valid('param').id;
    const found = await findAcross(c.env, c.get('customerLinks'), (db, link) => customerAppRepo.photo(db, link, id));
    if (!found) return c.json({ error: 'not_found' as const }, 404);
    const object = await c.env.PHOTOS.get(found.value.r2Key);
    if (!object) return c.json({ error: 'not_found' as const }, 404);
    return c.body(object.body, 200, {
      'Content-Type': found.value.contentType,
      'Cache-Control': 'private, max-age=86400',
    });
  });
