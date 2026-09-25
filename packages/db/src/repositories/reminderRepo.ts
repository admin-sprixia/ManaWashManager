import type { DbClient } from '../client';

const liveJob = { status: { not: 'void' } } as const;

export type ReminderAction = 'reminded' | 'snooze' | 'dismiss';

export const reminderRepo = {
  /**
   * Vehicles whose most recent real (non-void) wash is at or before `dueBefore` — one row per
   * vehicle, whoever owns it. Walk-ins are skipped: there's no one to remind.
   */
  async listLapsed(db: DbClient, dueBefore: Date, now: Date) {
    return db.vehicle.findMany({
      where: {
        NOT: { registrationNumber: { startsWith: 'WALK-IN' } },
        jobs: { some: liveJob, none: { ...liveJob, createdAt: { gt: dueBefore } } },
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        vehicleType: { select: { name: true } },
        reminder: true,
        jobs: {
          where: liveJob,
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            createdAt: true,
            jobServices: { select: { service: { select: { name: true } } } },
          },
        },
        coupons: {
          where: { status: 'active', expiresAt: { gt: now } },
          take: 1,
          select: { id: true, code: true, percent: true, expiresAt: true, customerId: true },
        },
      },
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
    const patch =
      data.action === 'reminded'
        ? { remindedAt: data.now, remindedByUserId: data.userId, snoozedUntil: null }
        : data.action === 'snooze'
          ? { snoozedUntil: data.snoozeUntil ?? data.now }
          : { dismissedAt: data.now, dismissedByUserId: data.userId };
    return db.vehicleReminder.upsert({
      where: { vehicleId: data.vehicleId },
      create: { vehicleId: data.vehicleId, lastVisitAt: data.lastVisitAt, ...patch },
      update: { lastVisitAt: data.lastVisitAt, ...base, ...patch },
    });
  },
};
