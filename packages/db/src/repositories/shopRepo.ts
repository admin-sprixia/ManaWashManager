import type { BranchStatus } from '@mana/domain';
import { createShopDb, type D1Database, type DbClient } from '../client';

const publicSelect = { id: true, code: true, name: true, city: true, status: true, statusReason: true } as const;

export const shopRepo = {
  async findById(db: DbClient, id: string) {
    return db.shop.findUnique({ where: { id }, select: publicSelect });
  },

  async listByIds(db: DbClient, ids: string[]) {
    return db.shop.findMany({ where: { id: { in: ids } }, select: publicSelect });
  },

  async findByCode(db: DbClient, code: string) {
    return db.shop.findUnique({ where: { code }, select: publicSelect });
  },

  async create(
    db: DbClient,
    data: {
      code: string;
      name: string;
      city: string | null;
      businessId?: string | null;
      townId?: string | null;
      pincode?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      allowHub?: boolean;
      allowCommunity?: boolean;
      allowDoorstep?: boolean;
      offerHub?: boolean;
      offerCommunity?: boolean;
      offerDoorstep?: boolean;
    },
  ) {
    return db.shop.create({ data });
  },

  async rename(db: DbClient, id: string, data: { name: string; city: string | null }) {
    return db.shop.update({ where: { id }, data, select: publicSelect });
  },

  /**
   * Every branch of a business with today's and this month's paid takings, washes still open
   * (any day) and active team size — HQ's at-a-glance view. Totals are in paise.
   */
  async businessOverview(pdb: DbClient, businessId: string, range: { dayFrom: Date; dayTo: Date; monthFrom: Date }) {
    const shops = await pdb.shop.findMany({
      where: { businessId, kind: 'branch' },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, city: true, status: true, statusReason: true, statusChangedAt: true },
    });
    const ids = shops.map((s) => s.id);
    const paidIn = (from: Date, to: Date) =>
      pdb.job.groupBy({
        by: ['shopId'],
        where: { shopId: { in: ids }, status: 'paid', completedAt: { gte: from, lt: to } },
        _sum: { total: true },
        _count: { _all: true },
      });
    const [today, month, open, team] = await Promise.all([
      paidIn(range.dayFrom, range.dayTo),
      paidIn(range.monthFrom, range.dayTo),
      pdb.job.groupBy({
        by: ['shopId'],
        where: { shopId: { in: ids }, status: { in: ['waiting', 'washing', 'ready'] } },
        _count: { _all: true },
      }),
      pdb.user.groupBy({
        by: ['shopId'],
        where: { shopId: { in: ids }, active: true, removedAt: null },
        _count: { _all: true },
      }),
    ]);
    const byShop = <T extends { shopId: string }>(rows: T[]) => new Map(rows.map((r) => [r.shopId, r]));
    const [t, m, o, u] = [byShop(today), byShop(month), byShop(open), byShop(team)];
    return shops.map((s) => ({
      ...s,
      statusChangedAt: s.statusChangedAt?.toISOString() ?? null,
      today: { washes: t.get(s.id)?._count._all ?? 0, takings: t.get(s.id)?._sum.total ?? 0 },
      month: { washes: m.get(s.id)?._count._all ?? 0, takings: m.get(s.id)?._sum.total ?? 0 },
      openWashes: o.get(s.id)?._count._all ?? 0,
      team: u.get(s.id)?._count._all ?? 0,
    }));
  },

  /** Recent status changes for one branch, newest first. */
  async statusHistory(pdb: DbClient, shopId: string, take = 20) {
    const rows = await pdb.branchStatusEvent.findMany({
      where: { shopId },
      orderBy: { createdAt: 'desc' },
      take,
      select: { status: true, reason: true, changedByPhone: true, createdAt: true },
    });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  },

  /** Only the status, for sign-in and branch switching. */
  async statusOf(db: DbClient, id: string) {
    return db.shop.findUnique({ where: { id }, select: { status: true, statusReason: true } });
  },

  /**
   * HQ sets a branch's status, and the change is logged with who made it and why. Returns false
   * when the branch is already in that status.
   */
  async setStatus(
    d1: D1Database,
    platform: DbClient,
    id: string,
    data: { status: BranchStatus; reason: string | null; byPhone: string },
    now = new Date(),
  ): Promise<boolean> {
    const reason = data.status === 'active' ? null : data.reason;
    const changed = await platform.shop.updateMany({
      where: { id, status: { not: data.status } },
      data: { status: data.status, statusReason: reason, statusChangedAt: now },
    });
    if (changed.count === 0) return false;
    await createShopDb(d1, id).branchStatusEvent.create({
      data: { shopId: id, status: data.status, reason, changedByPhone: data.byPhone, createdAt: now },
    });
    return true;
  },

  /** Only for undoing a sign-up whose owner couldn't be created (e.g. the number was just taken). */
  async deleteEmpty(db: DbClient, id: string) {
    await db.shop.delete({ where: { id } });
  },
};
