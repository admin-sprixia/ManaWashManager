import type { DbClient } from '../client';
import type { JobStatus, PaymentMethod } from '@mana/domain';

export interface CreateJobInput {
  customerId: string;
  vehicleId: string;
  createdByUserId: string;
  subtotal: number;
  discount: number;
  discountReason?: string;
  total: number;
  lineItems: { serviceId: string; priceAtTime: number; quantity: number }[];
}

export const jobRepo = {
  async create(db: DbClient, data: CreateJobInput) {
    return db.job.create({
      data: {
        customerId: data.customerId,
        vehicleId: data.vehicleId,
        createdByUserId: data.createdByUserId,
        status: 'waiting',
        subtotal: data.subtotal,
        discount: data.discount,
        discountReason: data.discountReason,
        total: data.total,
        jobServices: { create: data.lineItems },
      },
      include: { jobServices: true },
    });
  },

  async findById(db: DbClient, id: string) {
    return db.job.findUniqueOrThrow({ where: { id } });
  },

  async updateStatus(db: DbClient, id: string, status: JobStatus) {
    return db.job.update({
      where: { id },
      data: { status, completedAt: status === 'paid' ? new Date() : undefined },
    });
  },

  async markPaid(db: DbClient, id: string, paymentMethod: PaymentMethod) {
    return db.job.update({
      where: { id },
      data: {
        status: 'paid',
        paymentMethod,
        paymentStatus: 'paid',
        completedAt: new Date(),
      },
    });
  },

  /**
   * Today's job board / dashboard, newest first. `startOfDay` is resolved by the caller
   * (see `lib/istDate.ts`) — this repo has no opinion on timezones, only on the query.
   */
  async listToday(db: DbClient, startOfDay: Date) {
    return db.job.findMany({
      where: { createdAt: { gte: startOfDay } },
      include: {
        customer: true,
        vehicle: { include: { vehicleType: true } },
        jobServices: { include: { service: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * Cars currently in the shop right now — waiting, washing, or ready for pickup.
   * Deliberately not date-ranged: a car that arrived two days ago and is still sitting
   * "ready" is still pending *now*, regardless of which reporting range is being viewed.
   */
  async countPending(db: DbClient): Promise<number> {
    return db.job.count({ where: { status: { in: ['waiting', 'washing', 'ready'] } } });
  },

  /**
   * Aggregates for the Today dashboard / basic reports: cars washed, revenue, payment-method
   * split, and new-vs-repeat customers — all for jobs created on/after `from`. "New" means
   * this job is that customer's first-ever job; "repeat" means they'd visited before `from`.
   */
  async getStats(db: DbClient, from: Date) {
    const jobs = await db.job.findMany({
      where: { createdAt: { gte: from } },
      select: { status: true, total: true, paymentMethod: true, customerId: true },
    });

    const real = jobs.filter((j) => j.status !== 'void');
    const paid = jobs.filter((j) => j.status === 'paid');
    const sumWhere = (pred: (j: (typeof paid)[number]) => boolean) =>
      paid.filter(pred).reduce((sum, j) => sum + j.total, 0);

    const customerIds = [...new Set(real.map((j) => j.customerId))];
    const firstVisits =
      customerIds.length > 0
        ? await db.job.groupBy({
            by: ['customerId'],
            where: { customerId: { in: customerIds }, status: { not: 'void' } },
            _min: { createdAt: true },
          })
        : [];
    const firstVisitAt = new Map(firstVisits.map((f) => [f.customerId, f._min.createdAt]));

    let newCustomers = 0;
    let repeatCustomers = 0;
    const countedCustomers = new Set<string>();
    for (const job of real) {
      if (countedCustomers.has(job.customerId)) continue;
      countedCustomers.add(job.customerId);
      const first = firstVisitAt.get(job.customerId);
      if (first && first.getTime() >= from.getTime()) newCustomers += 1;
      else repeatCustomers += 1;
    }

    return {
      carsWashed: real.length,
      revenue: paid.reduce((sum, j) => sum + j.total, 0),
      cash: sumWhere((j) => j.paymentMethod === 'cash'),
      upi: sumWhere((j) => j.paymentMethod === 'upi'),
      other: sumWhere((j) => j.paymentMethod === 'other'),
      voided: jobs.length - real.length,
      newCustomers,
      repeatCustomers,
    };
  },
};
