import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { expenseRepo, jobRepo, opsRepo, type DbClient } from '@mana/db';
import {
  cashDifference,
  closeNeedsNote,
  expectedCash,
  handoverDifference,
  MAX_CASH_PAISE,
  MIN_REASON_LENGTH,
  STAFF_CLOSE_WINDOW_DAYS,
  type UserRole,
} from '@mana/domain';
import { endOfIstDay, formatIstDateOnly, parseIstDateOnly, startOfIstDaysAgo } from '../lib/istDate';
import { reportQuerySchema, resolveReportWindow, windowMeta } from '../lib/reportWindow';
import { cashHeldNow, heldBusy, heldLockKey } from '../lib/cashHeld';
import { withLock } from '../lib/phoneLock';
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
  /** Close although team members still hold doorstep cash: it carries over until handed in. */
  leaveHeld: z.boolean().optional(),
});
const handoverSchema = z.object({
  collectorId: z.string().min(1).max(100),
  /** What the phone showed them holding: if it changed meanwhile, the handover is refused. */
  due: moneySchema,
  received: moneySchema,
  /** Handed in less than they hold: the rest is still with them (brought later), or missing. */
  rest: z.enum(['still_held', 'missing']).optional(),
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

/**
 * Doorstep cash for one IST day: what was collected that day, what reached the drawer, and who
 * still holds cash now (from any day — it carries over until it's handed in).
 */
async function doorstepSummary(db: DbClient, date: string, from: Date, to: Date) {
  const [today, spentToday, held, handovers, names] = await Promise.all([
    jobRepo.doorstepCashByCollector(db, { from, to }),
    expenseRepo.heldSpendByUser(db, { from, to }),
    cashHeldNow(db),
    opsRepo.listHandovers(db, date),
    opsRepo.personNames(db),
  ]);
  const live = handovers.filter((h) => !h.voidedAt);
  const ids = new Set([
    ...today.map((t) => t.userId),
    ...spentToday.keys(),
    ...held.keys(),
    ...live.map((h) => h.collectorUserId),
  ]);
  const people = [...ids]
    .map((userId) => {
      const mine = today.find((t) => t.userId === userId);
      return {
        userId,
        name: names.get(userId) ?? 'Someone removed',
        collectedToday: mine?.total ?? 0,
        jobsToday: mine?.count ?? 0,
        /** Spent from their doorstep cash on this day (expenses paid from it). */
        spentToday: spentToday.get(userId)?.total ?? 0,
        handedInToday: live.filter((h) => h.collectorUserId === userId).reduce((sum, h) => sum + h.received, 0),
        held: held.get(userId) ?? 0,
      };
    })
    .sort((a, b) => b.held - a.held || a.name.localeCompare(b.name));
  return {
    collected: today.reduce((sum, t) => sum + t.total, 0),
    jobs: today.reduce((sum, t) => sum + t.count, 0),
    spent: [...spentToday.values()].reduce((sum, x) => sum + x.total, 0),
    handedIn: live.reduce((sum, h) => sum + h.received, 0),
    /** Held by everyone right now. */
    held: people.reduce((sum, p) => sum + p.held, 0),
    people,
    handovers: handovers.map((h) => ({
      id: h.id,
      collectorId: h.collectorUserId,
      collector: h.collector ?? 'Someone removed',
      receivedBy: h.receivedBy,
      due: h.due,
      received: h.received,
      difference: handoverDifference(h.due, h.received),
      note: h.note,
      at: h.createdAt.toISOString(),
      voided: h.voidedAt ? { by: h.voidedBy, at: h.voidedAt.toISOString(), reason: h.voidReason } : null,
    })),
  };
}

/** Everything the drawer screen shows for one IST day, worked out from the day's real records. */
async function daySummary(db: DbClient, date: string) {
  const from = parseIstDateOnly(date)!;
  const to = endOfIstDay(from);
  const [row, cashIn, cashOut, previous, earlier, doorstep] = await Promise.all([
    opsRepo.findCashDay(db, date),
    jobRepo.cashCollected(db, from, to),
    expenseRepo.cashTotal(db, from, to),
    opsRepo.previousClosedDay(db, date),
    opsRepo.listEarlierCloses(db, date),
    doorstepSummary(db, date, from, to),
  ]);
  const openingFloat = row?.openingFloat ?? 0;
  const expectedNow = expectedCash({
    openingFloat,
    cashIn: cashIn.total,
    handedIn: doorstep.handedIn,
    cashExpenses: cashOut.total,
  });
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
    doorstep,
    expected,
    counted,
    difference: counted != null ? cashDifference(expected, counted) : null,
    note: row?.note ?? null,
    /** Doorstep cash team members still held when the day was closed. */
    heldAtClose: closed ? (row!.heldAtClose ?? 0) : null,
    closedBy: row?.closedBy?.name ?? null,
    closedAt: row?.closedAt?.toISOString() ?? null,
    /** A payment or expense changed after the close — the frozen figure no longer matches. */
    changedSinceClose: closed ? expectedNow - expected : 0,
    reopenedBy: row?.reopenedBy?.name ?? null,
    reopenedAt: row?.reopenedAt?.toISOString() ?? null,
    reopenReason: row?.reopenReason ?? null,
    /** Closes of this day that were reopened, newest first — a reopen never erases a count. */
    earlierCloses: earlier.map((e) => ({
      expected: e.expected,
      counted: e.counted,
      difference: e.counted != null && e.expected != null ? cashDifference(e.expected, e.counted) : null,
      note: e.note,
      heldAtClose: e.heldAtClose,
      closedBy: e.closedBy,
      closedAt: e.closedAt.toISOString(),
      reopenedBy: e.reopenedBy,
      reopenedAt: e.reopenedAt?.toISOString() ?? null,
      reopenReason: e.reopenReason,
    })),
  };
}

/** Staff handle today and a forgotten yesterday; anything older, or in the future, is refused. */
function checkDate(date: string, role: UserRole) {
  const today = formatIstDateOnly(new Date());
  if (date > today) return 'The cash drawer can’t be closed for a future day.';
  if (role !== 'owner' && date < formatIstDateOnly(startOfIstDaysAgo(STAFF_CLOSE_WINDOW_DAYS))) {
    return 'Only the owner can handle older days.';
  }
  return null;
}

type HandoverContext = Context<{ Bindings: Env }>;

/** Records one handover; runs under the collector's held-cash lock. */
async function recordHandover(c: HandoverContext, body: z.infer<typeof handoverSchema>) {
  const db = c.get('db');
  const today = formatIstDateOnly(new Date());

  const [day, held, names] = await Promise.all([opsRepo.findCashDay(db, today), cashHeldNow(db), opsRepo.personNames(db)]);
  if (!names.has(body.collectorId)) {
    return c.json({ error: 'not_on_team' as const, message: 'That person isn’t on this branch’s team.' }, 404);
  }
  if (!day) {
    return c.json(
      { error: 'no_float' as const, message: 'Start today’s drawer first: the cash goes into today’s box.' },
      409,
    );
  }
  if (day.closedAt) {
    return c.json(
      { error: 'day_closed' as const, message: 'Today’s drawer is closed. Ask the owner to reopen it.' },
      409,
    );
  }
  const due = held.get(body.collectorId) ?? 0;
  if (due === 0) {
    return c.json(
      { error: 'nothing_held' as const, message: `${names.get(body.collectorId)} has no doorstep cash to hand in.` },
      409,
    );
  }
  if (due !== body.due) {
    return c.json(
      {
        error: 'held_changed' as const,
        message: `${names.get(body.collectorId)} now holds ₹${(due / 100).toLocaleString('en-IN')}. Check again before taking it.`,
        held: due,
      },
      409,
    );
  }
  const note = body.note?.trim() || null;
  // Part now, the rest later: this handover settles only what was handed in.
  const partial = body.rest === 'still_held' && body.received > 0 && body.received < due;
  const settles = partial ? body.received : due;
  if (handoverDifference(settles, body.received) !== 0 && (!note || note.length < MIN_REASON_LENGTH)) {
    return c.json(
      {
        error: 'note_required' as const,
        message: 'What was handed in doesn’t match. Add a short note explaining the difference.',
      },
      400,
    );
  }
  const created = await opsRepo.createHandover(db, {
    date: today,
    collectorUserId: body.collectorId,
    due: settles,
    received: body.received,
    note,
    userId: c.get('session').sub,
  });
  if (!created) {
    return c.json({ error: 'handover_clash' as const, message: 'Someone just took this cash. Check the list again.' }, 409);
  }
  return c.json(await daySummary(db, today), 201);
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
    if (summary.doorstep.held > 0 && !body.leaveHeld) {
      const holders = summary.doorstep.people.filter((p) => p.held > 0);
      return c.json(
        {
          error: 'cash_held' as const,
          message: 'Doorstep cash hasn’t been handed in yet. Take it first, or close and carry it over.',
          held: summary.doorstep.held,
          holders: holders.map((p) => ({ userId: p.userId, name: p.name, held: p.held })),
        },
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
      heldAtClose: summary.doorstep.held,
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
  // What the signed-in person holds now, for "Paid from my doorstep cash" on a new expense.
  .get('/held', async (c) => {
    const held = await cashHeldNow(c.get('db'));
    return c.json({ held: held.get(c.get('session').sub) ?? 0 });
  })
  // A team member hands in the doorstep cash they hold. It goes into today's drawer, which has to
  // be open; what they hold is worked out here, and the phone must have seen the same figure.
  .post('/handover', zValidator('json', handoverSchema), async (c) => {
    const body = c.req.valid('json');
    const done = await withLock(c.env, heldLockKey(c.get('session').shopId, body.collectorId), () => recordHandover(c, body));
    return done ?? c.json(heldBusy, 503);
  })
  // A mistaken handover is voided, never edited: the cash counts as held again. Only while its
  // day is open, so a closed count never changes underneath the closer.
  .post('/handover/:id/void', requireRole('owner'), zValidator('json', reopenSchema.pick({ reason: true })), async (c) => {
    const db = c.get('db');
    const handover = await opsRepo.findHandover(db, c.req.param('id'));
    if (!handover) return c.json({ error: 'not_found' as const, message: 'That handover isn’t on record.' }, 404);
    if (handover.voidedAt) {
      return c.json({ error: 'already_voided' as const, message: 'That handover was already undone.' }, 409);
    }
    const day = await opsRepo.findCashDay(db, handover.date);
    if (day?.closedAt) {
      return c.json(
        { error: 'day_closed' as const, message: 'That day is closed. Reopen it first, then undo the handover.' },
        409,
      );
    }
    const voided = await opsRepo.voidHandover(db, {
      id: handover.id,
      reason: c.req.valid('json').reason,
      userId: c.get('session').sub,
    });
    if (!voided) {
      return c.json({ error: 'already_voided' as const, message: 'That handover was already undone.' }, 409);
    }
    return c.json(await daySummary(db, handover.date));
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
      heldAtClose: r.closedAt ? (r.heldAtClose ?? 0) : null,
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
