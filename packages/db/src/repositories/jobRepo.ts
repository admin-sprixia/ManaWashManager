import type { DbClient } from '../client';
import {
  jobCommission,
  splitCommission,
  type JobEventAction,
  type JobStatus,
  type PaymentMethod,
} from '@mana/domain';
import { chunk } from '../chunk';
import { directoryRepo } from './directoryRepo';

export interface CreateJobInput {
  /** Client-generated id — makes a replayed offline submission idempotent. */
  id?: string;
  customerId: string;
  vehicleId: string;
  createdByUserId: string;
  subtotal: number;
  discount: number;
  discountReason?: string;
  total: number;
  createdAt?: Date;
  lineItems: { serviceId: string; priceAtTime: number; commissionAtTime: number; quantity: number }[];
  /** Who got the customer to take the commission services; empty when there are none. */
  sellerIds?: string[];
}

const personSelect = { select: { id: true, name: true } } as const;

/**
 * Everything a Job Board row needs, including who created, who washed, who got the commission
 * services and who collected.
 */
const boardInclude = {
  customer: true,
  vehicle: { include: { vehicleType: true } },
  jobServices: { include: { service: true } },
  createdBy: personSelect,
  paidBy: personSelect,
  washers: { select: { user: personSelect }, orderBy: { assignedAt: 'asc' } },
  sellers: { select: { user: personSelect }, orderBy: { assignedAt: 'asc' } },
} as const;

function event(
  userId: string,
  action: JobEventAction,
  at: Date,
  extra: { fromValue?: string | null; toValue?: string | null; reason?: string | null } = {},
) {
  return {
    userId,
    action,
    createdAt: at,
    fromValue: extra.fromValue ?? null,
    toValue: extra.toValue ?? null,
    reason: extra.reason ?? null,
  };
}

export const jobRepo = {
  async create(db: DbClient, data: CreateJobInput) {
    const at = data.createdAt ?? new Date();
    const job = await db.job.create({
      data: {
        id: data.id,
        customerId: data.customerId,
        vehicleId: data.vehicleId,
        createdByUserId: data.createdByUserId,
        status: 'waiting',
        subtotal: data.subtotal,
        discount: data.discount,
        discountReason: data.discountReason,
        total: data.total,
        createdAt: at,
        jobServices: { create: data.lineItems },
        ...(data.sellerIds?.length
          ? {
              sellers: {
                create: data.sellerIds.map((userId) => ({
                  userId,
                  assignedByUserId: data.createdByUserId,
                  assignedAt: at,
                })),
              },
            }
          : {}),
        events: {
          create: [
            event(data.createdByUserId, 'created', at, {
              toValue: 'waiting',
              reason: data.discount > 0 ? data.discountReason : null,
            }),
          ],
        },
      },
      include: boardInclude,
    });
    await directoryRepo.touchCustomer(db, data.customerId);
    return job;
  },

  async findById(db: DbClient, id: string) {
    return db.job.findUnique({ where: { id } });
  },

  async findBoardRow(db: DbClient, id: string) {
    return db.job.findUnique({ where: { id }, include: boardInclude });
  },

  /** Job Detail screen: the job, its lines, attribution, and the full audit trail. */
  async findDetail(db: DbClient, id: string) {
    return db.job.findUnique({
      where: { id },
      include: {
        ...boardInclude,
        voidedBy: personSelect,
        events: {
          orderBy: { createdAt: 'asc' },
          include: { user: personSelect },
        },
        photos: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true, kind: true, createdAt: true, takenBy: personSelect },
        },
      },
    });
  },

  /**
   * Moving to Washing can record who's washing it (replacing any earlier pick).
   *
   * This and the other status changes below only apply while the job is still in `from` — one
   * conditional update, so two phones tapping at once can't both win (and both write an audit
   * event). Returns null when the job had already moved on; the caller re-reads and answers.
   */
  async updateStatus(
    db: DbClient,
    id: string,
    data: { from: JobStatus; to: JobStatus; userId: string; at: Date; washerIds?: string[] },
  ) {
    const moved = await db.job.updateMany({ where: { id, status: data.from }, data: { status: data.to } });
    if (moved.count !== 1) return null;
    await db.jobEvent.create({
      data: { jobId: id, ...event(data.userId, 'status_changed', data.at, { fromValue: data.from, toValue: data.to }) },
    });
    if (data.washerIds?.length) {
      await db.jobWasher.deleteMany({ where: { jobId: id } });
      await db.jobWasher.createMany({
        data: data.washerIds.map((userId) => ({
          jobId: id,
          userId,
          assignedByUserId: data.userId,
          assignedAt: data.at,
        })),
      });
    }
    return db.job.findUnique({ where: { id }, include: boardInclude });
  },

  /** Correct who washed a job. Logged in the audit trail with the before/after names. */
  async setWashers(
    db: DbClient,
    id: string,
    data: { washerIds: string[]; userId: string; fromNames: string; toNames: string },
  ) {
    const at = new Date();
    return db.job.update({
      where: { id },
      data: {
        washers: {
          deleteMany: {},
          create: data.washerIds.map((userId) => ({
            userId,
            assignedByUserId: data.userId,
            assignedAt: at,
          })),
        },
        events: {
          create: [
            event(data.userId, 'washers_changed', at, {
              fromValue: data.fromNames || null,
              toValue: data.toNames,
            }),
          ],
        },
      },
      include: boardInclude,
    });
  },

  /** Correct who got the commission services. Logged with the before/after names. */
  async setSellers(
    db: DbClient,
    id: string,
    data: { sellerIds: string[]; userId: string; fromNames: string; toNames: string },
  ) {
    const at = new Date();
    return db.job.update({
      where: { id },
      data: {
        sellers: {
          deleteMany: {},
          create: data.sellerIds.map((userId) => ({
            userId,
            assignedByUserId: data.userId,
            assignedAt: at,
          })),
        },
        events: {
          create: [
            event(data.userId, 'sellers_changed', at, {
              fromValue: data.fromNames || null,
              toValue: data.toNames,
            }),
          ],
        },
      },
      include: boardInclude,
    });
  },

  async listWasherIds(db: DbClient, jobId: string): Promise<string[]> {
    const rows = await db.jobWasher.findMany({ where: { jobId }, select: { userId: true } });
    return rows.map((r) => r.userId);
  },

  /** Cash actually taken in `[from, to)`: paid-in-cash jobs by when they were paid. */
  async cashCollected(db: DbClient, from: Date, to: Date): Promise<{ total: number; count: number }> {
    const result = await db.job.aggregate({
      where: { status: 'paid', paymentMethod: 'cash', completedAt: { gte: from, lt: to } },
      _sum: { total: true },
      _count: true,
    });
    return { total: result._sum.total ?? 0, count: result._count };
  },

  async markPaid(
    db: DbClient,
    id: string,
    data: { from: JobStatus; paymentMethod: PaymentMethod; userId: string; at: Date },
  ) {
    const moved = await db.job.updateMany({
      where: { id, status: data.from },
      data: {
        status: 'paid',
        paymentMethod: data.paymentMethod,
        paymentStatus: 'paid',
        paidByUserId: data.userId,
        completedAt: data.at,
      },
    });
    if (moved.count !== 1) return null;
    await db.jobEvent.create({
      data: { jobId: id, ...event(data.userId, 'paid', data.at, { fromValue: data.from, toValue: data.paymentMethod }) },
    });
    return db.job.findUnique({ where: { id }, include: boardInclude });
  },

  async voidJob(
    db: DbClient,
    id: string,
    data: { from: JobStatus; userId: string; reason: string; at: Date },
  ) {
    const moved = await db.job.updateMany({
      where: { id, status: data.from },
      data: { status: 'void', voidedByUserId: data.userId, voidReason: data.reason },
    });
    if (moved.count !== 1) return null;
    await db.jobEvent.create({
      data: {
        jobId: id,
        ...event(data.userId, 'voided', data.at, { fromValue: data.from, toValue: 'void', reason: data.reason }),
      },
    });
    const job = await db.job.findUnique({ where: { id }, include: boardInclude });
    if (job) await directoryRepo.touchCustomer(db, job.customerId);
    return job;
  },

  /** Only while the job is still paid with `from`, so two corrections can't cross. */
  async changePaymentMethod(
    db: DbClient,
    id: string,
    data: { from: PaymentMethod | null; to: PaymentMethod; userId: string; reason: string },
  ) {
    const moved = await db.job.updateMany({
      where: { id, status: 'paid', paymentMethod: data.from },
      data: { paymentMethod: data.to },
    });
    if (moved.count !== 1) return null;
    await db.jobEvent.create({
      data: {
        jobId: id,
        ...event(data.userId, 'payment_method_changed', new Date(), {
          fromValue: data.from,
          toValue: data.to,
          reason: data.reason,
        }),
      },
    });
    return db.job.findUnique({ where: { id }, include: boardInclude });
  },

  /**
   * Today's job board / dashboard, newest first. `startOfDay` is resolved by the caller
   * (see `lib/istDate.ts`) — this repo has no opinion on timezones, only on the query.
   * Unfinished jobs from earlier days are included too: a car still sitting "ready" from
   * yesterday has to stay visible until someone closes it out.
   */
  async listToday(db: DbClient, startOfDay: Date) {
    return db.job.findMany({
      where: {
        OR: [
          { createdAt: { gte: startOfDay } },
          { status: { in: ['waiting', 'washing', 'ready'] } },
        ],
      },
      include: boardInclude,
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
   * Aggregates for reports: cars washed, revenue, payment-method split, and new-vs-repeat
   * customers for jobs with createdAt in `[from, to)`. "New" means this job is that
   * customer's first-ever job; "repeat" means they'd visited before `from`.
   */
  async getStats(db: DbClient, from: Date, to: Date) {
    const jobs = await db.job.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: { status: true, total: true, discount: true, paymentMethod: true, customerId: true },
    });

    const real = jobs.filter((j) => j.status !== 'void');
    const paid = jobs.filter((j) => j.status === 'paid');
    const sumWhere = (pred: (j: (typeof paid)[number]) => boolean) =>
      paid.filter(pred).reduce((sum, j) => sum + j.total, 0);

    const customerIds = [...new Set(real.map((j) => j.customerId))];
    const firstVisits = (
      await Promise.all(
        chunk(customerIds).map((ids) =>
          db.job.groupBy({
            by: ['customerId'],
            where: { customerId: { in: ids }, status: { not: 'void' } },
            _min: { createdAt: true },
          }),
        ),
      )
    ).flat();
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
      discounts: paid.reduce((sum, j) => sum + j.discount, 0),
      voided: jobs.length - real.length,
      newCustomers,
      repeatCustomers,
    };
  },

  /**
   * Per-staff performance for jobs created in `[from, to)`: washes each person started and
   * washed, commission earned (paid jobs only, split between the people who got the customer
   * to take the commission services), and money each person
   * collected (split by method) — the numbers the owner uses to reconcile each person's cash
   * at the end of a shift and to pay them.
   */
  async getStaffStats(db: DbClient, from: Date, to: Date) {
    const [users, jobs, events] = await Promise.all([
      db.user.findMany({ select: { id: true, name: true, role: true, active: true } }),
      db.job.findMany({
        where: { createdAt: { gte: from, lt: to } },
        select: {
          status: true,
          total: true,
          paymentMethod: true,
          createdByUserId: true,
          paidByUserId: true,
          voidedByUserId: true,
          jobServices: { select: { commissionAtTime: true, quantity: true } },
          washers: { select: { userId: true } },
          sellers: { select: { userId: true } },
        },
      }),
      db.jobEvent.findMany({
        where: { createdAt: { gte: from, lt: to }, action: 'payment_method_changed' },
        select: { userId: true },
      }),
    ]);

    const rows = new Map(
      users.map((u) => [
        u.id,
        {
          userId: u.id,
          name: u.name,
          role: u.role,
          active: u.active,
          washesStarted: 0,
          washesDone: 0,
          /** Paid jobs whose commission services this person got the customer to take. */
          servicesSold: 0,
          commission: 0,
          jobsCollected: 0,
          collected: 0,
          cash: 0,
          upi: 0,
          other: 0,
          voids: 0,
          corrections: 0,
        },
      ]),
    );

    for (const job of jobs) {
      if (job.status !== 'void') {
        const creator = rows.get(job.createdByUserId);
        if (creator) creator.washesStarted += 1;
      }
      if (job.status === 'paid') {
        const washerIds = job.washers.map((w) => w.userId);
        for (const id of washerIds) {
          const washer = rows.get(id);
          if (washer) washer.washesDone += 1;
        }
        const commission = jobCommission(job.jobServices);
        const sellerIds = job.sellers.map((s) => s.userId);
        if (commission > 0) {
          for (const id of sellerIds) {
            const seller = rows.get(id);
            if (seller) seller.servicesSold += 1;
          }
        }
        for (const [id, share] of splitCommission(commission, sellerIds)) {
          const seller = rows.get(id);
          if (seller) seller.commission += share;
        }
      }
      if (job.status === 'paid' && job.paidByUserId) {
        const collector = rows.get(job.paidByUserId);
        if (collector) {
          collector.jobsCollected += 1;
          collector.collected += job.total;
          if (job.paymentMethod === 'cash') collector.cash += job.total;
          else if (job.paymentMethod === 'upi') collector.upi += job.total;
          else collector.other += job.total;
        }
      }
      if (job.status === 'void' && job.voidedByUserId) {
        const voider = rows.get(job.voidedByUserId);
        if (voider) voider.voids += 1;
      }
    }
    for (const e of events) {
      const row = rows.get(e.userId);
      if (row) row.corrections += 1;
    }

    return [...rows.values()]
      .filter(
        (r) =>
          r.active ||
          r.washesStarted + r.washesDone + r.servicesSold + r.jobsCollected + r.voids + r.corrections > 0,
      )
      .sort((a, b) => b.collected - a.collected || b.washesStarted - a.washesStarted);
  },

  /** Voids and payment corrections in `[from, to)`, newest first — the owner's audit feed. */
  async listCorrections(db: DbClient, from: Date, to: Date) {
    return db.jobEvent.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        action: { in: ['voided', 'payment_method_changed'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: personSelect,
        job: {
          select: {
            id: true,
            total: true,
            customer: { select: { name: true, phone: true } },
            vehicle: { select: { registrationNumber: true } },
          },
        },
      },
    });
  },

  /** Job lines for a PDF / CSV export — newest first, only the columns the export prints. */
  async listForReport(db: DbClient, from: Date, to: Date) {
    return db.job.findMany({
      where: { createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        status: true,
        total: true,
        discount: true,
        discountReason: true,
        paymentMethod: true,
        customer: { select: { name: true, phone: true } },
        vehicle: { select: { registrationNumber: true, vehicleType: { select: { name: true } } } },
        jobServices: { select: { service: { select: { name: true } } } },
        createdBy: personSelect,
        paidBy: personSelect,
      },
    });
  },
};
