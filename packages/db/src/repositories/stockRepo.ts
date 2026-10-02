import type { DbClient } from '../client';
import { roundStock, stockKey, type StockMoveKind, type StockUnit } from '@mana/domain';

const personSelect = { select: { id: true, name: true } } as const;

export const stockRepo = {
  async list(db: DbClient) {
    return db.stockItem.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  },

  async findById(db: DbClient, id: string) {
    return db.stockItem.findUnique({ where: { id } });
  },

  /** The live item with this name (case and spacing ignored), if any. */
  async findByName(db: DbClient, name: string) {
    return db.stockItem.findFirst({ where: { nameKey: stockKey(name), active: true } });
  },

  async create(
    db: DbClient,
    data: {
      id?: string;
      name: string;
      unit: StockUnit;
      lowAt: number | null;
      createdByUserId: string;
    },
  ) {
    return db.stockItem.create({
      data: {
        id: data.id,
        name: data.name.trim().replace(/\s+/g, ' '),
        nameKey: stockKey(data.name),
        unit: data.unit,
        lowAt: data.lowAt,
        createdByUserId: data.createdByUserId,
      },
    });
  },

  async update(db: DbClient, id: string, data: { name?: string; lowAt?: number | null }) {
    return db.stockItem.update({
      where: { id },
      data: {
        ...(data.name != null
          ? { name: data.name.trim().replace(/\s+/g, ' '), nameKey: stockKey(data.name) }
          : {}),
        ...(data.lowAt !== undefined ? { lowAt: data.lowAt } : {}),
        updatedAt: new Date(),
      },
    });
  },

  /** Off the list; its moves stay for history and the name is free for a new item. */
  async deactivate(db: DbClient, id: string) {
    return db.stockItem.update({ where: { id }, data: { active: false, updatedAt: new Date() } });
  },

  async findMove(db: DbClient, id: string) {
    return db.stockMove.findUnique({ where: { id } });
  },

  /**
   * Changes a balance by `delta` and records the move. D1 has no interactive transactions, so
   * the balance is bumped with an atomic increment first and undone if the move can't be saved.
   *
   * `ifBalance` makes the change conditional: it only applies while the balance is still what
   * the caller read (a shelf count's delta is worked out from it). Returns null when it moved.
   */
  async applyMove(
    db: DbClient,
    data: {
      id?: string;
      itemId: string;
      kind: StockMoveKind;
      delta: number;
      note?: string | null;
      expenseId?: string | null;
      createdByUserId: string;
      ifBalance?: number;
    },
  ) {
    const delta = roundStock(data.delta);
    const bumped = await db.stockItem.updateMany({
      where: { id: data.itemId, ...(data.ifBalance != null ? { balance: data.ifBalance } : {}) },
      data: { balance: { increment: delta }, updatedAt: new Date() },
    });
    if (bumped.count !== 1) return null;
    const item = await db.stockItem.findUniqueOrThrow({ where: { id: data.itemId } });
    const balanceAfter = roundStock(item.balance);
    try {
      const move = await db.stockMove.create({
        data: {
          id: data.id,
          itemId: data.itemId,
          kind: data.kind,
          quantity: delta,
          balanceAfter,
          note: data.note ?? null,
          expenseId: data.expenseId ?? null,
          createdByUserId: data.createdByUserId,
        },
        include: { createdBy: personSelect },
      });
      // Keep the stored balance free of float dust (0.1 + 0.2). An increment, not an overwrite,
      // so a move landing in between isn't lost.
      if (balanceAfter !== item.balance) {
        await db.stockItem.update({
          where: { id: data.itemId },
          data: { balance: { increment: balanceAfter - item.balance } },
        });
      }
      return { move, item: { ...item, balance: balanceAfter } };
    } catch (e) {
      await db.stockItem.update({
        where: { id: data.itemId },
        data: { balance: { increment: -delta } },
      });
      throw e;
    }
  },

  async moves(db: DbClient, itemId: string, limit = 50) {
    return db.stockMove.findMany({
      where: { itemId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { createdBy: personSelect },
    });
  },

  async movesForExpense(db: DbClient, expenseId: string) {
    return db.stockMove.findMany({ where: { expenseId } });
  },

  /** Total used per item since `from` (positive numbers), for "used this week". */
  async usedSince(db: DbClient, from: Date): Promise<Map<string, number>> {
    const rows = await db.stockMove.groupBy({
      by: ['itemId'],
      where: { kind: 'use', createdAt: { gte: from } },
      _sum: { quantity: true },
    });
    return new Map(rows.map((r) => [r.itemId, roundStock(-(r._sum.quantity ?? 0))]));
  },
};
