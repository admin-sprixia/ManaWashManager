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
    data: { date: string; expected: number; counted: number; note: string | null; heldAtClose: number; userId: string },
  ) {
    const res = await db.cashDay.updateMany({
      where: { date: data.date, closedAt: null },
      data: {
        expected: data.expected,
        counted: data.counted,
        note: data.note,
        heldAtClose: data.heldAtClose,
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
          heldAtClose: day.heldAtClose,
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
        heldAtClose: null,
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
      heldAtClose: r.heldAtClose,
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

  // ─── Doorstep cash handovers ──────────────────────────────────────────────

  /** Everyone who has been on the team, removed people included: they may still hold cash. */
  async personNames(db: DbClient) {
    const users = await db.user.findMany(personSelect);
    return new Map(users.map((u) => [u.id, u.name]));
  },

  /** What each collector's live handovers settled, ever: subtracted from what they collected. */
  async handoverSettledByCollector(db: DbClient) {
    const rows = await db.cashHandover.groupBy({
      by: ['collectorUserId'],
      where: { voidedAt: null },
      _sum: { due: true },
    });
    return new Map(rows.map((r) => [r.collectorUserId, r._sum.due ?? 0]));
  },

  /** Handovers into one day's drawer, newest first, voided ones included (marked). */
  async listHandovers(db: DbClient, date: string) {
    const [rows, users] = await Promise.all([
      db.cashHandover.findMany({ where: { date }, orderBy: { createdAt: 'desc' } }),
      db.user.findMany(personSelect),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    const name = (id: string | null) => (id ? (byId.get(id)?.name ?? null) : null);
    return rows.map((r) => ({
      ...r,
      collector: name(r.collectorUserId),
      receivedBy: name(r.receivedByUserId),
      voidedBy: name(r.voidedByUserId),
    }));
  },

  /** Doorstep cash each person handed in short in `[from, to)` (live handovers), as a positive amount. */
  async handoverShortByCollector(db: DbClient, from: Date, to: Date) {
    const rows = await db.cashHandover.findMany({
      where: { createdAt: { gte: from, lt: to }, voidedAt: null },
      select: { collectorUserId: true, due: true, received: true },
    });
    const short = new Map<string, number>();
    for (const r of rows) {
      if (r.received < r.due) short.set(r.collectorUserId, (short.get(r.collectorUserId) ?? 0) + r.due - r.received);
    }
    return short;
  },

  /** Handovers undone in `[from, to)`, newest first — for the owner's corrections feed. */
  async listVoidedHandovers(db: DbClient, from: Date, to: Date) {
    const [rows, names] = await Promise.all([
      db.cashHandover.findMany({ where: { voidedAt: { gte: from, lt: to } }, orderBy: { voidedAt: 'desc' } }),
      this.personNames(db),
    ]);
    return rows.map((r) => ({
      ...r,
      collector: names.get(r.collectorUserId) ?? 'Someone removed',
      voidedBy: r.voidedByUserId ? { id: r.voidedByUserId, name: names.get(r.voidedByUserId) ?? 'Someone' } : null,
    }));
  },

  /** Cash days reopened in `[from, to)`, with the count each reopen set aside — for the corrections feed. */
  async listReopens(db: DbClient, from: Date, to: Date) {
    const [rows, names] = await Promise.all([
      db.cashDayClose.findMany({ where: { reopenedAt: { gte: from, lt: to } }, orderBy: { reopenedAt: 'desc' } }),
      this.personNames(db),
    ]);
    return rows.map((r) => ({
      ...r,
      reopenedBy: r.reopenedByUserId ? { id: r.reopenedByUserId, name: names.get(r.reopenedByUserId) ?? 'Someone' } : null,
    }));
  },

  async findHandover(db: DbClient, id: string) {
    return db.cashHandover.findFirst({ where: { id } });
  },

  /**
   * Records a handover. Its id is fixed by how many handovers the collector already has, so two
   * people taking the same cash at once make the same id: one is recorded, the other gets false.
   */
  async createHandover(
    db: DbClient,
    data: { date: string; collectorUserId: string; due: number; received: number; note: string | null; userId: string },
  ) {
    const n = await db.cashHandover.count({ where: { collectorUserId: data.collectorUserId } });
    try {
      return await db.cashHandover.create({
        data: {
          id: `${db.$shopId()}:${data.collectorUserId}:${n + 1}`,
          date: data.date,
          collectorUserId: data.collectorUserId,
          due: data.due,
          received: data.received,
          note: data.note,
          receivedByUserId: data.userId,
        },
      });
    } catch (e) {
      if (isUniqueClash(e)) return null;
      throw e;
    }
  },

  /** Voids a live handover: the cash counts as held again. A conditional update, so it voids once. */
  async voidHandover(db: DbClient, data: { id: string; reason: string; userId: string }) {
    const res = await db.cashHandover.updateMany({
      where: { id: data.id, voidedAt: null },
      data: { voidedAt: new Date(), voidedByUserId: data.userId, voidReason: data.reason },
    });
    return res.count === 1;
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
