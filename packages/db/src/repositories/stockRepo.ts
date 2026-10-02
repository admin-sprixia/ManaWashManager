import type { DbClient } from '../client';
import { formatStock, roundStock, stockKey, type StockMoveKind, type StockUnit } from '@mana/domain';

const personSelect = { select: { id: true, name: true } } as const;

/** Balances are kept to 3 decimals; this absorbs float dust when comparing. */
const STOCK_EPSILON = 1e-6;

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
   * the caller read (a shelf count's delta is worked out from it). `ifAtLeast` applies it only
   * while the balance is at least that much. Returns null when the condition didn't hold.
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
      ifAtLeast?: number;
    },
  ) {
    const delta = roundStock(data.delta);
    const near = (value: number) => ({ gte: value - STOCK_EPSILON, lte: value + STOCK_EPSILON });
    const condition =
      data.ifBalance != null
        ? { balance: near(data.ifBalance) }
        : data.ifAtLeast != null
          ? { balance: { gte: data.ifAtLeast - STOCK_EPSILON } }
          : {};
    const bumped = await db.stockItem.updateMany({
      where: { id: data.itemId, ...condition },
      data: { balance: { increment: delta }, updatedAt: new Date() },
    });
    if (bumped.count !== 1) return null;
    const item = await db.stockItem.findUniqueOrThrow({ where: { id: data.itemId } });
    const balanceAfter = roundStock(item.balance) || 0;
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
      // Keep the stored balance free of float dust (1 - 0.8). Only while nothing else has moved
      // it since; otherwise that later move cleans up instead.
      if (balanceAfter !== item.balance) {
        await db.stockItem.updateMany({
          where: { id: data.itemId, balance: near(item.balance) },
          data: { balance: balanceAfter },
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

  /**
   * Takes `quantity` off the shelf without ever going below zero. When the books hold less (use
   * logged on two phones offline, or a voided purchase that was already used), it takes what's
   * there and the note says how much was really meant — the item shows empty and gets recounted,
   * and the record of the use isn't lost. Null when the balance kept moving under it, or the
   * item is gone.
   */
  async takeOut(
    db: DbClient,
    data: {
      id: string;
      itemId: string;
      kind: 'use' | 'void';
      quantity: number;
      note: string | null;
      expenseId?: string | null;
      createdByUserId: string;
    },
  ) {
    const quantity = roundStock(data.quantity);
    for (let attempt = 0; attempt < 3; attempt++) {
      const item = await db.stockItem.findUnique({ where: { id: data.itemId } });
      if (!item) return null;
      const base = { id: data.id, itemId: data.itemId, kind: data.kind, expenseId: data.expenseId ?? null, createdByUserId: data.createdByUserId };
      if (item.balance >= quantity - STOCK_EPSILON) {
        const full = await this.applyMove(db, { ...base, delta: -quantity, note: data.note, ifAtLeast: quantity });
        if (full) return full;
        continue;
      }
      const have = Math.max(0, roundStock(item.balance));
      const short = `${formatStock(quantity, item.unit as StockUnit)} meant, only ${formatStock(have, item.unit as StockUnit)} on the books`;
      const partial = await this.applyMove(db, {
        ...base,
        delta: -have,
        note: data.note ? `${data.note} (${short})` : short,
        ifBalance: item.balance,
      });
      if (partial) return partial;
    }
    return null;
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
