import { isUniqueClash, stockRepo, type DbClient } from '@mana/db';
import { stockUnitOf, toStockQuantity, type ExpenseUnit } from '@mana/domain';

export interface StockResult {
  itemId: string;
  name: string;
  unit: string;
  balance: number;
  created: boolean;
}

/**
 * Adds a purchase to stock: the item with the same name, or a new item when there isn't one.
 * Skipped (null) when the units can't match — e.g. "Car wax" is kept in kg but 2 L was bought.
 */
export async function addPurchaseToStock(
  db: DbClient,
  input: {
    expenseId: string;
    itemName: string;
    quantity: number;
    unit: ExpenseUnit;
    userId: string;
  },
): Promise<StockResult | null> {
  const stockUnit = stockUnitOf(input.unit);
  if (!stockUnit) return null;
  let item = await stockRepo.findByName(db, input.itemName);
  let created = false;
  if (!item) {
    try {
      item = await stockRepo.create(db, {
        name: input.itemName,
        unit: stockUnit,
        lowAt: null,
        createdByUserId: input.userId,
      });
      created = true;
    } catch (e) {
      // Two purchases of a new item at once: the other one made it — add to that one.
      if (!isUniqueClash(e)) throw e;
      item = await stockRepo.findByName(db, input.itemName);
      if (!item) throw e;
    }
  }
  const quantity = toStockQuantity(input.quantity, input.unit, item.unit as typeof stockUnit);
  if (quantity == null) return null;
  const applied = await stockRepo.applyMove(db, {
    id: `exp-${input.expenseId}`,
    itemId: item.id,
    kind: 'in',
    delta: quantity,
    expenseId: input.expenseId,
    note: 'Bought',
    createdByUserId: input.userId,
  });
  if (!applied) return null;
  const after = applied.item;
  return { itemId: after.id, name: after.name, unit: after.unit, balance: after.balance, created };
}

/** A voided purchase comes back off the balance it added to. Safe to call twice. */
export async function reverseExpenseStock(
  db: DbClient,
  expenseId: string,
  userId: string,
): Promise<void> {
  // Each reversal has a fixed id, so a retry (or two voids at once) reverses each line once:
  // lines already reversed are skipped, and losing the race to save one undoes our own bump.
  const moves = await stockRepo.movesForExpense(db, expenseId);
  const reversed = new Set(moves.filter((m) => m.kind === 'void').map((m) => m.id));
  for (const m of moves) {
    if (m.kind !== 'in' || reversed.has(`void-${m.id}`)) continue;
    try {
      // Never below zero: if some of the purchase was already used, only what's left comes off.
      await stockRepo.takeOut(db, {
        id: `void-${m.id}`,
        itemId: m.itemId,
        kind: 'void',
        quantity: m.quantity,
        expenseId,
        note: 'Expense voided',
        createdByUserId: userId,
      });
    } catch (e) {
      const now = await stockRepo.movesForExpense(db, expenseId);
      if (!now.some((x) => x.id === `void-${m.id}`)) throw e;
    }
  }
}
