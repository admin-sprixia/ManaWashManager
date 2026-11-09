import type { DbClient } from '../client';
import { isUniqueClash } from '../retryOnClash';
import { directoryRepo } from './directoryRepo';

export const vehicleRepo = {
  /** A typo in a plate, fixed from the profile. 'taken' when another vehicle has that number. */
  async updateRegistration(db: DbClient, id: string, customerId: string, registrationNumber: string) {
    const existing = await db.vehicle.findFirst({ where: { id, customerId }, select: { id: true } });
    if (!existing) return 'not_found' as const;
    try {
      // updatedAt moves with it, so every phone's offline customer list picks the change up.
      return await db.vehicle.update({ where: { id }, data: { registrationNumber }, include: { vehicleType: true } });
    } catch (e) {
      if (isUniqueClash(e)) return 'taken' as const;
      throw e;
    }
  },

  /**
   * The owner's fix for a vehicle saved under the wrong customer (or a duplicate profile): the
   * vehicle and its washes move to `toCustomerId`, so its history and stamps follow it.
   */
  async moveToCustomer(db: DbClient, id: string, fromCustomerId: string, toCustomerId: string) {
    if (fromCustomerId === toCustomerId) return 'same' as const;
    const [vehicle, target] = await Promise.all([
      db.vehicle.findFirst({ where: { id, customerId: fromCustomerId }, select: { id: true } }),
      db.customer.findUnique({ where: { id: toCustomerId }, select: { id: true } }),
    ]);
    if (!vehicle || !target) return 'not_found' as const;
    await db.vehicle.update({ where: { id }, data: { customerId: toCustomerId } });
    const moved = await db.job.updateMany({ where: { vehicleId: id, customerId: fromCustomerId }, data: { customerId: toCustomerId } });
    await directoryRepo.touchCustomer(db, fromCustomerId);
    await directoryRepo.touchCustomer(db, toCustomerId);
    return { washes: moved.count };
  },

  async findByRegistration(db: DbClient, registrationNumber: string) {
    return db.vehicle.findFirst({
      where: { registrationNumber },
      include: { vehicleType: true, customer: true },
    });
  },

  async findById(db: DbClient, id: string) {
    return db.vehicle.findUnique({ where: { id }, include: { vehicleType: true } });
  },

  async listForCustomer(db: DbClient, customerId: string) {
    return db.vehicle.findMany({ where: { customerId }, include: { vehicleType: true } });
  },

  async create(
    db: DbClient,
    data: {
      customerId: string;
      registrationNumber: string;
      vehicleTypeId: string;
      make?: string;
      model?: string;
    },
  ) {
    return db.vehicle.create({ data });
  },
};
