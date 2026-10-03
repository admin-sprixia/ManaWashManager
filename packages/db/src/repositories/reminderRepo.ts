import type { Prisma } from '@prisma/client';
import type { DbClient } from '../client';
import { retryOnClash } from '../retryOnClash';

const liveJob = { status: { not: 'void' } } as const;

export type ReminderAction = 'reminded' | 'snooze' | 'dismiss';

export const reminderRepo = {
  /**
   * Vehicles whose most recent real (non-void) wash is at or before `dueBefore` but after
   * `seenAfter`. Walk-ins are skipped: there's no one to remind.
   */
  lapsedWhere(dueBefore: Date, seenAfter: Date): Prisma.VehicleWhereInput {
    return {
      NOT: { registrationNumber: { startsWith: 'WALK-IN' } },
      jobs: {
        some: { ...liveJob, createdAt: { gt: seenAfter, lte: dueBefore } },
        none: { ...liveJob, createdAt: { gt: dueBefore } },
      },
    };
  },

  /** The `lapsedWhere` vehicles — one row per vehicle, whoever owns it, at most `limit`. */
  async listLapsed(db: DbClient, dueBefore: Date, now: Date, seenAfter: Date, limit: number) {
    const lapsed = this.lapsedWhere(dueBefore, seenAfter);
    // A lapsed vehicle's latest visit is inside the window, so these are the only jobs needed.
    const windowJobs = { ...liveJob, createdAt: { gt: seenAfter, lte: dueBefore }, vehicle: lapsed };
    // One round of parallel queries, each filtered by the same subquery: nested includes would
    // run one after another, and an `IN` list of up to `limit` ids breaks D1's 100-value cap.
    const [vehicles, customers, types, reminders, jobs, lines, services, coupons] = await Promise.all([
      db.vehicle.findMany({ where: lapsed, take: limit }),
      db.customer.findMany({ where: { vehicles: { some: lapsed } }, select: { id: true, name: true, phone: true } }),
      db.vehicleType.findMany({ select: { id: true, name: true } }),
      db.vehicleReminder.findMany({ where: { vehicle: lapsed } }),
      db.job.findMany({ where: windowJobs, select: { id: true, vehicleId: true, createdAt: true } }),
      db.jobService.findMany({
        where: { job: windowJobs },
        orderBy: [{ jobId: 'asc' }, { serviceId: 'asc' }],
        select: { jobId: true, serviceId: true },
      }),
      db.service.findMany({ select: { id: true, name: true } }),
      db.coupon.findMany({
        where: { status: 'active', expiresAt: { gt: now }, vehicle: lapsed },
        orderBy: { id: 'asc' },
        select: { id: true, code: true, percent: true, expiresAt: true, customerId: true, vehicleId: true },
      }),
    ]);
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const typeById = new Map(types.map((t) => [t.id, t]));
    const serviceName = new Map(services.map((s) => [s.id, s.name]));
    const reminderByVehicle = new Map(reminders.map((r) => [r.vehicleId, r]));
    const latestJob = new Map<string, (typeof jobs)[number]>();
    for (const job of jobs) {
      const seen = latestJob.get(job.vehicleId);
      if (!seen || job.createdAt > seen.createdAt) latestJob.set(job.vehicleId, job);
    }
    const linesByJob = new Map<string, { service: { name: string } }[]>();
    for (const line of lines) {
      const list = linesByJob.get(line.jobId) ?? [];
      list.push({ service: { name: serviceName.get(line.serviceId) ?? '' } });
      linesByJob.set(line.jobId, list);
    }
    const couponByVehicle = new Map<string, Omit<(typeof coupons)[number], 'vehicleId'>>();
    for (const { vehicleId, ...coupon } of coupons) {
      if (!couponByVehicle.has(vehicleId)) couponByVehicle.set(vehicleId, coupon);
    }
    return vehicles.map((v) => {
      const last = latestJob.get(v.id);
      const coupon = couponByVehicle.get(v.id);
      return {
        ...v,
        customer: customerById.get(v.customerId)!,
        vehicleType: { name: typeById.get(v.vehicleTypeId)?.name ?? '' },
        reminder: reminderByVehicle.get(v.id) ?? null,
        jobs: last ? [{ createdAt: last.createdAt, jobServices: linesByJob.get(last.id) ?? [] }] : [],
        coupons: coupon ? [coupon] : [],
      };
    });
  },

  async lastVisit(db: DbClient, vehicleId: string) {
    const job = await db.job.findFirst({
      where: { vehicleId, ...liveJob },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return job?.createdAt ?? null;
  },

  /**
   * Records what the team did, pinned to the visit it was about. A newer visit simply makes the
   * stored state stale, so there's nothing to clean up when the vehicle comes back.
   */
  async record(
    db: DbClient,
    data: {
      vehicleId: string;
      lastVisitAt: Date;
      action: ReminderAction;
      userId: string;
      now: Date;
      snoozeUntil?: Date;
    },
  ) {
    const patch =
      data.action === 'reminded'
        ? { remindedAt: data.now, remindedByUserId: data.userId, snoozedUntil: null }
        : data.action === 'snooze'
          ? { snoozedUntil: data.snoozeUntil ?? data.now }
          : { dismissedAt: data.now, dismissedByUserId: data.userId };
    return retryOnClash(async () => {
      const existing = await db.vehicleReminder.findUnique({ where: { vehicleId: data.vehicleId } });
      const sameVisit = existing?.lastVisitAt.getTime() === data.lastVisitAt.getTime();
      const base = sameVisit
        ? {}
        : {
            remindedAt: null,
            remindedByUserId: null,
            snoozedUntil: null,
            dismissedAt: null,
            dismissedByUserId: null,
          };
      return db.vehicleReminder.upsert({
        where: { vehicleId: data.vehicleId },
        create: { vehicleId: data.vehicleId, lastVisitAt: data.lastVisitAt, ...patch },
        update: { lastVisitAt: data.lastVisitAt, ...base, ...patch },
      });
    });
  },
};
