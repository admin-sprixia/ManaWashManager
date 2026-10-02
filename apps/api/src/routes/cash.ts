import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { expenseRepo, jobRepo, opsRepo, type DbClient } from '@mana/db';
import {
  cashDifference,
  closeNeedsNote,
  expectedCash,
  MAX_CASH_PAISE,
  MIN_REASON_LENGTH,
  STAFF_CLOSE_WINDOW_DAYS,
} from '@mana/domain';
import { endOfIstDay, formatIstDateOnly, parseIstDateOnly, startOfIstDaysAgo } from '../lib/istDate';
import { reportQuerySchema, resolveReportWindow, windowMeta } from '../lib/reportWindow';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';
import { windowDates } from './shop';

const dateSchema = z
  .string()
  .refine((d) => parseIstDateOnly(d) != null, 'Date must be YYYY-MM-DD')
  .transform((d) => formatIstDateOnly(parseIstDateOnly(d)!));
const moneySchema = z
  .number()
  .int()
  .min(0, 'Amount can’t be negative')
  .max(MAX_CASH_PAISE, 'Amount looks too large');

const dayQuerySchema = z.object({ date: dateSchema.optional() });
const floatSchema = z.object({ date: dateSchema, amount: moneySchema });
const closeSchema = z.object({
  date: dateSchema,
  counted: moneySchema,
  note: z.string().trim().max(300).optional(),
});
const reopenSchema = z.object({
  date: dateSchema,
  reason: z
    .string()
    .trim()
    .min(MIN_REASON_LENGTH, `Reason must be at least ${MIN_REASON_LENGTH} characters`)
    .max(200),
});

/** Everything the drawer screen shows for one IST day, worked out from the day's real records. */
async function daySummary(db: DbClient, date: string) {
  const from = parseIstDateOnly(date)!;
  const to = endOfIstDay(from);
  const [row, cashIn, cashOut, previous] = await Promise.all([
    opsRepo.findCashDay(db, date),
    jobRepo.cashCollected(db, from, to),
    expenseRepo.cashTotal(db, from, to),
    opsRepo.previousClosedDay(db, date),
  ]);
  const openingFloat = row?.openingFloat ?? 0;
  const expectedNow = expectedCash({ openingFloat, cashIn: cashIn.total, cashExpenses: cashOut.total });
  const closed = Boolean(row?.closedAt);
  const expected = closed ? row!.expected! : expectedNow;
  const counted = closed ? row!.counted! : null;
  const status: 'closed' | 'open' | 'not_started' = closed ? 'closed' : row ? 'open' : 'not_started';

  return {
    date,
    status,
    openingFloat: row ? row.openingFloat : null,
    floatSetBy: row?.floatSetBy.name ?? null,
    /** Yesterday's counted cash — what's normally left in the drawer overnight. */
    suggestedFloat: previous?.counted ?? null,
    cashIn: cashIn.total,
    cashJobs: cashIn.count,
    cashExpenses: cashOut.total,
    cashExpenseCount: cashOut.count,
    expected,
    counted,
    difference: counted != null ? cashDifference(expected, counted) : null,
    note: row?.note ?? null,
    closedBy: row?.closedBy?.name ?? null,
    closedAt: row?.closedAt?.toISOString() ?? null,
    /** A payment or expense changed after the close — the frozen figure no longer matches. */
    changedSinceClose: closed ? expectedNow - expected : 0,
    reopenedBy: row?.reopenedBy?.name ?? null,
    reopenedAt: row?.reopenedAt?.toISOString() ?? null,
    reopenReason: row?.reopenReason ?? null,
  };
}

/** Staff handle today and a forgotten yesterday; anything older, or in the future, is refused. */
function checkDate(date: string, role: 'owner' | 'staff') {
  const today = formatIstDateOnly(new Date());
  if (date > today) return 'The cash drawer can’t be closed for a future day.';
  if (role !== 'owner' && date < formatIstDateOnly(startOfIstDaysAgo(STAFF_CLOSE_WINDOW_DAYS))) {
    return 'Only the owner can handle older days.';
  }
  return null;
}

// Online only: the expected figure has to come from the server's records at that moment.
export const cashRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  .get('/day', zValidator('query', dayQuerySchema), async (c) => {
    const db = c.get('db');
    const date = c.req.valid('query').date ?? formatIstDateOnly(new Date());
    const problem = checkDate(date, c.get('session').role);
    if (problem) return c.json({ error: 'date_not_allowed' as const, message: problem }, 403);
    return c.json(await daySummary(db, date));
  })
  .put('/day/float', zValidator('json', floatSchema), async (c) => {
    const body = c.req.valid('json');
    const problem = checkDate(body.date, c.get('session').role);
    if (problem) return c.json({ error: 'date_not_allowed' as const, message: problem }, 403);
    const db = c.get('db');
    const ok = await opsRepo.setFloat(db, { ...body, userId: c.get('session').sub });
    if (!ok) {
      return c.json(
        { error: 'day_closed' as const, message: 'This day is already closed. Ask the owner to reopen it.' },
        409,
      );
    }
    return c.json(await daySummary(db, body.date));
  })
  // Anyone on shift can close. The expected figure is recomputed here, not taken from the phone,
  // and frozen with the count — a mismatch needs a reason.
  .post('/day/close', zValidator('json', closeSchema), async (c) => {
    const body = c.req.valid('json');
    const problem = checkDate(body.date, c.get('session').role);
    if (problem) return c.json({ error: 'date_not_allowed' as const, message: problem }, 403);
    const db = c.get('db');

    const summary = await daySummary(db, body.date);
    if (summary.status === 'closed') {
      return c.json({ error: 'day_closed' as const, message: 'This day is already closed.' }, 409);
    }
    if (summary.status === 'not_started') {
      return c.json(
        { error: 'no_float' as const, message: 'Enter the morning float before closing the day.' },
        409,
      );
    }
    const difference = cashDifference(summary.expected, body.counted);
    const note = body.note?.trim() || null;
    if (closeNeedsNote(difference) && (!note || note.length < MIN_REASON_LENGTH)) {
      return c.json(
        {
          error: 'note_required' as const,
          message: 'The count doesn’t match. Add a short note explaining the difference.',
          expected: summary.expected,
        },
        400,
      );
    }
    const closed = await opsRepo.closeDay(db, {
      date: body.date,
      expected: summary.expected,
      counted: body.counted,
      note,
      userId: c.get('session').sub,
    });
    if (!closed) {
      return c.json({ error: 'day_closed' as const, message: 'This day was just closed by someone else.' }, 409);
    }
    return c.json(await daySummary(db, body.date));
  })
  .post('/day/reopen', requireRole('owner'), zValidator('json', reopenSchema), async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const reopened = await opsRepo.reopenDay(db, { ...body, userId: c.get('session').sub });
    if (!reopened) {
      return c.json({ error: 'not_closed' as const, message: 'This day isn’t closed.' }, 409);
    }
    return c.json(await daySummary(db, body.date));
  })
  // Owner history: every day with a drawer record in the period, newest first.
  .get('/history', requireRole('owner'), zValidator('query', reportQuerySchema), async (c) => {
    const db = c.get('db');
    const query = c.req.valid('query');
    const window = resolveReportWindow(query);
    if ('error' in window) return c.json({ error: window.error }, 400);
    const { fromDate, toDate } = windowDates(window.from, window.to);
    const rows = await opsRepo.listCashDays(db, fromDate, toDate);
    const days = rows.map((r) => ({
      date: r.date,
      status: r.closedAt ? ('closed' as const) : ('open' as const),
      openingFloat: r.openingFloat,
      expected: r.expected,
      counted: r.counted,
      difference: r.closedAt && r.counted != null && r.expected != null ? r.counted - r.expected : null,
      note: r.note,
      closedBy: r.closedBy?.name ?? null,
      reopenedBy: r.reopenedBy?.name ?? null,
      reopenReason: r.reopenReason,
    }));
    const closedDays = days.filter((d) => d.difference != null);
    return c.json({
      ...windowMeta(query, window),
      days,
      totals: {
        closedDays: closedDays.length,
        short: closedDays.reduce((s, d) => s + Math.min(0, d.difference!), 0),
        over: closedDays.reduce((s, d) => s + Math.max(0, d.difference!), 0),
      },
    });
  });
