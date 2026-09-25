import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createDbClient, userRepo } from '@mana/db';
import { checkPin, normalizePhone, pinProblemMessage } from '@mana/domain';
import { hashPin } from '../lib/pin';
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

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const teamRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth, requireRole('owner'))
  .get('/', async (c) => {
    const db = createDbClient(c.env.DB);
    return c.json(await userRepo.list(db));
  })
  .post('/', zValidator('json', createMemberSchema), async (c) => {
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);

    if (body.pin !== undefined && body.pin !== '') {
      const problem = checkPin(body.pin);
      if (problem) return c.json({ error: 'weak_pin' as const, message: pinProblemMessage(problem) }, 400);
    }
    if (await userRepo.findByPhone(db, body.phone)) {
      return c.json(
        { error: 'phone_taken' as const, message: 'Someone on the team already uses this number.' },
        409,
      );
    }

    let user = await userRepo.create(db, { name: body.name, phone: body.phone, role: body.role });
    if (body.pin) user = await userRepo.setPinHash(db, user.id, await hashPin(body.pin));
    return c.json({ id: user.id }, 201);
  })
  // Role and access changes. Two guards keep the shop from locking itself out: the owner can't
  // demote or deactivate themselves, and the last active owner can't be removed by anyone.
  .patch('/:id', zValidator('json', updateMemberSchema), async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    const session = c.get('session');

    const target = await userRepo.findById(db, id);
    if (!target) return c.json({ error: 'not_found' as const }, 404);

    const losesOwner =
      target.role === 'owner' &&
      target.active &&
      (body.role === 'staff' || body.active === false);

    if (losesOwner && target.id === session.sub) {
      return c.json(
        {
          error: 'cannot_change_self' as const,
          message: 'You can’t remove your own owner access. Ask another owner to do it.',
        },
        400,
      );
    }
    if (losesOwner && (await userRepo.countActiveOwners(db)) <= 1) {
      return c.json(
        { error: 'last_owner' as const, message: 'The shop needs at least one active owner.' },
        400,
      );
    }

    await userRepo.update(db, id, body);
    return c.json({ ok: true as const });
  })
  // Owner sets or resets someone's PIN (e.g. they forgot it, or it got locked).
  .put('/:id/pin', zValidator('json', setPinSchema), async (c) => {
    const id = c.req.param('id');
    const { pin } = c.req.valid('json');
    const problem = checkPin(pin);
    if (problem) return c.json({ error: 'weak_pin' as const, message: pinProblemMessage(problem) }, 400);

    const db = createDbClient(c.env.DB);
    if (!(await userRepo.findById(db, id))) return c.json({ error: 'not_found' as const }, 404);
    await userRepo.setPinHash(db, id, await hashPin(pin));
    return c.json({ ok: true as const });
  })
  .delete('/:id/pin', async (c) => {
    const id = c.req.param('id');
    const db = createDbClient(c.env.DB);
    if (!(await userRepo.findById(db, id))) return c.json({ error: 'not_found' as const }, 404);
    await userRepo.setPinHash(db, id, null);
    return c.json({ ok: true as const });
  });
