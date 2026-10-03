import type { DbClient } from '../client';
import { retryOnClash } from '../retryOnClash';
import type { ServiceAppliesTo, VehicleCategory } from '@mana/domain';

export const serviceRepo = {
  /** Active services; `includes` lists the services a combo bundles (empty for a plain service). */
  async listActive(db: DbClient, category?: VehicleCategory) {
    const [rows, items] = await Promise.all([
      db.service.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
      db.serviceComboItem.findMany({
        where: { combo: { active: true } },
        orderBy: [{ comboId: 'asc' }, { serviceId: 'asc' }],
        select: { comboId: true, serviceId: true },
      }),
    ]);
    const includesByCombo = new Map<string, string[]>();
    for (const item of items) {
      const list = includesByCombo.get(item.comboId) ?? [];
      list.push(item.serviceId);
      includesByCombo.set(item.comboId, list);
    }
    const services = rows.map((s) => ({ ...s, includes: includesByCombo.get(s.id) ?? [] }));
    if (!category) return services;
    return services.filter((s) => s.appliesTo === 'both' || s.appliesTo === category);
  },

  /** Sets what a combo bundles. An empty list turns it back into a plain service. */
  async setComboItems(db: DbClient, comboId: string, serviceIds: string[]) {
    // Two saves at once both clear and refill; the loser's clash redoes it, so the list ends up
    // exactly one save's choice.
    await retryOnClash(async () => {
      await db.serviceComboItem.deleteMany({ where: { comboId } });
      if (serviceIds.length) {
        await db.serviceComboItem.createMany({ data: serviceIds.map((serviceId) => ({ comboId, serviceId })) });
      }
    });
  },

  async updateService(db: DbClient, id: string, data: { name?: string; description?: string | null }) {
    await db.service.updateMany({ where: { id }, data });
  },

  async listVehicleTypes(db: DbClient, category?: VehicleCategory) {
    return db.vehicleType.findMany({
      where: category ? { category, active: true } : { active: true },
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
    return retryOnClash(() =>
      db.servicePrice.upsert({
        where: {
          serviceId_vehicleTypeId: {
            serviceId: data.serviceId,
            vehicleTypeId: data.vehicleTypeId,
          },
        },
        update: { price: data.price },
        create: data,
      }),
    );
  },

  /** Staff commission rates — the full matrix, or one vehicle type's column when pricing a job. */
  async listCommissionRates(db: DbClient, vehicleTypeId?: string) {
    return db.commissionRate.findMany({
      where: vehicleTypeId ? { vehicleTypeId } : undefined,
    });
  },

  /** Owner settings: set a rate, or clear it with `null` (no commission for that combination). */
  async setCommissionRate(
    db: DbClient,
    data: { serviceId: string; vehicleTypeId: string; amount: number | null },
  ) {
    const key = { serviceId: data.serviceId, vehicleTypeId: data.vehicleTypeId };
    if (data.amount == null) {
      await db.commissionRate.deleteMany({ where: key });
      return null;
    }
    const amount = data.amount;
    return retryOnClash(() =>
      db.commissionRate.upsert({
        where: { serviceId_vehicleTypeId: key },
        update: { amount },
        create: { ...key, amount },
      }),
    );
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

  /** A service is offered for a vehicle only where it has a price; this withdraws one vehicle. */
  async removePrice(db: DbClient, key: { serviceId: string; vehicleTypeId: string }) {
    await db.servicePrice.deleteMany({ where: key });
    await db.commissionRate.deleteMany({ where: key });
  },

  async setServiceAppliesTo(db: DbClient, id: string, appliesTo: ServiceAppliesTo) {
    await db.service.updateMany({ where: { id }, data: { appliesTo } });
  },

  /** Owner settings: take a service off the menu. Hidden, not deleted, so past jobs keep their lines. */
  async deactivateService(db: DbClient, id: string): Promise<boolean> {
    const { count } = await db.service.updateMany({ where: { id, active: true }, data: { active: false } });
    return count > 0;
  },

  /** Owner settings screen: add a new vehicle size within a category (e.g. Bike → Scooter). */
  /** Selecting a size the owner deselected earlier brings it back with its old prices. */
  async createVehicleType(db: DbClient, data: { name: string; category?: VehicleCategory }) {
    const category = data.category ?? 'car';
    const hidden = await db.vehicleType.findFirst({ where: { name: data.name, category, active: false } });
    if (hidden) return db.vehicleType.update({ where: { id: hidden.id }, data: { active: true } });
    const count = await db.vehicleType.count();
    return db.vehicleType.create({
      data: {
        name: data.name,
        category,
        sortOrder: count,
      },
    });
  },

  /**
   * Owner settings: deselect a vehicle size. Hidden when customers' vehicles use it, so their
   * history and saved size stay intact; deleted outright (with prices) when nothing does.
   */
  async removeVehicleType(db: DbClient, id: string): Promise<'deleted' | 'hidden' | 'not_found'> {
    const vehicleType = await db.vehicleType.findUnique({ where: { id } });
    if (!vehicleType || !vehicleType.active) return 'not_found';
    if ((await db.vehicle.count({ where: { vehicleTypeId: id } })) > 0) {
      await db.vehicleType.update({ where: { id }, data: { active: false } });
      return 'hidden';
    }
    await db.servicePrice.deleteMany({ where: { vehicleTypeId: id } });
    await db.commissionRate.deleteMany({ where: { vehicleTypeId: id } });
    await db.vehicleType.delete({ where: { id } });
    return 'deleted';
  },
};
