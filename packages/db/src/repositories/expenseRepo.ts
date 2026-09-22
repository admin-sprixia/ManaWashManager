import type { DbClient } from '../client';

export const expenseRepo = {
  async create(
    db: DbClient,
    data: {
      category: string;
      amount: number;
      description?: string;
      date: Date;
      createdByUserId: string;
    },
  ) {
    return db.expense.create({ data });
  },

  async listByDateRange(db: DbClient, from: Date, to: Date) {
    return db.expense.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'desc' },
    });
  },
};
