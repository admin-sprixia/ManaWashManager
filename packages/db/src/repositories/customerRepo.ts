import type { DbClient } from '../client';
import { MAX_IN_LIST } from '../chunk';
import { couponRepo } from './couponRepo';
import { directoryRepo } from './directoryRepo';

/**
 * What to do when a known plate arrives with a phone number that isn't its owner's:
 * - `new_owner` (default): the vehicle moves to that phone's customer (car sold, family member).
 * - `same_person`: the owner changed numbers — update their phone and keep their history whole.
 */
export type VehicleOwnership = 'new_owner' | 'same_person';

export const customerRepo = {
  async findByPhone(db: DbClient, phone: string) {
    return db.customer.findFirst({ where: { phone } });
  },

  async findById(db: DbClient, id: string) {
    return db.customer.findUnique({ where: { id } });
  },

  async create(db: DbClient, data: { phone: string; name: string; source?: string }) {
    return db.customer.create({ data });
  },

  async updateName(db: DbClient, id: string, name: string) {
    const customer = await db.customer.update({ where: { id }, data: { name } });
    await directoryRepo.touchCustomer(db, id);
    return customer;
  },

  /**
   * New Wash's find-or-create: the phone identifies the customer, the plate identifies the
   * vehicle. A known plate brought in under a different phone moves to that phone's customer
   * (past jobs stay with whoever brought the car at the time) — unless the operator confirmed
   * it's the same person with a new number, in which case the owner's phone is updated instead.
   * The vehicle's size is updated to what the operator just picked, since that's what the
   * job is priced on.
   */
  async ensureWithVehicle(
    db: DbClient,
    data: {
      phone: string;
      name: string;
      registrationNumber: string;
      vehicleTypeId: string;
      source?: string;
      ownership?: VehicleOwnership;
    },
  ) {
    const existing = await db.vehicle.findFirst({
      where: { registrationNumber: data.registrationNumber },
    });

    if (existing && data.ownership === 'same_person') {
      const owner = await db.customer.findUnique({ where: { id: existing.customerId } });
      if (owner && owner.phone !== data.phone) {
        const holder = await db.customer.findFirst({ where: { phone: data.phone } });
        if (holder) return { error: 'phone_taken' as const, holderName: holder.name };
        await db.customer.update({ where: { id: owner.id }, data: { phone: data.phone } });
        await directoryRepo.touchCustomer(db, owner.id);
      }
    }

    let customer = await db.customer.findFirst({ where: { phone: data.phone } });
    if (!customer) {
      customer = await db.customer.create({
        data: { phone: data.phone, name: data.name, source: data.source },
      });
    } else if (customer.name !== data.name) {
      customer = await db.customer.update({
        where: { id: customer.id },
        data: { name: data.name },
      });
      await directoryRepo.touchCustomer(db, customer.id);
    }

    let vehicle;
    if (!existing) {
      vehicle = await db.vehicle.create({
        data: {
          customerId: customer.id,
          registrationNumber: data.registrationNumber,
          vehicleTypeId: data.vehicleTypeId,
        },
      });
    } else if (
      existing.customerId !== customer.id ||
      existing.vehicleTypeId !== data.vehicleTypeId
    ) {
      vehicle = await db.vehicle.update({
        where: { id: existing.id },
        data: { customerId: customer.id, vehicleTypeId: data.vehicleTypeId },
      });
      if (existing.customerId !== customer.id) {
        await couponRepo.cancelActiveForVehicle(db, existing.id, 'owner_changed', new Date());
      }
    } else {
      vehicle = existing;
    }

    return { customer, vehicle };
  },

  /** One page of a customer's jobs for their profile, newest first, before `before` if given. */
  async getHistory(db: DbClient, customerId: string, opts: { before?: Date; limit: number }) {
    // Two rounds instead of one per nested include; the page is small enough for an `IN` list.
    const [jobs, vehicles, types, services] = await Promise.all([
      db.job.findMany({
        where: { customerId, ...(opts.before ? { createdAt: { lt: opts.before } } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Math.min(opts.limit, MAX_IN_LIST),
      }),
      db.vehicle.findMany({ where: { jobs: { some: { customerId } } } }),
      db.vehicleType.findMany(),
      db.service.findMany(),
    ]);
    const lines = jobs.length
      ? await db.jobService.findMany({
          where: { jobId: { in: jobs.map((j) => j.id) } },
          orderBy: [{ jobId: 'asc' }, { serviceId: 'asc' }],
        })
      : [];
    const typeById = new Map(types.map((t) => [t.id, t]));
    const serviceById = new Map(services.map((s) => [s.id, s]));
    const vehicleById = new Map(vehicles.map((v) => [v.id, { ...v, vehicleType: typeById.get(v.vehicleTypeId)! }]));
    const linesByJob = new Map<string, (typeof lines)[number][]>();
    for (const line of lines) {
      const list = linesByJob.get(line.jobId) ?? [];
      list.push(line);
      linesByJob.set(line.jobId, list);
    }
    return jobs.map((job) => ({
      ...job,
      jobServices: (linesByJob.get(job.id) ?? []).map((line) => ({
        ...line,
        service: serviceById.get(line.serviceId)!,
      })),
      vehicle: vehicleById.get(job.vehicleId)!,
    }));
  },

  /**
   * Visit count and last visit (every job, like New Wash shows) plus lifetime spend (paid jobs
   * only), worked out in the database rather than by loading the whole history.
   */
  async visitSummary(db: DbClient, customerId: string) {
    const [all, paid] = await Promise.all([
      db.job.aggregate({ where: { customerId }, _count: true, _max: { createdAt: true } }),
      db.job.aggregate({ where: { customerId, status: 'paid' }, _sum: { total: true }, _count: true }),
    ]);
    return {
      visitCount: all._count,
      lastVisit: all._max.createdAt ?? null,
      lifetimeSpend: paid._sum.total ?? 0,
      paidCount: paid._count,
    };
  },
};
