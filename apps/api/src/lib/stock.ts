import { stockRepo, type DbClient } from '@mana/db';
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
    item = await stockRepo.create(db, {
      name: input.itemName,
      unit: stockUnit,
      lowAt: null,
      createdByUserId: input.userId,
    });
    created = true;
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
  const moves = await stockRepo.movesForExpense(db, expenseId);
  if (moves.some((m) => m.kind === 'void')) return;
  for (const m of moves) {
    if (m.kind !== 'in') continue;
    await stockRepo.applyMove(db, {
      id: `void-${m.id}`,
      itemId: m.itemId,
      kind: 'void',
      delta: -m.quantity,
      expenseId,
      note: 'Expense voided',
      createdByUserId: userId,
    });
  }
}
