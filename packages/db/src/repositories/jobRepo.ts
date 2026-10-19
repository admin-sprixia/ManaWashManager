import type { Prisma } from '@prisma/client';
import type { DbClient } from '../client';
import {
  jobCommission,
  splitCommission,
  type DeliveryMode,
  type JobEventAction,
  type JobStatus,
  type PaymentMethod,
} from '@mana/domain';
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
  /** Washed at the hub (default) or at the customer's door, and by which service point. */
  deliveryMode?: DeliveryMode;
  servicePointId?: string | null;
  /** The service a community plan paid for, on a plan wash at the shop. */
  planServiceId?: string | null;
  visitKm?: number | null;
  visitPoint?: { latitude: number; longitude: number } | null;
  /** A bill a wash plan was sold on (money, not a wash). */
  planSaleId?: string | null;
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

const detailInclude = {
  ...boardInclude,
  voidedBy: personSelect,
  events: { orderBy: { createdAt: 'asc' }, include: { user: personSelect } },
  photos: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, kind: true, createdAt: true, takenBy: personSelect },
  },
} as const;

/** A welcome-gift item on a job, as the board and detail screens show it. */
export interface BoardGift {
  id: string;
  stockItemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  status: string;
}

export type BoardRow = Prisma.JobGetPayload<{ include: typeof boardInclude }> & {
  /** Services on this job taken as a free wash from the car's stamp card. */
  freeServiceIds: string[];
  /** The welcome gift written when this (first) wash was paid. */
  gifts: BoardGift[];
  /** Gifts this car is still owed from any visit, so staff can hand them over at pickup. */
  giftsOwedForCar: BoardGift[];
};
export type JobDetail = Omit<Prisma.JobGetPayload<{ include: typeof detailInclude }>, keyof BoardRow> & BoardRow;

type Person = { id: string; name: string };

function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

function groupByJob<T extends { jobId: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.jobId);
    if (list) list.push(r);
    else out.set(r.jobId, [r]);
  }
  return out;
}

/**
 * The same rows `include: boardInclude` returns, but in one round of parallel queries. Prisma
 * loads each included relation as its own query, one after another (eleven here), and every
 * query is a round trip to the database; each part below is filtered by the same `where` as a
 * subquery, so nothing waits on the job ids first. Ties are broken by each table's key, the
 * same order Prisma returns related rows in.
 */
async function loadBoard(
  db: DbClient,
  where: Prisma.JobWhereInput,
  orderBy?: Prisma.JobOrderByWithRelationInput,
): Promise<BoardRow[]> {
  const viaJob = { job: where };
  const owedForCar = { status: 'owed', vehicle: { jobs: { some: where } } };
  const [jobs, customers, vehicles, lines, washers, sellers, vehicleTypes, services, people, claims, gifts, owed, giftItems] = await Promise.all([
    db.job.findMany({ where, orderBy }),
    db.customer.findMany({ where: { jobs: { some: where } } }),
    db.vehicle.findMany({ where: { jobs: { some: where } } }),
    db.jobService.findMany({ where: viaJob, orderBy: [{ jobId: 'asc' }, { serviceId: 'asc' }] }),
    db.jobWasher.findMany({
      where: viaJob,
      orderBy: [{ assignedAt: 'asc' }, { jobId: 'asc' }, { userId: 'asc' }],
      select: { jobId: true, userId: true },
    }),
    db.jobSeller.findMany({
      where: viaJob,
      orderBy: [{ assignedAt: 'asc' }, { jobId: 'asc' }, { userId: 'asc' }],
      select: { jobId: true, userId: true },
    }),
    db.vehicleType.findMany(),
    db.service.findMany(),
    db.user.findMany({ select: { id: true, name: true } }),
    // Claims don't link to their job in the database (they're written first), so they're found
    // through the jobs' vehicles and matched by job id below.
    db.rewardClaim.findMany({
      where: { vehicle: { jobs: { some: where } } },
      orderBy: [{ jobId: 'asc' }, { serviceId: 'asc' }],
      select: { jobId: true, serviceId: true },
    }),
    db.rewardGift.findMany({ where: viaJob, orderBy: [{ jobId: 'asc' }, { id: 'asc' }] }),
    db.rewardGift.findMany({ where: owedForCar, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    db.stockItem.findMany({
      where: { rewardGifts: { some: { OR: [viaJob, owedForCar] } } },
      select: { id: true, name: true, unit: true },
    }),
  ]);
  if (!jobs.length) return [];
  const customerById = byId(customers);
  const vehicleById = byId(vehicles);
  const typeById = byId(vehicleTypes);
  const serviceById = byId(services);
  const personById = byId<Person>(people);
  const linesByJob = groupByJob(lines);
  const washersByJob = groupByJob(washers);
  const sellersByJob = groupByJob(sellers);
  const claimsByJob = groupByJob(claims);
  const giftsByJob = groupByJob(gifts);
  const giftItemById = byId(giftItems);
  const owedByVehicle = new Map<string, typeof owed>();
  for (const g of owed) {
    const list = owedByVehicle.get(g.vehicleId);
    if (list) list.push(g);
    else owedByVehicle.set(g.vehicleId, [g]);
  }
  const toBoardGift = (g: (typeof gifts)[number]): BoardGift => {
    const item = giftItemById.get(g.stockItemId);
    return {
      id: g.id,
      stockItemId: g.stockItemId,
      itemName: item?.name ?? 'Item',
      unit: item?.unit ?? 'pcs',
      quantity: g.quantity,
      status: g.status,
    };
  };
  const person = (id: string | null) => (id ? (personById.get(id) ?? null) : null);
  return jobs.map((job) => {
    const vehicle = vehicleById.get(job.vehicleId)!;
    return {
      ...job,
      customer: customerById.get(job.customerId)!,
      vehicle: { ...vehicle, vehicleType: typeById.get(vehicle.vehicleTypeId)! },
      jobServices: (linesByJob.get(job.id) ?? []).map((l) => ({ ...l, service: serviceById.get(l.serviceId)! })),
      createdBy: person(job.createdByUserId)!,
      paidBy: person(job.paidByUserId),
      washers: (washersByJob.get(job.id) ?? []).map((w) => ({ user: person(w.userId)! })),
      sellers: (sellersByJob.get(job.id) ?? []).map((s) => ({ user: person(s.userId)! })),
      freeServiceIds: (claimsByJob.get(job.id) ?? []).map((c) => c.serviceId),
      gifts: (giftsByJob.get(job.id) ?? []).map(toBoardGift),
      giftsOwedForCar: (owedByVehicle.get(job.vehicleId) ?? []).map(toBoardGift),
    };
  });
}

async function loadBoardRow(db: DbClient, id: string): Promise<BoardRow | null> {
  return (await loadBoard(db, { id }))[0] ?? null;
}

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
        deliveryMode: data.deliveryMode ?? 'hub',
        servicePointId: data.servicePointId ?? null,
        planServiceId: data.planServiceId ?? null,
        visitKm: data.visitKm ?? null,
        visitLatitude: data.visitPoint?.latitude ?? null,
        visitLongitude: data.visitPoint?.longitude ?? null,
        planSaleId: data.planSaleId ?? null,
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
      select: { id: true },
    });
    await directoryRepo.touchCustomer(db, data.customerId);
    return (await loadBoardRow(db, job.id))!;
  },

  /**
   * D1 has no transactions, so a crash part-way through `create` can leave the job row without
   * its lines, sellers or 'created' event. A retry of the same request calls this to write
   * whatever is missing (each part only when it has no rows yet), then returns the board row.
   */
  async completeCreate(db: DbClient, id: string, data: CreateJobInput) {
    const job = await db.job.findUnique({
      where: { id },
      select: {
        createdAt: true,
        _count: { select: { jobServices: true, sellers: true, events: true } },
      },
    });
    if (!job) return null;
    const at = job.createdAt;
    const quietly = (p: Promise<unknown>) => p.catch(() => undefined);
    if (job._count.jobServices === 0 && data.lineItems.length) {
      await quietly(db.jobService.createMany({ data: data.lineItems.map((l) => ({ ...l, jobId: id })) }));
    }
    if (job._count.sellers === 0 && data.sellerIds?.length) {
      await quietly(
        db.jobSeller.createMany({
          data: data.sellerIds.map((userId) => ({
            jobId: id,
            userId,
            assignedByUserId: data.createdByUserId,
            assignedAt: at,
          })),
        }),
      );
    }
    if (job._count.events === 0) {
      await quietly(
        db.jobEvent.create({
          data: {
            id: `created-${id}`,
            jobId: id,
            ...event(data.createdByUserId, 'created', at, {
              toValue: 'waiting',
              reason: data.discount > 0 ? data.discountReason : null,
            }),
          },
        }),
      );
    }
    return loadBoardRow(db, id);
  },

  async findById(db: DbClient, id: string) {
    return db.job.findUnique({ where: { id } });
  },

  async findBoardRow(db: DbClient, id: string) {
    return loadBoardRow(db, id);
  },

  /** Job Detail screen: the job, its lines, attribution, and the full audit trail. */
  async findDetail(db: DbClient, id: string): Promise<JobDetail | null> {
    const [row, events, photos, people] = await Promise.all([
      loadBoardRow(db, id),
      db.jobEvent.findMany({ where: { jobId: id }, orderBy: { createdAt: 'asc' } }),
      db.jobPhoto.findMany({
        where: { jobId: id, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, kind: true, createdAt: true, takenByUserId: true },
      }),
      db.user.findMany({ select: { id: true, name: true } }),
    ]);
    if (!row) return null;
    const personById = byId<Person>(people);
    return {
      ...row,
      voidedBy: row.voidedByUserId ? (personById.get(row.voidedByUserId) ?? null) : null,
      events: events.map((e) => ({ ...e, user: personById.get(e.userId)! })),
      photos: photos.map(({ takenByUserId, ...p }) => ({ ...p, takenBy: personById.get(takenByUserId)! })),
    };
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
    return loadBoardRow(db, id);
  },

  /** Correct who washed a job. Logged in the audit trail with the before/after names. */
  async setWashers(
    db: DbClient,
    id: string,
    data: { washerIds: string[]; userId: string; fromNames: string; toNames: string },
  ) {
    const at = new Date();
    await db.job.update({
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
      select: { id: true },
    });
    return (await loadBoardRow(db, id))!;
  },

  /** Correct who got the commission services. Logged with the before/after names. */
  async setSellers(
    db: DbClient,
    id: string,
    data: { sellerIds: string[]; userId: string; fromNames: string; toNames: string },
  ) {
    const at = new Date();
    await db.job.update({
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
      select: { id: true },
    });
    return (await loadBoardRow(db, id))!;
  },

  async listWasherIds(db: DbClient, jobId: string): Promise<string[]> {
    const rows = await db.jobWasher.findMany({ where: { jobId }, select: { userId: true } });
    return rows.map((r) => r.userId);
  },

  /** Cash actually taken in `[from, to)`: paid-in-cash jobs by when they were paid. */
  /** Cash taken at the shop in `[from, to)`: it went straight into the drawer. */
  async cashCollected(db: DbClient, from: Date, to: Date): Promise<{ total: number; count: number }> {
    const result = await db.job.aggregate({
      where: { status: 'paid', paymentMethod: 'cash', deliveryMode: 'hub', completedAt: { gte: from, lt: to } },
      _sum: { total: true },
      _count: true,
    });
    return { total: result._sum.total ?? 0, count: result._count };
  },

  /**
   * Doorstep cash by who collected it: in `[from, to)`, or ever when no window is given. It stays
   * with them until a handover brings it to the drawer.
   */
  async doorstepCashByCollector(db: DbClient, window?: { from: Date; to: Date }) {
    const rows = await db.job.groupBy({
      by: ['paidByUserId'],
      where: {
        status: 'paid',
        paymentMethod: 'cash',
        deliveryMode: 'doorstep',
        paidByUserId: { not: null },
        ...(window ? { completedAt: { gte: window.from, lt: window.to } } : {}),
      },
      _sum: { total: true },
      _count: { _all: true },
    });
    return rows.map((r) => ({ userId: r.paidByUserId!, total: r._sum.total ?? 0, count: r._count._all }));
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
    return loadBoardRow(db, id);
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
    const job = await loadBoardRow(db, id);
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
    return loadBoardRow(db, id);
  },

  /**
   * Today's job board / dashboard, newest first. `startOfDay` is resolved by the caller
   * (see `lib/istDate.ts`) — this repo has no opinion on timezones, only on the query.
   * Includes: jobs opened today, open jobs from earlier days, and jobs paid today
   * (even when the wash started yesterday — otherwise they vanish from "Paid today").
   */
  async listToday(db: DbClient, startOfDay: Date) {
    return loadBoard(
      db,
      {
        OR: [
          { createdAt: { gte: startOfDay } },
          { status: { in: ['waiting', 'washing', 'ready'] } },
          { status: 'paid', completedAt: { gte: startOfDay } },
        ],
      },
      { createdAt: 'desc' },
    );
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
   * Aggregates for reports in `[from, to)`. Washes and money both count on the day the
   * job was paid (`completedAt`) — same clock as the cash drawer — so a wash started
   * yesterday and paid today shows under today. Voids still use `createdAt` (no pay time).
   * "New" means this paid job is that customer's first-ever non-void job; "repeat" means
   * they'd visited before `from`. Community washes are plan cars washed at communities (their
   * money is plan income); a plan wash at the shop is a job, so it isn't counted twice.
   */
  async getStats(db: DbClient, from: Date, to: Date) {
    const notVoid = { status: { not: 'void' } };
    const paidInWindow = { status: 'paid' as const, completedAt: { gte: from, lt: to } };
    const [paid, voided, firstVisits, communityWashes] = await Promise.all([
      db.job.findMany({
        where: paidInWindow,
        select: { total: true, discount: true, paymentMethod: true, customerId: true, deliveryMode: true, planSaleId: true },
      }),
      db.job.count({ where: { status: 'void', createdAt: { gte: from, lt: to }, planSaleId: null } }),
      // First visit of every customer who paid in the window.
      db.job.groupBy({
        by: ['customerId'],
        where: {
          ...notVoid,
          customer: { jobs: { some: paidInWindow } },
        },
        _min: { createdAt: true },
      }),
      db.placeVisit.count({ where: { outcome: 'done', jobId: null, createdAt: { gte: from, lt: to } } }),
    ]);

    const sumWhere = (pred: (j: (typeof paid)[number]) => boolean) =>
      paid.filter(pred).reduce((sum, j) => sum + j.total, 0);

    const firstVisitAt = new Map(firstVisits.map((f) => [f.customerId, f._min.createdAt]));

    let newCustomers = 0;
    let repeatCustomers = 0;
    const countedCustomers = new Set<string>();
    for (const job of paid) {
      if (countedCustomers.has(job.customerId)) continue;
      countedCustomers.add(job.customerId);
      const first = firstVisitAt.get(job.customerId);
      if (first && first.getTime() >= from.getTime()) newCustomers += 1;
      else repeatCustomers += 1;
    }

    // A bill a plan was sold on is money in, but not a car washed.
    const washes = paid.filter((j) => !j.planSaleId);
    return {
      carsWashed: washes.length,
      revenue: paid.reduce((sum, j) => sum + j.total, 0),
      cash: sumWhere((j) => j.paymentMethod === 'cash'),
      upi: sumWhere((j) => j.paymentMethod === 'upi'),
      other: sumWhere((j) => j.paymentMethod === 'other'),
      /** Washes at customers' homes, and what they brought in (part of carsWashed and revenue). */
      doorstepWashes: paid.filter((j) => j.deliveryMode === 'doorstep').length,
      doorstepRevenue: sumWhere((j) => j.deliveryMode === 'doorstep'),
      communityWashes,
      /** Wash plans sold at the counter, and what they brought in (part of revenue). */
      shopPlansSold: paid.length - washes.length,
      shopPlanRevenue: sumWhere((j) => !!j.planSaleId),
      discounts: paid.reduce((sum, j) => sum + j.discount, 0),
      voided,
      newCustomers,
      repeatCustomers,
    };
  },

  /**
   * Per-staff performance in `[from, to)`: washes each person started (and voided) by when they
   * were started; washed, commission earned (split between the people who got the customer to
   * take the commission services) and money collected (split by method) by when the wash was
   * paid — the same clock as Reports and the cash drawer, so a car started at night and paid in
   * the morning counts on the morning both here and there. These are the numbers the owner uses
   * to reconcile each person's cash at the end of a shift and to pay them.
   */
  async getStaffStats(db: DbClient, from: Date, to: Date) {
    const window = { gte: from, lt: to };
    const inWindow = { createdAt: window };
    const touched = { OR: [{ createdAt: window }, { status: 'paid', completedAt: window }] };
    const startedIn = (at: Date) => at >= from && at < to;
    const byJobThenUser = [{ jobId: 'asc' as const }, { userId: 'asc' as const }];
    const [users, jobRows, lines, washers, sellers, events, visits] = await Promise.all([
      db.user.findMany({ select: { id: true, name: true, role: true, active: true } }),
      db.job.findMany({
        where: touched,
        select: {
          id: true,
          status: true,
          total: true,
          paymentMethod: true,
          createdAt: true,
          completedAt: true,
          createdByUserId: true,
          paidByUserId: true,
          voidedByUserId: true,
          planSaleId: true,
        },
      }),
      db.jobService.findMany({
        where: { job: touched },
        orderBy: [{ jobId: 'asc' }, { serviceId: 'asc' }],
        select: { jobId: true, commissionAtTime: true, quantity: true },
      }),
      db.jobWasher.findMany({ where: { job: touched }, orderBy: byJobThenUser, select: { jobId: true, userId: true } }),
      db.jobSeller.findMany({ where: { job: touched }, orderBy: byJobThenUser, select: { jobId: true, userId: true } }),
      db.jobEvent.findMany({
        where: { ...inWindow, action: 'payment_method_changed' },
        select: { userId: true },
      }),
      // A plan wash at the shop also writes a visit (with its job): it's counted as a shop wash.
      db.placeVisit.findMany({
        where: { ...inWindow, outcome: 'done', byUserId: { not: null }, jobId: null },
        select: { byUserId: true },
      }),
    ]);
    const linesByJob = groupByJob(lines);
    const washersByJob = groupByJob(washers);
    const sellersByJob = groupByJob(sellers);
    const jobs = jobRows.map((job) => ({
      ...job,
      jobServices: linesByJob.get(job.id) ?? [],
      washers: washersByJob.get(job.id) ?? [],
      sellers: sellersByJob.get(job.id) ?? [],
    }));

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
          /** Wash plans this person sold at the counter (paid in the period): money, not washes. */
          plansSold: 0,
          /** Cars washed at communities (plan visits marked done). */
          communityWashes: 0,
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
      const started = startedIn(job.createdAt);
      const paidHere = job.status === 'paid' && job.completedAt != null && job.completedAt >= from && job.completedAt < to;
      if (job.planSaleId) {
        const seller = paidHere ? rows.get(job.createdByUserId) : undefined;
        if (seller) seller.plansSold += 1;
      } else if (started && job.status !== 'void') {
        const creator = rows.get(job.createdByUserId);
        if (creator) creator.washesStarted += 1;
      }
      if (paidHere && !job.planSaleId) {
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
      if (paidHere && job.paidByUserId) {
        const collector = rows.get(job.paidByUserId);
        if (collector) {
          collector.jobsCollected += 1;
          collector.collected += job.total;
          if (job.paymentMethod === 'cash') collector.cash += job.total;
          else if (job.paymentMethod === 'upi') collector.upi += job.total;
          else collector.other += job.total;
        }
      }
      if (started && job.status === 'void' && job.voidedByUserId) {
        const voider = rows.get(job.voidedByUserId);
        if (voider) voider.voids += 1;
      }
    }
    for (const e of events) {
      const row = rows.get(e.userId);
      if (row) row.corrections += 1;
    }
    for (const v of visits) {
      const row = v.byUserId ? rows.get(v.byUserId) : undefined;
      if (row) row.communityWashes += 1;
    }

    return [...rows.values()]
      .filter(
        (r) =>
          r.active ||
          r.washesStarted +
            r.washesDone +
            r.plansSold +
            r.communityWashes +
            r.servicesSold +
            r.jobsCollected +
            r.voids +
            r.corrections >
            0,
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

  /**
   * Job lines for a PDF / CSV export — newest first. Includes jobs opened in the window
   * and jobs paid in the window (so overnight pays land on the payment day).
   */
  async listForReport(db: DbClient, from: Date, to: Date) {
    return db.job.findMany({
      where: {
        OR: [
          { createdAt: { gte: from, lt: to } },
          { status: 'paid', completedAt: { gte: from, lt: to } },
        ],
      },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        createdAt: true,
        completedAt: true,
        status: true,
        total: true,
        discount: true,
        discountReason: true,
        paymentMethod: true,
        planSaleId: true,
        customer: { select: { name: true, phone: true } },
        vehicle: { select: { registrationNumber: true, vehicleType: { select: { name: true } } } },
        jobServices: { select: { service: { select: { name: true } } } },
        createdBy: personSelect,
        paidBy: personSelect,
      },
    });
  },
};
