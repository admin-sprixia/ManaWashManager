import type { DbClient } from '../client';

export const referralRepo = {
  async findByJob(db: DbClient, jobId: string) {
    return db.referral.findUnique({
      where: { jobId },
      include: {
        referrer: { select: { id: true, name: true, phone: true } },
        referred: { select: { id: true, name: true, phone: true } },
      },
    });
  },

  /**
   * Recorded before the job row (same request). `referred_customer_id` is unique, so a
   * customer can only ever be referred once — a second attempt fails here.
   */
  async create(
    db: DbClient,
    data: {
      referredCustomerId: string;
      referrerCustomerId: string;
      jobId: string;
      percent: number;
      createdByUserId: string;
      now: Date;
    },
  ) {
    return db.referral.create({
      data: {
        referredCustomerId: data.referredCustomerId,
        referrerCustomerId: data.referrerCustomerId,
        jobId: data.jobId,
        percent: data.percent,
        createdByUserId: data.createdByUserId,
        createdAt: data.now,
      },
    });
  },

  /** Undo a referral whose job never got written. */
  async removeForJob(db: DbClient, jobId: string) {
    await db.referral.deleteMany({ where: { jobId, status: 'pending' } });
  },

  /** Moves a pending referral on exactly once, even if two requests race. */
  async settle(
    db: DbClient,
    id: string,
    data: { status: 'rewarded' | 'counted'; rewardCouponId?: string; now: Date },
  ) {
    const res = await db.referral.updateMany({
      where: { id, status: 'pending' },
      data: { status: data.status, rewardCouponId: data.rewardCouponId ?? null, settledAt: data.now },
    });
    return res.count === 1;
  },

  async cancel(db: DbClient, id: string, now: Date) {
    await db.referral.updateMany({
      where: { id, status: { not: 'cancelled' } },
      data: { status: 'cancelled', settledAt: now },
    });
  },

  /** How many paid washes this customer has had — a referrer needs at least one. */
  async paidVisits(db: DbClient, customerId: string) {
    return db.job.count({ where: { customerId, status: 'paid' } });
  },

  /** The vehicle a referrer's reward coupon is attached to: the one they brought in most recently. */
  async latestVehicleOf(db: DbClient, customerId: string) {
    const job = await db.job.findFirst({
      where: { customerId, status: { not: 'void' }, vehicle: { customerId } },
      orderBy: { createdAt: 'desc' },
      select: { vehicle: { select: { id: true, registrationNumber: true } } },
    });
    return job?.vehicle ?? null;
  },
};
