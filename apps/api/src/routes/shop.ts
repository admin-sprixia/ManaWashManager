import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createPlatformDb, jobRepo, opsRepo, settingsRepo, shopRepo } from '@mana/db';
import { daysWorked, type AttendanceStatus } from '@mana/domain';
import {
  ERRORS_SEEN_SETTING,
  formatSettingDate,
  parseSettingDate,
  reportError,
} from '../lib/alerts';
import { formatIstDateOnly } from '../lib/istDate';
import { reportQuerySchema, resolveReportWindow, windowMeta } from '../lib/reportWindow';
import { requireAuth, requireRole } from '../middleware/auth';
import { requirePro } from '../lib/plan';
import type { Env } from '../types';

const settingsSchema = z.object({
  googleReviewUrl: z
    .string()
    .trim()
    .max(300)
    .refine(
      (u) => u === '' || /^https:\/\/\S+$/i.test(u),
      'Paste the full link, starting with https://',
    )
    .nullable(),
});

const shopInfoSchema = z.object({
  name: z.string().trim().min(2, 'Shop name is too short').max(60),
  city: z.string().trim().max(40).nullable().optional(),
});

const errorReportSchema = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  context: z.string().max(2000).optional(),
  appVersion: z.string().max(20).optional(),
});

/** Inclusive IST calendar dates covering a half-open report window. */
export function windowDates(from: Date, to: Date) {
  return {
    fromDate: formatIstDateOnly(from),
    toDate: formatIstDateOnly(new Date(to.getTime() - 1)),
  };
}

// Chained in one expression, with every input declared via `zValidator` — see the comment
// in routes/auth.ts for why both matter for Hono RPC's client typing.
export const shopRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth)
  // Name and shop ID (staff read the ID out to new teammates).
  .get('/info', async (c) => {
    const shop = await shopRepo.findById(createPlatformDb(c.env.DB), c.get('session').shopId);
    if (!shop) return c.json({ error: 'not_found' as const }, 404);
    return c.json({ name: shop.name, city: shop.city, code: shop.code });
  })
  // The name customers see on WhatsApp messages, PDFs and every phone in the shop.
  .put('/info', requireRole('owner'), zValidator('json', shopInfoSchema), async (c) => {
    const body = c.req.valid('json');
    const shop = await shopRepo.rename(createPlatformDb(c.env.DB), c.get('session').shopId, {
      name: body.name.replace(/\s+/g, ' '),
      city: body.city?.trim() || null,
    });
    return c.json({ name: shop.name, city: shop.city, code: shop.code });
  })
  // Everyone needs these (the thank-you message includes the review link); phones cache them.
  .get('/settings', async (c) => {
    const db = c.get('db');
    const settings = await settingsRepo.listPublic(db);
    return c.json({ googleReviewUrl: settings.google_review_url });
  })
  .put('/settings', requireRole('owner'), zValidator('json', settingsSchema), async (c) => {
    const { googleReviewUrl } = c.req.valid('json');
    const db = c.get('db');
    if (googleReviewUrl) {
      await settingsRepo.set(db, 'google_review_url', googleReviewUrl, c.get('session').sub);
    } else {
      await settingsRepo.remove(db, 'google_review_url');
    }
    return c.json({ googleReviewUrl: googleReviewUrl || null });
  })
  // Active team members, for picking who washed a car. Names only — no phones, no PINs.
  .get('/roster', async (c) => {
    const db = c.get('db');
    const users = await db.user.findMany({
      where: { active: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    return c.json(users);
  })
  // A team member's own numbers for a period: washes done, commission services they got
  // customers to take and what that earned, days worked.
  .get('/me/earnings', requirePro('commission'), zValidator('query', reportQuerySchema), async (c) => {
    const db = c.get('db');
    const query = c.req.valid('query');
    const window = resolveReportWindow(query);
    if ('error' in window) return c.json({ error: window.error }, 400);
    const me = c.get('session').sub;

    const { fromDate, toDate } = windowDates(window.from, window.to);
    const [rows, attendance] = await Promise.all([
      jobRepo.getStaffStats(db, window.from, window.to),
      opsRepo.listAttendance(db, fromDate, toDate, me),
    ]);
    const mine = rows.find((r) => r.userId === me);
    const statuses = attendance.map((a) => a.status as AttendanceStatus);
    return c.json({
      ...windowMeta(query, window),
      washesDone: mine?.washesDone ?? 0,
      servicesSold: mine?.servicesSold ?? 0,
      commission: mine?.commission ?? 0,
      attendance: {
        present: statuses.filter((s) => s === 'present').length,
        half: statuses.filter((s) => s === 'half').length,
        absent: statuses.filter((s) => s === 'absent').length,
        daysWorked: daysWorked(statuses),
        days: attendance.map((a) => ({ date: a.date, status: a.status as AttendanceStatus })),
      },
    });
  })
  // App crashes, sent by the phone once it's signed in (crashes before sign-in wait on the phone).
  .post('/errors', zValidator('json', errorReportSchema), async (c) => {
    const body = c.req.valid('json');
    const ctx = c.executionCtx;
    const session = c.get('session');
    await reportError(
      c.env,
      { source: 'app', userId: session.sub, shopId: session.shopId, ...body },
      (p) => ctx.waitUntil(p),
    );
    return c.json({ ok: true as const }, 201);
  })
  // Badge count for the owner: errors logged since they last opened the error log.
  .get('/errors/unseen', requireRole('owner'), async (c) => {
    const db = c.get('db');
    const seenAt = parseSettingDate(await settingsRepo.get(db, ERRORS_SEEN_SETTING));
    return c.json({ count: await opsRepo.countErrorsSince(db, seenAt) });
  })
  .post('/errors/seen', requireRole('owner'), async (c) => {
    const db = c.get('db');
    await settingsRepo.set(
      db,
      ERRORS_SEEN_SETTING,
      formatSettingDate(new Date()),
      c.get('session').sub,
    );
    return c.json({ ok: true as const });
  })
  .get('/errors', requireRole('owner'), async (c) => {
    const db = c.get('db');
    const rows = await opsRepo.listErrors(db, 100);
    return c.json(
      rows.map((r) => ({
        id: r.id,
        source: r.source as 'app' | 'api',
        message: r.message,
        stack: r.stack,
        context: r.context,
        appVersion: r.appVersion,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  });
