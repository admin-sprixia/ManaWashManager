import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { billingRepo, createPlatformDb, joinRequestRepo, userRepo } from '@mana/db';
import {
  checkPin,
  JOIN_REQUEST_TTL_DAYS,
  normalizePhone,
  pinProblemMessage,
  staffLimitMessage,
} from '@mana/domain';
import { phoneBusy, withPhoneLock } from '../lib/phoneLock';
import { hashPin } from '../lib/pin';
import { teamFullProblem, teamSeats } from '../lib/plan';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';

const roleSchema = z.enum(['owner', 'staff']);

const createMemberSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  phone: z
    .string()
    .transform(normalizePhone)
    .refine((p) => /^[6-9]\d{9}$/.test(p), 'Enter a valid 10-digit mobile number'),
  role: roleSchema.default('staff'),
  pin: z.string().optional(),
});

const updateMemberSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    role: roleSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => d.name !== undefined || d.role !== undefined || d.active !== undefined, {
    message: 'Nothing to update',
  });

const setPinSchema = z.object({ pin: z.string() });

const phoneTaken = {
  error: 'phone_taken' as const,
  message: 'This number is already registered to an account.',
};

const lastOwner = {
  error: 'last_owner' as const,
  message: 'The shop needs at least one active owner.',
};

const ownPinOnly = {
  error: 'runs_other_shops' as const,
  message: 'This person runs another shop too, so only they can change their PIN.',
};

/**
 * Their one PIN opens all their branches, so an owner here must not be able to reset it (or make
 * them staff) and reach shops that aren't theirs.
 */
async function runsOtherShops(env: Env, user: { id: string; phone: string }) {
  const rows = await userRepo.listByPhone(createPlatformDb(env.DB), user.phone);
  return rows.some((r) => r.id !== user.id);
}

function joinRequestCutoff(now: Date) {
  return new Date(now.getTime() - JOIN_REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const teamRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth, requireRole('owner'))
  // `seatLocked`: on the team but past the plan's seats, so they can't sign in until an upgrade.
  .get('/', async (c) => {
    const db = c.get('db');
    const [members, order] = await Promise.all([userRepo.list(db), billingRepo.listSeatOrder(db)]);
    const seats = teamSeats(c.get('plan'));
    const locked = new Set(order.slice(seats).filter((u) => u.role !== 'owner').map((u) => u.id));
    return c.json(members.map((m) => ({ ...m, seatLocked: locked.has(m.id) })));
  })
  .post('/', zValidator('json', createMemberSchema), async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');

    if (body.pin !== undefined && body.pin !== '') {
      const problem = checkPin(body.pin);
      if (problem)
        return c.json({ error: 'weak_pin' as const, message: pinProblemMessage(problem) }, 400);
    }
    const full = await teamFullProblem(db, c.get('plan'));
    if (full) return c.json(full, 402);
    const pinHash = body.pin ? await hashPin(body.pin) : null;
    // Phones are unique across every shop; don't reveal whether it's this shop or another.
    const user = await withPhoneLock(c.env, body.phone, async () => {
      if (await userRepo.findByPhone(createPlatformDb(c.env.DB), body.phone)) return 'taken' as const;
      const created = await userRepo.create(db, { name: body.name, phone: body.phone, role: body.role });
      return pinHash ? userRepo.setPinHash(db, created.id, pinHash) : created;
    });
    if (user === null) return c.json(phoneBusy, 409);
    if (user === 'taken') return c.json(phoneTaken, 409);
    return c.json({ id: user.id }, 201);
  })
  // People who typed this shop's ID and asked to join. Nothing exists in the team until approved.
  .get('/requests', async (c) => {
    const db = c.get('db');
    const rows = await joinRequestRepo.listPending(db, joinRequestCutoff(new Date()));
    return c.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  })
  // Approving adds them as staff with no PIN; their phone then asks them to pick one.
  .post('/requests/:id/approve', async (c) => {
    const id = c.req.param('id');
    const db = c.get('db');
    const now = new Date();
    const request = await joinRequestRepo.findById(db, id);
    if (!request || request.status !== 'pending' || request.createdAt < joinRequestCutoff(now)) {
      return c.json(
        { error: 'not_found' as const, message: 'This request was cancelled or has expired.' },
        404,
      );
    }
    // Left pending, so the owner can approve it after upgrading or freeing a seat.
    const full = await teamFullProblem(db, c.get('plan'));
    if (full) return c.json(full, 402);

    const result = await withPhoneLock(c.env, request.phone, async () => {
      // Two owners (or a double tap) approving at once: the second sees it's already done.
      const fresh = await joinRequestRepo.findById(db, id);
      if (fresh?.status === 'approved' && fresh.userId) {
        const already = await userRepo.findMember(db, fresh.userId);
        if (already) return { id: already.id, name: already.name };
      }
      if (fresh?.status !== 'pending') return 'gone' as const;
      if (await userRepo.findByPhone(createPlatformDb(c.env.DB), request.phone)) {
        await joinRequestRepo.decide(db, id, { status: 'cancelled', now });
        return 'taken' as const;
      }
      const user = await userRepo.create(db, {
        name: request.name,
        phone: request.phone,
        role: 'staff',
      });
      const decided = await joinRequestRepo.decide(db, id, {
        status: 'approved',
        now,
        byUserId: c.get('session').sub,
        userId: user.id,
      });
      if (!decided) {
        // They cancelled at the same moment.
        await userRepo.remove(db, user.id, now);
        return 'gone' as const;
      }
      return { id: user.id, name: user.name };
    });
    if (result === null) return c.json(phoneBusy, 409);
    if (result === 'taken') return c.json(phoneTaken, 409);
    if (result === 'gone') {
      return c.json(
        { error: 'not_found' as const, message: 'This request was just cancelled.' },
        404,
      );
    }
    return c.json(result);
  })
  .post('/requests/:id/reject', async (c) => {
    const db = c.get('db');
    const decided = await joinRequestRepo.decide(db, c.req.param('id'), {
      status: 'rejected',
      now: new Date(),
      byUserId: c.get('session').sub,
    });
    if (!decided) return c.json({ error: 'not_found' as const }, 404);
    return c.json({ ok: true as const });
  })
  // Role and access changes. Two guards keep the shop from locking itself out: the owner can't
  // demote or deactivate themselves, and the last active owner can't be removed by anyone.
  .patch('/:id', zValidator('json', updateMemberSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = c.get('db');
    const session = c.get('session');

    const target = await userRepo.findMember(db, id);
    if (!target) return c.json({ error: 'not_found' as const }, 404);

    const losesOwner =
      target.role === 'owner' && target.active && (body.role === 'staff' || body.active === false);

    if (losesOwner && target.id === session.sub) {
      return c.json(
        {
          error: 'cannot_change_self' as const,
          message: 'You can’t remove your own owner access. Ask another owner to do it.',
        },
        400,
      );
    }
    if (losesOwner && (await userRepo.countActiveOwners(db)) <= 1) return c.json(lastOwner, 400);
    if (target.role === 'owner' && body.role === 'staff' && (await runsOtherShops(c.env, target))) {
      return c.json(
        {
          error: 'runs_other_shops' as const,
          message: 'This person runs another shop too, so they can only be an owner here.',
        },
        400,
      );
    }

    // Switching someone back on takes a seat. Making someone an owner moves them ahead of staff
    // in the seat order, so it isn't allowed while the team is over its seats.
    const plan = c.get('plan');
    const takesSeat = body.active === true && !target.active;
    if (takesSeat) {
      const full = await teamFullProblem(db, plan);
      if (full) return c.json(full, 402);
    }
    if (body.role === 'owner' && target.role !== 'owner') {
      if ((await billingRepo.countActiveMembers(db)) > teamSeats(plan)) {
        return c.json(
          { error: 'plan_staff_limit' as const, message: staffLimitMessage(plan.tier, plan.limits.staff) },
          402,
        );
      }
    }

    if (
      losesOwner &&
      !(await userRepo.dropOwnerAccess(db, id, {
        demote: body.role === 'staff',
        deactivate: body.active === false,
      }))
    ) {
      return c.json(lastOwner, 400);
    }
    await userRepo.update(db, id, body);
    return c.json({ ok: true as const });
  })
  // Off the team for good. Their past work keeps their name; their number can join another shop.
  .delete('/:id', async (c) => {
    const id = c.req.param('id');
    const db = c.get('db');
    const target = await userRepo.findMember(db, id);
    if (!target) return c.json({ error: 'not_found' as const }, 404);
    if (target.id === c.get('session').sub) {
      return c.json(
        {
          error: 'cannot_change_self' as const,
          message: 'You can’t remove yourself from the team.',
        },
        400,
      );
    }
    if (
      target.role === 'owner' &&
      target.active &&
      !(await userRepo.dropOwnerAccess(db, id, { demote: false, deactivate: true }))
    ) {
      return c.json(lastOwner, 400);
    }
    await userRepo.remove(db, id, new Date());
    return c.json({ ok: true as const });
  })
  // Owner sets or resets someone's PIN (e.g. they forgot it, or it got locked).
  .put('/:id/pin', zValidator('json', setPinSchema), async (c) => {
    const id = c.req.param('id');
    const { pin } = c.req.valid('json');
    const problem = checkPin(pin);
    if (problem)
      return c.json({ error: 'weak_pin' as const, message: pinProblemMessage(problem) }, 400);

    const db = c.get('db');
    const target = await userRepo.findMember(db, id);
    if (!target) return c.json({ error: 'not_found' as const }, 404);
    if (await runsOtherShops(c.env, target)) return c.json(ownPinOnly, 403);
    await userRepo.setPinHash(db, id, await hashPin(pin));
    return c.json({ ok: true as const });
  })
  .delete('/:id/pin', async (c) => {
    const id = c.req.param('id');
    const db = c.get('db');
    const target = await userRepo.findMember(db, id);
    if (!target) return c.json({ error: 'not_found' as const }, 404);
    if (await runsOtherShops(c.env, target)) return c.json(ownPinOnly, 403);
    await userRepo.setPinHash(db, id, null);
    return c.json({ ok: true as const });
  });
