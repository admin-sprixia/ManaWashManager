import type { DbClient } from '../client';

export const vehicleRepo = {
  async findByRegistration(db: DbClient, registrationNumber: string) {
    return db.vehicle.findUnique({
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
