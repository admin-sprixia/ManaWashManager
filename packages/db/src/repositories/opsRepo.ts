import type { DbClient } from '../client';
import type { AttendanceStatus, PhotoKind } from '@mana/domain';
import { chunk } from '../chunk';

const personSelect = { select: { id: true, name: true } } as const;

/** Day-to-day shop operations: attendance, the cash drawer, job photos, and the error log. */
export const opsRepo = {
  // ─── Attendance ───────────────────────────────────────────────────────────

  /** Attendance rows for IST dates in `[fromDate, toDate]` (inclusive, `YYYY-MM-DD`). */
  async listAttendance(db: DbClient, fromDate: string, toDate: string, userId?: string) {
    return db.attendance.findMany({
      where: { date: { gte: fromDate, lte: toDate }, ...(userId ? { userId } : {}) },
      orderBy: [{ date: 'asc' }],
      select: { userId: true, date: true, status: true, markedBy: personSelect, markedAt: true },
    });
  },

  /** Mark or change a day, or clear it with `null`. */
  async setAttendance(
    db: DbClient,
    data: { userId: string; date: string; status: AttendanceStatus | null; markedByUserId: string },
  ) {
    const key = { userId: data.userId, date: data.date };
    if (data.status == null) {
      await db.attendance.deleteMany({ where: key });
      return null;
    }
    return db.attendance.upsert({
      where: { userId_date: key },
      create: { ...key, status: data.status, markedByUserId: data.markedByUserId },
      update: { status: data.status, markedByUserId: data.markedByUserId, markedAt: new Date() },
    });
  },

  // ─── Cash drawer ──────────────────────────────────────────────────────────

  async findCashDay(db: DbClient, date: string) {
    return db.cashDay.findFirst({
      where: { date },
      include: { floatSetBy: personSelect, closedBy: personSelect, reopenedBy: personSelect },
    });
  },

  /** The latest closed day before `date` — its counted cash is the suggested next float. */
  async previousClosedDay(db: DbClient, date: string) {
    return db.cashDay.findFirst({
      where: { date: { lt: date }, closedAt: { not: null } },
      orderBy: { date: 'desc' },
      select: { date: true, counted: true },
    });
  },

  /** Setting the float is allowed any time the day is still open. */
  async setFloat(db: DbClient, data: { date: string; amount: number; userId: string }) {
    const res = await db.cashDay.updateMany({
      where: { date: data.date, closedAt: null },
      data: { openingFloat: data.amount, floatSetByUserId: data.userId, floatSetAt: new Date() },
    });
    if (res.count === 1) return true;
    const existing = await db.cashDay.findFirst({ where: { date: data.date } });
    if (existing) return false; // closed
    await db.cashDay.create({
      data: { date: data.date, openingFloat: data.amount, floatSetByUserId: data.userId },
    });
    return true;
  },

  /** Closes an open day. A conditional update, so two people closing at once can't both win. */
  async closeDay(
    db: DbClient,
    data: { date: string; expected: number; counted: number; note: string | null; userId: string },
  ) {
    const res = await db.cashDay.updateMany({
      where: { date: data.date, closedAt: null },
      data: {
        expected: data.expected,
        counted: data.counted,
        note: data.note,
        closedByUserId: data.userId,
        closedAt: new Date(),
      },
    });
    return res.count === 1;
  },

  async reopenDay(db: DbClient, data: { date: string; reason: string; userId: string }) {
    const res = await db.cashDay.updateMany({
      where: { date: data.date, closedAt: { not: null } },
      data: {
        expected: null,
        counted: null,
        note: null,
        closedByUserId: null,
        closedAt: null,
        reopenedByUserId: data.userId,
        reopenedAt: new Date(),
        reopenReason: data.reason,
      },
    });
    return res.count === 1;
  },

  async listCashDays(db: DbClient, fromDate: string, toDate: string) {
    return db.cashDay.findMany({
      where: { date: { gte: fromDate, lte: toDate } },
      orderBy: { date: 'desc' },
      include: { floatSetBy: personSelect, closedBy: personSelect, reopenedBy: personSelect },
    });
  },

  // ─── Photos ───────────────────────────────────────────────────────────────

  async findPhoto(db: DbClient, id: string) {
    return db.jobPhoto.findUnique({ where: { id } });
  },

  async countPhotos(db: DbClient, jobId: string, kind: PhotoKind) {
    return db.jobPhoto.count({ where: { jobId, kind, deletedAt: null } });
  },

  async createPhoto(
    db: DbClient,
    data: {
      id: string;
      jobId: string;
      kind: PhotoKind;
      r2Key: string;
      contentType: string;
      sizeBytes: number;
      takenByUserId: string;
      createdAt: Date;
    },
  ) {
    return db.jobPhoto.create({ data });
  },

  async deletePhoto(db: DbClient, id: string, userId: string) {
    return db.jobPhoto.update({
      where: { id },
      data: { deletedAt: new Date(), deletedByUserId: userId },
    });
  },

  /** Photos past the retention window: image and row both go. Oldest first, `limit` at a time. */
  async listExpiredPhotos(db: DbClient, before: Date, limit: number) {
    return db.jobPhoto.findMany({
      where: { createdAt: { lt: before } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, r2Key: true },
      take: limit,
    });
  },

  /** Photos deleted since `since`. Their images are removed again in case the first try failed. */
  async listRecentlyDeletedPhotos(db: DbClient, since: Date, limit: number) {
    return db.jobPhoto.findMany({
      where: { deletedAt: { gte: since } },
      orderBy: { deletedAt: 'asc' },
      select: { r2Key: true },
      take: limit,
    });
  },

  async purgePhotos(db: DbClient, ids: string[]) {
    for (const slice of chunk(ids)) await db.jobPhoto.deleteMany({ where: { id: { in: slice } } });
  },

  // ─── Error log ────────────────────────────────────────────────────────────

  async logError(
    db: DbClient,
    data: {
      source: 'app' | 'api';
      userId?: string | null;
      message: string;
      stack?: string | null;
      context?: string | null;
      appVersion?: string | null;
    },
  ) {
    return db.appError.create({
      data: {
        source: data.source,
        userId: data.userId ?? null,
        message: data.message.slice(0, 500),
        stack: data.stack?.slice(0, 4000) ?? null,
        context: data.context?.slice(0, 1000) ?? null,
        appVersion: data.appVersion ?? null,
      },
    });
  },

  async listErrors(db: DbClient, limit: number) {
    return db.appError.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  },

  async countErrorsSince(db: DbClient, since: Date | null) {
    return db.appError.count({ where: since ? { createdAt: { gt: since } } : {} });
  },

  async pruneErrors(db: DbClient, before: Date) {
    await db.appError.deleteMany({ where: { createdAt: { lt: before } } });
  },
};
