import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { isUniqueClash, stockRepo } from '@mana/db';
import {
  EXPENSE_UNITS,
  MAX_STOCK_QUANTITY,
  STOCK_NAME_MAX,
  STOCK_UNITS,
  roundStock,
  stockLevel,
  toStockQuantity,
  type ExpenseUnit,
  type StockUnit,
} from '@mana/domain';
import { requireAuth, requireRole } from '../middleware/auth';
import { requirePro } from '../lib/plan';
import { startOfIstDaysAgo } from '../lib/istDate';
import type { Env } from '../types';

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid id');
const itemParamSchema = z.object({ id: z.string().min(1) });
const quantitySchema = z.number().min(0).max(MAX_STOCK_QUANTITY, 'That number looks too large');

const createItemSchema = z.object({
  name: z.string().trim().min(2, 'Add a name').max(STOCK_NAME_MAX),
  unit: z.enum(STOCK_UNITS as [StockUnit, ...StockUnit[]]),
  lowAt: quantitySchema.nullable().optional(),
  /** What's on the shelf right now, in `unit`. */
  opening: quantitySchema.optional(),
});

const updateItemSchema = z.object({
  name: z.string().trim().min(2, 'Add a name').max(STOCK_NAME_MAX).optional(),
  lowAt: quantitySchema.nullable().optional(),
});

const moveSchema = z.object({
  id: idSchema,
  itemId: z.string().min(1),
  /** use: taken off the shelf. in: added without a bill (owner). count: what's actually there (owner). */
  kind: z.enum(['use', 'in', 'count']),
  quantity: quantitySchema,
  unit: z.enum(EXPENSE_UNITS as [ExpenseUnit, ...ExpenseUnit[]]),
  note: z.string().trim().max(120).optional(),
});

function withLevel<T extends { balance: number; lowAt: number | null }>(item: T) {
  return { ...item, level: stockLevel(item.balance, item.lowAt) };
}

// Everyone sees stock and logs what they use; setting items up, adding without a bill and
// correcting a count are the owner's.
export const stockRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth, requirePro('inventory'))
  .get('/', async (c) => {
    const db = c.get('db');
    const [items, used] = await Promise.all([
      stockRepo.list(db),
      stockRepo.usedSince(db, startOfIstDaysAgo(6)),
    ]);
    const rows = items.map((i) => ({ ...withLevel(i), usedWeek: used.get(i.id) ?? 0 }));
    return c.json({
      items: rows,
      low: rows.filter((r) => r.level !== 'ok').length,
    });
  })
  .post('/', requireRole('owner'), zValidator('json', createItemSchema), async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const session = c.get('session');
    const duplicate = { error: 'duplicate' as const, message: `“${body.name}” is already in stock.` };
    if (await stockRepo.findByName(db, body.name)) return c.json(duplicate, 409);
    let item;
    try {
      item = await stockRepo.create(db, {
        name: body.name,
        unit: body.unit,
        lowAt: body.lowAt ?? null,
        createdByUserId: session.sub,
      });
    } catch (e) {
      // Added from another phone at the same moment.
      if (isUniqueClash(e)) return c.json(duplicate, 409);
      throw e;
    }
    if (body.opening && body.opening > 0) {
      const opened = await stockRepo.applyMove(db, {
        itemId: item.id,
        kind: 'count',
        delta: body.opening,
        note: 'Opening stock',
        createdByUserId: session.sub,
      });
      if (opened) item = opened.item;
    }
    return c.json(withLevel(item), 201);
  })
  .patch(
    '/:id',
    requireRole('owner'),
    zValidator('param', itemParamSchema),
    zValidator('json', updateItemSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const db = c.get('db');
      const item = await stockRepo.findById(db, id);
      if (!item || !item.active) return c.json({ error: 'not_found' as const }, 404);
      if (body.name) {
        const clash = await stockRepo.findByName(db, body.name);
        if (clash && clash.id !== id) {
          return c.json(
            { error: 'duplicate' as const, message: `“${body.name}” is already in stock.` },
            409,
          );
        }
      }
      try {
        return c.json(withLevel(await stockRepo.update(db, id, body)));
      } catch (e) {
        if (!isUniqueClash(e)) throw e;
        return c.json(
          { error: 'duplicate' as const, message: `“${body.name}” is already in stock.` },
          409,
        );
      }
    },
  )
  .delete('/:id', requireRole('owner'), zValidator('param', itemParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const item = await stockRepo.findById(db, id);
    if (!item) return c.json({ error: 'not_found' as const }, 404);
    if (item.active) await stockRepo.deactivate(db, id);
    return c.json({ ok: true as const });
  })
  .get('/:id/moves', zValidator('param', itemParamSchema), async (c) => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const item = await stockRepo.findById(db, id);
    if (!item) return c.json({ error: 'not_found' as const }, 404);
    const moves = await stockRepo.moves(db, id);
    return c.json({ item: withLevel(item), moves });
  })
  .post('/moves', zValidator('json', moveSchema), async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const session = c.get('session');

    const existing = await stockRepo.findMove(db, body.id);
    if (existing) return c.json({ id: existing.id }, 200);

    if (body.kind !== 'use' && session.role !== 'owner') {
      return c.json(
        { error: 'owner_only' as const, message: 'Only the owner can add or correct stock.' },
        403,
      );
    }
    // A count says what's really on the shelf, so the move is the difference from the books —
    // applied only if the books haven't moved since they were read (else read again).
    for (let attempt = 0; attempt < 3; attempt++) {
      const item = await stockRepo.findById(db, body.itemId);
      if (!item || !item.active) {
        return c.json(
          { error: 'not_found' as const, message: 'This item was removed from stock.' },
          404,
        );
      }
      const quantity = toStockQuantity(body.quantity, body.unit, item.unit as StockUnit);
      if (quantity == null) {
        return c.json(
          { error: 'wrong_unit' as const, message: 'That unit doesn’t fit this item.' },
          400,
        );
      }
      if (body.kind !== 'count' && !(quantity > 0)) {
        return c.json({ error: 'invalid_body' as const, message: 'Enter more than zero.' }, 400);
      }

      if (body.kind === 'use') {
        // Never below zero: more than the books hold empties the item and notes the shortfall.
        let taken: Awaited<ReturnType<typeof stockRepo.takeOut>>;
        try {
          taken = await stockRepo.takeOut(db, {
            id: body.id,
            itemId: item.id,
            kind: 'use',
            quantity,
            note: body.note || null,
            createdByUserId: session.sub,
          });
        } catch (e) {
          const winner = await stockRepo.findMove(db, body.id);
          if (winner) return c.json({ id: winner.id }, 200);
          throw e;
        }
        if (taken) return c.json({ id: taken.move.id, item: withLevel(taken.item) }, 201);
        break;
      }

      const delta = body.kind === 'in' ? quantity : roundStock(quantity - item.balance);
      let applied: Awaited<ReturnType<typeof stockRepo.applyMove>>;
      try {
        applied = await stockRepo.applyMove(db, {
          id: body.id,
          itemId: item.id,
          kind: body.kind,
          delta,
          note: body.note || null,
          createdByUserId: session.sub,
          ifBalance: body.kind === 'count' ? item.balance : undefined,
        });
      } catch (e) {
        // A replay of this same move saved first (its balance change was undone above).
        const winner = await stockRepo.findMove(db, body.id);
        if (winner) return c.json({ id: winner.id }, 200);
        throw e;
      }
      if (applied) return c.json({ id: applied.move.id, item: withLevel(applied.item) }, 201);
    }
    return c.json(
      { error: 'busy' as const, message: 'This item is being updated by someone else. Try again.' },
      409,
    );
  });
