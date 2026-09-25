import type { DbClient } from '../client';

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
      take: limit,
      include: {
        customer: {
          include: {
            _count: { select: { jobs: true } },
            jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
          },
        },
        jobs: {
          where: { status: { not: 'void' } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { jobServices: { select: { serviceId: true, quantity: true } } },
        },
      },
    });

    return rows.map((v) => ({
      vehicleId: v.id,
      registrationNumber: v.registrationNumber,
      vehicleTypeId: v.vehicleTypeId,
      customerId: v.customerId,
      customerName: v.customer.name ?? '',
      customerPhone: v.customer.phone,
      visitCount: v.customer._count.jobs,
      lastVisit: v.customer.jobs[0]?.createdAt.toISOString() ?? null,
      lastServices: v.jobs[0]?.jobServices ?? [],
      updatedAt: v.updatedAt.toISOString(),
    }));
  },

  /**
   * Marks every vehicle of a customer as changed, so phones re-pull them. Call after anything
   * the directory shows changes at the customer level: name, phone, or a job added / voided.
   */
  async touchCustomer(db: DbClient, customerId: string) {
    await db.vehicle.updateMany({ where: { customerId }, data: { updatedAt: new Date() } });
  },
};
