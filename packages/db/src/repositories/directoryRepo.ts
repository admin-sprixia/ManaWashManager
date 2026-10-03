import { Prisma } from '@prisma/client';
import type { DbClient } from '../client';
import { MAX_IN_LIST } from '../chunk';
import { rewardRepo, type RewardCardView } from './rewardRepo';

/**
 * One row of New Wash's customer directory: a vehicle, who owns it, and just enough history
 * to greet the customer and offer "repeat last wash". Phones keep a copy of every row so
 * suggestions work instantly and offline.
 */
export interface DirectoryEntry {
  vehicleId: string;
  registrationNumber: string;
  vehicleTypeId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  /** Every job for the customer (any vehicle), counted the same way as `/customers/lookup`. */
  visitCount: number;
  lastVisit: string | null;
  /** Services on this vehicle's most recent non-void job. */
  lastServices: { serviceId: string; quantity: number }[];
  /** Stamp cards with stamps or a free wash on them (Pro shops; empty otherwise). */
  rewardCards: RewardCardView[];
  /** Welcome-gift items still owed to this vehicle (Pro shops; 0 otherwise). */
  giftsOwed: number;
  updatedAt: string;
}

export interface DirectoryCursor {
  updatedAt: Date;
  id: string;
}

export const directoryRepo = {
  /**
   * Rows changed after `cursor`, oldest first. The (updatedAt, id) pair keeps paging stable
   * even when many rows share a timestamp.
   */
  async page(
    db: DbClient,
    cursor: DirectoryCursor | null,
    limit: number,
    options: { rewards: boolean; now?: Date } = { rewards: false },
  ): Promise<DirectoryEntry[]> {
    const rows = await db.vehicle.findMany({
      where: cursor
        ? {
            OR: [
              { updatedAt: { gt: cursor.updatedAt } },
              { updatedAt: cursor.updatedAt, id: { gt: cursor.id } },
            ],
          }
        : undefined,
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: Math.min(limit, MAX_IN_LIST),
      select: { id: true, registrationNumber: true, vehicleTypeId: true, customerId: true, updatedAt: true },
    });
    if (rows.length === 0) return [];

    // Second (and last) round, all in parallel: nested includes would cost one trip each.
    const vehicleIds = rows.map((v) => v.id);
    const customerIds = [...new Set(rows.map((v) => v.customerId))];
    const shopId = db.$shopId();
    const [customers, visits, lines, cards, owed] = await Promise.all([
      db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true, phone: true } }),
      db.job.groupBy({
        by: ['customerId'],
        where: { customerId: { in: customerIds } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      db.$queryRaw<{ vehicleId: string; serviceId: string; quantity: number | bigint }[]>`
        SELECT j.vehicle_id AS vehicleId, js.service_id AS serviceId, js.quantity AS quantity
          FROM jobs j
          JOIN job_services js ON js.job_id = j.id AND js.shop_id = j.shop_id
         WHERE j.shop_id = ${shopId}
           AND j.vehicle_id IN (${Prisma.join(vehicleIds)})
           AND j.id = (
             SELECT l.id FROM jobs l
              WHERE l.shop_id = j.shop_id AND l.vehicle_id = j.vehicle_id AND l.status <> 'void'
              ORDER BY l.created_at DESC
              LIMIT 1
           )
         ORDER BY js.job_id, js.service_id`,
      options.rewards ? rewardRepo.cardsForVehicles(db, vehicleIds, options.now ?? new Date()) : null,
      options.rewards ? rewardRepo.owedCountByVehicle(db, vehicleIds) : null,
    ]);
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const visitsByCustomer = new Map(visits.map((v) => [v.customerId, v]));
    const linesByVehicle = new Map<string, { serviceId: string; quantity: number }[]>();
    for (const line of lines) {
      const list = linesByVehicle.get(line.vehicleId) ?? [];
      list.push({ serviceId: line.serviceId, quantity: Number(line.quantity) });
      linesByVehicle.set(line.vehicleId, list);
    }

    return rows.map((v) => {
      const customer = customerById.get(v.customerId);
      const visit = visitsByCustomer.get(v.customerId);
      return {
        vehicleId: v.id,
        registrationNumber: v.registrationNumber,
        vehicleTypeId: v.vehicleTypeId,
        customerId: v.customerId,
        customerName: customer?.name ?? '',
        customerPhone: customer?.phone ?? '',
        visitCount: visit?._count._all ?? 0,
        lastVisit: visit?._max.createdAt?.toISOString() ?? null,
        lastServices: linesByVehicle.get(v.id) ?? [],
        rewardCards: cards?.get(v.id) ?? [],
        giftsOwed: owed?.get(v.id) ?? 0,
        updatedAt: v.updatedAt.toISOString(),
      };
    });
  },

  /**
   * Marks every vehicle of a customer as changed, so phones re-pull them. Call after anything
   * the directory shows changes at the customer level: name, phone, or a job added / voided.
   */
  async touchCustomer(db: DbClient, customerId: string) {
    await db.vehicle.updateMany({ where: { customerId }, data: { updatedAt: new Date() } });
  },
};
