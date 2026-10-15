import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createPlatformDb, joinRequestRepo, userRepo, type DbClient } from '@mana/db';
import {
  canManageMember,
  JOIN_REQUEST_TTL_DAYS,
  MAX_SHOPS_PER_OWNER,
  normalizePhone,
  toUserRole,
  USER_ROLE_LABEL,
  USER_ROLES,
  type UserRole,
} from '@mana/domain';
import { phoneBusy, withPhoneLock } from '../lib/phoneLock';
import { isHq } from '../lib/catalog';
import { resetPin, worksElsewhere } from '../lib/pinReset';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';

type Ctx = Context<{ Bindings: Env }>;

const roleSchema = z.enum(USER_ROLES);

const createMemberSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  phone: z
    .string()
    .transform(normalizePhone)
    .refine((p) => /^[6-9]\d{9}$/.test(p), 'Enter a valid 10-digit mobile number'),
  role: roleSchema.default('staff'),
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

const alreadyHere = {
  error: 'phone_taken' as const,
  message: 'This number is already on this branch’s team.',
};

const tooManyBranches = {
  error: 'too_many_shops' as const,
  message: `One number can work at up to ${MAX_SHOPS_PER_OWNER} branches.`,
};

const lastOwner = {
  error: 'last_owner' as const,
  message: 'The shop needs at least one active owner.',
};

function notAllowed(target: UserRole) {
  const message =
    target === 'owner'
      ? 'Only Mana Wash HQ can add, change or remove branch owners.'
      : target === 'manager'
        ? 'Only the owner can add, change or remove managers.'
        : 'You can’t change this teammate.';
  return { error: target === 'owner' ? ('hq_only' as const) : ('forbidden' as const), message };
}

const otherBranchesReset = {
  error: 'works_elsewhere' as const,
  message: 'This person works at another branch too, so only Mana Wash HQ can reset their PIN.',
};

function joinRequestCutoff(now: Date) {
  return new Date(now.getTime() - JOIN_REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Who's asking, and whether they're HQ — looked up only when an owner's row is involved. */
async function actor(c: Ctx, involvesOwner: boolean) {
  const role = c.get('session').role;
  return { role, hq: involvesOwner ? await isHq(c) : false };
}

async function mayManage(c: Ctx, ...roles: UserRole[]) {
  const me = await actor(c, roles.includes('owner'));
  return roles.find((r) => !canManageMember(me.role, r, me.hq)) ?? null;
}

/**
 * A row in this branch for someone who may already work at others: they keep their one PIN,
 * so they sign in here exactly as they do there. Returns why not, when they can't be added.
 */
async function addPerson(
  c: Ctx,
  db: DbClient,
  data: { name: string; phone: string; role: UserRole },
): Promise<{ id: string; name: string } | 'here' | 'too_many'> {
  const platform = createPlatformDb(c.env.DB);
  const rows = await userRepo.listByPhone(platform, data.phone);
  if (rows.some((r) => r.shopId === c.get('session').shopId)) return 'here';
  if (rows.length >= MAX_SHOPS_PER_OWNER) return 'too_many';
  const person = await userRepo.personPin(platform, data.phone);
  const user = await userRepo.createWithPin(db, {
    name: person?.name ?? data.name,
    phone: data.phone,
    role: data.role,
    pin: person?.pin ?? { hash: null, digits: null, setAt: null },
  });
  return { id: user.id, name: user.name };
}

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
//
// Owners run the whole team; managers handle staff and join requests only; owners themselves
// are added, changed and removed by Mana Wash HQ (`canManageMember`).
export const teamRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth, requireRole('owner', 'manager'))
  .get('/', async (c) => {
    return c.json(await userRepo.list(c.get('db')));
  })
  // Someone who already works at another branch keeps their PIN and name.
  .post('/', zValidator('json', createMemberSchema), async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const blocked = await mayManage(c, body.role);
    if (blocked) return c.json(notAllowed(blocked), 403);

    const result = await withPhoneLock(c.env, body.phone, async () => {
      const added = await addPerson(c, db, body);
      if (typeof added !== 'string') {
        await joinRequestRepo.cancelOpenForPhone(createPlatformDb(c.env.DB), body.phone, new Date());
      }
      return added;
    });
    if (result === null) return c.json(phoneBusy, 409);
    if (result === 'here') return c.json(alreadyHere, 409);
    if (result === 'too_many') return c.json(tooManyBranches, 409);
    return c.json({ id: result.id }, 201);
  })
  // People who typed this shop's ID and asked to join. Nothing exists in the team until approved.
  .get('/requests', async (c) => {
    const db = c.get('db');
    const rows = await joinRequestRepo.listPending(db, joinRequestCutoff(new Date()));
    return c.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  })
  // Approving adds them as staff; a new person's phone then asks them to pick a PIN.
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

    const result = await withPhoneLock(c.env, request.phone, async () => {
      // Two people (or a double tap) approving at once: the second sees it's already done.
      const fresh = await joinRequestRepo.findById(db, id);
      if (fresh?.status === 'approved' && fresh.userId) {
        const already = await userRepo.findMember(db, fresh.userId);
        if (already) return { id: already.id, name: already.name };
      }
      if (fresh?.status !== 'pending') return 'gone' as const;
      const added = await addPerson(c, db, { name: request.name, phone: request.phone, role: 'staff' });
      if (typeof added === 'string') {
        await joinRequestRepo.decide(db, id, { status: 'cancelled', now });
        return added;
      }
      const decided = await joinRequestRepo.decide(db, id, {
        status: 'approved',
        now,
        byUserId: c.get('session').sub,
        userId: added.id,
      });
      if (!decided) {
        // They cancelled at the same moment.
        await userRepo.remove(db, added.id, now);
        return 'gone' as const;
      }
      return added;
    });
    if (result === null) return c.json(phoneBusy, 409);
    if (result === 'here') return c.json(alreadyHere, 409);
    if (result === 'too_many') return c.json(tooManyBranches, 409);
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
  // Name, role and access. Both the teammate's current role and any new one must be within what
  // the asker manages. Nobody changes their own role or access, and the last active owner can't
  // be removed by anyone.
  .patch('/:id', zValidator('json', updateMemberSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = c.get('db');
    const session = c.get('session');

    const target = await userRepo.findMember(db, id);
    if (!target) return c.json({ error: 'not_found' as const }, 404);
    const current = toUserRole(target.role);
    const blocked = await mayManage(c, current, body.role ?? current);
    if (blocked) return c.json(notAllowed(blocked), 403);

    const changesAccess =
      (body.role !== undefined && body.role !== current) || (body.active !== undefined && body.active !== target.active);
    if (changesAccess && target.id === session.sub) {
      return c.json(
        { error: 'cannot_change_self' as const, message: 'You can’t change your own role or access.' },
        400,
      );
    }

    const losesOwner =
      current === 'owner' && target.active && ((body.role !== undefined && body.role !== 'owner') || body.active === false);
    if (
      losesOwner &&
      !(await userRepo.dropOwnerAccess(db, id, {
        demote: body.role !== undefined && body.role !== 'owner',
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
    const blocked = await mayManage(c, toUserRole(target.role));
    if (blocked) return c.json(notAllowed(blocked), 403);
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
  // Forgot their PIN, or it got locked. Only clears it (see lib/pinReset.ts): the person confirms
  // with a WhatsApp code and picks a new one. Someone who also works at another branch shares one
  // PIN across them, so only HQ can reset theirs.
  .post('/:id/reset-pin', async (c) => {
    const id = c.req.param('id');
    const db = c.get('db');
    const session = c.get('session');
    const target = await userRepo.findMember(db, id);
    if (!target) return c.json({ error: 'not_found' as const }, 404);
    if (target.id === session.sub) {
      return c.json(
        { error: 'cannot_change_self' as const, message: 'Change your own PIN from More → Change PIN.' },
        400,
      );
    }
    const role = toUserRole(target.role);
    const elsewhere = await worksElsewhere(c.env, target.phone, target.shopId);
    const me = await actor(c, role === 'owner' || elsewhere);
    if (!canManageMember(me.role, role, me.hq)) return c.json(notAllowed(role), 403);
    if (elsewhere && !me.hq) return c.json(otherBranchesReset, 403);

    const asker = await userRepo.findById(db, session.sub);
    const label = `${asker?.name ?? 'Someone'} (${me.hq ? 'Mana Wash HQ' : USER_ROLE_LABEL[me.role]})`;
    await resetPin(c.env, target, { phone: session.phone, label });
    return c.json({ ok: true as const });
  });
