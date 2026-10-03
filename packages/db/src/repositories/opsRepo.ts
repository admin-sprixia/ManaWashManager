import type { DbClient } from '../client';
import type { AttendanceStatus, PhotoKind } from '@mana/domain';
import { chunk } from '../chunk';
import { isUniqueClash, retryOnClash } from '../retryOnClash';

const personSelect = { select: { id: true, name: true } } as const;

/** Day-to-day shop operations: attendance, the cash drawer, job photos, and the error log. */
export const opsRepo = {
  // ─── Attendance ───────────────────────────────────────────────────────────

  /** Attendance rows for IST dates in `[fromDate, toDate]` (inclusive, `YYYY-MM-DD`). */
  async listAttendance(db: DbClient, fromDate: string, toDate: string, userId?: string) {
    const [rows, users] = await Promise.all([
      db.attendance.findMany({
        where: { date: { gte: fromDate, lte: toDate }, ...(userId ? { userId } : {}) },
        orderBy: [{ date: 'asc' }],
        select: { userId: true, date: true, status: true, markedByUserId: true, markedAt: true },
      }),
      db.user.findMany(personSelect),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      userId: r.userId,
      date: r.date,
      status: r.status,
      markedBy: byId.get(r.markedByUserId)!,
      markedAt: r.markedAt,
    }));
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
    const status = data.status;
    return retryOnClash(() =>
      db.attendance.upsert({
        where: { userId_date: key },
        create: { ...key, status, markedByUserId: data.markedByUserId },
        update: { status, markedByUserId: data.markedByUserId, markedAt: new Date() },
      }),
    );
  },

  // ─── Cash drawer ──────────────────────────────────────────────────────────

  async findCashDay(db: DbClient, date: string) {
    const [day, users] = await Promise.all([db.cashDay.findFirst({ where: { date } }), db.user.findMany(personSelect)]);
    if (!day) return null;
    const byId = new Map(users.map((u) => [u.id, u]));
    const person = (id: string | null) => (id ? (byId.get(id) ?? null) : null);
    return {
      ...day,
      floatSetBy: byId.get(day.floatSetByUserId)!,
      closedBy: person(day.closedByUserId),
      reopenedBy: person(day.reopenedByUserId),
    };
  },

  /** The latest closed day before `date` — its counted cash is the suggested next float. */
  async previousClosedDay(db: DbClient, date: string) {
    return db.cashDay.findFirst({
      where: { date: { lt: date }, closedAt: { not: null } },
      orderBy: { date: 'desc' },
      select: { date: true, counted: true },
    });
  },

  /**
   * Setting the float is allowed any time the day is still open. Two people setting the first
   * float of a day at once: the second one's insert clashes, and the retry updates the new row.
   */
  async setFloat(db: DbClient, data: { date: string; amount: number; userId: string }) {
    return retryOnClash(async () => {
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
    });
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

  /**
   * Reopens a closed day, keeping the close it replaces in cash_day_closes. The copy is written
   * first, under an id fixed by that close, so a crash part-way or two owners reopening at once
   * still leave exactly one copy; only the reopen that wins stamps it with its name and reason.
   */
  async reopenDay(db: DbClient, data: { date: string; reason: string; userId: string }) {
    const day = await db.cashDay.findFirst({ where: { date: data.date } });
    if (!day?.closedAt) return false;
    const closedAt = day.closedAt;
    const closeId = `${db.$shopId()}:${data.date}:${closedAt.toISOString()}`;
    await db.cashDayClose
      .create({
        data: {
          id: closeId,
          date: data.date,
          openingFloat: day.openingFloat,
          expected: day.expected,
          counted: day.counted,
          note: day.note,
          closedByUserId: day.closedByUserId,
          closedAt,
        },
      })
      .catch((e: unknown) => {
        if (!isUniqueClash(e)) throw e;
      });
    const now = new Date();
    const res = await db.cashDay.updateMany({
      where: { date: data.date, closedAt },
      data: {
        expected: null,
        counted: null,
        note: null,
        closedByUserId: null,
        closedAt: null,
        reopenedByUserId: data.userId,
        reopenedAt: now,
        reopenReason: data.reason,
      },
    });
    if (res.count !== 1) return false;
    await db.cashDayClose.updateMany({
      where: { id: closeId, reopenedAt: null },
      data: { reopenedByUserId: data.userId, reopenedAt: now, reopenReason: data.reason },
    });
    return true;
  },

  /** Earlier closes of a day that were reopened, newest first, with who closed and reopened. */
  async listEarlierCloses(db: DbClient, date: string) {
    const rows = await db.cashDayClose.findMany({ where: { date }, orderBy: { closedAt: 'desc' } });
    const ids = [...new Set(rows.flatMap((r) => [r.closedByUserId, r.reopenedByUserId]).filter((x): x is string => !!x))];
    const people = ids.length
      ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
    const name = new Map(people.map((p) => [p.id, p.name]));
    return rows.map((r) => ({
      expected: r.expected,
      counted: r.counted,
      note: r.note,
      closedBy: r.closedByUserId ? (name.get(r.closedByUserId) ?? null) : null,
      closedAt: r.closedAt,
      reopenedBy: r.reopenedByUserId ? (name.get(r.reopenedByUserId) ?? null) : null,
      reopenedAt: r.reopenedAt,
      reopenReason: r.reopenReason,
    }));
  },

  async listCashDays(db: DbClient, fromDate: string, toDate: string) {
    // Users load alongside instead of one include after another.
    const [days, users] = await Promise.all([
      db.cashDay.findMany({ where: { date: { gte: fromDate, lte: toDate } }, orderBy: { date: 'desc' } }),
      db.user.findMany(personSelect),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    const person = (id: string | null) => (id ? (byId.get(id) ?? null) : null);
    return days.map((d) => ({
      ...d,
      floatSetBy: person(d.floatSetByUserId),
      closedBy: person(d.closedByUserId),
      reopenedBy: person(d.reopenedByUserId),
    }));
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
