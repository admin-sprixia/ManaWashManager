import type { DbClient } from '../client';
import type { JobStatus, PaymentMethod } from '@mana/domain';

export interface CreateJobInput {
  customerId: string;
  vehicleId: string;
  createdByUserId: string;
  subtotal: number;
  discount: number;
  discountReason?: string;
  total: number;
  lineItems: { serviceId: string; priceAtTime: number; quantity: number }[];
}

export const jobRepo = {
  async create(db: DbClient, data: CreateJobInput) {
    return db.job.create({
      data: {
        customerId: data.customerId,
        vehicleId: data.vehicleId,
        createdByUserId: data.createdByUserId,
        status: 'waiting',
        subtotal: data.subtotal,
        discount: data.discount,
        discountReason: data.discountReason,
        total: data.total,
        jobServices: { create: data.lineItems },
      },
      include: { jobServices: true },
    });
  },

  async findById(db: DbClient, id: string) {
    return db.job.findUniqueOrThrow({ where: { id } });
  },

  async updateStatus(db: DbClient, id: string, status: JobStatus) {
    return db.job.update({
      where: { id },
      data: { status, completedAt: status === 'paid' ? new Date() : undefined },
    });
  },

  async markPaid(db: DbClient, id: string, paymentMethod: PaymentMethod) {
    return db.job.update({
      where: { id },
      data: {
        status: 'paid',
        paymentMethod,
        paymentStatus: 'paid',
        completedAt: new Date(),
      },
    });
  },

  /** Today's job board / dashboard, newest first. */
  async listToday(db: DbClient) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return db.job.findMany({
      where: { createdAt: { gte: startOfDay } },
      include: {
        customer: true,
        vehicle: { include: { vehicleType: true } },
        jobServices: { include: { service: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },
};
