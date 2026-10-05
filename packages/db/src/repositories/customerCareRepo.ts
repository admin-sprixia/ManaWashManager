import {
  canRateWash,
  MAX_OPEN_PROBLEMS,
  MAX_PENDING_VEHICLE_REQUESTS,
  type ProblemKind,
} from '@mana/domain';
import type { DbClient } from '../client';
import { isUniqueClash, retryOnClash } from '../retryOnClash';
import type { CustomerLink } from './customerAppRepo';
import { directoryRepo } from './directoryRepo';

/** Rejected and cancelled vehicle requests stay visible to the customer this long. */
const HANDLED_REQUEST_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const problemSelect = {
  id: true,
  kind: true,
  details: true,
  status: true,
  resolution: true,
  resolvedAt: true,
  createdAt: true,
  job: { select: { id: true, createdAt: true, vehicle: { select: { registrationNumber: true } } } },
} as const;

type ProblemRow = Awaited<ReturnType<typeof listCustomerProblems>>[number];

function listCustomerProblems(db: DbClient, customerId: string) {
  return db.washProblem.findMany({
    where: { customerId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 30,
    select: problemSelect,
  });
}

function problemView(p: ProblemRow, link: CustomerLink) {
  return {
    id: p.id,
    kind: p.kind as ProblemKind,
    details: p.details,
    status: p.status as 'open' | 'resolved',
    resolution: p.resolution,
    resolvedAt: p.resolvedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    wash: p.job
      ? { id: p.job.id, createdAt: p.job.createdAt.toISOString(), registrationNumber: p.job.vehicle.registrationNumber }
      : null,
    branch: { id: link.shopId, name: link.shopName, city: link.city },
  };
}

export type CustomerProblemView = ReturnType<typeof problemView>;

const vehicleRequestSelect = {
  id: true,
  registrationNumber: true,
  make: true,
  model: true,
  status: true,
  reason: true,
  createdAt: true,
  handledAt: true,
  vehicleType: { select: { id: true, name: true, category: true } },
} as const;

/**
 * Ratings, problem reports and "add my vehicle" requests from the MANA Car Wash app — the
 * customer's side (always filtered by their customer id in this branch) and the team's side.
 */
export const customerCareRepo = {
  // ───────────── Customer side ─────────────

  /** 'not_found' | 'not_rateable' | the saved rating. */
  async rate(db: DbClient, link: CustomerLink, jobId: string, data: { stars: number; comment: string | null }, now: Date) {
    const job = await db.job.findFirst({
      where: { id: jobId, customerId: link.customerId, status: { not: 'void' } },
      select: { id: true, status: true, completedAt: true },
    });
    if (!job) return 'not_found' as const;
    if (!canRateWash({ status: job.status, paidAt: job.completedAt, now })) return 'not_rateable' as const;
    return retryOnClash(() =>
      db.washRating.upsert({
        where: { jobId },
        create: { jobId, customerId: link.customerId, stars: data.stars, comment: data.comment, createdAt: now, updatedAt: now },
        update: { stars: data.stars, comment: data.comment, updatedAt: now },
        select: { stars: true, comment: true, updatedAt: true },
      }),
    );
  },

  /** 'not_found' (the wash isn't theirs) | 'too_many' | the new report. */
  async reportProblem(
    db: DbClient,
    link: CustomerLink,
    data: { jobId: string | null; kind: ProblemKind; details: string },
    now: Date,
  ) {
    if (data.jobId) {
      const job = await db.job.findFirst({
        where: { id: data.jobId, customerId: link.customerId, status: { not: 'void' } },
        select: { id: true },
      });
      if (!job) return 'not_found' as const;
    }
    const open = await db.washProblem.count({ where: { customerId: link.customerId, status: 'open' } });
    if (open >= MAX_OPEN_PROBLEMS) return 'too_many' as const;
    const created = await db.washProblem.create({
      data: { customerId: link.customerId, jobId: data.jobId, kind: data.kind, details: data.details, createdAt: now },
      select: problemSelect,
    });
    return problemView(created, link);
  },

  async problems(db: DbClient, link: CustomerLink) {
    return (await listCustomerProblems(db, link.customerId)).map((p) => problemView(p, link));
  },

  /** Pending requests, and ones handled in the last 30 days (so a decline and its reason show). */
  async vehicleRequests(db: DbClient, link: CustomerLink, now: Date) {
    const rows = await db.vehicleRequest.findMany({
      where: {
        customerId: link.customerId,
        OR: [{ status: 'pending' }, { status: { in: ['rejected', 'approved'] }, handledAt: { gte: new Date(now.getTime() - HANDLED_REQUEST_DAYS * DAY_MS) } }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
      select: vehicleRequestSelect,
    });
    return rows.map((r) => ({
      id: r.id,
      registrationNumber: r.registrationNumber,
      make: r.make,
      model: r.model,
      status: r.status as 'pending' | 'approved' | 'rejected',
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      handledAt: r.handledAt?.toISOString() ?? null,
      type: { name: r.vehicleType.name, category: r.vehicleType.category as 'car' | 'bike' },
      branch: { id: link.shopId, name: link.shopName, city: link.city },
    }));
  },

  /**
   * "Add my vehicle". A vehicle of theirs they'd removed from the app comes straight back;
   * anything else waits for the team.
   */
  async requestVehicle(
    db: DbClient,
    link: CustomerLink,
    data: { registrationNumber: string; vehicleTypeId: string; make: string | null; model: string | null },
    now: Date,
  ): Promise<
    | { kind: 'restored' }
    | { kind: 'requested'; id: string }
    | { kind: 'already_yours' | 'bad_type' | 'too_many' | 'already_requested' }
  > {
    const [type, existing] = await Promise.all([
      db.vehicleType.findFirst({ where: { id: data.vehicleTypeId, active: true }, select: { id: true } }),
      db.vehicle.findFirst({
        where: { registrationNumber: data.registrationNumber },
        select: { id: true, customerId: true, appHiddenAt: true },
      }),
    ]);
    if (existing && existing.customerId === link.customerId) {
      if (!existing.appHiddenAt) return { kind: 'already_yours' };
      await db.vehicle.update({ where: { id: existing.id }, data: { appHiddenAt: null } });
      return { kind: 'restored' };
    }
    if (!type) return { kind: 'bad_type' };
    const pending = await db.vehicleRequest.count({ where: { customerId: link.customerId, status: 'pending' } });
    if (pending >= MAX_PENDING_VEHICLE_REQUESTS) return { kind: 'too_many' };
    try {
      const created = await db.vehicleRequest.create({
        data: {
          customerId: link.customerId,
          registrationNumber: data.registrationNumber,
          vehicleTypeId: data.vehicleTypeId,
          make: data.make,
          model: data.model,
          createdAt: now,
        },
        select: { id: true },
      });
      return { kind: 'requested', id: created.id };
    } catch (e) {
      if (isUniqueClash(e)) return { kind: 'already_requested' };
      throw e;
    }
  },

  async cancelVehicleRequest(db: DbClient, link: CustomerLink, id: string, now: Date): Promise<boolean> {
    const res = await db.vehicleRequest.updateMany({
      where: { id, customerId: link.customerId, status: 'pending' },
      data: { status: 'cancelled', handledAt: now },
    });
    return res.count === 1;
  },

  /** Hides one of their vehicles from the app. False when it isn't theirs. */
  async hideVehicle(db: DbClient, link: CustomerLink, vehicleId: string, now: Date): Promise<boolean> {
    const res = await db.vehicle.updateMany({
      where: { id: vehicleId, customerId: link.customerId },
      data: { appHiddenAt: now },
    });
    return res.count === 1;
  },

  // ───────────── Team side ─────────────

  async counts(db: DbClient) {
    const [openProblems, pendingVehicles] = await Promise.all([
      db.washProblem.count({ where: { status: 'open' } }),
      db.vehicleRequest.count({ where: { status: 'pending' } }),
    ]);
    return { openProblems, pendingVehicles };
  },

  async listProblems(db: DbClient, filter: 'open' | 'resolved') {
    return db.washProblem.findMany({
      where: { status: filter },
      orderBy: [{ createdAt: filter === 'open' ? 'asc' : 'desc' }, { id: 'asc' }],
      take: 50,
      select: {
        ...problemSelect,
        customer: { select: { id: true, name: true, phone: true } },
        job: {
          select: {
            id: true,
            createdAt: true,
            total: true,
            vehicle: { select: { registrationNumber: true } },
            washers: { select: { user: { select: { name: true } } } },
          },
        },
        resolvedBy: { select: { id: true, name: true } },
      },
    });
  },

  async resolveProblem(db: DbClient, id: string, data: { userId: string; resolution: string; now: Date }) {
    const res = await db.washProblem.updateMany({
      where: { id, status: 'open' },
      data: { status: 'resolved', resolution: data.resolution, resolvedByUserId: data.userId, resolvedAt: data.now },
    });
    return res.count === 1;
  },

  async problemExists(db: DbClient, id: string) {
    return (await db.washProblem.count({ where: { id } })) > 0;
  },

  /** Newest first, `take` rated before `before`; plus the last 30 days' average. */
  async listRatings(db: DbClient, before: Date | null, take: number, now: Date) {
    const [rows, recent] = await Promise.all([
      db.washRating.findMany({
        where: before ? { updatedAt: { lt: before } } : {},
        orderBy: [{ updatedAt: 'desc' }, { jobId: 'desc' }],
        take,
        select: {
          jobId: true,
          stars: true,
          comment: true,
          updatedAt: true,
          customer: { select: { id: true, name: true, phone: true } },
          job: {
            select: {
              createdAt: true,
              vehicle: { select: { registrationNumber: true } },
              washers: { select: { user: { select: { name: true } } } },
            },
          },
        },
      }),
      db.washRating.groupBy({
        by: ['stars'],
        where: { updatedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } },
        _count: { _all: true },
      }),
    ]);
    const count = recent.reduce((n, r) => n + r._count._all, 0);
    const sum = recent.reduce((n, r) => n + r.stars * r._count._all, 0);
    return {
      rows,
      last30: {
        count,
        average: count ? Math.round((sum / count) * 10) / 10 : null,
        byStars: [1, 2, 3, 4, 5].map((s) => recent.find((r) => r.stars === s)?._count._all ?? 0),
      },
    };
  },

  async listVehicleRequests(db: DbClient, filter: 'pending' | 'handled') {
    const rows = await db.vehicleRequest.findMany({
      where: filter === 'pending' ? { status: 'pending' } : { status: { in: ['approved', 'rejected'] } },
      orderBy: [{ createdAt: filter === 'pending' ? 'asc' : 'desc' }, { id: 'asc' }],
      take: 50,
      select: {
        ...vehicleRequestSelect,
        customerId: true,
        customer: { select: { id: true, name: true, phone: true } },
        handledBy: { select: { id: true, name: true } },
      },
    });
    const plates = [...new Set(rows.map((r) => r.registrationNumber))];
    const owners = plates.length
      ? await db.vehicle.findMany({
          where: { registrationNumber: { in: plates } },
          select: { registrationNumber: true, customer: { select: { id: true, name: true, phone: true } } },
        })
      : [];
    const ownerOf = new Map(owners.map((v) => [v.registrationNumber, v.customer]));
    return rows.map((r) => {
      const owner = ownerOf.get(r.registrationNumber);
      return { ...r, currentOwner: owner && owner.id !== r.customerId ? owner : null };
    });
  },

  /**
   * Gives the customer the vehicle: creates it, or moves an existing plate to them (as New Wash
   * does when a known plate comes in under a new number). 'not_found' | 'already_handled' | 'ok'.
   */
  async approveVehicleRequest(db: DbClient, id: string, data: { userId: string; now: Date }) {
    const request = await db.vehicleRequest.findUnique({
      where: { id },
      select: { id: true, status: true, customerId: true, registrationNumber: true, vehicleTypeId: true, make: true, model: true },
    });
    if (!request) return 'not_found' as const;
    if (request.status !== 'pending') return 'already_handled' as const;

    const vehicle = await retryOnClash(async () => {
      const existing = await db.vehicle.findFirst({
        where: { registrationNumber: request.registrationNumber },
        select: { id: true, customerId: true },
      });
      if (!existing) {
        return db.vehicle.create({
          data: {
            customerId: request.customerId,
            registrationNumber: request.registrationNumber,
            vehicleTypeId: request.vehicleTypeId,
            make: request.make,
            model: request.model,
          },
          select: { id: true, customerId: true },
        });
      }
      if (existing.customerId !== request.customerId) {
        await db.vehicle.update({
          where: { id: existing.id },
          data: { customerId: request.customerId, appHiddenAt: null },
        });
        await directoryRepo.touchCustomer(db, existing.customerId);
      }
      return existing;
    });

    const res = await db.vehicleRequest.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'approved', vehicleId: vehicle.id, handledByUserId: data.userId, handledAt: data.now },
    });
    await directoryRepo.touchCustomer(db, request.customerId);
    return res.count === 1 ? ('ok' as const) : ('already_handled' as const);
  },

  async rejectVehicleRequest(db: DbClient, id: string, data: { userId: string; reason: string; now: Date }) {
    const exists = await db.vehicleRequest.count({ where: { id } });
    if (!exists) return 'not_found' as const;
    const res = await db.vehicleRequest.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected', reason: data.reason, handledByUserId: data.userId, handledAt: data.now },
    });
    return res.count === 1 ? ('ok' as const) : ('already_handled' as const);
  },
};
