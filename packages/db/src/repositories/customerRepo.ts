import type { DbClient } from '../client';

export const customerRepo = {
  async findByPhone(db: DbClient, phone: string) {
    return db.customer.findUnique({ where: { phone } });
  },

  async findById(db: DbClient, id: string) {
    return db.customer.findUnique({ where: { id } });
  },

  async create(db: DbClient, data: { phone: string; name?: string; source?: string }) {
    return db.customer.create({ data });
  },

  /** Full job history for a customer's profile screen, newest first. */
  async getHistory(db: DbClient, customerId: string) {
    return db.job.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: { jobServices: { include: { service: true } }, vehicle: true },
    });
  },
};
