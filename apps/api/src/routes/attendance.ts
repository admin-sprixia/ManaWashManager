import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { opsRepo } from '@mana/db';
import { ATTENDANCE_STATUSES, type AttendanceStatus } from '@mana/domain';
import { formatIstDateOnly, parseIstDateOnly } from '../lib/istDate';
import { requireAuth, requireRole } from '../middleware/auth';
import type { Env } from '../types';

const dateSchema = z
  .string()
  .refine((d) => parseIstDateOnly(d) != null, 'Date must be YYYY-MM-DD')
  .transform((d) => formatIstDateOnly(parseIstDateOnly(d)!));

const dayQuerySchema = z.object({ date: dateSchema.optional() });
const monthQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM') });
const markSchema = z.object({
  userId: z.string().min(1).max(64),
  date: dateSchema,
  status: z.enum(ATTENDANCE_STATUSES as [AttendanceStatus, ...AttendanceStatus[]]).nullable(),
});

// Owner-only: attendance is marked by the owner. Staff see their own days via /shop/me/earnings.
export const attendanceRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth, requireRole('owner'))
  // One day's sheet: every active member (plus anyone already marked that day) and their status.
  .get('/', zValidator('query', dayQuerySchema), async (c) => {
    const db = c.get('db');
    const date = c.req.valid('query').date ?? formatIstDateOnly(new Date());
    const [users, marks] = await Promise.all([
      db.user.findMany({ select: { id: true, name: true, role: true, active: true } }),
      opsRepo.listAttendance(db, date, date),
    ]);
    const byUser = new Map(marks.map((m) => [m.userId, m]));
    const rows = users
      .filter((u) => u.active || byUser.has(u.id))
      .map((u) => {
        const mark = byUser.get(u.id);
        return {
          userId: u.id,
          name: u.name,
          role: u.role as 'owner' | 'staff',
          status: (mark?.status as AttendanceStatus | undefined) ?? null,
          markedBy: mark?.markedBy.name ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return c.json({ date, today: formatIstDateOnly(new Date()), rows });
  })
  // Per-day counts for a calendar month, so the date picker can show which days are marked.
  .get('/month', zValidator('query', monthQuerySchema), async (c) => {
    const db = c.get('db');
    const { month } = c.req.valid('query');
    const [members, marks] = await Promise.all([
      db.user.count({ where: { active: true } }),
      opsRepo.listAttendance(db, `${month}-01`, `${month}-31`),
    ]);
    const days: Record<string, { present: number; half: number; absent: number }> = {};
    for (const m of marks) {
      const day = (days[m.date] ??= { present: 0, half: 0, absent: 0 });
      day[m.status as AttendanceStatus] += 1;
    }
    return c.json({ month, members, today: formatIstDateOnly(new Date()), days });
  })
  .put('/', zValidator('json', markSchema), async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    if (body.date > formatIstDateOnly(new Date())) {
      return c.json(
        { error: 'future_date' as const, message: 'Attendance can’t be marked for a future day.' },
        400,
      );
    }
    const user = await db.user.findUnique({ where: { id: body.userId }, select: { id: true } });
    if (!user) return c.json({ error: 'not_found' as const }, 404);
    await opsRepo.setAttendance(db, {
      userId: body.userId,
      date: body.date,
      status: body.status,
      markedByUserId: c.get('session').sub,
    });
    return c.json({ ok: true as const });
  });
