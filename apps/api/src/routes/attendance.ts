import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { opsRepo } from '@mana/db';
import {
  ATTENDANCE_MANAGER_DAYS,
  ATTENDANCE_STATUSES,
  canMarkAttendance,
  daysWorked,
  noAbsences,
  toUserRole,
  type AttendanceStatus,
  type UserRole,
} from '@mana/domain';
import { formatIstDateOnly, parseIstDateOnly, startOfIstDaysAgo } from '../lib/istDate';
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

/** Why this person can't change `date`, if anything: never the future; managers only lately. */
function dateProblem(date: string, role: UserRole): string | null {
  if (date > formatIstDateOnly(new Date())) return 'Attendance can’t be marked for a future day.';
  if (role !== 'owner' && date < formatIstDateOnly(startOfIstDaysAgo(ATTENDANCE_MANAGER_DAYS))) {
    return 'Only the owner can change older days.';
  }
  return null;
}

// The owner marks everyone; a manager marks staff, for today and yesterday. Nobody marks their own
// day. Staff see their own days via /shop/me/earnings.
export const attendanceRoutes = new Hono<{ Bindings: Env }>()
  .use('*', requireAuth, requireRole('owner', 'manager'))
  // One day's sheet: every active member (plus anyone already marked that day), their status, and
  // whether the person asking may change it.
  .get('/', zValidator('query', dayQuerySchema), async (c) => {
    const db = c.get('db');
    const session = c.get('session');
    const date = c.req.valid('query').date ?? formatIstDateOnly(new Date());
    const [users, marks] = await Promise.all([
      db.user.findMany({ select: { id: true, name: true, role: true, active: true, removedAt: true } }),
      opsRepo.listAttendance(db, date, date),
    ]);
    const byUser = new Map(marks.map((m) => [m.userId, m]));
    const dayLocked = dateProblem(date, session.role);
    const rows = users
      // Your own day is someone else's to mark, so it isn't on your sheet.
      .filter((u) => u.id !== session.sub && ((u.active && !u.removedAt) || byUser.has(u.id)))
      .map((u) => {
        const mark = byUser.get(u.id);
        const role = toUserRole(u.role);
        return {
          userId: u.id,
          name: u.name,
          role,
          status: (mark?.status as AttendanceStatus | undefined) ?? null,
          markedBy: mark?.markedBy.name ?? null,
          markedAt: mark?.markedAt.toISOString() ?? null,
          // Removed teammates still show on days they were marked, but can't be marked any more.
          canMark: !dayLocked && !u.removedAt && canMarkAttendance(session.role, role, false),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return c.json({ date, today: formatIstDateOnly(new Date()), locked: dayLocked, rows });
  })
  // Per-day counts for a calendar month, so the date picker can show which days are marked.
  .get('/month', zValidator('query', monthQuerySchema), async (c) => {
    const db = c.get('db');
    const { month } = c.req.valid('query');
    const [members, marks] = await Promise.all([
      db.user.count({ where: { active: true, removedAt: null } }),
      opsRepo.listAttendance(db, `${month}-01`, `${month}-31`),
    ]);
    const days: Record<string, { present: number; half: number; absent: number }> = {};
    for (const m of marks) {
      const day = (days[m.date] ??= { present: 0, half: 0, absent: 0 });
      day[m.status as AttendanceStatus] += 1;
    }
    return c.json({ month, members, today: formatIstDateOnly(new Date()), days });
  })
  // Each person's month: present, half days, absent, days worked, and whether they had no absences.
  .get('/summary', zValidator('query', monthQuerySchema), async (c) => {
    const db = c.get('db');
    const session = c.get('session');
    const { month } = c.req.valid('query');
    const [users, marks] = await Promise.all([
      db.user.findMany({ select: { id: true, name: true, role: true, active: true, removedAt: true } }),
      opsRepo.listAttendance(db, `${month}-01`, `${month}-31`),
    ]);
    const byUser = new Map<string, AttendanceStatus[]>();
    for (const m of marks) byUser.set(m.userId, [...(byUser.get(m.userId) ?? []), m.status as AttendanceStatus]);
    const people = users
      // Your own day is someone else's to mark, so it isn't on your sheet.
      .filter((u) => u.id !== session.sub && ((u.active && !u.removedAt) || byUser.has(u.id)))
      .map((u) => {
        const statuses = byUser.get(u.id) ?? [];
        return {
          userId: u.id,
          name: u.name,
          role: toUserRole(u.role),
          present: statuses.filter((s) => s === 'present').length,
          half: statuses.filter((s) => s === 'half').length,
          absent: statuses.filter((s) => s === 'absent').length,
          daysWorked: daysWorked(statuses),
          noAbsences: noAbsences(statuses),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return c.json({ month, people });
  })
  .put('/', zValidator('json', markSchema), async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const session = c.get('session');
    const problem = dateProblem(body.date, session.role);
    if (problem) {
      return c.json(
        { error: body.date > formatIstDateOnly(new Date()) ? ('future_date' as const) : ('date_not_allowed' as const), message: problem },
        400,
      );
    }
    const user = await db.user.findFirst({ where: { id: body.userId, removedAt: null }, select: { id: true, role: true } });
    if (!user) return c.json({ error: 'not_found' as const }, 404);
    if (!canMarkAttendance(session.role, toUserRole(user.role), user.id === session.sub)) {
      return c.json(
        {
          error: 'forbidden' as const,
          message:
            user.id === session.sub
              ? 'You can’t mark your own attendance.'
              : 'A manager marks staff only. The owner marks managers and owners.',
        },
        403,
      );
    }
    await opsRepo.setAttendance(db, {
      userId: body.userId,
      date: body.date,
      status: body.status,
      markedByUserId: session.sub,
    });
    return c.json({ ok: true as const });
  });
