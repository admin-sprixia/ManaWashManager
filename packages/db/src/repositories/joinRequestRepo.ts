import type { DbClient } from '../client';

export type JoinRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const joinRequestRepo = {
  async findById(db: DbClient, id: string) {
    return db.joinRequest.findUnique({ where: { id } });
  },

  /**
   * One open request per number across all shops, so a new request closes any older one.
   * Needs the platform client.
   */
  async cancelOpenForPhone(db: DbClient, phone: string, now: Date) {
    await db.joinRequest.updateMany({
      where: { phone, status: 'pending' },
      data: { status: 'cancelled', decidedAt: now },
    });
  },

  async create(db: DbClient, data: { phone: string; name: string }) {
    return db.joinRequest.create({ data });
  },

  /** Requests still waiting on the owner; anything created before `since` has expired. */
  async listPending(db: DbClient, since: Date) {
    return db.joinRequest.findMany({
      where: { status: 'pending', createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, phone: true, createdAt: true },
    });
  },

  async countPending(db: DbClient, since: Date) {
    return db.joinRequest.count({ where: { status: 'pending', createdAt: { gte: since } } });
  },

  /** Moves a pending request on. False when it was already decided (or cancelled) meanwhile. */
  async decide(
    db: DbClient,
    id: string,
    data: {
      status: Exclude<JoinRequestStatus, 'pending'>;
      now: Date;
      byUserId?: string;
      userId?: string;
    },
  ): Promise<boolean> {
    const { count } = await db.joinRequest.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: data.status,
        decidedAt: data.now,
        decidedByUserId: data.byUserId ?? null,
        userId: data.userId ?? null,
      },
    });
    return count === 1;
  },
};
