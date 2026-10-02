import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { expenseRepo } from '@mana/db';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_SETUP,
  EXPENSE_PHOTO_KINDS,
  EXPENSE_UNITS,
  MAX_PHOTO_BYTES,
  MIN_REASON_LENGTH,
  STOCK_CATEGORIES,
  type ExpenseCategory,
  type ExpensePhotoKind,
  type ExpenseUnit,
} from '@mana/domain';
import { requireAuth } from '../middleware/auth';
import { formatIstDateOnly, parseIstDateOnly, startOfIstDay, startOfIstDaysAgo } from '../lib/istDate';
import { reportQuerySchema, resolveReportWindow, windowMeta } from '../lib/reportWindow';
import { addPurchaseToStock, reverseExpenseStock, type StockResult } from '../lib/stock';
import type { Env } from '../types';

/** ₹10,00,000 — anything above is certainly a typo (extra zeros), not a shop expense. */
const MAX_EXPENSE_PAISE = 10_00_000 * 100;
/** Late entries (a bill found in a drawer) are fine; older than this belongs to the owner. */
const MAX_BACKDATE_DAYS = 31;

const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const createExpenseSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid id'),
    category: z.enum(EXPENSE_CATEGORIES as [ExpenseCategory, ...ExpenseCategory[]]),
    amount: z.number().int().positive('Amount must be more than zero').max(MAX_EXPENSE_PAISE, 'Amount looks too large'),
    description: z.string().trim().max(200).optional(),
    itemName: z.string().trim().min(1, 'Add what was bought').max(80),
    quantity: z.number().positive('Quantity must be more than zero').max(1_000_000, 'Quantity looks too large').optional(),
    unit: z.enum(EXPENSE_UNITS as [ExpenseUnit, ...ExpenseUnit[]]).optional(),
    paymentMethod: z.enum(['cash', 'upi', 'other']).default('cash'),
    date: z.string().optional(),
    /** Add the quantity to the stock item with the same name (created if it's new). */
    addToStock: z.boolean().optional(),
  })
  .refine((b) => (b.quantity == null) === (b.unit == null), {
    message: 'Quantity and unit go together',
    path: ['unit'],
  })
  .refine((b) => b.unit == null || EXPENSE_CATEGORY_SETUP[b.category].units.includes(b.unit), {
    message: 'That unit doesn’t fit this category',
    path: ['unit'],
  })
  .refine((b) => !EXPENSE_CATEGORY_SETUP[b.category].quantityRequired || b.quantity != null, {
    message: 'Add the quantity',
    path: ['quantity'],
  });

// Multipart: the entry as JSON in `data`, plus both photos. One request, so an expense never
// exists without its proof — even one replayed from the offline queue days later.
const createFormSchema = z.object({
  data: z.string().min(2, 'Missing expense details'),
  billPhoto: z.instanceof(File, { message: 'Attach a photo of the bill' }),
  itemPhoto: z.instanceof(File, { message: 'Attach a photo of the item' }),
});

const photoParamSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid id'),
  kind: z.enum(EXPENSE_PHOTO_KINDS as [ExpensePhotoKind, ...ExpensePhotoKind[]]),
});

function photoProblem(file: File, label: string): string | null {
  if (!ALLOWED_PHOTO_TYPES.has(file.type)) return `The ${label} photo must be JPEG, PNG or WebP.`;
  if (file.size === 0 || file.size > MAX_PHOTO_BYTES) return `The ${label} photo is too large.`;
  return null;
}

function photoExt(type: string): string {
  return type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
}

const voidExpenseSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(MIN_REASON_LENGTH, `Reason must be at least ${MIN_REASON_LENGTH} characters`)
    .max(200),
});

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const expenseRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  // Anyone on shift can log an expense (chemicals bought, electricity bill paid in cash…).
  .post('/', zValidator('form', createFormSchema), async (c) => {
    const form = c.req.valid('form');
    const db = c.get('db');
    const session = c.get('session');

    let raw: unknown;
    try {
      raw = JSON.parse(form.data);
    } catch {
      return c.json({ error: 'invalid_body' as const, message: 'Expense details are unreadable.' }, 400);
    }
    const parsed = createExpenseSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: 'invalid_body' as const, message: parsed.error.issues[0]?.message ?? 'Check the expense details.' },
        400,
      );
    }
    const body = parsed.data;

    const existing = await expenseRepo.findById(db, body.id);
    if (existing) return c.json({ id: existing.id }, 200);

    const problem = photoProblem(form.billPhoto, 'bill') ?? photoProblem(form.itemPhoto, 'item');
    if (problem) return c.json({ error: 'bad_photo' as const, message: problem }, 400);

    const today = startOfIstDay();
    let date = today;
    if (body.date) {
      const parsed = parseIstDateOnly(body.date);
      if (!parsed) return c.json({ error: 'invalid_date' as const, message: 'Date must be YYYY-MM-DD.' }, 400);
      if (parsed.getTime() > today.getTime()) {
        return c.json({ error: 'future_date' as const, message: 'Expense date can’t be in the future.' }, 400);
      }
      if (parsed.getTime() < startOfIstDaysAgo(MAX_BACKDATE_DAYS).getTime() && session.role !== 'owner') {
        return c.json(
          { error: 'too_old' as const, message: `Only the owner can add expenses older than ${MAX_BACKDATE_DAYS} days.` },
          400,
        );
      }
      date = parsed;
    }

    const prefix = `shops/${session.shopId}/expenses/${body.id}`;
    const billPhotoKey = `${prefix}/bill.${photoExt(form.billPhoto.type)}`;
    const itemPhotoKey = `${prefix}/item.${photoExt(form.itemPhoto.type)}`;
    await Promise.all([
      c.env.PHOTOS.put(billPhotoKey, await form.billPhoto.arrayBuffer(), {
        httpMetadata: { contentType: form.billPhoto.type },
      }),
      c.env.PHOTOS.put(itemPhotoKey, await form.itemPhoto.arrayBuffer(), {
        httpMetadata: { contentType: form.itemPhoto.type },
      }),
    ]);

    try {
      const expense = await expenseRepo.create(db, {
        id: body.id,
        category: body.category,
        amount: body.amount,
        description: body.description || undefined,
        itemName: body.itemName,
        quantity: body.quantity,
        unit: body.unit,
        billPhotoKey,
        itemPhotoKey,
        paymentMethod: body.paymentMethod,
        date,
        createdByUserId: session.sub,
      });
      // The expense is saved either way; a stock hiccup only means it wasn't added to stock.
      let stock: StockResult | null = null;
      if (body.addToStock && body.quantity != null && body.unit && STOCK_CATEGORIES.includes(body.category)) {
        stock = await addPurchaseToStock(db, {
          expenseId: expense.id,
          itemName: body.itemName,
          quantity: body.quantity,
          unit: body.unit,
          userId: session.sub,
        }).catch((e: unknown) => {
          console.error(e);
          return null;
        });
      }
      return c.json({ id: expense.id, stock }, 201);
    } catch (e) {
      // A replay of this same upload may have saved the expense first — it uses these same keys.
      const winner = await expenseRepo.findById(db, body.id);
      if (winner) return c.json({ id: winner.id }, 200);
      await Promise.all([c.env.PHOTOS.delete(billPhotoKey), c.env.PHOTOS.delete(itemPhotoKey)]);
      throw e;
    }
  })
  // Proof photos stay as long as the expense. Staff can open only their own entries.
  .get('/:id/photos/:kind', zValidator('param', photoParamSchema), async (c) => {
    const { id, kind } = c.req.valid('param');
    const session = c.get('session');
    const expense = await expenseRepo.findById(c.get('db'), id);
    if (!expense) return c.json({ error: 'not_found' as const }, 404);
    if (session.role !== 'owner' && expense.createdByUserId !== session.sub) {
      return c.json({ error: 'forbidden' as const }, 403);
    }
    const key = kind === 'bill' ? expense.billPhotoKey : expense.itemPhotoKey;
    if (!key) return c.json({ error: 'not_found' as const }, 404);
    const object = await c.env.PHOTOS.get(key);
    if (!object) return c.json({ error: 'not_found' as const }, 404);
    return c.body(object.body, 200, {
      'Content-Type': key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
    });
  })
  // Owners see everyone's expenses for the period; staff see only the ones they entered.
  .get('/', zValidator('query', reportQuerySchema), async (c) => {
    const db = c.get('db');
    const session = c.get('session');
    const query = c.req.valid('query');
    const window = resolveReportWindow(query);
    if ('error' in window) return c.json({ error: window.error }, 400);

    const items = await expenseRepo.list(db, window.from, window.to, {
      createdByUserId: session.role === 'owner' ? undefined : session.sub,
    });
    const total = items.filter((e) => !e.voidedAt).reduce((sum, e) => sum + e.amount, 0);

    const byCategory: Record<string, number> = {};
    for (const e of items) {
      if (e.voidedAt) continue;
      byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
    }

    return c.json({
      ...windowMeta(query, window),
      total,
      byCategory,
      items: items.map(({ billPhotoKey, itemPhotoKey, ...e }) => ({
        ...e,
        date: formatIstDateOnly(e.date),
        hasBillPhoto: billPhotoKey != null,
        hasItemPhoto: itemPhotoKey != null,
      })),
    });
  })
  // Void with a reason. Staff can undo their own entry the same day (typo fix); anything else
  // is the owner's call. The row stays, marked voided, so it shows up in the audit log.
  .post('/:id/void', zValidator('json', voidExpenseSchema), async (c) => {
    const id = c.req.param('id');
    const { reason } = c.req.valid('json');
    const db = c.get('db');
    const session = c.get('session');

    const expense = await expenseRepo.findById(db, id);
    if (!expense) return c.json({ error: 'not_found' as const }, 404);
    if (expense.voidedAt) return c.json({ ok: true as const });

    const ownSameDay =
      expense.createdByUserId === session.sub &&
      expense.createdAt.getTime() >= startOfIstDay().getTime();
    if (session.role !== 'owner' && !ownSameDay) {
      return c.json(
        { error: 'owner_only' as const, message: 'Only the owner can void this expense.' },
        403,
      );
    }

    await expenseRepo.voidExpense(db, id, { userId: session.sub, reason });
    await reverseExpenseStock(db, id, session.sub);
    return c.json({ ok: true as const });
  });
