import type { DbClient } from '../client';
import type { ExpenseCashSource, ExpenseCategory, ExpenseUnit, PaymentMethod } from '@mana/domain';
import { chunk } from '../chunk';

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
      cashSource?: ExpenseCashSource;
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

  /** Cash paid out of the drawer: non-voided cash expenses from the box dated in `[from, to)`. */
  async cashTotal(db: DbClient, from: Date, to: Date): Promise<{ total: number; count: number }> {
    const result = await db.expense.aggregate({
      where: { date: { gte: from, lt: to }, voidedAt: null, paymentMethod: 'cash', cashSource: 'drawer' },
      _sum: { amount: true },
      _count: true,
    });
    return { total: result._sum.amount ?? 0, count: result._count };
  },

  /**
   * Doorstep cash spent by who entered it: dated in `[from, to)`, or ever when no window is given.
   * It comes off what they hold; a deleted expense gives it back.
   */
  async heldSpendByUser(db: DbClient, window?: { from: Date; to: Date }) {
    const rows = await db.expense.groupBy({
      by: ['createdByUserId'],
      where: {
        voidedAt: null,
        paymentMethod: 'cash',
        cashSource: 'held',
        ...(window ? { date: { gte: window.from, lt: window.to } } : {}),
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.createdByUserId, { total: r._sum.amount ?? 0, count: r._count._all }]));
  },

  /** Expenses voided in `[from, to)` — feeds the owner's audit log alongside job corrections. */
  async listVoided(db: DbClient, from: Date, to: Date) {
    const rows = db.expense.findMany({
      where: { voidedAt: { gte: from, lt: to } },
      orderBy: { voidedAt: 'desc' },
    });
    return withPeople(db, rows);
  },

  /**
   * Changes a live expense and logs the edit with it, in one batch. `changes` is what moved, for
   * the record. Returns false when the expense was voided meanwhile (nothing is changed then).
   */
  async edit(
    db: DbClient,
    id: string,
    data: {
      fields: {
        category?: ExpenseCategory;
        amount?: number;
        description?: string | null;
        itemName?: string;
        quantity?: number | null;
        unit?: ExpenseUnit | null;
        paymentMethod?: PaymentMethod;
        cashSource?: ExpenseCashSource;
        date?: Date;
      };
      edit: { id: string; userId: string; reason: string; changes: { field: string; from: unknown; to: unknown }[] };
    },
  ) {
    const { count } = await db.expense.updateMany({ where: { id, voidedAt: null }, data: data.fields });
    if (count !== 1) return false;
    await db.expenseEdit.create({
      data: {
        id: data.edit.id,
        expenseId: id,
        editedByUserId: data.edit.userId,
        reason: data.edit.reason,
        changes: JSON.stringify(data.edit.changes),
      },
    });
    return true;
  },

  /** Which of these expenses were ever edited (a year of entries is far past D1's 100-value IN list). */
  async editedIds(db: DbClient, ids: string[]) {
    const edited = new Set<string>();
    for (const slice of chunk(ids)) {
      const rows = await db.expenseEdit.findMany({ where: { expenseId: { in: slice } }, select: { expenseId: true } });
      for (const r of rows) edited.add(r.expenseId);
    }
    return edited;
  },

  /** An expense's edits, newest first, with who made each. */
  async editsFor(db: DbClient, expenseId: string) {
    const [rows, users] = await Promise.all([
      db.expenseEdit.findMany({ where: { expenseId }, orderBy: { createdAt: 'desc' } }),
      db.user.findMany(personSelect),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      changes: JSON.parse(r.changes) as { field: string; from: unknown; to: unknown }[],
      createdAt: r.createdAt,
      editedBy: byId.get(r.editedByUserId) ?? { id: r.editedByUserId, name: 'Someone' },
    }));
  },

  /** Every edit in `[from, to)`, newest first, with its expense and who made it — for the audit feed. */
  async listEdits(db: DbClient, from: Date, to: Date) {
    const [rows, users] = await Promise.all([
      db.expenseEdit.findMany({
        where: { createdAt: { gte: from, lt: to } },
        orderBy: { createdAt: 'desc' },
        include: { expense: { select: { id: true, category: true, amount: true, itemName: true, description: true } } },
      }),
      db.user.findMany(personSelect),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      changes: JSON.parse(r.changes) as { field: string; from: unknown; to: unknown }[],
      createdAt: r.createdAt,
      expense: r.expense,
      editedBy: byId.get(r.editedByUserId) ?? { id: r.editedByUserId, name: 'Someone' },
    }));
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
