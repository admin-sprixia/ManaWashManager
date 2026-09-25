import type { DbClient } from '../client';
import type { ServiceAppliesTo, VehicleCategory } from '@mana/domain';

export const serviceRepo = {
  async listActive(db: DbClient, category?: VehicleCategory) {
    const services = await db.service.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (!category) return services;
    return services.filter((s) => s.appliesTo === 'both' || s.appliesTo === category);
  },

  async listVehicleTypes(db: DbClient, category?: VehicleCategory) {
    return db.vehicleType.findMany({
      where: category ? { category } : undefined,
      orderBy: { sortOrder: 'asc' },
    });
  },

  async getVehicleType(db: DbClient, id: string) {
    return db.vehicleType.findUnique({ where: { id } });
  },

  async findById(db: DbClient, id: string) {
    return db.service.findUnique({ where: { id } });
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
  async createService(
    db: DbClient,
    data: { name: string; description?: string; appliesTo?: ServiceAppliesTo },
  ) {
    const count = await db.service.count();
    return db.service.create({
      data: {
        name: data.name,
        description: data.description,
        appliesTo: data.appliesTo ?? 'car',
        sortOrder: count,
      },
    });
  },

  /** Owner settings screen: add a new vehicle size within a category (e.g. Bike → Scooter). */
  async createVehicleType(db: DbClient, data: { name: string; category?: VehicleCategory }) {
    const count = await db.vehicleType.count();
    return db.vehicleType.create({
      data: {
        name: data.name,
        category: data.category ?? 'car',
        sortOrder: count,
      },
    });
  },
};
