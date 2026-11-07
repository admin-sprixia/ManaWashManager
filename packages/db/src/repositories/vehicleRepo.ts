import type { DbClient } from '../client';
import { isUniqueClash } from '../retryOnClash';

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
