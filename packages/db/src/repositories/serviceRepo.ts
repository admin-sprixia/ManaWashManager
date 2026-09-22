import type { DbClient } from '../client';

export const serviceRepo = {
  async listActive(db: DbClient) {
    return db.service.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  },

  async listVehicleTypes(db: DbClient) {
    return db.vehicleType.findMany({ orderBy: { sortOrder: 'asc' } });
  },

  /** The full price matrix, or just one vehicle type's column when building a New Wash screen. */
  async listPrices(db: DbClient, vehicleTypeId?: string) {
    return db.servicePrice.findMany({
      where: vehicleTypeId ? { vehicleTypeId } : undefined,
    });
  },

  /** Owner settings screen: add or change a price without touching code (see V0.1 feature table). */
  async upsertPrice(
    db: DbClient,
    data: { serviceId: string; vehicleTypeId: string; price: number },
  ) {
    return db.servicePrice.upsert({
      where: {
        serviceId_vehicleTypeId: {
          serviceId: data.serviceId,
          vehicleTypeId: data.vehicleTypeId,
        },
      },
      update: { price: data.price },
      create: data,
    });
  },

  /** Owner settings screen: add a new service — no code change, no deploy. */
  async createService(db: DbClient, data: { name: string; description?: string }) {
    const count = await db.service.count();
    return db.service.create({ data: { ...data, sortOrder: count } });
  },

  /** Owner settings screen: add a new vehicle category (e.g. "Bike", "Van"). */
  async createVehicleType(db: DbClient, data: { name: string }) {
    const count = await db.vehicleType.count();
    return db.vehicleType.create({ data: { ...data, sortOrder: count } });
  },
};
