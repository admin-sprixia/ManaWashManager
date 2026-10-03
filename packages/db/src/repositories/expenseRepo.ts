import type { DbClient } from '../client';
import type { ExpenseCategory, ExpenseUnit, PaymentMethod } from '@mana/domain';

const personSelect = { select: { id: true, name: true } } as const;

type ExpenseRow = { createdByUserId: string; voidedByUserId: string | null };

/** Adds `createdBy` / `voidedBy` with the users loaded in one query rather than an include each. */
async function withPeople<T extends ExpenseRow>(db: DbClient, rows: Promise<T[]>) {
  const [list, users] = await Promise.all([rows, db.user.findMany(personSelect)]);
  const byId = new Map(users.map((u) => [u.id, u]));
  return list.map((e) => ({
    ...e,
    createdBy: byId.get(e.createdByUserId)!,
    voidedBy: e.voidedByUserId ? (byId.get(e.voidedByUserId) ?? null) : null,
  }));
}

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
      itemName?: string;
      quantity?: number;
      unit?: ExpenseUnit;
      billPhotoKey?: string;
      itemPhotoKey?: string;
      paymentMethod: PaymentMethod;
      date: Date;
      createdByUserId: string;
    },
  ) {
    return db.expense.create({ data, include: { createdBy: personSelect } });
  },

  /** Expenses in `[from, to)`, newest first. Pass `createdByUserId` to scope to one person. */
  async list(db: DbClient, from: Date, to: Date, opts: { createdByUserId?: string } = {}) {
    const rows = db.expense.findMany({
      where: {
        date: { gte: from, lt: to },
        ...(opts.createdByUserId ? { createdByUserId: opts.createdByUserId } : {}),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    return withPeople(db, rows);
  },

  /** Sum of non-voided expenses in `[from, to)`. */
  async total(db: DbClient, from: Date, to: Date): Promise<number> {
    const result = await db.expense.aggregate({
      where: { date: { gte: from, lt: to }, voidedAt: null },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  },

  /** Cash paid out of the drawer: non-voided cash expenses dated in `[from, to)`. */
  async cashTotal(db: DbClient, from: Date, to: Date): Promise<{ total: number; count: number }> {
    const result = await db.expense.aggregate({
      where: { date: { gte: from, lt: to }, voidedAt: null, paymentMethod: 'cash' },
      _sum: { amount: true },
      _count: true,
    });
    return { total: result._sum.amount ?? 0, count: result._count };
  },

  /** Expenses voided in `[from, to)` — feeds the owner's audit log alongside job corrections. */
  async listVoided(db: DbClient, from: Date, to: Date) {
    const rows = db.expense.findMany({
      where: { voidedAt: { gte: from, lt: to } },
      orderBy: { voidedAt: 'desc' },
    });
    return withPeople(db, rows);
  },

  /** Only voids a live expense, so two voids at once keep the first one's reason and name. */
  async voidExpense(db: DbClient, id: string, data: { userId: string; reason: string }) {
    const { count } = await db.expense.updateMany({
      where: { id, voidedAt: null },
      data: { voidedByUserId: data.userId, voidReason: data.reason, voidedAt: new Date() },
    });
    return count === 1;
  },
};
