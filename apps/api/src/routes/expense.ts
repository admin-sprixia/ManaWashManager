import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createDbClient, expenseRepo } from '@mana/db';
import { EXPENSE_CATEGORIES, MIN_REASON_LENGTH, type ExpenseCategory } from '@mana/domain';
import { requireAuth } from '../middleware/auth';
import { formatIstDateOnly, parseIstDateOnly, startOfIstDay, startOfIstDaysAgo } from '../lib/istDate';
import { reportQuerySchema, resolveReportWindow, windowMeta } from '../lib/reportWindow';
import type { Env } from '../types';

/** ₹10,00,000 — anything above is certainly a typo (extra zeros), not a shop expense. */
const MAX_EXPENSE_PAISE = 10_00_000 * 100;
/** Late entries (a bill found in a drawer) are fine; older than this belongs to the owner. */
const MAX_BACKDATE_DAYS = 31;

const createExpenseSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'Invalid id').optional(),
  category: z.enum(EXPENSE_CATEGORIES as [ExpenseCategory, ...ExpenseCategory[]]),
  amount: z.number().int().positive('Amount must be more than zero').max(MAX_EXPENSE_PAISE, 'Amount looks too large'),
  description: z.string().trim().max(200).optional(),
  date: z.string().optional(),
});

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
  .post('/', zValidator('json', createExpenseSchema), async (c) => {
    const body = c.req.valid('json');
    const db = createDbClient(c.env.DB);
    const session = c.get('session');

    if (body.id) {
      const existing = await expenseRepo.findById(db, body.id);
      if (existing) return c.json(existing, 200);
    }

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

    const expense = await expenseRepo.create(db, {
      id: body.id,
      category: body.category,
      amount: body.amount,
      description: body.description || undefined,
      date,
      createdByUserId: session.sub,
    });
    return c.json(expense, 201);
  })
  // Owners see everyone's expenses for the period; staff see only the ones they entered.
  .get('/', zValidator('query', reportQuerySchema), async (c) => {
    const db = createDbClient(c.env.DB);
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
      items: items.map((e) => ({ ...e, date: formatIstDateOnly(e.date) })),
    });
  })
  // Void with a reason. Staff can undo their own entry the same day (typo fix); anything else
  // is the owner's call. The row stays, marked voided, so it shows up in the audit log.
  .post('/:id/void', zValidator('json', voidExpenseSchema), async (c) => {
    const id = c.req.param('id');
    const { reason } = c.req.valid('json');
    const db = createDbClient(c.env.DB);
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
    return c.json({ ok: true as const });
  });
