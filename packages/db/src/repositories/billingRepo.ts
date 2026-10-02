import type { DbClient } from '../client';

/** The shop columns plans and billing read. */
const planSelect = {
  id: true,
  plan: true,
  trialEndsAt: true,
  paidUntil: true,
  subscriptionId: true,
  billingInterval: true,
  pricePaise: true,
  founderAt: true,
  founderHoldUntil: true,
  founderHoldAt: true,
} as const;

export interface SubscriptionUpdate {
  plan?: string;
  paidUntil?: Date | null;
  subscriptionId?: string | null;
  billingInterval?: string | null;
  pricePaise?: number | null;
}

export const billingRepo = {
  /** Works with the shop or the platform client — Shop isn't shop-scoped. */
  async findPlan(db: DbClient, shopId: string) {
    return db.shop.findUnique({ where: { id: shopId }, select: planSelect });
  },

  async findPlanBySubscription(db: DbClient, subscriptionId: string) {
    return db.shop.findFirst({ where: { subscriptionId }, select: planSelect });
  },

  async updateSubscription(db: DbClient, shopId: string, data: SubscriptionUpdate) {
    return db.shop.update({ where: { id: shopId }, data, select: planSelect });
  },

  /**
   * Moves paid_until forward only. Webhooks can arrive late or out of order; an older charge
   * must never shorten a period a newer one already paid for.
   */
  async extendPaidUntil(db: DbClient, shopId: string, until: Date) {
    await db.shop.updateMany({
      where: { id: shopId, OR: [{ paidUntil: null }, { paidUntil: { lt: until } }] },
      data: { paidUntil: until },
    });
  },

  /**
   * Shops whose subscription should have renewed (or been paid for) by `dueBy` — the nightly
   * job asks Razorpay about these in case a webhook never arrived.
   */
  async listDueForSync(db: DbClient, dueBy: Date, take: number) {
    return db.shop.findMany({
      where: {
        subscriptionId: { not: null },
        plan: { in: ['pending', 'active', 'past_due'] },
        OR: [{ paidUntil: null }, { paidUntil: { lt: dueBy } }],
      },
      orderBy: { paidUntil: 'asc' },
      take,
      select: { id: true },
    });
  },

  /** Founder slots taken: shops that have paid the founder price, plus slots held for a pending payment. */
  async countFounderSlotsTaken(db: DbClient, now: Date) {
    return db.shop.count({
      where: { OR: [{ founderAt: { not: null } }, { founderHoldUntil: { gt: now } }] },
    });
  },

  /**
   * Holds a founder slot until `until`. A new hold (none, or the last one lapsed) is stamped with
   * `now` — its place in the queue; extending a live hold keeps its place and never shortens it.
   */
  async holdFounderSlot(db: DbClient, shopId: string, until: Date, now: Date) {
    await db.shop.updateMany({
      where: { id: shopId, founderAt: null, OR: [{ founderHoldUntil: null }, { founderHoldUntil: { lte: now } }] },
      data: { founderHoldUntil: until, founderHoldAt: now },
    });
    await db.shop.updateMany({
      where: { id: shopId, founderAt: null, founderHoldUntil: { lt: until } },
      data: { founderHoldUntil: until },
    });
  },

  /** Every shop with a founder slot or a live hold on one — at most a few dozen rows. */
  async listFounderClaims(db: DbClient, now: Date) {
    const rows = await db.shop.findMany({
      where: { OR: [{ founderAt: { not: null } }, { founderHoldUntil: { gt: now } }] },
      select: { id: true, founderAt: true, founderHoldUntil: true, founderHoldAt: true },
    });
    return rows.map((r) => ({ id: r.id, founderAt: r.founderAt, holdUntil: r.founderHoldUntil, holdAt: r.founderHoldAt }));
  },

  /** Gives a held slot back at once, e.g. when the checkout is cancelled before any payment. */
  async releaseFounderSlot(db: DbClient, shopId: string) {
    await db.shop.updateMany({
      where: { id: shopId, founderAt: null },
      data: { founderHoldUntil: null, founderHoldAt: null },
    });
  },

  /**
   * Attaches a new subscription only if the shop still has the one this request started from.
   * False means another checkout got there first — the caller must retire its own.
   */
  async swapSubscription(db: DbClient, shopId: string, expectedId: string | null, data: SubscriptionUpdate) {
    const res = await db.shop.updateMany({ where: { id: shopId, subscriptionId: expectedId }, data });
    return res.count === 1;
  },

  /** Marks the shop a founder once; later calls keep the original date. */
  async markFounder(db: DbClient, shopId: string, at: Date) {
    await db.shop.updateMany({ where: { id: shopId, founderAt: null }, data: { founderAt: at } });
  },

  /** Washes that count toward the monthly limit: everything started since `since`, except voids. */
  async countWashesSince(db: DbClient, since: Date) {
    return db.job.count({ where: { createdAt: { gte: since }, status: { not: 'void' } } });
  },

  /**
   * Everyone on the team and switched on, in seat order: owners first, then staff, each oldest
   * first. With 1 + N seats the first 1 + N keep working; staff past that are locked until the
   * shop upgrades. Owners are never locked.
   */
  async listSeatOrder(db: DbClient) {
    const rows = await db.user.findMany({
      where: { active: true, removedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, role: true },
    });
    return [...rows.filter((r) => r.role === 'owner'), ...rows.filter((r) => r.role !== 'owner')];
  },

  async countActiveMembers(db: DbClient) {
    return db.user.count({ where: { active: true, removedAt: null } });
  },

  async listPayments(db: DbClient, take = 24) {
    return db.billingPayment.findMany({
      orderBy: { paidAt: 'desc' },
      take,
      select: { id: true, amountPaise: true, status: true, method: true, periodEnd: true, paidAt: true },
    });
  },

  /** Platform client: the webhook isn't signed in as the shop, so shopId is set explicitly. */
  async upsertPayment(
    db: DbClient,
    data: {
      id: string;
      shopId: string;
      subscriptionId: string;
      amountPaise: number;
      status: 'captured' | 'failed' | 'refunded';
      method: string | null;
      periodEnd: Date | null;
      paidAt: Date;
    },
  ) {
    const { id, ...rest } = data;
    await db.billingPayment.upsert({
      where: { id },
      create: data,
      update: { status: rest.status, periodEnd: rest.periodEnd ?? undefined, method: rest.method ?? undefined },
    });
  },

  async eventSeen(db: DbClient, id: string) {
    return (await db.billingEvent.findUnique({ where: { id }, select: { id: true } })) !== null;
  },

  async recordEvent(db: DbClient, data: { id: string; event: string; shopId: string | null }) {
    await db.billingEvent.upsert({ where: { id: data.id }, create: data, update: {} });
  },
};
