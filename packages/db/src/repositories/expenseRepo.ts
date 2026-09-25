import type { DbClient } from '../client';
import type { ExpenseCategory } from '@mana/domain';

const personSelect = { select: { id: true, name: true } } as const;

export const expenseRepo = {
  async findById(db: DbClient, id: string) {
    return db.expense.findUnique({ where: { id } });
  },

  async create(
    db: DbClient,
    data: {
      /** Client-generated id — makes a replayed offline entry idempotent. */
      id?: string;
      category: ExpenseCategory;
      amount: number;
      description?: string;
      date: Date;
      createdByUserId: string;
    },
  ) {
    return db.expense.create({ data, include: { createdBy: personSelect } });
  },

  /** Expenses in `[from, to)`, newest first. Pass `createdByUserId` to scope to one person. */
  async list(db: DbClient, from: Date, to: Date, opts: { createdByUserId?: string } = {}) {
    return db.expense.findMany({
      where: {
        date: { gte: from, lt: to },
        ...(opts.createdByUserId ? { createdByUserId: opts.createdByUserId } : {}),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { createdBy: personSelect, voidedBy: personSelect },
    });
  },

  /** Sum of non-voided expenses in `[from, to)`. */
  async total(db: DbClient, from: Date, to: Date): Promise<number> {
    const result = await db.expense.aggregate({
      where: { date: { gte: from, lt: to }, voidedAt: null },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  },

  /** Expenses voided in `[from, to)` — feeds the owner's audit log alongside job corrections. */
  async listVoided(db: DbClient, from: Date, to: Date) {
    return db.expense.findMany({
      where: { voidedAt: { gte: from, lt: to } },
      orderBy: { voidedAt: 'desc' },
      include: { createdBy: personSelect, voidedBy: personSelect },
    });
  },

  async voidExpense(db: DbClient, id: string, data: { userId: string; reason: string }) {
    return db.expense.update({
      where: { id },
      data: { voidedByUserId: data.userId, voidReason: data.reason, voidedAt: new Date() },
      include: { createdBy: personSelect, voidedBy: personSelect },
    });
  },
};
